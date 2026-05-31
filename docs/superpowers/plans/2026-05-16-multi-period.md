# Multi-Period Support (Phase B.2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let M&E teams collect, store, and analyze data across multiple **periods** (baseline → midline → endline; or quarterly rounds) without overwriting each other. Indicators learn to compare across periods (delta, % change), and reports can be built per-period or as period-comparison.

**Architecture:**
- A top-level `periods:` block in `config.yml` is the source of truth — a registry of periods with `current` and `baseline` pointers.
- Data files are physically separated by a period slug: `{alias}_{slug}_data_{ts}.csv` and `{alias}_{slug}_{group}_{ts}.csv`. Repeat-table loader auto-discovers them.
- All existing flows degrade gracefully when `periods:` is absent — single-period mode behaves identically to today (backward compat is mandatory).
- Comparison reports work by extending the existing build pipeline to optionally accept multiple periods; per-indicator Jinja placeholders gain `_p_<slug>`, `_delta`, and `_pct_change` variants. No new docx template engine.
- A new `period_bar` / `period_line` chart family takes an indicator name and plots its value across the periods listed in the registry.

**Tech Stack:** Python 3.12 + pandas + click + docxtpl + FastAPI + pytest; React + Vite frontend; no new third-party deps.

**Non-goals:**
- Time series WITHIN a single period (e.g. daily series in Q1). The existing `line`/`area` chart types already cover that.
- Multi-form federation (one project = one Kobo form). Period support is per-form.
- Automatic period detection from data (the user always declares periods explicitly).
- Editing period boundaries in the UI beyond a simple "+ Add period" workflow — bulk imports / spreadsheet of periods is out of scope.

**Backward-compat contract (mandatory):**
- Config without a `periods:` block → all CLI commands, endpoints, and UI behave exactly as today.
- Existing data files without a period slug remain loadable. New downloads in single-period mode keep the old naming.

**Risk + rollback:**
- This is a 28-task plan spanning data model, CLI, backend, frontend, and docs. Mid-plan rework risk is real.
- Each commit is atomic and individually reversible. The sub-phase boundaries (after Task 8, 14, 22) are natural checkpoints — pause-and-review if anything feels off.

---

## Sub-phases at a glance

| Sub-phase | Tasks | Delivers |
|---|---|---|
| **B.2.a Foundations** | 1 – 8 | Period schema + per-period data downloads + provenance integration. Solves the silent-overwrite bug. |
| **B.2.b Per-period indicators** | 9 – 14 | Indicators carry baseline/delta/pct-change values. Template placeholders + UI surface them. |
| **B.2.c Comparison reports** | 15 – 22 | `--compare A,B` CLI + multi-period builder + `period_bar`/`period_line` charts + UI Compare button. |
| **B.2.d UI polish + docs** | 23 – 28 | Active-period chip, dropdowns, history, README + CLAUDE.md. |

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/periods.py` | create | `slugify(label)`, `current_period(cfg)`, `period_paths(cfg, alias, slug)`, `parse_period_arg(cfg, arg)` |
| `tests/test_periods.py` | create | Unit tests for the helpers |
| `src/data/transform.py:417-460` | modify | `_export_file` writes period-prefixed filenames when `periods.current` is set |
| `src/data/transform.py:663-738` | modify | `load_processed_data(cfg, period=None)` discovers period-prefixed files; falls back to legacy glob |
| `src/data/make.py:download` | modify | New `--period` flag; falls back to `cfg.periods.current` if any |
| `src/data/make.py:build-report` | modify | New `--period` flag; new `--compare "A,B[,C]"` flag |
| `src/data/make.py` | add | New `set-period` CLI command for scripting |
| `src/reports/indicators.py:47-87` | modify | `compute_indicators` accepts optional `per_period` map; emits `_p_<slug>`, `_delta`, `_pct_change` placeholders |
| `tests/test_indicators_periods.py` | create | Unit tests for per-period indicator placeholder emission |
| `src/reports/charts.py` | modify | Register `period_bar` and `period_line` in `CHART_DISPATCH` |
| `src/reports/builder.py:105-160` | modify | Accept `--compare` periods, load each via `load_processed_data`, pass per-period data to indicators + charts |
| `src/utils/provenance.py:51-78` | modify | Provenance footer includes the active period label (or "compare A vs B vs C") |
| `web/main.py` | append | `GET /api/periods`, `POST /api/periods/current`, `POST /api/periods/registry`, `DELETE /api/periods/registry/{slug}` |
| `tests/test_periods_endpoints.py` | create | Endpoint smoke tests |
| `frontend/src/components/PeriodPicker.jsx` | create | Reusable dropdown + "+ Add period" inline |
| `frontend/src/pages/Sources.jsx` | modify | Period picker + per-period download history table |
| `frontend/src/pages/Dashboard.jsx` | modify | Active period chip in the top hero |
| `frontend/src/App.jsx` | modify | Active-period chip in the global topbar |
| `frontend/src/pages/Composition.jsx` | modify | Indicator row shows `Q1: 75 → Q2: 82 (+9.3%)` trend chip; chart catalog adds `period_bar`/`period_line` |
| `frontend/src/pages/Reports.jsx` | modify | Group reports by period; "Compare" button → period multi-select modal |
| `frontend/src/styles.css` | append | Period chip, picker, history table |
| `README.md` | modify | "Multi-period workflow" section |
| `CLAUDE.md` | modify | Update config.yml annotated example + commands list |

---

## Period config contract (referenced throughout)

```yaml
periods:
  current:  "Q2 2026"         # the active period label
  baseline: "Q1 2026"         # canonical comparison anchor
  registry:
    - label:   "Q1 2026"
      slug:    "q1_2026"      # filesystem-safe; auto-derived from label if absent
      started: 2026-01-01     # optional
      ended:   2026-03-31     # optional
    - label:   "Q2 2026"
      slug:    "q2_2026"
      started: 2026-04-01
      ended:   2026-06-30
```

**Slug rules** (implemented in `src/utils/periods.py:slugify`):
- Lowercase
- Strip accents
- Replace any run of non-alphanumeric with `_`
- Strip leading/trailing underscores
- Truncate to 32 chars

Example: `"Q1 2026 — Baseline"` → `"q1_2026_baseline"`.

---

## Sub-phase B.2.a: Foundations

### Task 1: Period helpers module + tests

**Files:**
- Create: `src/utils/periods.py`
- Create: `tests/test_periods.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_periods.py`:

```python
from src.utils.periods import slugify, current_period, parse_period_arg, period_data_glob


def test_slugify_basic():
    assert slugify("Q1 2026") == "q1_2026"

def test_slugify_strips_accents():
    assert slugify("Année 1") == "annee_1"

def test_slugify_collapses_punctuation():
    assert slugify("Q1 2026 — Baseline!") == "q1_2026_baseline"

def test_slugify_truncates_long_labels():
    assert len(slugify("a very long period label " * 20)) <= 32

def test_slugify_strips_leading_trailing_underscores():
    s = slugify("___Q1 2026___")
    assert not s.startswith("_") and not s.endswith("_")

def test_current_period_returns_none_when_no_periods_block():
    assert current_period({}) is None

def test_current_period_returns_label_when_set():
    cfg = {"periods": {"current": "Q2 2026", "registry": [{"label": "Q2 2026", "slug": "q2_2026"}]}}
    p = current_period(cfg)
    assert p == {"label": "Q2 2026", "slug": "q2_2026"}

def test_current_period_auto_derives_slug_if_missing():
    cfg = {"periods": {"current": "Q2 2026", "registry": [{"label": "Q2 2026"}]}}
    p = current_period(cfg)
    assert p["slug"] == "q2_2026"

def test_parse_period_arg_explicit_label_overrides_current():
    cfg = {"periods": {"current": "Q1 2026", "registry": [
        {"label": "Q1 2026", "slug": "q1_2026"},
        {"label": "Q2 2026", "slug": "q2_2026"},
    ]}}
    p = parse_period_arg(cfg, "Q2 2026")
    assert p["label"] == "Q2 2026"

def test_parse_period_arg_unknown_label_creates_ephemeral():
    cfg = {"periods": {"current": "Q1 2026", "registry": []}}
    p = parse_period_arg(cfg, "Q3 2026")
    assert p == {"label": "Q3 2026", "slug": "q3_2026"}

def test_period_data_glob_returns_alias_period_pattern():
    pat = period_data_glob("monitoring", "q1_2026")
    assert pat == "monitoring_q1_2026_data_*"
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pytest tests/test_periods.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement the helpers**

Create `src/utils/periods.py`:

```python
"""Period registry helpers for multi-period support.

A "period" is a named data-collection round (baseline / Q1 / midline / etc).
The registry lives under cfg["periods"] with this shape:

    periods:
      current:  "Q2 2026"
      baseline: "Q1 2026"
      registry:
        - label:   "Q1 2026"
          slug:    "q1_2026"
          started: 2026-01-01
          ended:   2026-03-31

When the registry is absent the project is in "single-period mode" — all
helpers return None so callers can fall back to legacy behavior.
"""
from __future__ import annotations
import re
import unicodedata
from typing import Dict, List, Optional


_SLUG_MAX = 32


def slugify(label: str) -> str:
    """Filesystem-safe slug from a period label."""
    s = unicodedata.normalize("NFD", label or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:_SLUG_MAX]


def _ensure_slug(entry: Dict) -> Dict:
    """Return a copy of a registry entry with `slug` populated."""
    out = dict(entry)
    if not out.get("slug"):
        out["slug"] = slugify(out.get("label", ""))
    return out


def current_period(cfg: Dict) -> Optional[Dict]:
    """Return {label, slug, ...} for the active period, or None in single-period mode."""
    p = cfg.get("periods") or {}
    label = p.get("current")
    if not label:
        return None
    for entry in p.get("registry", []) or []:
        if entry.get("label") == label:
            return _ensure_slug(entry)
    return {"label": label, "slug": slugify(label)}


def baseline_period(cfg: Dict) -> Optional[Dict]:
    """Return {label, slug, ...} for the baseline period, or None."""
    p = cfg.get("periods") or {}
    label = p.get("baseline")
    if not label:
        return None
    for entry in p.get("registry", []) or []:
        if entry.get("label") == label:
            return _ensure_slug(entry)
    return {"label": label, "slug": slugify(label)}


def all_periods(cfg: Dict) -> List[Dict]:
    """Return every registry entry as {label, slug, ...} dicts (slug auto-filled)."""
    p = cfg.get("periods") or {}
    return [_ensure_slug(e) for e in (p.get("registry", []) or [])]


def parse_period_arg(cfg: Dict, arg: Optional[str]) -> Optional[Dict]:
    """Resolve a CLI --period argument to a period dict.

    Priority: explicit `arg` > cfg.periods.current > None.
    An unknown label creates an ephemeral dict (the period need not be
    pre-registered — the writer will register it via /api/periods later).
    """
    if arg:
        return next(
            (e for e in all_periods(cfg) if e["label"] == arg),
            {"label": arg, "slug": slugify(arg)},
        )
    return current_period(cfg)


def period_data_glob(alias: str, slug: str) -> str:
    """Glob pattern for a period's main data files (used by load_processed_data)."""
    return f"{alias}_{slug}_data_*"
```

- [ ] **Step 4: Run tests — expect 11 pass**

```bash
pytest tests/test_periods.py -v
```

- [ ] **Step 5: Full suite — expect 43 passed (32 prior + 11 new)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/periods.py tests/test_periods.py
git commit -m "feat(periods): registry helpers + slugify"
```

---

### Task 2: `_export_file` writes period-prefixed filenames

**Files:**
- Modify: `src/data/transform.py:417-460` (function `_export_file`)
- Modify: `tests/test_validate.py` (add a parametric regression — only if reasonably scoped)

- [ ] **Step 1: Inspect current `_export_file`**

```bash
sed -n '417,465p' src/data/transform.py
```

You'll see the current pattern: `{alias}_data_{ts}.csv` and `{alias}_{safe_name}_{ts}.csv`. The `alias` is read from `cfg.get("form", {}).get("alias", "form")`.

- [ ] **Step 2: Modify to inject the period slug when set**

Find the `alias = cfg.get("form", {}).get("alias", "form")` line at the start of `_export_file`. Immediately after it, add:

```python
    from src.utils.periods import current_period
    period = current_period(cfg)
    prefix = f"{alias}_{period['slug']}" if period else alias
```

Then replace all uses of `f"{alias}_data_{ts}"` with `f"{prefix}_data_{ts}"`, and all uses of `f"{alias}_{safe_name}_{ts}"` with `f"{prefix}_{safe_name}_{ts}"`.

(Use exact text replacement, do not refactor surrounding code.)

- [ ] **Step 3: Manual verification (no test framework for the export path in this plan — covered by integration in Task 5)**

```bash
python3 -c "
from src.data.transform import _export_file
import pandas as pd
df = pd.DataFrame({'a': [1, 2, 3]})
cfg = {
    'form': {'alias': 'test'},
    'export': {'format': 'csv', 'output_dir': '/tmp/p2'},
    'periods': {'current': 'Q1 2026', 'registry': [{'label': 'Q1 2026'}]},
}
import os; os.makedirs('/tmp/p2', exist_ok=True)
_export_file(df, cfg, 'csv', {})
import glob
print(glob.glob('/tmp/p2/test_q1_2026_data_*.csv'))
"
```

Expected: a path matching `/tmp/p2/test_q1_2026_data_<ts>.csv`. If no match, debug. Clean up: `rm -rf /tmp/p2`.

Also verify single-period fallback still works:

```bash
python3 -c "
from src.data.transform import _export_file
import pandas as pd
df = pd.DataFrame({'a': [1]})
cfg = {'form': {'alias': 'legacy'}, 'export': {'format': 'csv', 'output_dir': '/tmp/p2b'}}
import os; os.makedirs('/tmp/p2b', exist_ok=True)
_export_file(df, cfg, 'csv', {})
import glob
print(glob.glob('/tmp/p2b/legacy_data_*.csv'))
"
```

Expected: a `legacy_data_<ts>.csv` (no period slug — single-period mode preserved).

- [ ] **Step 4: Full suite — expect 43 still passing**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.py
git commit -m "feat(periods): export per-period data files when periods.current is set"
```

---

### Task 3: `load_processed_data` discovers period-prefixed files

**Files:**
- Modify: `src/data/transform.py:663-738` (function `load_processed_data`)

- [ ] **Step 1: Inspect**

```bash
sed -n '660,740p' src/data/transform.py
```

The function uses globs like `{alias}_data*.csv` for the main file and `{alias}_*.csv` for repeats. We need to scope those to a specific period when one is provided.

- [ ] **Step 2: Add a `period` parameter and use it for discovery**

Change the signature from:

```python
def load_processed_data(cfg: Dict, sample_size: Optional[int] = None, random_sample: bool = False, session: Optional[str] = None) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
```

To:

```python
def load_processed_data(cfg: Dict, sample_size: Optional[int] = None, random_sample: bool = False, session: Optional[str] = None, period: Optional[Dict] = None) -> Tuple[pd.DataFrame, Dict[str, pd.DataFrame]]:
```

Just below the `alias = ...` line at the top of the function, add:

```python
    from src.utils.periods import current_period
    period = period or current_period(cfg)
    prefix = f"{alias}_{period['slug']}" if period else alias
```

Replace all occurrences of `f"{alias}_data*.{ext}"` with `f"{prefix}_data*.{ext}"`, all `f"{alias}_*.{ext}"` with `f"{prefix}_*.{ext}"`, and all `f"{alias}_data_"` with `f"{prefix}_data_"`.

The `safe_name` extraction inside the repeat-table loop (using `f.stem[len(f"{alias}_"):]`) must also change to `f.stem[len(f"{prefix}_"):]`.

- [ ] **Step 3: Manual sanity check**

```bash
python3 -c "
from src.data.transform import load_processed_data
cfg = {
    'form': {'alias': 'test'},
    'export': {'format': 'csv', 'output_dir': '/tmp/p2'},
    'periods': {'current': 'Q1 2026', 'registry': [{'label': 'Q1 2026'}]},
}
# This should fail with a clear 'no file' (we deleted the temp files in Task 2);
# the important thing is it doesn't crash with a syntax error.
try:
    load_processed_data(cfg)
except FileNotFoundError as e:
    print('Expected FileNotFoundError:', e)
"
```

Verify the error message references `test_q1_2026_*` (the per-period prefix), not `test_*` (the legacy prefix).

- [ ] **Step 4: Full suite — expect 43 still passing**

```bash
pytest -v
```

(The existing `test_build_report_smoke.py` uses single-period mode and should still pass — that's the regression guarantee.)

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.py
git commit -m "feat(periods): load_processed_data scopes discovery to a period when set"
```

---

### Task 4: `download` CLI accepts `--period`

**Files:**
- Modify: `src/data/make.py` (`download` command)

- [ ] **Step 1: Find the `download` command**

```bash
grep -nA 10 '@cli.command("download")' src/data/make.py | head -25
```

- [ ] **Step 2: Add the `--period` option**

Add a new click option to the `download` command:

```python
@click.option("--period", default=None, help="Period label to tag this download (overrides periods.current).")
```

In the function body, near the top, resolve the period and temporarily inject it as the current period for the duration of this download:

```python
    from src.utils.periods import parse_period_arg
    if period:
        cfg.setdefault("periods", {})
        cfg["periods"]["current"] = period
        # auto-register the period if it isn't already
        registry = cfg["periods"].setdefault("registry", [])
        if not any(e.get("label") == period for e in registry):
            from src.utils.periods import slugify
            registry.append({"label": period, "slug": slugify(period)})
```

This means `_export_file` (which reads `current_period(cfg)`) automatically writes per-period files.

After the download completes successfully, persist the updated `cfg` back to disk:

```python
    if period:
        from src.utils.config import write_config
        write_config(CONFIG_PATH, cfg)
```

(`write_config` should already exist — if not, use whatever the project's existing config-write helper is. Grep for `def write_config` to confirm.)

- [ ] **Step 3: Manual sanity check**

A dry-run is hard without hitting the Kobo API. The full integration is covered by `--period` flowing through `_export_file` (Task 2) and `load_processed_data` (Task 3), both already verified. Confirm only that the click option parses:

```bash
PYTHONPATH=. python3 src/data/make.py download --help | grep period
```

Expected: a line containing `--period TEXT` and the help text.

- [ ] **Step 4: Full suite — expect 43 still passing**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add src/data/make.py
git commit -m "feat(periods): download --period flag tags + persists the period"
```

---

### Task 5: `build-report` CLI accepts `--period`

**Files:**
- Modify: `src/data/make.py` (`build-report` command)
- Modify: `src/reports/builder.py:105-160` (pass period through to `load_processed_data`)

- [ ] **Step 1: Add the option**

```python
@click.option("--period", default=None, help="Period label to build from (overrides periods.current).")
```

In the function body, when constructing the `ReportBuilder` or before calling `build`, resolve the period and pass it forward. The cleanest way is to add a `period` kwarg to `ReportBuilder.build(...)` and thread it down to `load_processed_data`.

- [ ] **Step 2: Pass period through the builder**

In `src/reports/builder.py`, change the `build` method signature from:

```python
def build(self, sample_size=None, random_sample=False, split_by=None, session=None):
```

To:

```python
def build(self, sample_size=None, random_sample=False, split_by=None, session=None, period=None):
```

Inside `build`, change the existing `load_processed_data(self.cfg, sample_size=..., random_sample=..., session=session)` call to also pass `period=period`:

```python
        from src.utils.periods import parse_period_arg
        resolved_period = parse_period_arg(self.cfg, period)
        df, repeat_tables = load_processed_data(
            self.cfg, sample_size=sample_size, random_sample=random_sample,
            session=session, period=resolved_period,
        )
```

In `make.py`'s `cmd_build_report`, pass the new `period` argument:

```python
    builder.build(sample_size=sample, random_sample=random_sample,
                  split_by=split_by, session=session, period=period)
```

- [ ] **Step 3: Manual check + full suite**

```bash
PYTHONPATH=. python3 src/data/make.py build-report --help | grep period
pytest -v
```

Expected: `--period` line in help, 43 tests passing.

- [ ] **Step 4: Commit**

```bash
git add src/data/make.py src/reports/builder.py
git commit -m "feat(periods): build-report --period selects which period's data to use"
```

---

### Task 6: `set-period` CLI command

**Files:**
- Modify: `src/data/make.py`

- [ ] **Step 1: Add a new click command**

After the existing CLI commands, add:

```python
@cli.command("set-period")
@click.argument("label")
@click.option("--baseline", is_flag=True, default=False, help="Also set this period as the baseline.")
def cmd_set_period(label, baseline):
    """Set the current period. Auto-registers it if not already in the registry."""
    from src.utils.periods import slugify
    cfg = load_config(CONFIG_PATH)
    cfg.setdefault("periods", {})
    cfg["periods"]["current"] = label
    if baseline:
        cfg["periods"]["baseline"] = label
    registry = cfg["periods"].setdefault("registry", [])
    if not any(e.get("label") == label for e in registry):
        registry.append({"label": label, "slug": slugify(label)})
    from src.utils.config import write_config
    write_config(CONFIG_PATH, cfg)
    click.echo(f"Current period set to: {label}")
    if baseline:
        click.echo(f"Baseline period set to: {label}")
```

- [ ] **Step 2: Verify it parses**

```bash
PYTHONPATH=. python3 src/data/make.py set-period --help
```

- [ ] **Step 3: Full suite**

```bash
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add src/data/make.py
git commit -m "feat(periods): set-period CLI command"
```

---

### Task 7: `/api/periods` endpoints

**Files:**
- Modify: `web/main.py`
- Create: `tests/test_periods_endpoints.py`

- [ ] **Step 1: Write the failing endpoint tests**

Create `tests/test_periods_endpoints.py`:

```python
import yaml
import pytest


@pytest.fixture
def tmp_periods_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "p", "uid": "x"},
        "questions": [],
        "periods": {
            "current":  "Q1 2026",
            "baseline": "Q1 2026",
            "registry": [
                {"label": "Q1 2026", "slug": "q1_2026"},
                {"label": "Q2 2026", "slug": "q2_2026"},
            ],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_get_periods_returns_block(tmp_periods_workspace, api_client):
    r = api_client.get("/api/periods")
    assert r.status_code == 200
    body = r.json()
    assert body["current"] == "Q1 2026"
    assert body["baseline"] == "Q1 2026"
    assert len(body["registry"]) == 2


def test_post_current_period_updates_config(tmp_periods_workspace, api_client):
    r = api_client.post("/api/periods/current", json={"label": "Q2 2026"})
    assert r.status_code == 200
    body = r.json()
    assert body["current"] == "Q2 2026"

    cfg = yaml.safe_load((tmp_periods_workspace / "config.yml").read_text())
    assert cfg["periods"]["current"] == "Q2 2026"


def test_post_registry_appends_new_period(tmp_periods_workspace, api_client):
    r = api_client.post("/api/periods/registry", json={"label": "Q3 2026"})
    assert r.status_code == 200
    body = r.json()
    assert any(e["label"] == "Q3 2026" for e in body["registry"])

    cfg = yaml.safe_load((tmp_periods_workspace / "config.yml").read_text())
    labels = [e["label"] for e in cfg["periods"]["registry"]]
    assert "Q3 2026" in labels


def test_delete_registry_removes_period(tmp_periods_workspace, api_client):
    r = api_client.delete("/api/periods/registry/q2_2026")
    assert r.status_code == 200
    body = r.json()
    assert not any(e["slug"] == "q2_2026" for e in body["registry"])


def test_get_periods_empty_when_no_periods_block(tmp_path, monkeypatch, api_client):
    ws = tmp_path / "ws2"
    ws.mkdir()
    cfg = {"api": {"platform": "kobo", "url": "x", "token": "x"},
           "form": {"alias": "p", "uid": "x"}, "questions": []}
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    r = api_client.get("/api/periods")
    assert r.status_code == 200
    body = r.json()
    assert body == {"current": None, "baseline": None, "registry": []}
```

- [ ] **Step 2: Run — expect failures (endpoints don't exist)**

```bash
pytest tests/test_periods_endpoints.py -v
```

- [ ] **Step 3: Implement the endpoints in `web/main.py`**

Append near the existing read-only endpoints:

```python
class PeriodLabelPayload(BaseModel):
    label: str


def _read_cfg() -> dict:
    """cwd-first config reader (matches /api/validate convention)."""
    config_path = Path("config.yml") if Path("config.yml").exists() else CONFIG_PATH
    if not config_path.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f.read()) or {}, config_path


def _write_cfg(cfg: dict, path: Path) -> None:
    with open(path, "w", encoding="utf-8") as f:
        f.write(yaml.dump(cfg, allow_unicode=True, default_flow_style=False, sort_keys=False))


@app.get("/api/periods")
async def get_periods():
    cfg, _ = _read_cfg()
    p = cfg.get("periods") or {}
    return {
        "current":  p.get("current"),
        "baseline": p.get("baseline"),
        "registry": p.get("registry", []) or [],
    }


@app.post("/api/periods/current")
async def set_current_period(payload: PeriodLabelPayload):
    cfg, path = _read_cfg()
    cfg.setdefault("periods", {})
    cfg["periods"]["current"] = payload.label
    from src.utils.periods import slugify
    registry = cfg["periods"].setdefault("registry", [])
    if not any(e.get("label") == payload.label for e in registry):
        registry.append({"label": payload.label, "slug": slugify(payload.label)})
    _write_cfg(cfg, path)
    return {"current": payload.label, "registry": cfg["periods"]["registry"]}


@app.post("/api/periods/registry")
async def add_registry_period(payload: PeriodLabelPayload):
    cfg, path = _read_cfg()
    cfg.setdefault("periods", {})
    registry = cfg["periods"].setdefault("registry", [])
    from src.utils.periods import slugify
    if not any(e.get("label") == payload.label for e in registry):
        registry.append({"label": payload.label, "slug": slugify(payload.label)})
    _write_cfg(cfg, path)
    return {"registry": registry}


@app.delete("/api/periods/registry/{slug}")
async def delete_registry_period(slug: str):
    cfg, path = _read_cfg()
    p = cfg.setdefault("periods", {})
    registry = p.get("registry", []) or []
    p["registry"] = [e for e in registry if e.get("slug") != slug]
    _write_cfg(cfg, path)
    return {"registry": p["registry"]}
```

If `_read_cfg`/`_write_cfg` helpers already exist with these signatures, reuse them — don't duplicate. Grep first: `grep -n "def _read_cfg\|def _write_cfg" web/main.py`.

- [ ] **Step 4: Run tests — expect 5 pass**

```bash
pytest tests/test_periods_endpoints.py -v
```

- [ ] **Step 5: Full suite — expect 48 passed (43 + 5)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_periods_endpoints.py
git commit -m "feat(periods): /api/periods endpoints (GET, set current, register, delete)"
```

---

### Task 8: Provenance footer surfaces the period

**Files:**
- Modify: `src/utils/provenance.py`
- Modify: `tests/test_provenance.py`

- [ ] **Step 1: Append a failing test**

Add to `tests/test_provenance.py`:

```python
def test_provenance_footer_includes_period_label_when_set():
    cfg = {
        "form": {"alias": "m"},
        "periods": {"current": "Q2 2026", "registry": [{"label": "Q2 2026"}]},
    }
    df = pd.DataFrame({"a": [1]})
    prov = build_provenance(cfg, df, data_downloaded_at=None)
    assert "Q2 2026" in prov["footer"]
    assert prov["period_label"] == "Q2 2026"
```

- [ ] **Step 2: Run — expect 1 fail (no `period_label` key yet)**

```bash
pytest tests/test_provenance.py -v
```

- [ ] **Step 3: Update `build_provenance`**

In `src/utils/provenance.py`, after the existing `period = (cfg.get("report") or {}).get("period", "") or ""` line, add:

```python
    from src.utils.periods import current_period
    cp = current_period(cfg)
    period_label = cp["label"] if cp else ""
```

In the `parts` list, append the period label after the existing `period` part:

```python
    if period_label:
        parts.append(f"period={period_label}")
    elif period:
        parts.append(f"period={period}")
```

(So a config with `periods.current` wins over the legacy `report.period`.)

Add `period_label` to the returned dict:

```python
        "period_label":       period_label,
```

- [ ] **Step 4: Run tests — expect all provenance tests pass + new test passes**

```bash
pytest tests/test_provenance.py tests/test_periods.py -v
```

- [ ] **Step 5: Full suite — expect 49 passed**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/provenance.py tests/test_provenance.py
git commit -m "feat(periods): provenance footer shows the active period"
```

**Checkpoint:** B.2.a complete. Single-period mode still works; period-aware downloads + reports are wired. Ready for B.2.b.

---

## Sub-phase B.2.b: Per-period indicators

### Task 9: `compute_indicators` accepts a `per_period` map

**Files:**
- Modify: `src/reports/indicators.py:47-87`

- [ ] **Step 1: Inspect the existing signature**

```bash
sed -n '47,90p' src/reports/indicators.py
```

- [ ] **Step 2: Add an optional `per_period` parameter**

Change the signature from:

```python
def compute_indicators(
    indicators: List[Dict],
    df: pd.DataFrame,
    repeat_tables: Optional[Dict[str, pd.DataFrame]] = None,
) -> Dict[str, str]:
```

To:

```python
def compute_indicators(
    indicators: List[Dict],
    df: pd.DataFrame,
    repeat_tables: Optional[Dict[str, pd.DataFrame]] = None,
    per_period: Optional[Dict[str, Dict]] = None,
) -> Dict[str, str]:
    """...

    per_period (optional): {period_slug: {"df": main_df, "repeat_tables": {...}, "label": "Q1 2026"}}
        When provided, each indicator that does not specify a `period` is also
        computed against every period in per_period. The result populates
        `ind_<name>_p_<slug>` placeholders, plus `_delta` and `_pct_change`
        if a baseline period exists.
    """
```

Inside the function, after the existing per-indicator loop body (where `context[f"ind_{name}"] = ...` is set), add:

```python
            if per_period:
                values_by_slug = {}
                for slug, bundle in per_period.items():
                    try:
                        p_df  = _resolve_source(ind, bundle["df"], bundle.get("repeat_tables", {}))
                        p_val = _compute(ind, p_df)
                        values_by_slug[slug] = p_val
                        context[f"ind_{name}_p_{slug}"] = _format(p_val, fmt, ind)
                    except Exception as e:
                        log.warning(f"Indicator '{name}' for period '{slug}' failed: {e}")
                        context[f"ind_{name}_p_{slug}"] = "N/A"

                # delta + pct change vs baseline if both endpoints are numeric
                baseline_slug = next((s for s, b in per_period.items() if b.get("is_baseline")), None)
                if baseline_slug and baseline_slug in values_by_slug:
                    try:
                        base = float(values_by_slug[baseline_slug])
                        cur  = float(value)
                        context[f"ind_{name}_delta"] = _format(cur - base, fmt, ind)
                        if base != 0:
                            context[f"ind_{name}_pct_change"] = f"{((cur - base) / base) * 100:,.1f}%"
                        else:
                            context[f"ind_{name}_pct_change"] = "N/A"
                    except (TypeError, ValueError):
                        context[f"ind_{name}_delta"] = "N/A"
                        context[f"ind_{name}_pct_change"] = "N/A"
```

- [ ] **Step 3: Manual signature check**

```bash
python3 -c "import inspect; from src.reports.indicators import compute_indicators; print(inspect.signature(compute_indicators))"
```

Should include `per_period`.

- [ ] **Step 4: Full suite — expect 49 still passing (no behavior change without per_period arg)**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add src/reports/indicators.py
git commit -m "feat(periods): compute_indicators emits per-period + delta + pct_change"
```

---

### Task 10: Per-period indicator unit tests

**Files:**
- Create: `tests/test_indicators_periods.py`

- [ ] **Step 1: Write the tests**

Create `tests/test_indicators_periods.py`:

```python
import pandas as pd
from src.reports.indicators import compute_indicators


def test_no_per_period_arg_keeps_legacy_behavior():
    df = pd.DataFrame({"score": [10, 20, 30]})
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    ctx = compute_indicators(inds, df)
    assert "ind_avg_score" in ctx
    assert "ind_avg_score_delta" not in ctx
    assert "ind_avg_score_pct_change" not in ctx


def test_per_period_emits_p_slug_placeholders():
    df_current = pd.DataFrame({"score": [80, 90]})
    df_q1      = pd.DataFrame({"score": [70, 60]})
    df_q2      = pd.DataFrame({"score": [80, 90]})
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    per_period = {
        "q1_2026": {"df": df_q1, "is_baseline": True,  "label": "Q1 2026"},
        "q2_2026": {"df": df_q2, "is_baseline": False, "label": "Q2 2026"},
    }
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_avg_score_p_q1_2026" in ctx
    assert "ind_avg_score_p_q2_2026" in ctx


def test_per_period_computes_delta_and_pct_change_against_baseline():
    df_current = pd.DataFrame({"score": [80, 90]})  # mean = 85
    df_q1      = pd.DataFrame({"score": [70, 60]})  # mean = 65 (baseline)
    inds = [{"name": "avg_score", "stat": "mean", "question": "score"}]
    per_period = {
        "q1_2026": {"df": df_q1, "is_baseline": True, "label": "Q1 2026"},
    }
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_avg_score_delta" in ctx
    # Delta = 85 - 65 = 20
    assert "20" in ctx["ind_avg_score_delta"]
    # Pct change = (20 / 65) * 100 ≈ 30.8%
    assert "30.8" in ctx["ind_avg_score_pct_change"]


def test_per_period_handles_zero_baseline_gracefully():
    df_current = pd.DataFrame({"score": [10]})
    df_q1      = pd.DataFrame({"score": [0]})
    inds = [{"name": "x", "stat": "mean", "question": "score"}]
    per_period = {"q1_2026": {"df": df_q1, "is_baseline": True, "label": "Q1 2026"}}
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert ctx["ind_x_pct_change"] == "N/A"


def test_per_period_with_no_baseline_emits_p_slug_only():
    df_current = pd.DataFrame({"score": [80]})
    df_q1      = pd.DataFrame({"score": [70]})
    inds = [{"name": "x", "stat": "mean", "question": "score"}]
    per_period = {"q1_2026": {"df": df_q1, "is_baseline": False, "label": "Q1 2026"}}
    ctx = compute_indicators(inds, df_current, per_period=per_period)
    assert "ind_x_p_q1_2026" in ctx
    assert "ind_x_delta" not in ctx
```

- [ ] **Step 2: Run — expect 5 pass**

```bash
pytest tests/test_indicators_periods.py -v
```

- [ ] **Step 3: Full suite — expect 54 passed**

```bash
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_indicators_periods.py
git commit -m "test(periods): per-period indicator placeholders + delta + pct_change"
```

---

### Task 11: Builder loads per-period data when periods registry exists

**Files:**
- Modify: `src/reports/builder.py`

- [ ] **Step 1: Inside `_render`, build the `per_period` map before calling `compute_indicators`**

Locate the line `indicators = compute_indicators(self.cfg.get("indicators", []), df, repeat_tables)`.

Immediately before it, add:

```python
        from src.utils.periods import all_periods, baseline_period
        registry = all_periods(self.cfg)
        per_period = None
        if registry and len(registry) > 1:
            from src.data.transform import load_processed_data
            base = baseline_period(self.cfg)
            base_slug = base["slug"] if base else None
            per_period = {}
            for entry in registry:
                try:
                    p_df, p_repeats = load_processed_data(self.cfg, period=entry)
                    per_period[entry["slug"]] = {
                        "df": p_df,
                        "repeat_tables": p_repeats,
                        "label": entry["label"],
                        "is_baseline": entry["slug"] == base_slug,
                    }
                except FileNotFoundError:
                    # Period in registry but no data downloaded yet — skip.
                    continue
```

Change the existing call to:

```python
        indicators = compute_indicators(
            self.cfg.get("indicators", []), df, repeat_tables, per_period=per_period
        )
```

- [ ] **Step 2: Full suite — expect 54 still passing (single-period configs unchanged)**

```bash
pytest -v
```

- [ ] **Step 3: Commit**

```bash
git add src/reports/builder.py
git commit -m "feat(periods): builder loads per-period data + threads it to indicators"
```

---

### Task 12: `/api/indicators/preview` returns the per-period trend

**Files:**
- Modify: `web/main.py` (the `/api/indicators/preview` endpoint)

- [ ] **Step 1: Inspect the existing endpoint**

```bash
grep -nA 30 "preview_indicator" web/main.py | head -40
```

- [ ] **Step 2: Extend the response to include `trend`**

When `cfg["periods"]["registry"]` has ≥ 2 entries, compute the indicator value per period and add a `trend` key to the response: `[{"slug", "label", "value", "is_baseline"}, ...]`. Reuse `load_processed_data(cfg, period=entry)` (catch FileNotFoundError → omit that period).

Outline of the addition (paste at the appropriate place inside the existing `preview_indicator` function, after the current single-value computation):

```python
    trend = []
    try:
        from src.utils.periods import all_periods, baseline_period
        registry = all_periods(_cfg) if _cfg else []
        base = baseline_period(_cfg) if _cfg else None
        base_slug = base["slug"] if base else None
        if len(registry) >= 2:
            from src.data.transform import load_processed_data
            for entry in registry:
                try:
                    p_df, _ = load_processed_data(_cfg, period=entry)
                    p_df = _pick_preview_df(p_df, [question], _questions) if question else p_df
                    p_result = compute_indicators([ind], p_df)
                    p_value = p_result.get(f"ind_{ind.get('name', 'preview')}", "N/A")
                    trend.append({
                        "slug": entry["slug"], "label": entry["label"],
                        "value": p_value, "is_baseline": entry["slug"] == base_slug,
                    })
                except FileNotFoundError:
                    continue
    except Exception as e:
        log.warning(f"Trend computation failed: {e}")

    return {"value": value, "n_rows": len(df), "trend": trend}
```

(`_cfg` is the dict loaded earlier in the same function. If the variable name differs, adapt.)

- [ ] **Step 3: Add an endpoint smoke test**

Append to `tests/test_validate_endpoint.py` (or create a new `tests/test_indicators_endpoint.py`):

```python
def test_indicator_preview_returns_trend_when_multiple_periods(tmp_periods_with_data, api_client):
    payload = {"indicator": {"name": "n", "stat": "count", "question": "x"}}
    r = api_client.post("/api/indicators/preview", json=payload)
    body = r.json()
    assert "trend" in body
    assert len(body["trend"]) >= 1
```

You'll need a `tmp_periods_with_data` fixture that stages two periods of data files. Use the pattern from `tests/test_build_report_smoke.py` (write CSVs with period slug prefixes manually).

- [ ] **Step 4: Run + full suite**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add web/main.py tests/test_indicators_endpoint.py
git commit -m "feat(periods): indicator preview returns per-period trend"
```

---

### Task 13: IndicatorsCard surfaces the trend chip

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (IndicatorsCard subcomponent)

- [ ] **Step 1: Extend the existing `latest` state shape to also store `trend`**

In Phase A we wired IndicatorsCard to `/api/indicators/preview` returning `{value, n_rows}`. Now the endpoint also returns `trend`. Update the state slot:

```jsx
const [latest, setLatest] = useState({});
// shape: { [name]: { value?, error?, trend?: [{slug, label, value, is_baseline}] } }
```

In the `loadOne` async function, when the success branch fires, also stash `trend`:

```jsx
        setLatest(prev => ({ ...prev, [ind.name]: { value: data.value, trend: data.trend || [] } }));
```

- [ ] **Step 2: Render a small trend chip next to the value when `trend.length >= 2`**

Below the existing `<span className="value-tag">…</span>` (in the indicator row), add:

```jsx
{(latest[ind.name]?.trend?.length || 0) >= 2 && (
  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono, monospace)' }}>
    {latest[ind.name].trend.map(t => `${t.label}: ${t.value}`).join(' → ')}
  </span>
)}
```

- [ ] **Step 3: Vite recompiles cleanly**

```bash
./scripts/dev.sh status || ./scripts/dev.sh start
sleep 3
curl -s -o /tmp/c.js "http://localhost:51730/src/pages/Composition.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
```

Expected: HTTP 200.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "feat(ui): IndicatorsCard shows period trend when multiple periods exist"
```

---

### Task 14: Template placeholders — narrator awareness

**Files:**
- Modify: `src/reports/ai_template_generator.py` (system prompt)

- [ ] **Step 1: Append period placeholders to the AI template prompt**

Find the placeholder list (look for the existing `{{ provenance.X }}` lines added in Phase A) and append:

```
Per-period indicator placeholders (when periods.registry has 2+ entries):
  {{ ind_<name>_p_<slug> }}    value for that period
  {{ ind_<name>_delta }}        current value minus baseline value
  {{ ind_<name>_pct_change }}   percent change from baseline
  {{ provenance.period_label }} the active period label
```

- [ ] **Step 2: Commit**

```bash
git add src/reports/ai_template_generator.py
git commit -m "docs(periods): AI template generator knows about per-period placeholders"
```

**Checkpoint:** B.2.b complete. Indicators carry trend information end-to-end.

---

## Sub-phase B.2.c: Comparison reports

### Task 15: `build-report --compare A,B[,C]` flag

**Files:**
- Modify: `src/data/make.py` (`build-report` command)
- Modify: `src/reports/builder.py:_render` (accept compare list)

- [ ] **Step 1: Add the `--compare` option**

In `cmd_build_report`:

```python
@click.option("--compare", default=None, help='Comma-separated period labels to compare (e.g. "Q1 2026,Q2 2026").')
```

Parse it into a list:

```python
    compare_labels = [s.strip() for s in (compare or "").split(",") if s.strip()] or None
    builder.build(sample_size=sample, random_sample=random_sample,
                  split_by=split_by, session=session, period=period,
                  compare=compare_labels)
```

- [ ] **Step 2: Plumb `compare` through `build` → `_render`**

In `src/reports/builder.py`, change `build(...)` to accept `compare: Optional[List[str]] = None` and forward to `_render`.

In `_render`, when `compare` is set, override the `per_period` map to ONLY include the listed periods (in the given order) and mark the first as baseline if no baseline is set:

```python
        if compare:
            from src.utils.periods import slugify
            registry = all_periods(self.cfg)
            label_to_slug = {e["label"]: e["slug"] for e in registry}
            slugs = [label_to_slug.get(lbl, slugify(lbl)) for lbl in compare]
            # Filter per_period to just these (preserving order via insertion)
            if per_period:
                per_period = {s: per_period[s] for s in slugs if s in per_period}
            base_slug = baseline_period(self.cfg)["slug"] if baseline_period(self.cfg) else slugs[0]
            for s in per_period:
                per_period[s]["is_baseline"] = (s == base_slug)
```

- [ ] **Step 3: Manual + full suite**

```bash
PYTHONPATH=. python3 src/data/make.py build-report --help | grep compare
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add src/data/make.py src/reports/builder.py
git commit -m "feat(periods): build-report --compare produces a multi-period report"
```

---

### Task 16: `period_bar` chart type

**Files:**
- Modify: `src/reports/charts.py`

- [ ] **Step 1: Find `CHART_DISPATCH`**

```bash
grep -n "CHART_DISPATCH" src/reports/charts.py | head
```

- [ ] **Step 2: Add the function + register it**

Append a new chart function (near the other chart-type definitions):

```python
def chart_period_bar(df, questions, title, out_path, opts):
    """Bar chart of an indicator's value across periods.

    Expects opts to contain:
        metric:   the indicator name (without the ind_ prefix)
        periods:  list of {"slug", "label", "value"} dicts (passed by builder)
    """
    periods = opts.get("periods", [])
    if not periods:
        log.warning("period_bar: opts.periods is empty — chart skipped")
        return
    labels = [p["label"] for p in periods]
    # Strip non-numeric formatting like "%" or "," from the value strings before plotting.
    raw_values = []
    for p in periods:
        v = p.get("value", "0")
        try:
            raw_values.append(float(str(v).replace(",", "").replace("%", "").strip()))
        except (TypeError, ValueError):
            raw_values.append(0.0)
    fig, ax = plt.subplots(figsize=_fs(opts, (6, 4)))
    bars = ax.bar(labels, raw_values, color=_color(opts))
    ax.set_title(title)
    ax.set_ylabel(opts.get("ylabel", opts.get("metric", "value")))
    for b, v in zip(bars, raw_values):
        ax.annotate(f"{v:,.1f}", xy=(b.get_x() + b.get_width()/2, v), ha="center", va="bottom", fontsize=9)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
```

Add to the dispatch dict:

```python
CHART_DISPATCH["period_bar"] = chart_period_bar
```

- [ ] **Step 3: Smoke check the registration**

```bash
PYTHONPATH=. python3 -c "from src.reports.charts import CHART_DISPATCH; assert 'period_bar' in CHART_DISPATCH; print('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add src/reports/charts.py
git commit -m "feat(charts): period_bar chart type for comparison reports"
```

---

### Task 17: `period_line` chart type

**Files:**
- Modify: `src/reports/charts.py`

- [ ] **Step 1: Add `chart_period_line` mirroring `chart_period_bar` but using `ax.plot`**

Append:

```python
def chart_period_line(df, questions, title, out_path, opts):
    """Line chart of an indicator's value across periods (time trend)."""
    periods = opts.get("periods", [])
    if not periods:
        log.warning("period_line: opts.periods is empty — chart skipped")
        return
    labels = [p["label"] for p in periods]
    raw_values = []
    for p in periods:
        v = p.get("value", "0")
        try:
            raw_values.append(float(str(v).replace(",", "").replace("%", "").strip()))
        except (TypeError, ValueError):
            raw_values.append(0.0)
    fig, ax = plt.subplots(figsize=_fs(opts, (6, 4)))
    ax.plot(labels, raw_values, marker="o", color=_color(opts), linewidth=2)
    ax.set_title(title)
    ax.set_ylabel(opts.get("ylabel", opts.get("metric", "value")))
    for x, y in zip(labels, raw_values):
        ax.annotate(f"{y:,.1f}", (x, y), textcoords="offset points", xytext=(0, 8), ha="center", fontsize=9)
    fig.tight_layout()
    fig.savefig(out_path, dpi=150)
    plt.close(fig)


CHART_DISPATCH["period_line"] = chart_period_line
```

- [ ] **Step 2: Smoke check + commit**

```bash
PYTHONPATH=. python3 -c "from src.reports.charts import CHART_DISPATCH; assert 'period_line' in CHART_DISPATCH; print('ok')"
git add src/reports/charts.py
git commit -m "feat(charts): period_line chart type"
```

---

### Task 18: Builder enriches chart opts with `periods` payload

**Files:**
- Modify: `src/reports/builder.py` (`_generate_charts`)

- [ ] **Step 1: Inspect `_generate_charts`**

```bash
grep -nA 30 "_generate_charts" src/reports/builder.py | head -40
```

- [ ] **Step 2: Inject per-period values into opts when the chart type is `period_bar` or `period_line`**

Inside the per-chart loop, before calling `generate_chart(...)`, add:

```python
        if c.get("type") in ("period_bar", "period_line") and per_period:
            metric = c.get("options", {}).get("metric") or c.get("metric")
            opts = dict(c.get("options", {}) or {})
            opts["periods"] = [
                {
                    "slug":  slug,
                    "label": bundle["label"],
                    "value": compute_indicators(
                        [{"name": metric, "stat": c.get("stat", "count"), "question": c.get("question")}],
                        bundle["df"], bundle.get("repeat_tables", {}),
                    ).get(f"ind_{metric}", "0")
                    if metric else "0",
                }
                for slug, bundle in per_period.items()
            ]
            c = {**c, "options": opts}
```

(This is heavy-handed but explicit. A cleaner refactor can come later.)

- [ ] **Step 3: Manual end-to-end check (optional — covered by integration in Task 22)**

- [ ] **Step 4: Commit**

```bash
git add src/reports/builder.py
git commit -m "feat(periods): builder injects per-period values into period_bar/line opts"
```

---

### Task 19: Provenance lists compared periods

**Files:**
- Modify: `src/utils/provenance.py`
- Modify: `tests/test_provenance.py`

- [ ] **Step 1: Test**

Append to `tests/test_provenance.py`:

```python
def test_provenance_compared_periods_in_footer():
    cfg = {"form": {"alias": "m"},
           "periods": {"current": "Q2 2026", "registry": [
               {"label": "Q1 2026"}, {"label": "Q2 2026"},
           ]}}
    df = pd.DataFrame({"a": [1]})
    prov = build_provenance(cfg, df, data_downloaded_at=None, compared_periods=["Q1 2026", "Q2 2026"])
    assert "compare" in prov["footer"].lower()
    assert "Q1 2026" in prov["footer"] and "Q2 2026" in prov["footer"]
```

- [ ] **Step 2: Extend `build_provenance` signature**

```python
def build_provenance(
    cfg: Dict,
    df: pd.DataFrame,
    data_downloaded_at: Optional[str] = None,
    compared_periods: Optional[List[str]] = None,
) -> Dict:
```

Inside, when `compared_periods` is non-empty, replace the `period=…` part with `compare=A vs B vs C`:

```python
    if compared_periods:
        parts.append("compare=" + " vs ".join(compared_periods))
    elif period_label:
        parts.append(f"period={period_label}")
    elif period:
        parts.append(f"period={period}")
```

Add `compared_periods` (as a list) to the returned dict.

- [ ] **Step 3: Builder passes `compared_periods` when `--compare` was used**

In `src/reports/builder.py`'s `_render`, change the existing `provenance = build_provenance(...)` call to also pass `compared_periods=compare` (when set).

- [ ] **Step 4: Full suite**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add src/utils/provenance.py tests/test_provenance.py src/reports/builder.py
git commit -m "feat(periods): provenance footer reflects compared periods"
```

---

### Task 20: Compare-mode template auto-suggestions

**Files:**
- Modify: `src/reports/ai_chart_suggester.py` (system prompt — small addition)

- [ ] **Step 1: Append to the chart suggester's system prompt**

Add to the existing rules block:

```
When periods.registry contains 2+ entries, prefer chart type `period_line` for
indicators that have a clear trend (rates, proportions, totals over time), and
`period_bar` for discrete counts. Pass the indicator's name via options.metric.
```

- [ ] **Step 2: Commit**

```bash
git add src/reports/ai_chart_suggester.py
git commit -m "docs(periods): chart suggester knows about period_bar/period_line"
```

---

### Task 21: Reports tab — Compare button + period multi-select modal

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

- [ ] **Step 1: Inspect the existing Reports page**

```bash
sed -n '1,80p' frontend/src/pages/Reports.jsx
```

- [ ] **Step 2: Add a "Compare" button next to the existing actions**

Add a new state slot and a small modal that:
- Fetches `/api/periods` to populate a list of registry labels
- Lets the user pick 2 or more
- POSTs to a NEW backend endpoint `/api/run/build-report` with `compare` in the payload
  (the existing `/api/run/{command}` infrastructure already accepts arbitrary CLI args — make sure `compare` is in the allowlist)

Specifically, in `web/main.py`, the `ALLOWED_COMMANDS` dict and the `_build_cli_args` helper need to learn about `--compare`. Open `web/main.py`, find `ALLOWED_COMMANDS`, add `--compare` to `build-report`'s allowed flags:

```python
    "build-report":         ["--sample", "--split-by", "--session", "--period", "--compare"],
```

In the request payload builder (where `payload.split_by` etc. are translated), add:

```python
    if payload.compare and "--compare" in ALLOWED_COMMANDS[command]:
        cmd += ["--compare", payload.compare]
    if payload.period and "--period" in ALLOWED_COMMANDS[command]:
        cmd += ["--period", payload.period]
```

And extend `RunPayload`:

```python
    compare: Optional[str] = None
    period:  Optional[str] = None
```

In the frontend Reports.jsx, the Compare button opens a modal listing periods (fetched from `/api/periods`); user ticks two or more and hits "Build comparison". The modal POSTs to `/api/run/build-report` with `compare: "Q1 2026,Q2 2026"`.

- [ ] **Step 3: Vite recompiles + commit**

```bash
curl -s -o /tmp/r.js "http://localhost:51730/src/pages/Reports.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
git add frontend/src/pages/Reports.jsx web/main.py
git commit -m "feat(periods): Reports tab Compare button + backend wiring"
```

---

### Task 22: End-to-end smoke test for comparison report

**Files:**
- Create: `tests/test_compare_report_smoke.py`

- [ ] **Step 1: Write the test**

This test stages a workspace with TWO period datasets, runs `build-report --compare`, and asserts the resulting `.docx` contains both period labels in the provenance footer.

```python
"""Smoke: build a comparison report across two periods and assert both appear in the docx."""
import os, subprocess, sys, zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_compare_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    # Two period datasets — same schema, different values
    pd.DataFrame({"Age": [10, 11, 12]}).to_csv(ws / "data" / "processed" / "cmpsmoke_q1_2026_data_20260101_120000.csv", index=False)
    pd.DataFrame({"Age": [15, 16, 17]}).to_csv(ws / "data" / "processed" / "cmpsmoke_q2_2026_data_20260101_120000.csv", index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "cmpsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts": [{"name": "h", "title": "Age", "type": "histogram", "questions": ["Age"]}],
        "report": {
            "template":   str(ws / "templates" / "t.docx"),
            "output_dir": str(ws / "reports"),
            "title": "Compare", "period": "Q2 2026",
        },
        "export": {"format": "csv", "output_dir": str(ws / "data" / "processed")},
        "periods": {
            "current":  "Q2 2026",
            "baseline": "Q1 2026",
            "registry": [
                {"label": "Q1 2026", "slug": "q1_2026"},
                {"label": "Q2 2026", "slug": "q2_2026"},
            ],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def _docx_text(path):
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _run_cli(*args):
    project_root = Path(__file__).resolve().parent.parent
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(project_root)}
    return subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"), *args],
        env=env, capture_output=True, text=True,
    )


def test_build_compare_report_includes_both_periods(tmp_compare_workspace):
    r = _run_cli("generate-template", "--out", str(tmp_compare_workspace / "templates" / "t.docx"))
    assert r.returncode == 0, r.stderr
    r = _run_cli("build-report", "--compare", "Q1 2026,Q2 2026")
    assert r.returncode == 0, r.stderr
    docs = list((tmp_compare_workspace / "reports").glob("cmpsmoke_report_*.docx"))
    assert len(docs) == 1, f"expected one .docx, got {[d.name for d in docs]}"
    text = _docx_text(docs[0])
    assert "Q1 2026" in text
    assert "Q2 2026" in text
    assert "compare" in text.lower()
```

- [ ] **Step 2: Run — confirm it passes**

```bash
pytest tests/test_compare_report_smoke.py -v -s
```

- [ ] **Step 3: Full suite**

```bash
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_compare_report_smoke.py
git commit -m "test: end-to-end comparison report smoke test"
```

**Checkpoint:** B.2.c complete. Comparison reports generate end-to-end. UI affordance present.

---

## Sub-phase B.2.d: UI polish + docs

### Task 23: PeriodPicker component

**Files:**
- Create: `frontend/src/components/PeriodPicker.jsx`

- [ ] **Step 1: Write the component**

```jsx
import { useEffect, useState } from 'react';

export default function PeriodPicker({ value, onChange, allowAdd = true }) {
  const [periods, setPeriods] = useState({ current: null, baseline: null, registry: [] });
  const [adding, setAdding]   = useState(false);
  const [draft,  setDraft]    = useState('');

  const reload = async () => {
    try { setPeriods(await (await fetch('/api/periods')).json()); }
    catch { /* leave defaults */ }
  };

  useEffect(() => { reload(); }, []);

  const addPeriod = async () => {
    const label = draft.trim();
    if (!label) return;
    await fetch('/api/periods/registry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    setAdding(false); setDraft('');
    await reload();
    if (onChange) onChange(label);
  };

  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <select
        className="src-input"
        value={value ?? periods.current ?? ''}
        onChange={e => onChange?.(e.target.value)}
        style={{ minWidth: 140 }}
      >
        <option value="">(no period)</option>
        {periods.registry.map(p => (
          <option key={p.slug} value={p.label}>
            {p.label}{p.label === periods.baseline ? ' · baseline' : ''}
          </option>
        ))}
      </select>
      {allowAdd && (
        adding ? (
          <>
            <input
              autoFocus className="src-input"
              value={draft} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPeriod(); if (e.key === 'Escape') setAdding(false); }}
              placeholder="e.g. Q3 2026" style={{ width: 140 }}
            />
            <button className="btn btn-primary btn-sm" onClick={addPeriod}>Add</button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>+ Period</button>
        )
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify Vite serves it**

```bash
curl -s -o /tmp/pp.js "http://localhost:51730/src/components/PeriodPicker.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PeriodPicker.jsx
git commit -m "feat(ui): PeriodPicker component (select + inline add)"
```

---

### Task 24: Active-period chip in App.jsx topbar

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add a small chip in the topbar that reads `/api/periods` on mount and shows `periods.current`**

Near the existing PROJECT chip, add:

```jsx
import { useEffect as _useEffectP, useState as _useStateP } from 'react';

function ActivePeriodChip() {
  const [cur, setCur] = _useStateP(null);
  _useEffectP(() => {
    (async () => {
      try {
        const data = await (await fetch('/api/periods')).json();
        setCur(data.current);
      } catch { /* noop */ }
    })();
  }, []);
  if (!cur) return null;
  return (
    <span className="period-chip">
      Period: <strong>{cur}</strong>
    </span>
  );
}
```

Render `<ActivePeriodChip />` in the topbar where the project chip lives.

- [ ] **Step 2: Append a small style to `frontend/src/styles.css`**

```css
.period-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--ink-3);
  padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px;
}
.period-chip strong { color: var(--ink-2); font-weight: 600; }
```

- [ ] **Step 3: Vite OK + commit**

```bash
curl -s -o /tmp/a.js "http://localhost:51730/src/App.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
git add frontend/src/App.jsx frontend/src/styles.css
git commit -m "feat(ui): active period chip in topbar"
```

---

### Task 25: Sources tab — period picker + per-period download history

**Files:**
- Modify: `frontend/src/pages/Sources.jsx`

- [ ] **Step 1: Insert PeriodPicker into the Sources form**

Near the existing Kobo/Ona controls, add:

```jsx
import PeriodPicker from '../components/PeriodPicker.jsx';

// inside the component, near other state:
const [period, setPeriod] = useState(null);

// in the JSX, before the Download button:
<div style={{ marginBottom: 12 }}>
  <label style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>Download for period</label>
  <PeriodPicker value={period} onChange={async v => {
    setPeriod(v);
    if (v) await fetch('/api/periods/current', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: v }) });
  }} />
</div>
```

- [ ] **Step 2: Add a small per-period history table**

Add a section at the bottom of Sources that fetches `/api/periods` and `/api/data/sessions` to render:

```
Q1 2026  · 1,240 rows · downloaded 2026-03-30 14:02
Q2 2026  · 1,318 rows · downloaded 2026-06-30 16:45
(no data) Q3 2026
```

The implementation can be a simple table — sessions API returns metadata that includes filenames, and you parse the slug out of the filename to group by period.

If the existing `/api/data/sessions` doesn't surface per-period info, expose it on the frontend by globbing the filenames the response already returns.

- [ ] **Step 3: Vite OK + commit**

```bash
curl -s -o /tmp/s.js "http://localhost:51730/src/pages/Sources.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
git add frontend/src/pages/Sources.jsx
git commit -m "feat(ui): Sources tab period picker + per-period history"
```

---

### Task 26: IndicatorModal — `compare_to` field

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (IndicatorModal)

- [ ] **Step 1: Add a new field**

In the existing IndicatorModal, add an optional field after `format`:

```jsx
<ModalField label="Compare to" hint="Pick a period to compute delta + pct from. Default: baseline.">
  <select className="src-input" value={compareTo} onChange={e => setCompareTo(e.target.value)}>
    <option value="">(no comparison)</option>
    <option value="baseline">Baseline</option>
    {/* Could also list registry period labels — fetched via /api/periods if you want */}
  </select>
</ModalField>
```

Wire the `compareTo` value into the `item` object before calling `onSave`.

- [ ] **Step 2: Composition Composition.jsx commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "feat(ui): IndicatorModal compare_to field"
```

---

### Task 27: Composition chart catalog includes period_bar / period_line

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (the `CHART_TYPES` array at the top)

- [ ] **Step 1: Append the two new types**

Find the `CHART_TYPES = [...]` array and append `'period_bar'` and `'period_line'` to the end. Also add corresponding entries to `chartTone()` and `ChartIcon` so they display a sensible icon (a small line/bar SVG, your choice — reuse `bar`/`line` icons for simplicity).

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Composition.jsx
git commit -m "feat(ui): period_bar/period_line in Composition's chart catalog"
```

---

### Task 28: Docs — README + CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — append a new section**

After the "Validate (data quality)" section, add:

```markdown
### Multi-period workflow

`databridge-cli` can track data collection across multiple periods (baseline, midline, endline; or quarterly rounds) without overwriting earlier downloads.

**Config**:

```yaml
periods:
  current:  "Q2 2026"
  baseline: "Q1 2026"
  registry:
    - { label: "Q1 2026", slug: "q1_2026" }
    - { label: "Q2 2026", slug: "q2_2026" }
```

**Commands**:

```bash
# Tag a download with a period (auto-registers if new)
python3 src/data/make.py download --period "Q3 2026"

# Build the report for a specific period
python3 src/data/make.py build-report --period "Q2 2026"

# Comparison report (any number of periods)
python3 src/data/make.py build-report --compare "Q1 2026,Q2 2026"

# Switch the active period
python3 src/data/make.py set-period "Q3 2026"
```

**Template placeholders** (in addition to the standard `{{ ind_<name> }}`):

- `{{ ind_<name>_p_<slug> }}` — value for a specific period
- `{{ ind_<name>_delta }}` — current minus baseline
- `{{ ind_<name>_pct_change }}` — percent change from baseline
- `{{ provenance.period_label }}` — the active period label
- `{{ provenance.compared_periods }}` — when --compare was used

**Backward compatibility**: configs without a `periods:` block behave exactly as before. Single-period mode is the default.
```

- [ ] **Step 2: CLAUDE.md — update the annotated config example**

Open the annotated `config.yml` example in CLAUDE.md and add the `periods:` block at a sensible location (above `export:` is good). Also add the new commands to the "Four CLI commands" section (now six commands: `set-period` and the new `--period`/`--compare` flags).

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: multi-period workflow in README + CLAUDE.md"
```

---

## Final self-review checklist

- [ ] `pytest -v` passes (expected: ~55+ tests; was 32 before this plan).
- [ ] Configs without a `periods:` block behave EXACTLY as today (regression-test: the existing `test_build_report_smoke.py` must pass unchanged).
- [ ] `python3 src/data/make.py build-report` works without `--period` (uses `periods.current` if set, else falls back to legacy file naming).
- [ ] `python3 src/data/make.py build-report --compare "A,B"` produces a docx mentioning both periods.
- [ ] `/api/periods` GET returns empty registry when no `periods:` block exists.
- [ ] Frontend: active period chip appears in topbar when a period is set; absent otherwise.
- [ ] Frontend: Sources tab can add/select a period; download writes to a per-period filename.
- [ ] Frontend: IndicatorsCard shows a trend chip when 2+ periods have data.
- [ ] Frontend: Reports tab has a Compare button that produces a comparison report.

## Deferred to follow-up plans

| Concern | Where |
|---|---|
| Period boundaries (calendar dates) drive automatic data sliding from a single `_submission_time` column | future B.2 polish |
| Period-aware filters (e.g. "only this period's villages") | future B.2 polish |
| Period diff exports (CSV of delta values) | future B.2 polish |
| Results-framework hierarchy (Output → Outcome → Impact) | **B.3** |
| PII redaction step in the data pipeline | **B.4** |
