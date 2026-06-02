# Materialized Project Workspace + Minio — Design

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 3b (second sub-slice of Slice 3) of the multi-tenant SaaS re-platforming

---

## Context

Re-platforming into a multi-tenant SaaS: Postgres (Slice 2, done), Zitadel (Slice 1, done),
Minio object storage (Slice 3). Slice 3 was split:
- **3a (done)** — `web/storage/`: a `Storage` abstraction (`LocalStorage` for tests, `S3Storage`
  for Minio), per-project key helper `storage_key(org_id, project_id, category, name)`, lazy
  `get_storage()`/`reset_storage()` factory. Pure infra, no run-path wiring.
- **3b (this spec)** — make the local working dirs a materialized mirror of the active
  project's files, with Minio as the durable per-project store; wire it into activate + the
  run path; keep the existing read/listing/download endpoints unchanged.
- **3c (deferred)** — true per-job temp-workspace isolation + relax single-flight to
  per-project concurrency + per-run process/stream tracking + a formal runs/audit table.

Today: the CLI and ~8 on-demand read endpoints (profile, validate, data-quality, ask,
view-preview, base-tables, period-preview, …) read `data/processed` from disk via
`load_processed_data(cfg)`; reports/templates/sessions listing + downloads read
`reports/`/`templates/`/`data/processed/` from disk. Slice 2 mirrors the active project's
config to `config.yml` (the durable copy is the Postgres `jsonb`). There is no durable
per-project storage for data/reports/templates — switching projects would collide on disk.

---

## Goal

Make Minio the durable per-project store for project **files** (data sessions, reports,
templates), and make the local `data/processed/`, `reports/`, `templates/` directories a
**materialized mirror of the active project** — refreshed on project activation and after a
run. The runner keeps running in `cwd=BASE_DIR` under the existing single-flight lock and,
on success, pushes outputs to Minio. The ~8 read endpoints, listing, and downloads are
**unchanged** (they read the local mirror, which now reflects exactly the active project).

This delivers per-project storage isolation (switching projects swaps the workspace; no
cross-project bleed) without a per-endpoint rewrite.

### Non-goals (→ Slice 3c)
- Per-job temp-workspace hydration / per-run tempdirs.
- Relaxing single-flight; per-project concurrency; per-run process/stream tracking.
- A formal `runs`/audit table. (Sessions stay derived from the mirror, as today.)
- Migrating the on-demand read endpoints to hydrate-from-Minio-per-request.

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Execution model | **Single materialized active-project workspace** (not per-run tempdirs) | Under single-flight, the mirror IS the workspace; far less churn; reads work synchronously |
| Durable store | **Minio** holds per-project `processed`/`reports`/`templates` | Per-project isolation; survives project switches |
| Local dirs | **Materialized mirror of the active project**, swapped on activate | Existing endpoints read it unchanged |
| Synced categories | **processed, reports, templates** | The durable, non-regenerable artifacts |
| Excluded | **raw, charts** (`data/raw/`, `data/processed/charts/`) | Intermediate / regenerable / large |
| Concurrency | **Deferred to 3c** (single-flight retained) | Needs a streaming-layer refactor; isolation lands without it |
| Sessions metadata | **Derived from the mirror** (no new tables) | Matches current `list_sessions`; YAGNI |

---

## Architecture & data flow

Minio is the durable per-project store keyed by `orgs/<org_id>/projects/<project_id>/<category>/<name>`.
The local dirs are scratch space for the active project:

| Category | Local dir | Minio prefix |
|---|---|---|
| `processed` | `data/processed/` (data files only; excludes `charts/`) | `.../processed/` |
| `reports` | `reports/` | `.../reports/` |
| `templates` | `templates/` | `.../templates/` |

Lifecycle:
1. **Activate** (`POST /api/projects/{id}/activate`): set active project (Slice 2) →
   `mirror_active` writes `config.yml` (Slice 2) → **`pull_workspace(project)`** clears the
   three local dirs and downloads the active project's files from Minio into them.
2. **Run** (`POST /api/run/{command}`): single-flight reservation (unchanged) → config.yml
   already mirrored, data/templates already present from activate → CLI runs in
   `cwd=BASE_DIR` (unchanged) → on **success**, **`push_outputs(project)`** uploads the local
   dirs' files to Minio. (Config changes from `suggest-*` are already synced to the DB by the
   Slice-2 file→DB sync helper; that remains.)
3. **Bootstrap**: one-time, for the legacy-import project, push the existing local
   `data/processed`/`reports`/`templates` to Minio so the current data is durable.

---

## New module: `web/storage/workspace.py`

Bridges project files ↔ Minio (via `get_storage()` + `storage_key`) ↔ local dirs. Depends on
the `Storage` abstraction (3a) and reads a `Project` (org_id/project_id/id) but builds keys
from plain strings.

```
CATEGORY_DIRS = {"processed": "data/processed", "reports": "reports", "templates": "templates"}

def project_files(project, base=BASE_DIR) -> dict[str, list[Path]]
    # local files per category for a project's mirror (processed excludes the charts/ subdir)

def pull_workspace(org_id, project_id, base=BASE_DIR) -> int
    # for each category: clear the local dir, then download every Minio key under
    # storage_key(org_id, project_id, category, "") into CATEGORY_DIRS[category].
    # Returns the number of files pulled.

def push_outputs(org_id, project_id, base=BASE_DIR) -> int
    # for each category: upload every local file (excluding data/processed/charts/) to
    # storage_key(org_id, project_id, category, <relpath>). Idempotent overwrite.
    # Returns the number of files pushed.

def is_empty(org_id, project_id) -> bool
    # True if the project has no objects under any category prefix (for bootstrap idempotency).
```

`pull_workspace`/`push_outputs` take ids (callers pass `str(project.org_id)`,
`str(project.id)`) so the module stays decoupled from the ORM. `processed` excludes the
`charts/` subdir on both pull and push.

---

## Wiring points (targeted edits to `web/main.py`, `web/db/bootstrap.py`)

- **`activate_project`** — after `db_repo.set_active_project` + `db_bridge.mirror_active`,
  call `workspace.pull_workspace(str(project.org_id), str(project.id))`.
- **Run path** — resolve the active project at run start (already done for `mirror_active`);
  thread `org_id`/`project_id` into `_stream`; on `status == "success"` (before the
  `finally`), call `workspace.push_outputs(org_id, project_id)` inside a `try/except` that
  logs failures (the CLI work already succeeded — a push failure must not crash the stream or
  wedge state).
- **Bootstrap** (`init_db` / a new `import_legacy_workspace`) — after `import_legacy_config`,
  if `workspace.is_empty(org_id, project_id)` for the legacy project, `push_outputs(...)` once
  so the existing local data is durable. Idempotent.
- **Listing/downloads** (`/api/reports*`, `/api/templates*`, `/api/data/sessions*`) —
  **unchanged**; they read the local mirror.

---

## Error handling

- `pull_workspace` failure on activate → 5xx to the client; `active_project_id` stays set (its
  DB write already committed) so a retry re-pulls. The local mirror may be partially cleared;
  a re-activate fully re-pulls.
- `push_outputs` failure after a successful run → logged loudly; run status still reports the
  CLI result; local outputs remain on disk and can be re-pushed on the next run/activate.
- Single-flight (Slice 1) still serializes runs, so the shared local dirs are never contended.
- `Storage` `get_*` raise `KeyError` for missing keys (3a contract); `pull_workspace` lists
  then gets, so it never requests a missing key.

---

## Testing (TDD)

Tests use the `LocalStorage` backend (conftest `_app_storage` fixture) + temp dirs, plus the
session DB fixture.

- **`pull_workspace`/`push_outputs` round-trip:** push files for a project, clear local,
  pull → identical files restored under the right dirs.
- **Category mapping + exclusions:** `processed` data files sync; `data/processed/charts/*.png`
  and `data/raw/*` are NOT pushed; `reports`/`templates` `.docx` sync.
- **Activate swaps the mirror:** seed project A (reports r1) and B (reports r2) in Minio;
  activate A → local `reports/` has r1 only; activate B → r2 only (A's cleared).
- **Run pushes outputs:** simulate a run that writes a new report locally; `push_outputs` →
  it appears under the project's Minio `reports/` prefix.
- **Bootstrap idempotency:** `import_legacy_workspace` pushes once; a second call with a
  non-empty prefix is a no-op (`is_empty` False).
- **API-level:** after `POST /api/projects/{id}/activate`, `GET /api/reports` /
  `GET /api/data/sessions` reflect the activated project's mirror; an existing read endpoint
  (e.g. `GET /api/profile`) still works against the mirror.

---

## Risks / open points

- **Active-project mirror is process-wide** — correct only under single-flight (Slice 1).
  Concurrent users with different active projects would contend on the local dirs; that is the
  documented interim until 3c's per-job isolation. (Same constraint Slice 2 documented for
  `config.yml`.)
- **Real-Minio parity** — 3a tested `S3Storage` against a mock; `workspace` tests use
  `LocalStorage`. A real-Minio smoke test (round-trip a project's files) is worthwhile during
  rollout but is out of automated-CI scope.
- **`pull_workspace` clears local dirs** — must scope deletion to `CATEGORY_DIRS` only (never
  touch `src/`, `config.yml`, `data/raw` beyond its lane). The clear step deletes files under
  the mapped dirs only; `data/processed/charts/` is preserved across pulls (regenerated).
- **Large data sessions** — pulling a big project's processed data on every activate has a
  latency cost; acceptable for the single-active-user interim, revisited with 3c.
