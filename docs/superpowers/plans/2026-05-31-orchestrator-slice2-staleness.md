# Orchestrator Slice 2 — Build-Report Staleness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** `run-all` skips the `build-report` stage when the downloaded data content and report-relevant config are unchanged since the last build; `--force` always rebuilds.

**Architecture:** A new `src/data/run_state.py` computes content-based fingerprints (data via `load_processed_data`, config via a stable hash of report-relevant sections) and persists a sidecar `reports/.run_all_state.json`. `run-all` consults `report_is_current(cfg)` around build-report and calls `save_state` after building. Safe-toward-rebuild.

**Tech Stack:** Python 3, pandas, pytest, Click.

**Spec:** `docs/superpowers/specs/2026-05-31-orchestrator-slice2-staleness-design.md`. On `main`: orchestrator Slice 1 merged; suite 295.

## File structure
- **Create:** `src/data/run_state.py`.
- **Modify:** `src/data/make.py` (`run-all`: `--force` + skip/build + save_state).
- **Create:** `tests/test_run_state.py`; **Modify:** `tests/test_run_all.py`.
- **Modify:** `CLAUDE.md`.

---

## Task 1: `run_state.py` fingerprints + sidecar

**Files:** Create `src/data/run_state.py`; Test `tests/test_run_state.py`.

- [ ] **Step 1: Write the failing tests** in `tests/test_run_state.py`:

```python
import pandas as pd
from src.data import run_state
from src.data.transform import export_data, load_processed_data


def _cfg(tmp_path, **extra):
    cfg = {
        "form": {"alias": "survey"},
        "export": {"format": "csv", "output_dir": str(tmp_path / "data")},
        "report": {"output_dir": str(tmp_path / "reports")},
        "charts": [{"name": "c", "type": "bar", "questions": ["Region"]}],
    }
    cfg.update(extra)
    return cfg


def test_config_fingerprint_stable_and_sensitive(tmp_path):
    cfg = _cfg(tmp_path)
    fp = run_state.config_fingerprint(cfg)
    assert fp == run_state.config_fingerprint(cfg)                       # stable
    cfg2 = _cfg(tmp_path, charts=[{"name": "c2", "type": "pie", "questions": ["Region"]}])
    assert run_state.config_fingerprint(cfg2) != fp                      # report-relevant change
    cfg3 = _cfg(tmp_path)
    cfg3["some_unrelated_key"] = {"x": 1}
    assert run_state.config_fingerprint(cfg3) == fp                      # unrelated key ignored


def test_data_fingerprint_none_when_no_data(tmp_path):
    assert run_state.data_fingerprint(_cfg(tmp_path)) is None


def test_data_fingerprint_changes_with_content(tmp_path):
    cfg = _cfg(tmp_path)
    export_data(pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"]}), cfg)
    fp1 = run_state.data_fingerprint(cfg)
    assert fp1 is not None and fp1 == run_state.data_fingerprint(cfg)    # stable
    export_data(pd.DataFrame({"_id": [1, 2], "Region": ["N", "E"]}), cfg)  # content changed
    assert run_state.data_fingerprint(cfg) != fp1


def test_state_roundtrip_and_report_is_current(tmp_path):
    cfg = _cfg(tmp_path)
    export_data(pd.DataFrame({"_id": [1], "Region": ["N"]}), cfg)
    # no report yet -> not current
    assert run_state.report_is_current(cfg) is False
    # drop a report + record matching state -> current
    rdir = tmp_path / "reports"; rdir.mkdir(parents=True, exist_ok=True)
    (rdir / "survey_report.docx").write_text("x")
    run_state.save_state(cfg, run_state.data_fingerprint(cfg), run_state.config_fingerprint(cfg), built_at="2026-05-31T00:00:00")
    assert run_state.load_state(cfg)["data"] == run_state.data_fingerprint(cfg)
    assert run_state.report_is_current(cfg) is True
    # config change -> stale
    cfg["charts"] = [{"name": "z", "type": "pie", "questions": ["Region"]}]
    assert run_state.report_is_current(cfg) is False
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_run_state.py -v` — expect FAIL (ModuleNotFoundError).

- [ ] **Step 3: Create `src/data/run_state.py`:**

```python
"""Build-report staleness for `run-all` (Orchestrator Slice 2).

Content-based fingerprints + a sidecar so `run-all` can skip rebuilding an
up-to-date report. Safe-toward-rebuild: any uncertainty -> "stale" -> rebuild.
"""
from __future__ import annotations
import hashlib
import json
import logging
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)

STATE_FILENAME = ".run_all_state.json"
# Config sections that affect a built report; any change here invalidates the cache.
_CONFIG_KEYS = ["charts", "indicators", "summaries", "views", "report",
                "framework", "pii", "periods", "questions"]


def _report_dir(cfg: Dict) -> Path:
    return Path(cfg.get("report", {}).get("output_dir", "reports"))


def data_fingerprint(cfg: Dict) -> Optional[str]:
    """sha256 (truncated) over the CONTENT of the data build-report would read for
    the current period. None when no data exists. Filename timestamps are ignored —
    only the data values matter (so an identical re-download yields the same fp)."""
    from src.data.transform import load_processed_data
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return None
    except Exception as e:  # noqa: BLE001
        log.warning(f"run_state: data_fingerprint load failed ({e}); treating as stale.")
        return None
    h = hashlib.sha256()
    h.update(df.to_csv(index=False).encode("utf-8"))
    for name in sorted(repeats or {}):
        h.update(name.encode("utf-8"))
        h.update(repeats[name].to_csv(index=False).encode("utf-8"))
    return h.hexdigest()[:16]


def config_fingerprint(cfg: Dict) -> str:
    """sha256 (truncated) over the report-relevant config sections (stable JSON)."""
    subset = {k: cfg.get(k) for k in _CONFIG_KEYS}
    blob = json.dumps(subset, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def load_state(cfg: Dict) -> Dict:
    try:
        return json.loads((_report_dir(cfg) / STATE_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(cfg: Dict, data_fp: Optional[str], config_fp: str, built_at: str) -> None:
    rdir = _report_dir(cfg)
    try:
        rdir.mkdir(parents=True, exist_ok=True)
        (rdir / STATE_FILENAME).write_text(
            json.dumps({"data": data_fp, "config": config_fp, "built_at": built_at}),
            encoding="utf-8",
        )
    except OSError as e:  # noqa: BLE001
        log.warning(f"run_state: could not save state: {e}")


def report_is_current(cfg: Dict) -> bool:
    """True iff a report exists AND the sidecar matches the current data + config
    fingerprints. Any miss / error -> False (rebuild)."""
    rdir = _report_dir(cfg)
    if not rdir.exists() or not any(rdir.glob("*.docx")):
        return False
    state = load_state(cfg)
    if not state:
        return False
    data_fp = data_fingerprint(cfg)
    if data_fp is None:
        return False
    return state.get("data") == data_fp and state.get("config") == config_fingerprint(cfg)
```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_state.py -v` (expect 4 passed). Then full suite `PYTHONPATH=. python -m pytest tests/ -q`.

- [ ] **Step 5: Commit**
```bash
git add src/data/run_state.py tests/test_run_state.py
git commit -m "feat(run-state): content-based build-report staleness fingerprints + sidecar"
```

---

## Task 2: Wire staleness + `--force` into `run-all`

**Files:** Modify `src/data/make.py`; Test `tests/test_run_all.py`.

- [ ] **Step 1: Append tests** to `tests/test_run_all.py` (the file already has `_write_cfg` + CliRunner imports from Slice 1; reuse them):

```python
from src.data import run_state as _run_state


def test_run_all_skips_build_when_current(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: True)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0
    assert "download" in calls and "build-report" not in calls     # skipped
    assert "up-to-date" in res.output.lower()


def test_run_all_force_rebuilds_even_when_current(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: True)
    monkeypatch.setattr(_run_state, "save_state", lambda *a, **k: None)
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all", "--force"])
    assert res.exit_code == 0 and "build-report" in calls


def test_run_all_builds_and_records_when_stale(tmp_path, monkeypatch):
    calls = []
    saved = {}
    monkeypatch.setattr(make, "_invoke", lambda ctx, command, **kw: calls.append(command.name))
    monkeypatch.setattr(_run_state, "report_is_current", lambda cfg: False)
    monkeypatch.setattr(_run_state, "data_fingerprint", lambda cfg: "d")
    monkeypatch.setattr(_run_state, "config_fingerprint", lambda cfg: "c")
    monkeypatch.setattr(_run_state, "save_state", lambda cfg, d, c, built_at: saved.update({"d": d, "c": c}))
    p = _write_cfg(tmp_path, template_exists=True)
    res = CliRunner().invoke(make.cli, ["--config", str(p), "run-all"])
    assert res.exit_code == 0 and "build-report" in calls
    assert saved == {"d": "d", "c": "c"}     # state recorded after building
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all.py::test_run_all_skips_build_when_current -v` — expect FAIL (no `--force`, no skip logic).

- [ ] **Step 3: Edit `cmd_run_all` in `src/data/make.py`.**
  (a) Add the `--force` option (after `--period`):
  ```python
  @click.option("--force", is_flag=True, default=False, help="Rebuild the report even if data + config are unchanged.")
  ```
  and add `force` to the signature: `def cmd_run_all(ctx, sample, period, force):`.
  (b) Replace the existing build-report block (the `log.info("▶ build-report")` ... `_invoke(ctx, cmd_build_report, ...)` ... `log.info("✓ Pipeline complete.")` section) with:
  ```python
          from src.data import run_state
          if not force and run_state.report_is_current(cfg):
              log.info("✓ report up-to-date — skipping build-report (use --force to rebuild).")
          else:
              log.info("▶ build-report")
              try:
                  # sample=None on purpose: build-report reads the already-downloaded session
                  # (the --sample on run-all limited the download, not the report).
                  _invoke(ctx, cmd_build_report, sample=None, random_sample=False, split_by=None,
                          split_sample=None, session=None, period=period, compare=None)
              except SystemExit:
                  raise
              except Exception as e:  # noqa: BLE001
                  click.echo(f"✗ build-report failed: {e}", err=True)
                  sys.exit(1)
              run_state.save_state(cfg, run_state.data_fingerprint(cfg),
                                   run_state.config_fingerprint(cfg),
                                   built_at=datetime.now().isoformat(timespec="seconds"))
              log.info("✓ build-report")
          log.info("✓ Pipeline complete.")
  ```
  (c) Ensure `datetime` is available: `make.py` likely imports it; if not, add `from datetime import datetime` at the top (check existing imports first — other commands use timestamps).

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_run_all.py -v` (expect all pass incl. the 3 new) then full suite `PYTHONPATH=. python -m pytest tests/ -q`. Confirm `run-all --help` shows `--force`.

- [ ] **Step 5: Commit**
```bash
git add src/data/make.py tests/test_run_all.py
git commit -m "feat(run-all): skip build-report when up-to-date; --force to rebuild"
```

---

## Task 3: Docs

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** In the `run-all` note added in Slice 1, append a sentence:
> Slice 2 adds **build-report staleness**: `run-all` skips rebuilding when the downloaded data content + report-relevant config are unchanged since the last build (content fingerprints recorded in `reports/.run_all_state.json`); pass `--force` to rebuild regardless. (Skipping the *download* itself when the remote is unchanged is a later slice.)

Add the `--force` example to the `run-all` bash block:
```bash
python3 src/data/make.py run-all --force   # rebuild even if nothing changed
```

- [ ] **Step 2: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` (green).

- [ ] **Step 3: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: document run-all build-report staleness (--force)"
```

---

## Self-review notes
- **Spec coverage:** content-based `data_fingerprint` + broad `config_fingerprint` + sidecar (T1) ✓; `report_is_current` safe-toward-rebuild (T1) ✓; run-all skip + `--force` + `save_state` after build (T2) ✓; download always runs / download-staleness deferred (unchanged in T2) ✓; docs (T3) ✓.
- **Type/name consistency:** `data_fingerprint(cfg)->str|None`, `config_fingerprint(cfg)->str`, `load_state(cfg)->dict`, `save_state(cfg, data_fp, config_fp, built_at)`, `report_is_current(cfg)->bool`; run-all imports `from src.data import run_state` and calls those names. `built_at` passed in by run-all (no `datetime.now()` inside run_state — deterministic/testable).
- **Safety:** every failure path returns "stale" → rebuild; `save_state` failure is non-fatal. Staleness can only skip a redundant rebuild.
- **No placeholders:** complete code/commands throughout.
