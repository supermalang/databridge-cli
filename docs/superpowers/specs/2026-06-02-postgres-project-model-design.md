# Postgres Project Model — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 2 of the multi-tenant SaaS re-platforming

---

## Context

databridge-cli is being re-platformed from a local single-user tool into a multi-tenant
SaaS backed by Postgres (app state), Zitadel (identity — **shipped in Slice 1**), and Minio
(object storage — Slice 3). See `docs/superpowers/specs/2026-06-02-zitadel-login-gate-design.md`.

Today, after Slice 1:
- Identity is in place: every request resolves to a Zitadel user (`sub`/`email`/`name`), or
  a fixed dev user (`dev-local`) when OIDC is unconfigured.
- Project config still lives in a single global `config.yml` at the repo root, loaded /
  validated / env-resolved by `src/utils/config.py` (`load_config` / `write_config`).
- The web backend reads/writes that one file via `GET`/`POST /api/config`; the CLI reads it
  from disk; runs are single-flight (Slice 1's `_running_command` lock).
- Data "sessions" are derived from files on disk (`list_sessions` parses `data/processed`
  filenames); run staleness is a JSON sidecar (`reports/.run_all_state.json`).

This slice introduces the **Postgres data model** — users ↔ orgs ↔ projects — and migrates
per-project config into Postgres as the source of truth, while keeping the existing
file-based CLI working via a run-time bridge.

---

## Goal

Stand up a Postgres-backed (SQLAlchemy + Alembic) data model with three tenancy tiers
(users → orgs → projects), auto-provision users/orgs from Zitadel identity, store each
project's config as `jsonb` (source of truth), make the web backend read/write the active
project's config from the DB, and make the project switcher real — all while the existing
CLI keeps running unchanged by materializing the active project's config to `config.yml` at
run time under the single-flight lock.

### Non-goals (deferred)
- **Session/run metadata in the DB** — tightly coupled to on-disk `data/` files and the
  run-state sidecar; deferred to **Slice 3** (when files move to Minio).
- Object storage (Minio), per-job temp-workspace hydration — **Slice 3**.
- Rewriting the CLI to read config from the DB directly — explicitly out (per-job hydration
  in Slice 3 replaces the bridge).
- Cross-config SQL querying / admin dashboards, org invitations UI, role management beyond
  `owner`/`member`, billing.

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Tenancy tiers | **users → orgs → projects** (membership table w/ role) | Matches multi-tenant SaaS goal; orgs are the isolation boundary |
| Config source of truth | **`jsonb` on the project row** (SQLAlchemy `JSON` → `jsonb` on PG) | Transactional, atomic with the project, optimistic concurrency; big blobs go to Minio in Slice 3, not config |
| Provisioning | **Auto-provision personal org on first login** | Zero-friction self-serve onboarding |
| DB in dev/prod | **Postgres required everywhere** (via `DATABASE_URL`) | Production-faithful; real `jsonb` in dev |
| Migrations | **Alembic** | Reversible, versioned schema evolution |
| SQLAlchemy style | **Sync** + threadpooled `def` endpoints | Matches existing sync SQLAlchemy usage; no event-loop blocking |
| CLI compatibility | **Run-time bridge:** jsonb → `config.yml` under the single-flight lock | CLI unchanged; Slice 3 replaces with hydration |
| Session/run metadata | **Deferred to Slice 3** | Coupled to on-disk files; low value until files move to S3 |

---

## Schema

Five tables (plus Alembic's `alembic_version`). All ids are surrogate integers or UUIDs
(implementer's choice; UUID preferred for SaaS). Timestamps `created_at` / `updated_at` on
all rows.

**users**
- `id` (PK)
- `zitadel_sub` (string, **unique, not null**) — stable identity key from the IdP
- `email` (string), `name` (string)
- `active_project_id` (nullable FK → projects.id) — the caller's current project
- `created_at`, `updated_at`

**orgs**
- `id` (PK)
- `name` (string, not null)
- `slug` (string, **unique, not null**) — filesystem/URL-safe; derived from name/email
- `created_by` (FK → users.id)
- `created_at`, `updated_at`

**memberships**
- `id` (PK)
- `user_id` (FK → users.id, not null)
- `org_id` (FK → orgs.id, not null)
- `role` (string, not null) — `owner` | `member`
- **unique (user_id, org_id)**
- `created_at`

**projects**
- `id` (PK)
- `org_id` (FK → orgs.id, not null)
- `name` (string, not null)
- `slug` (string, not null) — **unique within org** (unique constraint on `(org_id, slug)`)
- `config` (`JSON`/`jsonb`, not null, default `{}`) — the full config tree, source of truth
- `config_version` (int, not null, default 1) — optimistic concurrency
- `created_at`, `updated_at`

**Access rule:** every project/org query is scoped through `memberships` for the current
user — a user can only see/edit orgs they're a member of and projects in those orgs.

---

## Code layout

New package **`web/db/`**:

- `models.py` — the five SQLAlchemy ORM models + the declarative `Base`.
- `session.py` — `engine` + `SessionLocal` built from `DATABASE_URL`; a `get_db()` FastAPI
  dependency yielding a `Session` (closes in `finally`).
- `repository.py` — pure CRUD/query functions taking a `Session`: `get_user_by_sub`,
  `list_projects_for_user`, `get_project_for_user` (membership-checked, raises/returns None
  if unauthorized), `create_project`, `set_active_project`, `update_project_config`
  (version-checked), etc. No FastAPI imports here — testable in isolation.
- `provision.py` — `ensure_user(db, claims) -> User`: idempotent upsert (user + personal
  org + owner membership + active_project default).
- `bridge.py` — `materialize_config(project, path=CONFIG_PATH)`: serialize a project's
  `config` jsonb → YAML and write it to `config.yml` (the run-time bridge).
- `bootstrap.py` — `run_migrations()` (Alembic to head) + `import_legacy_config(db)`
  (one-time import of the repo `config.yml`).

Alembic config + `migrations/` directory at repo root. `alembic` added to `requirements.txt`.

`web/main.py` wires: DB engine init + `bootstrap` on startup; the new project/org endpoints;
the run-time bridge call; and rewrites `/api/config` to go through the DB.

---

## Provisioning (integrates with Slice 1 auth)

`provision.ensure_user(db, claims)` — idempotent, keyed by `zitadel_sub`:
1. Upsert the user row (update email/name on each login).
2. If the user has no memberships, create a **personal org** (`slug` derived from the email
   local-part, de-duplicated) and an `owner` membership.
3. If `active_project_id` is null, set it to the user's first available project (if any).

Call sites:
- **Real users:** from `/auth/callback` (Slice 1), after `exchange_token`, via
  `asyncio.to_thread(ensure_user, ...)` (sync DB call from the async handler).
- **Dev user (`dev-local`):** once at startup bootstrap (auth-off mode has no callback).

So `./scripts/dev.sh` continues to work end-to-end with zero auth setup: the dev user is
provisioned and owns the imported legacy project.

---

## Config flow

### Editing — per-user, transactional (no frontend change)
- `GET /api/config` → load the caller's active project; serialize its `config` jsonb to a
  YAML string; return the existing contract `{"content": <yaml>, "exists": bool}`.
  (`exists: false` with empty content when the user has no active project yet.)
- `POST /api/config` → accept the existing `{content, version?}` body; parse YAML (400 on
  invalid, as today); write to the active project's `config` jsonb; bump `config_version`.
  If a `version` is supplied and is stale, return **409** (optimistic concurrency); the
  frontend already surfaces non-OK detail.

The frontend's `lib/config.js` YAML-based contract is preserved; the only behavioral change
is that config is now per-active-project rather than a global file.

### Running — the run-time bridge
The CLI subprocesses read `config.yml` from disk. So at **run time only**, inside the
existing single-flight critical section in `web/main.py` (`run_command`, guarded by
`_running_command`), call `bridge.materialize_config(active_project)` to write the active
project's jsonb → `config.yml` immediately before spawning the subprocess. Because runs are
already serialized, the shared `config.yml` is never contended. Slice 3 replaces this with
per-job temp-workspace hydration.

---

## Active project + project/org endpoints

- `GET /api/projects` → `[{id, name, slug, org: {id, name}}, ...]` for the caller (across
  their orgs), plus `active_id`.
- `POST /api/projects` → `{name, org_id?}` → create a project (in the given org, or the
  caller's personal org); seeded with an empty/default config; membership-checked.
- `POST /api/projects/{id}/activate` → set `users.active_project_id` (membership-checked;
  404 if not a member of the project's org).

Frontend: the hardcoded `PROJECT` constant in `App.jsx` becomes a real switcher — lists the
caller's projects, shows the active one, switches via `/activate`, and offers "New project".
On switch, the keep-alive panes refresh (reuse the existing `databridge:data-changed` event)
so config-bound tabs reload against the new active project.

---

## Bootstrap / migration of existing config.yml

On app startup (and as an idempotent operation):
1. `run_migrations()` — Alembic upgrade to head (creates tables on a fresh DB).
2. `import_legacy_config(db)` — if the repo's `config.yml` exists and no project has been
   imported from it yet (tracked by a sentinel project slug, e.g. `legacy-import`, or a
   marker), create it as a project named from `report.title`/`form.alias` (fallback
   "PCP Mauritania") under the bootstrap org, and set it active for the dev user.

Nothing is lost; the current working project carries over.

---

## Configuration (env vars)

Added to `.env.example`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLAlchemy URL, e.g. `postgresql+psycopg2://user:pass@localhost:5432/databridge` |

Dev setup note (documented in CLAUDE.md / README): run a local Postgres, e.g.
`docker run -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:16`, and set `DATABASE_URL`
accordingly. `psycopg2-binary` (already commented in `requirements.txt`) is uncommented.

---

## Testing (TDD)

Tests run against **SQLite** (temp file) via the same SQLAlchemy models — fast, no live
Postgres in CI. The `JSON` column type works on both dialects (we don't rely on PG-only
JSON querying this slice).

- **Provisioning idempotency:** `ensure_user` twice → one user, one personal org, one
  membership; email/name updated on re-login.
- **Membership-scoped access:** user A cannot read/edit user B's org's projects
  (`get_project_for_user` returns None / repository raises).
- **Config round-trip:** jsonb ↔ YAML through `GET`/`POST /api/config`; invalid YAML → 400.
- **Optimistic concurrency:** stale `version` on `POST /api/config` → 409; fresh → bumps
  version.
- **Bridge:** `materialize_config` writes a YAML file whose `load_config` round-trips to the
  stored jsonb.
- **Project create/activate authorization:** create in a non-member org → rejected; activate
  a non-member project → 404; happy paths set state correctly.
- **Bootstrap import idempotency:** importing the legacy `config.yml` twice → one project.

DB-touching API tests use a `TestClient` with `get_db` overridden to a SQLite test session
and auth disabled (dev user), mirroring the existing API-test pattern.

---

## Risks / open points

- **Single shared `config.yml` is process-wide.** Correct only because runs are
  single-flight; concurrent runs for different projects are NOT supported until Slice 3's
  per-job hydration. Editing is per-user/per-project and safe (DB). Documented as interim.
- **Postgres required in dev** breaks the previous zero-service `dev.sh` loop; mitigated by
  documented one-line local Postgres. (Explicit user decision.)
- **Startup migrations** run automatically; acceptable for this stage. A separate
  `migrate` command/flag may be preferable for prod later (out of scope).
- **Slug collisions** for personal orgs (same email local-part across IdPs) — de-duplicate
  with a numeric suffix.
- **Legacy import marker** must be robust so re-import doesn't duplicate or clobber edits.
