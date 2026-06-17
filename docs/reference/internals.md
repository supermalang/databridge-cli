# Implementation internals

The deep version of CLAUDE.md's "Key implementation details". Read the relevant section
before touching the subsystem it describes.

## App database & project model (web/db/)

App state (users ↔ orgs ↔ projects) lives in **Postgres** via SQLAlchemy 2.0 (`web/db/`:
`models.py`, `session.py`, `repository.py`, `provision.py`, `bridge.py`, `bootstrap.py`).
Each project's config is stored as a `jsonb` column (source of truth); every project/org
query is **membership-scoped** so a user only sees their orgs' projects. Users + a personal
org are auto-provisioned from the Zitadel identity on login (and for the dev user at
startup). `DATABASE_URL` is **required** — e.g. a local Postgres via
`docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=databridge -p 5432:5432 postgres:16`.
Migrations are **Alembic** (`alembic upgrade head`), run automatically by the FastAPI startup
lifespan; tests run against SQLite (`DATABRIDGE_SKIP_MIGRATIONS=1` → `init_schema`).
`/api/config` reads/writes the caller's **active project** (`users.active_project_id`); on
save or project switch the config is mirrored to `config.yml` so the file-based CLI and the
existing config-reading endpoints stay consistent. The repo's existing `config.yml` is
imported once at startup as the first project.

## Per-project RBAC, invitations & superadmins (web/db/ + web/main.py + web/zitadel_admin.py)

Access is **per-project**, not org-wide. `ProjectMembership(user_id, project_id, role)` is
the authority (`role ∈ viewer|editor|admin`); each project has an `owner_id` (creator, an
implicit admin), and `users.is_superadmin` is a global override. The rank is
`viewer<editor<admin<superadmin` (`repository.ROLE_RANK` / `role_for` / `role_at_least`).
`list_projects_for_user`/`get_project_for_user` consult ProjectMembership (superadmins see
all).
- **Gating:** `web/main.py:require_role(request, db, minimum)` (and the session-opening
  wrapper `_require`) resolve the **active** project and 403 if under-rank. Applied to every
  mutating endpoint: config/questions/periods(POST)/framework/pii/ask-save/run → **editor**;
  delete reports/sessions/data → **editor**; delete templates/periods, upload/set-active
  template, `DELETE /api/projects` → **admin**. Previews/suggest/AI-test stay ungated.
- **Members:** `GET/POST /api/projects/{id}/members*`, `PATCH`/`DELETE .../members/{user_id}`
  — admin-gated. Guards: a non-owner admin can't remove/demote the **owner** (`#6`); a
  superadmin can't revoke **another** superadmin via `POST /api/admin/superadmins` (`#10`).
- **Invitations:** `Invitation(project_id, email, role, status)`. An admin invite records a
  pending row and (if `ZITADEL_API_TOKEN` is set) creates the user in Zitadel + emails them
  via `web/zitadel_admin.py` (Management v2). `provision.ensure_user` calls
  `repo.consume_invitations_for` on login → turns pending invites (matched by email) into
  ProjectMemberships. Superadmins are bootstrapped from `SUPERADMIN_EMAILS` (env) at startup
  and on first login.
- **Frontend:** `GET /api/projects` returns each project's `role`/`is_owner` +
  `is_superadmin`; `lib/perms.js` (`PermsProvider`/`usePerms` → `canEdit`/`canAdmin`) hides
  destructive controls (server still enforces). `components/ProjectMembersModal.jsx` manages
  members; the project switcher hosts the new-project **Modal**, "Manage members", and
  admin-only "Delete project".

## Object storage & project workspace (web/storage/)

Project **files** (data sessions, reports, templates) are stored durably per project in
**Minio/S3** (`web/storage/`: `Storage` interface, `s3.py`/`local.py` backends, `storage_key`,
lazy `factory.get_storage()`). The local `data/processed`/`reports`/`templates` dirs are a
**materialized mirror of the active project** (`web/storage/workspace.py`): `pull_workspace`
runs on project **activate** (clear local dirs → download the project's files from Minio), and
`push_outputs` runs after a **successful run** (upload outputs back). `data/raw` and
`data/processed/charts` are **not** synced (regenerable). The ~8 on-demand read endpoints +
reports/templates/sessions listing/downloads read the local mirror unchanged. `S3_*` env is
**required** — local Minio via
`docker run --rm -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 minio/minio server /data --console-address ":9001"`;
tests use the local-fs backend (`STORAGE_BACKEND=local`).

**Per-run isolation:** each `/api/run/{command}` executes in its own **temp directory**.
`workspace.hydrate_run_dir` writes the project's config + pulls the command's input categories
(the `RUN_INPUTS` manifest) from Minio into the tempdir; the CLI runs with `cwd=<tempdir>`
(absolute `make.py` path). On success, `_persist_run_outputs` pushes outputs to Minio, syncs a
changed `config.yml` back to the DB, and refreshes the active `BASE_DIR` read-mirror; the
tempdir is removed afterward. The read endpoints + the activate-pull still use the `BASE_DIR`
mirror.

**Run concurrency:** runs are tracked by an in-memory `RunRegistry` (`web/runs.py`), not a
global single-flight lock. **One run per project at a time** (a second run for a busy project →
`409`); **different projects run concurrently** up to `MAX_CONCURRENT_RUNS` (env, default 4;
over the cap → `429` + `Retry-After`). No-active-project runs serialize on a `"__base__"` key
(shared `BASE_DIR`). Each run has a `run_id` (in the first SSE `status` event);
`GET /api/status` lists active runs and `POST /api/stop/{run_id}` stops a specific one.
**Reads remain process-wide:** concurrent users with different active projects share the one
`BASE_DIR` read-mirror (best-effort, last-writer-wins) — durable Minio/DB data is always
correct; true multi-user read isolation is out of scope.

## env: variable resolution (src/utils/config.py)

Config values starting with `env:` are resolved from environment at load time.
```python
if isinstance(obj, str) and obj.startswith("env:"):
    var = obj[4:].strip()
    return os.environ.get(var) or obj
```

## fetch-questions preserves user edits (src/data/questions.py)

On re-run, existing `category` and `export_label` per `kobo_key` are carried over. New
questions from the schema are appended with fresh defaults.

## SSE log streaming (web/main.py)

CLI commands run as subprocesses via `asyncio.create_subprocess_exec`. stdout/stderr merged
and streamed line-by-line via SSE-style frames (event: log/status/done + data: JSON). Only
whitelisted commands (`ALLOWED_COMMANDS`) can be triggered — no arbitrary shell execution.

Runs are **single-flight** at the process level: while one command is active, a second
`POST /api/run/{command}` is rejected with **HTTP 409** (the in-flight command is tracked in
`_running_command`, reserved synchronously in `run_command` and released in `_stream`'s
`finally`); `GET /api/status` reports `running`. This prevents two pipeline runs from
clobbering the shared `_proc` and `config.yml`/`data/`. (Per-project concurrency via
`RunRegistry` is the durable, multi-project layer on top — see Object storage above.)

The React side reads it with `fetch().body.getReader()` in `hooks/useCommand.js` (EventSource
is GET-only); a non-OK response (e.g. the 409) is surfaced as an error log line.

## Frontend ↔ backend wiring in dev

Vite (`:51730`) proxies `/api/*` → uvicorn (`:8000`). All `fetch('/api/…')` calls in the React
app go through the proxy. Same code paths work in prod-like mode (single port).

## Export routing (src/data/transform.py)

```python
export_data() → _export_file()     # csv, json, xlsx
             → _export_sql()       # mysql, postgres (requires sqlalchemy)
             → _export_supabase()  # supabase (requires supabase-py)
```
Database drivers are optional imports — only install what you need.

## Base-table linkage columns (src/data/flatten.py)

`load_data` flattens submissions into a main table plus one base table per repeat level
(including nested sub-repeats) via `build_repeat_tables`. Every repeat row carries linkage
columns:

- `_root_id` — id of the root submission the row descends from
- `_parent_index` — alias of `_root_id` (kept for backward-compat with filters, computed
  columns, `join_repeat_to_main`, and split reports)
- `_parent_row_id` — `_row_id` of the immediate parent repeat row (equals `_root_id` for
  top-level repeats)
- `_row_id` — stable composite id, e.g. `"12.0.1"` (root 12 → member 0 → illness 1)
- `_row_index` — position within the immediate parent

Join any level to its parent on `_parent_row_id == parent._row_id`, or to the root on
`_root_id == main._id`. The catalog is exposed read-only at `GET /api/base-tables`.

## Data profiling (src/data/profile.py)

`profile_dataset(cfg, main_df, repeat_tables)` computes a deterministic, structured EDA
profile for every base table — per-column `role`, completeness, cardinality, numeric stats +
3×IQR outliers, date ranges, low-cardinality top values, plus per-table numeric correlations
and duplicate-id info. It is the single source of truth for these signals: `validate.py`
(findings) and `summaries.py` (narrative) derive their numbers from `profile.py`'s primitives
(`null_stats`, `iqr_bounds`, `numeric_outliers`, `correlations`). No LLM, no I/O.

`top_values` are computed only for low-cardinality columns (≤ `LOW_CARDINALITY_MAX`, default
20) so the profile never surfaces individual free-text/PII values.

Exposed read-only at `GET /api/profile`; rendered in the **Profile** tab.

## PII gate (src/utils/pii.py)

PII has two tiers:
- **Strict export gate** — `enforce_pii` runs inside `export_data` (default `redact=True`).
  It calls `validate_pii_config` (fail-closed: a configured `consent_column` or `redact`
  column missing from the data, or an unknown strategy, raises `PIIConfigError` and aborts the
  download), consent-gates the main table, prunes orphaned repeat rows (parents filtered out by
  consent, via `_parent_index`), then applies redaction. So `data/processed` + DB/Supabase are
  always redacted + consent-gated.
- **Lenient render net** — the existing `apply_pii` still runs at report/preview time as
  defense-in-depth (log-and-skip on missing columns); it operates on already-gated data.

`download --no-redact` is an explicit, off-by-default escape hatch that writes RAW data
(internal/secure use only) and logs a warning; it is CLI-only (not in the web UI's
ALLOWED_COMMANDS flag whitelist). Reports built from a raw session are still redacted by the
lenient render net. The post-download classification re-export passes `redact=False` (its data
was already gated by the primary export).

## Ask question-engine (src/reports/ask_engine.py)

`ask(question, cfg, df, repeat_tables)` answers a natural-language question with 1–3
locally-computed answers — each either a **chart** or a scalar **indicator** (the LLM picks per
item):
1. `build_catalog` condenses the Layer 2 profile into a data-aware catalog (roles, cardinality,
   low-cardinality top-values, numeric ranges; linkage columns excluded).
2. `propose_items` asks the LLM (`ask_propose` prompt) for `kind`-tagged recipes
   (`{"items": [{"kind": "chart"|"indicator", ...}]}`).
3. `validate_recipe` dispatches by kind: charts → `CHART_REQS` role checks; indicators →
   `INDICATOR_STATS` + stat/column/role checks. Invalid recipes are dropped with a reason.
4. Execute locally: charts → `render_recipe` (chart engine); indicators → `compute_indicator`
   (the `compute_indicators` engine).
5. `ground_captions` (`ask_caption` prompt) writes one-line captions from each answer's ACTUAL
   computed values (chart stats block / indicator value+stat); falls back to the title if AI is
   off.
Duplicate names within a batch are disambiguated. `save_recipe(recipe, cfg, kind)` appends a
chosen recipe to `config.charts` (chart) or `config.indicators` (indicator). Exposed at
`POST /api/ask` and `POST /api/ask/save` (`{recipe, kind}`); surfaced in the **Ask** tab
(charts as images, indicators as big-number cards). Needs an AI provider and downloaded data.

A returned answer can be **refined** in plain language ("make it a line chart", "split by sex",
"just give me the number") via `refine_item` (the `ask_refine` prompt) → `POST /api/ask/refine`;
the revised recipe is re-validated/executed (it may switch chart↔indicator) and the Ask tab
replaces the card in place. `_execute_item` is the shared validate→execute helper used by both
`ask` and `refine_item`, so a refined answer behaves identically to an asked one.

## Web UI tabs

The React app under `frontend/src/pages/` has six tabs that mirror the pipeline:

| Tab | Purpose | Backend endpoints |
|---|---|---|
| Dashboard | Greeting + pipeline strip + KPIs + runs + AI queue + project usage | `/api/state`, `/api/run/{cmd}`, `/api/data/sessions` |
| ① Sources | Platform picker (Ona/Kobo) · API & form · AI Narrative · Output formats | `/api/config`, `/api/ai/test` |
| ② Questions | Group accordions with inline `export_label` editing, bulk keep/delete | `/api/questions` |
| ③ Composition | Filters · Charts · Indicators · Summaries · Views · Templates | `/api/config`, `/api/templates` |
| ④ Reports | Generated `.docx` reports + downloaded data sessions | `/api/reports`, `/api/data/sessions` |
| Templates | Standalone template management (also embedded in Composition) | `/api/templates*` |

The **BottomTerminal** is a sticky bottom drawer rendered on the Dashboard page: pipeline-run /
fetch-questions log sessions plus a ttyd `shell` session (only works if you also run ttyd
separately — not required). All CSS lives in `frontend/src/styles.css` (design tokens at the
top, component styles below).
