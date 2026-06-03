# Per-Project Run Concurrency — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 3c-ii (final sub-slice of Slice 3 / the multi-tenant SaaS re-platforming)

---

## Context

Re-platforming into a multi-tenant SaaS: Postgres (Slice 2), Zitadel (Slice 1), Minio (Slice 3).
Slice 3 progress:
- **3a** — `web/storage/` Storage abstraction (S3/Minio + local-fs backends).
- **3b** — `web/storage/workspace.py`: Minio is the durable per-project store; the local
  `data/processed`/`reports`/`templates` dirs are a materialized mirror of the active project.
- **3c-i** — each run executes in its own temp directory (hydrate config from DB + inputs from
  Minio → run `cwd=tempdir` → push outputs to Minio + sync config to DB + refresh the read-mirror).
  Runs are still globally single-flight.
- **3c-ii (this spec)** — relax single-flight to **per-project concurrency**: a run registry
  replaces the global `_proc`/`_running_command`/`_last_status`, per-project locks allow different
  projects to run concurrently (bounded by a global cap), `/api/stop` & `/api/status` become
  per-run, and the frontend tracks a `run_id`.

Today the run path is three module globals — `_proc` (the one subprocess), `_running_command`
(global single-flight name), `_last_status` — with a global 409 guard, `POST /api/stop` killing the
one process, `GET /api/status` reading the globals, and a single `useCommand` hook in the UI that
runs one command at a time.

---

## Goal

Allow runs for **different projects to execute concurrently** (each already isolated in its own
tempdir by 3c-i), serialized **per project** and bounded by a **global concurrency cap**, with
per-run stop/status and a `run_id` the frontend can target. The single-browser UI still runs one
command at a time; the concurrency is for other users/projects.

### Non-goals (genuinely out — end of the roadmap)
- **Multi-user READ isolation.** The `BASE_DIR` read-mirror stays a single process-wide "active
  view" (best-effort, last-writer-wins under concurrency). Per-request hydration of the ~8 read
  endpoints was deferred in 3b and stays out.
- A **job queue** when the cap is hit (we reject, not queue).
- A persistent **runs/audit table** (the registry is in-memory).
- A **full multi-run UI** (one user launching several runs at once).

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Locking | **Per-project lock + global cap** | Project = isolation unit (shared workspace/Minio prefix); cap bounds host resources |
| Cap exceeded | **Reject (429 + `Retry-After`)** | No queue infra (YAGNI); queueing is a future add |
| No-active-project runs | Lock key sentinel `"__base__"` | They use `cwd=BASE_DIR`; must serialize (shared dir) |
| Pre-run `mirror_active` | **Dropped** | Run uses the tempdir's config (from DB), not `BASE_DIR/config.yml`; under concurrency it's a process-wide write race |
| Frontend | **Minimal** — `run_id` capture + stop-by-id | Single browser runs one at a time; concurrency is cross-user |
| Reads | **Process-wide mirror, unchanged** | True per-user read isolation explicitly out of scope |
| Registry | **In-memory** `RunRegistry` | No persistence need this slice |

---

## Architecture — `web/runs.py` (`RunRegistry`)

A new module holds an in-memory registry that replaces the three globals.

```
class RunInfo:   run_id, command, lock_key, proc, status, started_at, finished_at

class BusyError(Exception)   # lock_key already running  -> 409
class CapError(Exception)    # global cap reached         -> 429

class RunRegistry:
    MAX_CONCURRENT  # from env MAX_CONCURRENT_RUNS, default 4

    start(command: str, lock_key: str) -> str          # run_id; raises BusyError / CapError
    attach_proc(run_id: str, proc) -> None
    set_status(run_id: str, status: str) -> None
    finish(run_id: str) -> None                        # remove from active (releases lock + cap slot)
    get(run_id: str) -> RunInfo | None
    active() -> list[RunInfo]
    last() -> RunInfo | None                           # most-recent finished (for the Dashboard)
    async stop(run_id: str) -> bool                    # terminate→kill that run's proc; False if unknown
```

**Atomicity:** `start` (the check-and-reserve) is a *synchronous* method with no `await` between
the lock/cap check and the registration — atomic on the single asyncio event loop, exactly like the
current single-flight check-and-set. `start` rejects when an active run shares `lock_key`
(`BusyError`) or when `len(active) >= MAX_CONCURRENT` (`CapError`); otherwise it mints a `run_id`
(`uuid4().hex[:12]`) and registers a pending `RunInfo`.

**Lock key** = the run's `project_id`, or `"__base__"` when there is no active project (legacy
`cwd=BASE_DIR` runs serialize on the shared dir).

A bounded ring of recently-finished runs (e.g. last 20) backs `last()`; active runs live in the main
dict until `finish`.

---

## Run lifecycle changes (`web/main.py`)

- **`run_command`**: build `cmd`, resolve `run_ctx=(org_id, project_id, cfg)` as today (still under a
  `SessionLocal`), compute `lock_key = project_id or "__base__"`, then:
  ```
  try:
      run_id = registry.start(command, lock_key)
  except BusyError:  -> HTTP 409 ("a run is already in progress for this project")
  except CapError:   -> HTTP 429 (+ Retry-After) ("server is at capacity, retry shortly")
  ```
  **Remove** the pre-run `db_bridge.mirror_active(...)` call (vestigial; the run reads the tempdir's
  config). Return `StreamingResponse(_stream(run_id, command, cmd, run_ctx), …)`.
- **`_stream(run_id, command, cmd, run_ctx)`**: unchanged tempdir hydrate→run→dehydrate, except:
  - the spawned process is registered via `registry.attach_proc(run_id, proc)` (no module `_proc`);
  - the initial `status` SSE event includes `run_id`: `{"status":"running","command":…,"run_id":run_id}`;
  - `registry.set_status(run_id, status)` on completion; `registry.finish(run_id)` in `finally`
    (releases the lock + cap slot; no global to clear).
  - Hydrate-failure / run-failure paths still emit `error` status + `done` and `finish` the run.

The 3c-i tempdir isolation, dehydrate (Minio push + DB config sync + `BASE_DIR` read-mirror refresh),
and tempdir cleanup are unchanged. The read-mirror refresh remains process-wide best-effort.

---

## status / stop API

- **`GET /api/status`** → `{"running": <bool any active>, "runs": [{"run_id","command","project_id","status"}], "last": {<most-recent finished status>}}`. Keeps a `running` bool + a `last` object so the existing Dashboard keeps working.
- **`POST /api/stop/{run_id}`** → `await registry.stop(run_id)`; `{"ok": true}` if stopped, `404`/`{"ok": false}` if the run_id is unknown/finished.
- **`POST /api/stop`** (no id, back-compat) → if exactly one active run, stop it; else `400`
  ("specify a run_id"). The frontend switches to the by-id route.

---

## Frontend (minimal — `frontend/src/hooks/useCommand.js`)

- The `status` SSE event now carries `run_id`; `useCommand` stores it in a ref when the first
  `status` event arrives (it already forwards `payload` to `onStatus`).
- `stop()` POSTs `/api/stop/${runId}` (the captured id) instead of `/api/stop`. If no `run_id` yet
  (race before the first event), fall back to `/api/stop`.
- The single-run re-entry guard (`if (running) return`) and the one-hook model are unchanged.
- No new UI components; the Dashboard's existing `running`/status display is unaffected (the status
  shape keeps `running` + `last`).

---

## Error handling

- `start` contention → `409` (project busy) / `429` (+ `Retry-After: 2`) (server at capacity). No
  process is spawned, no registry entry leaks.
- Run failure/exception (hydrate, spawn, or CLI) → `error` status + `done`; `registry.finish(run_id)`
  in `finally` always releases the lock + cap slot.
- `stop` on an unknown/already-finished `run_id` → `404` / `{ok: false}` (idempotent, no crash).
- Registry check-and-reserve is `await`-free (atomic on the event loop) — no TOCTOU race between two
  concurrent `start` calls.

---

## Testing (TDD)

**`web/runs.py` (unit):**
- per-key lock: `start("download","p1")` then `start("build-report","p1")` → `BusyError`; a different
  key (`"p2"`) → succeeds.
- global cap: with `MAX_CONCURRENT=2`, the 3rd concurrent `start` → `CapError`.
- `run_id` uniqueness; `finish` releases both the lock (same key can start again) and a cap slot;
  `stop` terminates a registered proc; `stop` on unknown id → False.

**API (hermetic via `isolated_base`, fake subprocess):**
- two runs for **different** projects both stream to completion concurrently (interleaved), and both
  outputs land in their respective Minio prefixes.
- a second run for the **same** project while one is active → `409`.
- cap-exceeded (`MAX_CONCURRENT_RUNS=1` via env) → `429`.
- `GET /api/status` lists the active run(s) and a `running` bool; `last` reflects a finished run.
- the `run_id` appears in the stream's first `status` event; `POST /api/stop/{run_id}` stops that run
  and is reflected in `/api/status`.
- existing `tests/test_run_all_api.py` single-flight semantics are replaced by the per-key tests
  (the global 409-when-busy test becomes a same-key 409 test).

---

## Risks / open points

- **Reads remain process-wide.** Concurrent users with different active projects share the one
  `BASE_DIR` read-mirror — documented end-state; durable data (Minio/DB) is always correct.
  Per-user read isolation would be a further (unscheduled) slice.
- **In-memory registry** — runs are lost on process restart (the subprocess is also killed). Fine for
  a single-process deployment; a multi-replica deploy would need shared run state (out of scope).
- **Global cap default (4)** — tune via `MAX_CONCURRENT_RUNS`; too low serializes unrelated projects,
  too high risks host exhaustion.
- **`mirror_active` removal** — confirm no read endpoint depended on the *pre-run* config refresh
  (activate already mirrors config + workspace; post-run dehydrate refreshes again). The removal only
  drops a redundant, race-prone write.
- **Dehydrate read-mirror refresh under concurrency** — still last-writer-wins on `BASE_DIR`; the
  durable Minio/DB outputs are unaffected. Acceptable per the reads-out-of-scope boundary.
