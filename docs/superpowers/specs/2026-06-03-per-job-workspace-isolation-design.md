# Per-Job Temp-Workspace Isolation — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — ready for implementation plan
**Slice:** 3c-i (first sub-slice of Slice 3c) of the multi-tenant SaaS re-platforming

---

## Context

Re-platforming into a multi-tenant SaaS: Postgres (Slice 2), Zitadel (Slice 1), Minio
(Slice 3). Slice 3 progress:
- **3a (done)** — `web/storage/`: `Storage` abstraction + S3/Minio + local-fs backends + key helper.
- **3b (done)** — `web/storage/workspace.py`: Minio is the durable per-project store; the local
  `data/processed`/`reports`/`templates` dirs are a materialized mirror of the active project
  (`pull_workspace` on activate, `push_outputs` after a successful run, both against `BASE_DIR`).
- **3c-i (this spec)** — run each CLI command in its own **temp directory** (hydrate → run →
  dehydrate), decoupling execution from the shared `BASE_DIR` read-mirror. Single-flight retained.
- **3c-ii (deferred)** — per-run process/stream registry, per-project locks (replacing the global
  single-flight), per-run `/api/stop` & `/api/status`, frontend run-ids, concurrent multi-project runs.

Today (after 3b): a run executes with `cwd=BASE_DIR` against the active project's materialized
mirror, and `_stream` pushes the mirror's outputs to Minio on success. The run thus **mutates the
same dirs the ~8 read endpoints serve from**, while they serve from them. The run machinery is global
singletons: `_proc`, `_running_command`, `_last_status`; `/api/status` and `/api/stop` act on the one
global process; the frontend runs one command at a time.

---

## Goal

Make every run execute in an isolated temp directory: hydrate the project's config (from the DB) and
the command's required inputs (from Minio) into the tempdir, run the CLI with `cwd=<tempdir>`, then
push outputs to Minio, sync any config changes back to the DB, and refresh the active-project
read-mirror so read endpoints see the new outputs. This decouples execution from the read mirror and
is the groundwork for concurrency — **without** touching the global run/streaming machinery
(single-flight stays; one run at a time).

### Non-goals (→ Slice 3c-ii)
- Per-run process/stream registry; replacing global single-flight with per-project locks.
- Per-run `/api/stop` & `/api/status`; frontend run-id tracking.
- Concurrent runs (multi-project / multi-user).
- Running a non-active project (runs stay scoped to the requesting user's active project).

---

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Execution location | **Per-run temp directory** (not `BASE_DIR`) | Decouples a run from the read mirror; the original per-job-workspace vision |
| Concurrency machinery | **Unchanged** — global single-flight, global `_proc`/stop/status | One run at a time; concurrency is 3c-ii |
| Hydration | **Command-aware manifest** (config always; inputs per command) | Avoids pointless downloads (e.g. `download` needs no inputs) |
| Run scope | **Requesting user's active project** | Matches the current UI; arbitrary-project runs are 3c-ii |
| Read mirror | **Refreshed after a successful active-project run** | So the ~8 read endpoints + listing see new outputs |
| Config sync-back | **tempdir `config.yml` → DB** when a command mutates it | `suggest-*`/`generate-template` write config in the tempdir |

---

## The tempdir lifecycle

Orchestrated in `web/main.py`'s run path; the file-moving primitives live in `web/storage/workspace.py`.

1. **Hydrate** — `workspace.hydrate_run_dir(org_id, project_id, command, dest, cfg)`:
   - write `dest/config.yml` from the project's DB `jsonb` (`cfg`, via `write_config`);
   - for each input category in the command's manifest, download the project's Minio files into the
     mapped local dir under `dest` (`processed → dest/data/processed`, `templates → dest/templates`);
   - `data/raw` and `charts` are never hydrated.
   Returns the number of input files pulled.

2. **Run** — spawn `python <ABS BASE_DIR>/src/data/make.py <command> [args…]` with `cwd=dest`,
   env `PYTHONPATH=BASE_DIR`, `PYTHONUNBUFFERED=1`. The CLI's cwd-relative paths (`config.yml`,
   `data/processed`, `reports`, `templates`, `data/processed/charts`) resolve **inside the tempdir**.
   The absolute `make.py` path is required because `cwd ≠ BASE_DIR`. Logs stream exactly as today.

3. **Dehydrate on success** — `workspace.dehydrate_run_dir(org_id, project_id, dest, db, project)`:
   - `push_outputs(org_id, project_id, base=dest)` → Minio (processed/reports/templates top-level
     files; charts/raw excluded — reuses the 3b primitive);
   - if `dest/config.yml` differs from the stored config, parse it and
     `repo.update_project_config(db, project, parsed)` (DB stays source of truth — handles
     `suggest-*`/`generate-template` config mutations);
   - if this run's project is the **requesting user's active project**, refresh the `BASE_DIR`
     read-mirror: `mirror_active` (config.yml) + `pull_workspace(...BASE_DIR)` (data/reports/templates)
     so the read endpoints reflect the new outputs.

4. **Cleanup** — remove `dest` in a `finally` (success or failure).

---

## Command → input manifest

`RUN_INPUTS: dict[str, list[str]]` in `workspace.py` (config is always written, never listed):

| Command | Input categories hydrated |
|---|---|
| `download` | `[]` (regenerates processed data) |
| `build-report` | `["processed", "templates"]` |
| `generate-template`, `ai-generate-template` | `[]` (writes templates from config) |
| `suggest-charts/views/summaries/tables/indicators` | `["processed"]` |
| `run-all` | `["processed", "templates"]` |
| `fetch-questions`, `push-prompts` | `[]` |

Unknown/unlisted commands default to `["processed", "templates"]` (safe superset). Documented and
easily tunable.

---

## Wiring (`web/main.py`)

`run_command` already resolves the active project + ids under the single-flight reservation. Extend:
- Resolve the project's config dict (DB) and ids; pass them + the chosen command into `_stream`.
- `_stream` (still using the global `_proc`/`_running_command`):
  - create a tempdir (`tempfile.mkdtemp`);
  - `hydrate_run_dir(...)`;
  - spawn the CLI with `cwd=tempdir` and the **absolute** `make.py` path (the `cmd` list's script
    path becomes `str(BASE_DIR / "src/data/make.py")`);
  - on `status == "success"` and a resolved project: `dehydrate_run_dir(...)` inside try/except
    (logged-not-fatal);
  - `finally`: clear `_proc`/`_running_command` (as today) **and** `shutil.rmtree(tempdir, ignore_errors=True)`.

The single-flight 409 guard, `/api/status`, and `/api/stop` are unchanged (one run, one global proc).
The 3b `activate` pull and all read/listing/download endpoints are unchanged.

---

## Error handling

- **Hydrate failure** (Storage/DB) before spawn → remove the tempdir, release the single-flight lock,
  surface as an error log line + `error` status (the lock is already reserved in `run_command`; the
  `_stream` `finally` releases it, mirroring today's behavior).
- **Run failure** (returncode ≠ 0 / exception) → no push, no config sync, no mirror refresh; tempdir
  removed; status `error`.
- **Dehydrate failure** after a successful run → logged loudly (warning SSE line); status still
  reports the CLI success; outputs are lost on tempdir cleanup (regenerable by re-running) — the same
  posture as 3b's push-failure interim.
- Tempdir is **always** removed in `finally`.

---

## Testing (TDD, LocalStorage backend, hermetic via `isolated_base`)

- **`hydrate_run_dir`:** writes `dest/config.yml` from the cfg dict; pulls the manifest's categories
  for the command into `dest/data/processed` + `dest/templates`; `download` pulls 0 inputs;
  `build-report` pulls processed + templates; raw/charts never hydrated.
- **`RUN_INPUTS` manifest:** returns the expected categories per command; unknown command → safe default.
- **`dehydrate_run_dir`:** pushes the tempdir's new outputs to Minio under the project prefix; a changed
  `config.yml` is written back to the project's DB `config` (version bumped); when the project is the
  active one, the `BASE_DIR` mirror is refreshed (a new report appears in `BASE_DIR/reports`).
- **End-to-end run:** a fake subprocess writes a report into the tempdir; after the streamed run, the
  report is in Minio, the active `BASE_DIR/reports` mirror has it, and the tempdir no longer exists.
- **Hydrate failure releases the lock:** monkeypatch hydrate to raise → run ends `error`,
  `_running_command` is None.
- **Cleanup:** the tempdir is removed on both success and failure.

---

## Risks / open points

- **Still single-flight** — one run at a time; concurrency is 3c-ii. The tempdir gives isolation but
  the global `_proc`/lock means no parallelism yet.
- **Read-mirror refresh after run** — adds a Minio round-trip on every active-project run (pull). The
  download command excludes inputs on hydrate but a refresh re-pulls processed; acceptable under
  single-flight, revisited with 3c-ii.
- **Large data** — hydrating processed data into a tempdir per run (for `build-report`/`run-all`) costs
  a Minio download each run; acceptable interim.
- **`make.py` absolute path** — the spawned command must use `str(BASE_DIR / "src/data/make.py")`; a
  relative path would not resolve under `cwd=tempdir`. Covered in the implementation + an end-to-end test.
- **Config sync-back diff** — comparing tempdir `config.yml` to stored config decides whether to write
  back; parse-and-compare (not a byte diff) to avoid formatting-only writes.
