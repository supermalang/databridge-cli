# Orchestrator, Slice 2 (Build-Report Staleness) Design

**Date:** 2026-05-31
**Status:** Design (decisions made autonomously per the owner's "run autonomously" directive; review async)
**Roadmap:** Orchestrator Slice 2, following Slice 1 (`run-all` sequencer). Adds "only re-run what changed" for the expensive stage.

---

## 1. Goal

When `run-all` runs but **nothing that affects the report has changed**, skip the expensive `build-report` stage. Concretely: after the (always-run) download, if the downloaded data **content** and the report-relevant **config** are identical to what produced the last report, skip rebuilding and log that the report is up-to-date. `--force` always rebuilds.

---

## 2. Scope & key decisions (autonomous)

- **Build-report staleness only.** Detection is **content-based** (hash of the data files + a hash of the report-relevant config), not mtime/count-based — so it correctly catches *edited* submissions and config tweaks, and never skips when output would differ.
- **Download always runs** (it's the refresh; it's cheap relative to a wrong/stale report and always correct). Skipping the download *itself* (detecting remote changes without fetching) is **deferred** — count-based remote checks silently miss edited submissions, a correctness trade-off worth deciding with the owner. **This deferral is the one item to surface on the owner's return.**
- **Safe default:** any uncertainty (no prior state, unreadable files, hash mismatch) → treat as stale → rebuild. Staleness can only ever *skip a redundant rebuild*, never *skip a needed one*.
- `--force` flag on `run-all` bypasses the check.

**Out of scope (later):** download/remote staleness; the `_proc` concurrency fix; scheduling; configurable stage lists.

---

## 3. Architecture

A new pure-ish module `src/data/run_state.py` owns the fingerprinting + sidecar; `run-all` consults it around the build-report stage. No change to `build-report`/`download` themselves.

### `src/data/run_state.py`
- `data_fingerprint(cfg) -> Optional[str]` — sha256 over the **content** of the current period's latest data session files (the same files `load_processed_data` would read: the `{prefix}_data*` main file + any repeat files, sorted by name). Returns `None` if no data exists. Hashing bytes makes it content-sensitive (catches edits/additions; insensitive to filename timestamps).
- `config_fingerprint(cfg) -> str` — sha256 over a stable JSON dump of the **report-relevant** config sections: `charts, indicators, summaries, views, report, framework, pii, periods, questions` (sorted keys). Excludes nothing volatile beyond what doesn't affect a report. (Distinct from provenance's `config_hash`, which intentionally narrows differently; this one is purposely broad so any report-affecting edit invalidates the cache.)
- `STATE_FILENAME = ".run_all_state.json"`, stored in the report output dir (`cfg.report.output_dir`, default `reports/`).
- `load_state(cfg) -> dict` / `save_state(cfg, data_fp, config_fp)` — read/write the sidecar `{"data": <fp>, "config": <fp>, "built_at": <iso>}`. `built_at` is passed in (no `datetime.now()` inside, to keep the module deterministic/testable; `run-all` stamps it).
- `report_is_current(cfg) -> bool` — `True` iff: a `.docx` exists in the report output dir AND the sidecar exists AND `state["data"] == data_fingerprint(cfg)` (both non-None) AND `state["config"] == config_fingerprint(cfg)`. Any miss → `False` (stale).

### `src/data/make.py` — `run-all`
- Add `--force` option.
- After download (and template-if-missing), before build-report:
  ```
  from src.data import run_state
  if not force and run_state.report_is_current(cfg):
      log.info("✓ report up-to-date — skipping build-report (use --force to rebuild).")
  else:
      log.info("▶ build-report")
      ... _invoke(cmd_build_report, ...) ...
      run_state.save_state(cfg, run_state.data_fingerprint(cfg), run_state.config_fingerprint(cfg), built_at=<now iso>)
      log.info("✓ build-report")
  log.info("✓ Pipeline complete.")
  ```
  The `cfg` used is the one loaded at the top of `run-all` (re-load after download is unnecessary for fingerprints — `config_fingerprint` reads the same cfg object; `data_fingerprint` reads the freshly-written files from disk).

### Web / Frontend
- No new endpoint. `--force` is CLI-level; the dashboard "Run pipeline" button keeps calling `run-all` (default = staleness-aware skip). Optionally a future toggle could pass `--force`, but Slice 2 doesn't add UI (the staleness skip is the desirable default; the run-log shows "report up-to-date — skipping").

---

## 4. Error handling
Fail-safe-toward-rebuild: `data_fingerprint` returns `None` (→ stale) on missing/unreadable data; `report_is_current` returns `False` on any read error or missing sidecar. A corrupt sidecar → stale → rebuild (and overwrite the sidecar). `save_state` failures are logged and non-fatal (the report still built; next run just won't skip). Nothing about staleness can cause a wrong or missing report.

## 5. Testing (TDD)
- `tests/test_run_state.py`:
  - `data_fingerprint`: stable across calls for identical files; changes when a data file's content changes; `None` when no data.
  - `config_fingerprint`: stable; changes when `charts`/`indicators`/`report`/etc. change; unaffected by an unrelated top-level key.
  - `report_is_current`: `True` only when a report exists + sidecar matches both fingerprints; `False` on missing report, missing sidecar, data change, or config change.
  - `save_state`/`load_state` round-trip.
- `tests/test_run_all.py` (extend): with `_invoke` monkeypatched (record stage order) + a tmp report dir, simulate: first run builds (sidecar written); second run with unchanged data+config **skips** build-report (build-report not in calls; "up-to-date" logged); after a config change it builds again; `--force` always builds. (Stub `run_state.data_fingerprint` or write tmp files to control fingerprints.)
- Full suite green (currently 295).

## 6. Risks & open questions
- **Download still always runs** — Slice 2 optimizes only the report. The headline "data changed → rebuild" is fully delivered for the report; "skip the download when remote is unchanged" is the deferred piece (needs the owner's call on edit-detection trade-offs).
- **Non-deterministic export** — if `export_data` ever produced non-deterministic bytes for identical data (it currently writes a deterministic CSV of the dataframe), fingerprints would differ and the skip simply wouldn't fire (safe).
- **config_fingerprint breadth** — deliberately broad (any report-affecting edit invalidates). If it's too broad (e.g. a comment-only `ai` change forcing a rebuild), that only costs a redundant rebuild, never a wrong skip.
