# Validation View (Phase B.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface data-quality problems in the downloaded submissions *before* the user spends time configuring charts — missingness per column, suspect numeric outliers, suspected duplicate submissions, and type-coercion issues — all in a dedicated **Validate** tab sitting between Questions and Composition.

**Architecture:**
- Pure-Python detectors in `src/data/validate.py` (no AI, no IO). One function per check, each returning a structured "findings" list. A top-level `validate_dataset(cfg, df, repeat_tables) → ValidationReport` composes them.
- A single FastAPI endpoint `POST /api/validate` that loads the latest processed data via the existing `load_processed_data(cfg)`, runs the detectors, and returns the report as JSON.
- A new React page `frontend/src/pages/Validate.jsx` registered as the third tab in `App.jsx`'s `TABS` (renumbering subsequent steps). The page renders one card per check with sortable rows and a severity color.
- pytest coverage on the detector unit functions and one endpoint smoke test.

**Tech Stack:** Python 3.12, pandas, FastAPI, pytest, React + Vite.

**Non-goals:**
- Per-column user-configurable thresholds (defaults are baked into the detectors for MVP). A `validation:` config block can come in a follow-up.
- Auto-fixing or quarantining bad rows (read-only surfacing only).
- Validation of repeat-group rows beyond what each detector trivially supports (the report focuses on the main table; repeat-table coverage is best-effort).
- Real-time / push validation as data streams in (validation runs on-demand against the latest downloaded snapshot).
- Internationalization of severity labels / hints (English strings for MVP).

**Scope note:** This is plan B.1. The other three Phase B subsystems — multi-period (B.2), results framework (B.3), PII layer (B.4) — follow as separate plans.

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/data/validate.py` | create | Pure detector functions + `validate_dataset` aggregator |
| `tests/test_validate.py` | create | Unit tests for each detector + aggregator shape |
| `web/main.py` | modify (append) | `POST /api/validate` endpoint |
| `tests/test_validate_endpoint.py` | create | Smoke test against the endpoint via the ASGI fixture |
| `frontend/src/App.jsx:10-17` | modify | Add `Validate` to `TABS`, renumber Composition step from 3 → 4 and Reports from 4 → 5 |
| `frontend/src/pages/Validate.jsx` | create | The page — header, fetch on mount, four detector cards |
| `frontend/src/styles.css` | modify (append) | A handful of validate-card classes for severity colors and table layout |

---

## Detector contract (referenced by Tasks 2–6)

Every detector returns a list of dicts with this shape:

```python
{
    "severity":    "info" | "warning" | "error",
    "column":      str,           # the export_label or "(row)" for row-level
    "kind":        str,           # detector identifier, e.g. "missingness", "outlier_iqr"
    "message":     str,           # human-readable one-liner
    "count":       int,           # number of rows affected
    "pct":         float,         # fraction of rows affected, 0.0–1.0
    "examples":    list,          # up to 5 sample bad values or row indices
}
```

The top-level `validate_dataset(cfg, df, repeat_tables) → dict` returns:

```python
{
    "n_rows":     int,                       # len(main_df)
    "n_columns":  int,
    "checks":     [<finding>, ...],          # all findings, sorted by severity then count desc
    "summary":    {"error": int, "warning": int, "info": int},
}
```

This contract is the source of truth — every task references it.

---

## Task 1: Detector module skeleton + the simplest detector (missingness)

**Files:**
- Create: `src/data/validate.py`
- Create: `tests/test_validate.py`

- [ ] **Step 1: Write the failing tests for `compute_missingness`**

Create `tests/test_validate.py`:

```python
import pandas as pd
from src.data.validate import compute_missingness


def test_missingness_flat_dataframe_no_missing():
    df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
    findings = compute_missingness(df)
    assert findings == []  # nothing missing, no findings


def test_missingness_returns_warning_for_20_to_50_percent_missing():
    # 6 rows, 2 missing in 'a' → 33%
    df = pd.DataFrame({"a": [1, None, 3, None, 5, 6], "b": ["x"] * 6})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert len(a) == 1
    assert a[0]["severity"] == "warning"
    assert a[0]["count"] == 2
    assert round(a[0]["pct"], 2) == 0.33
    assert a[0]["kind"] == "missingness"


def test_missingness_returns_error_for_over_50_percent_missing():
    # 4 rows, 3 missing in 'a' → 75%
    df = pd.DataFrame({"a": [1, None, None, None], "b": ["x"] * 4})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["severity"] == "error"


def test_missingness_treats_empty_string_as_missing():
    df = pd.DataFrame({"a": ["", "", "", "x"]})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["count"] == 3


def test_missingness_under_threshold_is_info_or_skipped():
    # 100 rows, 5 missing → 5% — below 20% threshold, classified info or omitted.
    # MVP choice: omit findings below 5% to keep the UI quiet; emit "info" for 5–20%.
    df = pd.DataFrame({"a": [None] * 5 + [1] * 95})
    findings = compute_missingness(df)
    a = [f for f in findings if f["column"] == "a"]
    assert a and a[0]["severity"] == "info"
```

- [ ] **Step 2: Run the tests — confirm they fail**

```bash
pytest tests/test_validate.py -v
```

Expected: ImportError / collection failure (module doesn't exist yet).

- [ ] **Step 3: Implement `compute_missingness`**

Create `src/data/validate.py`:

```python
"""Data-quality detectors for the Validate tab.

Each detector returns a list of "finding" dicts with this shape:

    {
        "severity": "info" | "warning" | "error",
        "column":   str,         # export_label or "(row)"
        "kind":     str,         # detector identifier
        "message":  str,         # human one-liner
        "count":    int,         # rows affected
        "pct":      float,       # fraction affected, 0.0-1.0
        "examples": list,        # up to 5 sample bad values or row indices
    }
"""
from __future__ import annotations
from typing import Dict, List, Optional

import pandas as pd


# Severity thresholds, in fraction-of-rows-affected. Below INFO is omitted.
INFO_THRESHOLD    = 0.05   # 5%
WARNING_THRESHOLD = 0.20   # 20%
ERROR_THRESHOLD   = 0.50   # 50%


def _severity_for_pct(pct: float) -> Optional[str]:
    """Map a fraction to a severity bucket, or None if below the floor."""
    if pct >= ERROR_THRESHOLD:   return "error"
    if pct >= WARNING_THRESHOLD: return "warning"
    if pct >= INFO_THRESHOLD:    return "info"
    return None


def compute_missingness(df: pd.DataFrame) -> List[Dict]:
    """Per-column missingness. Empty strings and NaN both count as missing."""
    if df is None or len(df) == 0:
        return []
    n = len(df)
    findings: List[Dict] = []
    for col in df.columns:
        s = df[col]
        # NaN OR empty string (after strip) is "missing"
        missing_mask = s.isna() | (s.astype(str).str.strip() == "")
        count = int(missing_mask.sum())
        if count == 0:
            continue
        pct = count / n
        sev = _severity_for_pct(pct)
        if sev is None:
            continue
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "missingness",
            "message":  f"{count} of {n} rows ({pct:.0%}) are missing or blank",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": [],  # no value-examples for missing data
        })
    return findings
```

- [ ] **Step 4: Run the tests — confirm 5 pass**

```bash
pytest tests/test_validate.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Run the full suite — no regressions**

```bash
pytest -v
```

Expected: 14 passed (9 from Phase A + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(validate): add missingness detector with severity thresholds"
```

---

## Task 2: Numeric-outlier detector (IQR-based)

**Files:**
- Modify: `src/data/validate.py` (append `find_numeric_outliers`)
- Modify: `tests/test_validate.py` (append tests)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_validate.py`:

```python
from src.data.validate import find_numeric_outliers


def test_outliers_returns_nothing_on_clean_numeric_column():
    df = pd.DataFrame({"age": [10, 12, 14, 16, 18, 20, 22, 24, 26, 28]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []


def test_outliers_flags_extreme_high_value():
    df = pd.DataFrame({"age": [10, 12, 14, 16, 18, 20, 22, 24, 26, 999]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert len(findings) == 1
    f = findings[0]
    assert f["column"] == "age"
    assert f["kind"] == "outlier_iqr"
    assert f["count"] == 1
    assert 999 in f["examples"] or 999.0 in f["examples"]


def test_outliers_only_runs_on_quantitative_columns():
    df = pd.DataFrame({"region": ["A"] * 9 + ["X"]})
    questions = [{"export_label": "region", "category": "categorical"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []


def test_outliers_ignores_columns_not_in_questions():
    df = pd.DataFrame({"untracked": [1, 2, 3, 4, 5, 999999]})
    questions = []
    findings = find_numeric_outliers(df, questions)
    assert findings == []  # column isn't a known quantitative question


def test_outliers_handles_all_nan_column_without_crashing():
    df = pd.DataFrame({"age": [None] * 10})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_numeric_outliers(df, questions)
    assert findings == []
```

- [ ] **Step 2: Run — confirm 5 new tests fail**

```bash
pytest tests/test_validate.py -v
```

Expected: existing 5 pass, new 5 fail (function not defined).

- [ ] **Step 3: Implement the detector**

Append to `src/data/validate.py`:

```python
def find_numeric_outliers(df: pd.DataFrame, questions: List[Dict]) -> List[Dict]:
    """Flag rows where a quantitative column's value is outside [Q1 - 3*IQR, Q3 + 3*IQR].

    3*IQR (vs the textbook 1.5) is a deliberate choice: M&E surveys often have
    legitimate skew (e.g. population counts), and 1.5*IQR generates too much
    noise. 3*IQR catches the obviously-mistyped values (Age=999, NumStudents=-1).
    """
    if df is None or len(df) == 0:
        return []
    quant_cols = {q.get("export_label") for q in questions if q.get("category") == "quantitative"}
    findings: List[Dict] = []
    n = len(df)
    for col in df.columns:
        if col not in quant_cols:
            continue
        s = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(s) < 4:  # IQR needs enough data to be meaningful
            continue
        q1, q3 = s.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr == 0:
            continue  # constant column — nothing to flag
        lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
        outliers = s[(s < lo) | (s > hi)]
        count = int(len(outliers))
        if count == 0:
            continue
        pct = count / n
        sev = _severity_for_pct(pct) or "info"  # outliers always show, even at 1 row
        examples = outliers.head(5).tolist()
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "outlier_iqr",
            "message":  f"{count} value(s) outside [{lo:.1f}, {hi:.1f}] (3×IQR bounds)",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": examples,
        })
    return findings
```

- [ ] **Step 4: Run tests — confirm 10 pass**

```bash
pytest tests/test_validate.py -v
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(validate): numeric outlier detector using 3×IQR"
```

---

## Task 3: Duplicate-row detector

**Files:**
- Modify: `src/data/validate.py` (append `find_duplicates`)
- Modify: `tests/test_validate.py` (append tests)

- [ ] **Step 1: Append failing tests**

Append to `tests/test_validate.py`:

```python
from src.data.validate import find_duplicates


def test_duplicates_on_unique_id_column():
    df = pd.DataFrame({"_id": ["a", "b", "c", "d"]})
    findings = find_duplicates(df)
    assert findings == []


def test_duplicates_flags_repeated_id():
    df = pd.DataFrame({"_id": ["a", "b", "a", "c"]})
    findings = find_duplicates(df)
    assert len(findings) == 1
    f = findings[0]
    assert f["kind"] == "duplicate_id"
    assert f["count"] == 2   # two rows share the duplicate id (a appears twice)
    assert "a" in f["examples"]


def test_duplicates_returns_empty_when_no_id_column_present():
    df = pd.DataFrame({"x": [1, 2, 3]})
    findings = find_duplicates(df)
    assert findings == []  # no _id / _uuid / _index — nothing to dedup on


def test_duplicates_prefers_underscore_uuid_over_underscore_id():
    # If _uuid is present it's treated as the canonical key.
    df = pd.DataFrame({"_id": ["A", "B", "C"], "_uuid": ["u1", "u1", "u2"]})
    findings = find_duplicates(df)
    assert findings and findings[0]["column"] == "_uuid"
```

- [ ] **Step 2: Run — confirm 4 new tests fail**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 3: Implement**

Append to `src/data/validate.py`:

```python
def find_duplicates(df: pd.DataFrame) -> List[Dict]:
    """Flag rows that share an identifier column.

    Looks for canonical Kobo identifiers in this priority order:
      _uuid > _id > _index
    """
    if df is None or len(df) == 0:
        return []
    id_col = next((c for c in ("_uuid", "_id", "_index") if c in df.columns), None)
    if id_col is None:
        return []
    counts = df[id_col].value_counts()
    dup_ids = counts[counts > 1]
    if dup_ids.empty:
        return []
    affected_rows = int(dup_ids.sum())  # total rows involved in any duplicate group
    n = len(df)
    pct = affected_rows / n
    return [{
        "severity": "error",  # duplicated identifiers are always serious
        "column":   id_col,
        "kind":     "duplicate_id",
        "message":  f"{affected_rows} rows share a duplicated {id_col} across {len(dup_ids)} group(s)",
        "count":    affected_rows,
        "pct":      round(pct, 4),
        "examples": [str(v) for v in dup_ids.head(5).index.tolist()],
    }]
```

- [ ] **Step 4: Run tests — confirm 14 pass**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(validate): duplicate-id detector (prefers _uuid > _id > _index)"
```

---

## Task 4: Type-coercion-issue detector

**Files:**
- Modify: `src/data/validate.py` (append `find_type_issues`)
- Modify: `tests/test_validate.py` (append tests)

- [ ] **Step 1: Append failing tests**

```python
from src.data.validate import find_type_issues


def test_type_issues_no_findings_when_quantitative_column_is_clean():
    df = pd.DataFrame({"age": ["1", "2", "3"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    assert find_type_issues(df, questions) == []


def test_type_issues_flags_non_numeric_in_quantitative_column():
    df = pd.DataFrame({"age": ["12", "n/a", "20", "TBD", "25"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    findings = find_type_issues(df, questions)
    assert len(findings) == 1
    f = findings[0]
    assert f["column"] == "age"
    assert f["kind"] == "type_quantitative_nonnumeric"
    assert f["count"] == 2
    assert "n/a" in f["examples"] or "TBD" in f["examples"]


def test_type_issues_ignores_blank_and_nan_values():
    df = pd.DataFrame({"age": ["1", "", None, "2"]})
    questions = [{"export_label": "age", "category": "quantitative"}]
    # Blank/NaN are caught by missingness detector, not type detector.
    assert find_type_issues(df, questions) == []


def test_type_issues_skips_categorical_columns():
    df = pd.DataFrame({"region": ["A", "B", "weird-name"]})
    questions = [{"export_label": "region", "category": "categorical"}]
    assert find_type_issues(df, questions) == []
```

- [ ] **Step 2: Run — confirm 4 new tests fail**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 3: Implement**

Append to `src/data/validate.py`:

```python
def find_type_issues(df: pd.DataFrame, questions: List[Dict]) -> List[Dict]:
    """Flag rows where a quantitative column holds a non-numeric, non-blank string.

    Distinguishes "broken data type" from "missing data": NaN and blank are
    handled by compute_missingness; this detector targets values like 'n/a',
    'TBD', '--', which suggest data entry sloppiness rather than absence.
    """
    if df is None or len(df) == 0:
        return []
    quant_cols = {q.get("export_label") for q in questions if q.get("category") == "quantitative"}
    findings: List[Dict] = []
    n = len(df)
    for col in df.columns:
        if col not in quant_cols:
            continue
        s = df[col]
        # Non-numeric AND non-blank values
        as_str = s.astype(str).str.strip()
        coerced = pd.to_numeric(as_str, errors="coerce")
        bad_mask = coerced.isna() & (as_str != "") & ~s.isna()
        count = int(bad_mask.sum())
        if count == 0:
            continue
        pct = count / n
        sev = _severity_for_pct(pct) or "info"
        examples = as_str[bad_mask].head(5).tolist()
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "type_quantitative_nonnumeric",
            "message":  f"{count} non-numeric value(s) in a quantitative column",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": examples,
        })
    return findings
```

- [ ] **Step 4: Run tests — confirm 18 pass**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(validate): type-coercion detector for non-numeric quantitative values"
```

---

## Task 5: `validate_dataset` aggregator

**Files:**
- Modify: `src/data/validate.py` (append `validate_dataset`)
- Modify: `tests/test_validate.py` (append tests)

- [ ] **Step 1: Append failing tests**

```python
from src.data.validate import validate_dataset


def test_validate_dataset_returns_envelope_shape():
    cfg = {"questions": [{"export_label": "age", "category": "quantitative"}]}
    df = pd.DataFrame({"age": [1, 2, 3, 4]})
    report = validate_dataset(cfg, df, repeat_tables={})
    assert set(report.keys()) == {"n_rows", "n_columns", "checks", "summary"}
    assert report["n_rows"] == 4
    assert report["n_columns"] == 1
    assert report["summary"] == {"error": 0, "warning": 0, "info": 0}
    assert report["checks"] == []


def test_validate_dataset_sorts_checks_by_severity_then_count():
    cfg = {"questions": [
        {"export_label": "a", "category": "quantitative"},
        {"export_label": "b", "category": "quantitative"},
    ]}
    # Construct a df where:
    #   a: 1 outlier (info)
    #   b: 60% missing (error)
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5, 6, 7, 8, 9, 999],
                       "b": [None] * 6 + [1, 2, 3, 4]})
    report = validate_dataset(cfg, df, repeat_tables={})
    # error first
    assert report["checks"][0]["severity"] == "error"
    assert report["summary"]["error"] >= 1


def test_validate_dataset_empty_df_returns_empty_report():
    cfg = {"questions": []}
    df = pd.DataFrame()
    report = validate_dataset(cfg, df, repeat_tables={})
    assert report["n_rows"] == 0
    assert report["checks"] == []
```

- [ ] **Step 2: Run — confirm 3 new tests fail**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 3: Implement**

Append to `src/data/validate.py`:

```python
def validate_dataset(cfg: Dict, df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Run all detectors against the main DataFrame and return a report envelope.

    repeat_tables is accepted for forward-compatibility (a future detector pass
    will surface findings across repeat groups) but is unused in the MVP.
    """
    questions = cfg.get("questions", []) or []
    if df is None:
        df = pd.DataFrame()

    findings: List[Dict] = []
    findings += compute_missingness(df)
    findings += find_numeric_outliers(df, questions)
    findings += find_duplicates(df)
    findings += find_type_issues(df, questions)

    # Sort: errors first, then warnings, then info; within a tier, larger count first.
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda f: (severity_rank.get(f["severity"], 9), -f["count"]))

    summary = {"error": 0, "warning": 0, "info": 0}
    for f in findings:
        if f["severity"] in summary:
            summary[f["severity"]] += 1

    return {
        "n_rows":    int(len(df)),
        "n_columns": int(df.shape[1]) if hasattr(df, "shape") else 0,
        "checks":    findings,
        "summary":   summary,
    }
```

- [ ] **Step 4: Run tests — confirm 21 pass**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 5: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(validate): top-level validate_dataset aggregator with sorted findings"
```

---

## Task 6: `/api/validate` endpoint

**Files:**
- Modify: `web/main.py` (append a new endpoint near the other read-only endpoints)
- Create: `tests/test_validate_endpoint.py`

- [ ] **Step 1: Locate a sensible insertion point**

Run:

```bash
grep -n "^@app.\(get\|post\)" web/main.py | head -20
```

You'll see the endpoints in declaration order. Pick a spot near other read-only `@app.get`/`@app.post` endpoints — for example, just before `@app.get("/api/data/sessions")` or near `/api/state`. Anywhere is fine; just keep it grouped sensibly.

- [ ] **Step 2: Write the smoke test FIRST**

Create `tests/test_validate_endpoint.py`:

```python
"""Smoke test for /api/validate. Uses the in-process ASGI client + a temp workspace."""
import os
import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_workspace(tmp_path, monkeypatch):
    """Stage a config + a tiny data file the endpoint can read."""
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    csv = ws / "data" / "processed" / "vsmoke_data_20260101_120000.csv"
    pd.DataFrame({"Region": ["A", "A", None, "B"], "Age": [10, 12, 14, 999]}).to_csv(csv, index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "vsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Region", "label": "Region", "type": "select_one",
             "category": "categorical", "group": "", "export_label": "Region"},
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts":  [],
        "report":  {"output_dir": str(ws / "reports")},
        "export":  {"format": "csv", "output_dir": str(ws / "data" / "processed")},
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_validate_endpoint_returns_report_envelope(tmp_workspace, api_client):
    r = api_client.post("/api/validate", json={})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body.keys()) >= {"n_rows", "n_columns", "checks", "summary"}
    assert body["n_rows"] == 4


def test_validate_endpoint_finds_the_outlier(tmp_workspace, api_client):
    r = api_client.post("/api/validate", json={})
    body = r.json()
    # The Age column has a 999 — should appear as an outlier finding.
    outliers = [c for c in body["checks"] if c["kind"] == "outlier_iqr" and c["column"] == "Age"]
    assert outliers, f"expected an Age outlier; got {body['checks']}"
    assert 999 in outliers[0]["examples"] or 999.0 in outliers[0]["examples"]
```

- [ ] **Step 3: Run — confirm tests fail**

```bash
pytest tests/test_validate_endpoint.py -v
```

Expected: HTTP 404 from the endpoint (it doesn't exist yet).

- [ ] **Step 4: Add the endpoint to `web/main.py`**

Near the other read-only endpoints, append:

```python
@app.post("/api/validate")
async def validate():
    """Run all validation detectors against the latest downloaded data."""
    if not CONFIG_PATH.exists():
        raise HTTPException(status_code=400, detail="config.yml not found")
    async with aiofiles.open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(await f.read()) or {}
    try:
        from src.data.transform import load_processed_data
        from src.data.validate import validate_dataset
        df, repeat_tables = load_processed_data(cfg)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=f"No downloaded data found. Run Download first. ({e})")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to load data: {e}")
    report = validate_dataset(cfg, df, repeat_tables)
    return report
```

- [ ] **Step 5: Run tests — confirm 2 pass**

```bash
pytest tests/test_validate_endpoint.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Run full suite — no regressions**

```bash
pytest -v
```

Expected: 23 passed (9 Phase A + 14 from Tasks 1–5).

- [ ] **Step 7: Commit**

```bash
git add web/main.py tests/test_validate_endpoint.py
git commit -m "feat(validate): POST /api/validate endpoint backed by validate_dataset"
```

---

## Task 7: Register Validate tab + create empty `Validate.jsx`

**Files:**
- Modify: `frontend/src/App.jsx` (TABS array + step numbers)
- Create: `frontend/src/pages/Validate.jsx`

- [ ] **Step 1: Create a minimal `Validate.jsx`**

Create `frontend/src/pages/Validate.jsx`:

```jsx
import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Validate() {
  const toast = useToast();
  const [report, setReport] = useState(null);   // null | { n_rows, n_columns, checks, summary }
  const [error,  setError]  = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
        setReport(data);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader step="Step 3 of 5 · Validate" title="Check your data." subtitle="Scan the downloaded submissions for missingness, duplicates, outliers, and type problems before composing charts." />
      {loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 60 }}>Running validation…</div>}
      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>
          <div style={{ fontWeight: 600 }}>Validation failed</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, marginTop: 6 }}>{error}</div>
          <div style={{ marginTop: 8, color: 'var(--ink-3)', fontSize: 12 }}>If no data is downloaded yet, run <strong>Download</strong> in the Dashboard first.</div>
        </div>
      )}
      {report && (
        <div style={{ padding: '0 8px' }}>
          <div style={{ color: 'var(--ink-3)', fontSize: 13, marginBottom: 16 }}>
            Scanned {report.n_rows.toLocaleString()} rows · {report.n_columns} columns ·
            <span style={{ marginLeft: 8, color: 'var(--danger, #b91c1c)' }}>{report.summary.error} errors</span> ·
            <span style={{ marginLeft: 8, color: 'var(--warn, #b45309)' }}>{report.summary.warning} warnings</span> ·
            <span style={{ marginLeft: 8 }}>{report.summary.info} notes</span>
          </div>
          {report.checks.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>No issues found — your data looks clean.</div>
          ) : (
            <div className="validate-findings" />
          )}
        </div>
      )}
    </div>
  );
}
```

(The findings list itself is wired up in Task 8 — for now this page just fetches and renders the summary line.)

- [ ] **Step 2: Register the tab in `App.jsx`**

Modify `frontend/src/App.jsx`. Update the imports at the top to add Validate:

```jsx
import Validate from './pages/Validate.jsx';
```

Replace the existing `TABS` constant (around lines 10–17) with:

```jsx
const TABS = [
  { id: 'dashboard',   label: 'Dashboard',                         component: Dashboard },
  { id: 'sources',     label: 'Sources',     step: '1',            component: Sources },
  { id: 'questions',   label: 'Questions',   step: '2',            component: Questions },
  { id: 'validate',    label: 'Validate',    step: '3',            component: Validate },
  { id: 'composition', label: 'Composition', step: '4',            component: Composition },
  { id: 'reports',     label: 'Reports',     step: '5',            component: Reports },
  { id: 'templates',   label: 'Templates',                         component: Templates, secondary: true },
];
```

(The steps for Composition and Reports shift from 3→4 and 4→5.)

- [ ] **Step 3: Verify Vite compiles cleanly**

```bash
./scripts/dev.sh status || ./scripts/dev.sh start
sleep 2
curl -s -o /tmp/v.js "http://localhost:51730/src/pages/Validate.jsx?t=$(date +%s)" -w "HTTP %{http_code} bytes=%{size_download}\n"
curl -s -o /tmp/a.js "http://localhost:51730/src/App.jsx?t=$(date +%s)" -w "HTTP %{http_code} bytes=%{size_download}\n"
```

Expected: both HTTP 200 with non-zero bytes.

- [ ] **Step 4: Manual sanity check**

Open `http://localhost:51730/` in a browser. The tab nav should now show: Dashboard · Sources(1) · Questions(2) · Validate(3) · Composition(4) · Reports(5) · Templates. Click Validate — you should see either "Running validation…" then a summary line, OR an error pointing the user at Download (if no data is on disk).

If something doesn't render, check the browser console for the actual JS error.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/pages/Validate.jsx
git commit -m "feat(ui): add Validate tab between Questions and Composition"
```

---

## Task 8: Findings list rendering on `Validate.jsx`

**Files:**
- Modify: `frontend/src/pages/Validate.jsx` (replace the empty `<div className="validate-findings" />` placeholder)
- Modify: `frontend/src/styles.css` (append validate-specific styles)

- [ ] **Step 1: Add the styles**

Append to `frontend/src/styles.css`:

```css
/* ── Validate tab ───────────────────────────────────────────────────────────── */
.validate-findings {
  display: grid;
  gap: 12px;
}
.validate-finding {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  gap: 12px;
  align-items: start;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px 16px;
}
.validate-finding__bar { width: 4px; border-radius: 2px; align-self: stretch; }
.validate-finding[data-severity="error"]   .validate-finding__bar { background: var(--danger, #b91c1c); }
.validate-finding[data-severity="warning"] .validate-finding__bar { background: var(--warn,   #b45309); }
.validate-finding[data-severity="info"]    .validate-finding__bar { background: var(--ink-3); }
.validate-finding__column { font-family: var(--font-mono, monospace); font-weight: 600; font-size: 13px; }
.validate-finding__kind   { color: var(--ink-3); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; margin-left: 8px; }
.validate-finding__msg    { color: var(--ink-2); font-size: 13px; margin-top: 4px; line-height: 1.45; }
.validate-finding__examples { font-family: var(--font-mono, monospace); color: var(--ink-3); font-size: 12px; margin-top: 6px; }
.validate-finding__count  { color: var(--ink-3); font-size: 12px; white-space: nowrap; padding-top: 2px; }
```

- [ ] **Step 2: Replace the placeholder in `Validate.jsx`**

In `frontend/src/pages/Validate.jsx`, replace:

```jsx
            <div className="validate-findings" />
```

With:

```jsx
            <div className="validate-findings">
              {report.checks.map((f, i) => (
                <div className="validate-finding" data-severity={f.severity} key={`${f.kind}-${f.column}-${i}`}>
                  <div className="validate-finding__bar" />
                  <div>
                    <div>
                      <span className="validate-finding__column">{f.column}</span>
                      <span className="validate-finding__kind">{f.kind}</span>
                    </div>
                    <div className="validate-finding__msg">{f.message}</div>
                    {f.examples?.length > 0 && (
                      <div className="validate-finding__examples">
                        Examples: {f.examples.map(v => JSON.stringify(v)).join(', ')}
                      </div>
                    )}
                  </div>
                  <div className="validate-finding__count">
                    {f.count.toLocaleString()} row{f.count === 1 ? '' : 's'}
                    <br />
                    <span style={{ color: f.severity === 'error' ? 'var(--danger, #b91c1c)' : f.severity === 'warning' ? 'var(--warn, #b45309)' : 'var(--ink-3)' }}>
                      {(f.pct * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
```

- [ ] **Step 3: Vite re-compiles**

```bash
curl -s -o /tmp/v.js "http://localhost:51730/src/pages/Validate.jsx?t=$(date +%s)" -w "HTTP %{http_code} bytes=%{size_download}\n"
grep -c "validate-finding\|examples" /tmp/v.js
```

Expected: HTTP 200; grep count ≥ 2.

- [ ] **Step 4: Manual sanity check**

Reload the Validate tab in the browser. If data is downloaded, you should see one card per finding with:
- Severity color bar on the left
- Column name + kind badge
- Human-readable message
- Examples (if any)
- Affected rows + percentage on the right

Without downloaded data, you should still see the "Validation failed" error block with the "run Download first" hint.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Validate.jsx frontend/src/styles.css
git commit -m "feat(ui): render Validate findings as severity-coded cards"
```

---

## Task 9: README — document the Validate tab

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a short section under "Trust & audit" (or wherever the Phase A trust section landed)**

Add this paragraph (formatted to match the surrounding doc style):

```markdown
### Validate (data quality)

The **Validate** tab (step 3 of 5) scans your downloaded submissions and surfaces:

- **Missingness** — columns where ≥5% of rows are blank or NaN, with severity escalating at 20% and 50%.
- **Numeric outliers** — quantitative columns with values outside `Q1 − 3·IQR` to `Q3 + 3·IQR`. Catches mistyped Age=999 or NumStudents=-1 without flooding on legitimate skew.
- **Duplicate identifiers** — rows that share `_uuid`, `_id`, or `_index` (whichever the data uses).
- **Type-coercion issues** — quantitative columns containing non-numeric strings like `"n/a"` or `"TBD"`.

Findings are computed by `src/data/validate.py` and served by `POST /api/validate`. There are no user-configurable thresholds in this MVP — the defaults are tuned for typical M&E survey data.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README section on the Validate tab"
```

---

## Self-review checklist

After all tasks land, verify:

- [ ] `pytest -v` reports all tests passing (Phase A's 9 + Phase B.1's ~20 new = ~29).
- [ ] `grep -rn "Math.random\|coming next" frontend/src/pages/` returns nothing new (no regressions from Phase A's trust hardening).
- [ ] Opening the dev server and visiting `/` shows the tab order: Dashboard · Sources(1) · Questions(2) · Validate(3) · Composition(4) · Reports(5) · Templates.
- [ ] Clicking Validate without downloaded data shows a clean error pointing at Download.
- [ ] Clicking Validate with downloaded data shows a non-empty findings list (or a clean "no issues" panel) within ~1s.
- [ ] `curl -s -X POST http://localhost:8000/api/validate -H 'Content-Type: application/json' -d '{}' | python3 -m json.tool` returns the report envelope.

## Deferred to follow-up plans

| Concern | Where |
|---|---|
| Per-column user-configurable thresholds via `validation:` block in config.yml | future B.1 polish |
| Cross-column rules (e.g. "Age implausible given Years of Schooling") | future B.1 polish |
| Repeat-group detector coverage (the MVP only validates the main table) | future B.1 polish |
| Auto-fix / quarantine workflow | not planned |
| Multi-period support (baseline → midline → endline) | **B.2** |
| Results-framework hierarchy (Output → Outcome → Impact) | **B.3** |
| PII redaction step in the data pipeline | **B.4** |
