# Data Quality Web Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the report's per-column Data Quality overview (completeness / outlier-rate / duplicate-rate) in the web UI as a threshold-colored, sortable panel atop the Validate tab, backed by a new read-only `GET /api/data-quality` endpoint.

**Architecture:** Split `src/reports/data_quality.py` into a numeric core (`compute_data_quality`, returns floats / `None`) and a thin string formatter (`build_data_quality`, unchanged output contract for the `{{ data_quality }}` template). A new `GET /api/data-quality` endpoint loads processed data, applies PII redaction, and returns the numeric core. A new `DataQualityPanel.jsx` renders it above the existing findings list in `Validate.jsx`.

**Tech Stack:** Python 3.12 + pandas + FastAPI; React + Vite (no JS test runner — frontend verified via build + manual smoke).

**Spec:** [`../specs/2026-05-31-data-quality-web-panel-design.md`](../specs/2026-05-31-data-quality-web-panel-design.md)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/data_quality.py` | modify | Add `compute_data_quality` (numeric core); reduce `build_data_quality` to a formatter wrapping it |
| `tests/test_data_quality.py` | modify | Add numeric-core tests; keep existing string-format tests green (regression guard) |
| `web/main.py` | modify | Add `GET /api/data-quality` |
| `tests/test_data_quality_api.py` | create | Endpoint tests (data present / no data), monkeypatch pattern from `test_profile_api.py` |
| `frontend/src/components/DataQualityPanel.jsx` | create | Threshold-colored, sortable DQ table |
| `frontend/src/pages/Validate.jsx` | modify | Render `<DataQualityPanel/>` above findings |
| `frontend/src/styles.css` | modify | Panel + threshold-cell styles |
| `CLAUDE.md` | modify | Document `/api/data-quality` + the Validate-tab panel |

---

## Task 1: Numeric core in `data_quality.py`

Split the per-column math out of the formatter. `compute_data_quality` returns numbers (`float` 0–100, or `None`); `build_data_quality` formats those numbers into the existing `"95.0%"` / `"—"` strings so the report template and its tests are unaffected.

**Files:**
- Modify: `src/reports/data_quality.py`
- Modify: `tests/test_data_quality.py`

- [ ] **Step 1: Write the failing numeric-core tests**

Append to `tests/test_data_quality.py`:

```python
from src.reports.data_quality import compute_data_quality


def test_compute_returns_numeric_values():
    cfg = {"questions": [
        {"export_label": "Phone", "category": "qualitative"},
        {"export_label": "Site", "category": "categorical"},
    ]}
    dq = compute_data_quality(cfg, _df())
    assert dq["has_data"] is True
    by = {r["column"]: r for r in dq["rows"]}
    assert by["Phone"]["completeness"] == 80.0          # float, not "80.0%"
    assert by["Phone"]["outlier_rate"] is None          # non-numeric -> None
    assert by["Site"]["duplicate_rate"] == 80.0


def test_compute_outlier_rate_numeric():
    dq = compute_data_quality(
        {"questions": [{"export_label": "Age", "category": "quantitative"}]}, _df())
    assert dq["rows"][0]["outlier_rate"] == 10.0


def test_compute_complete_unique_column():
    dq = compute_data_quality({"questions": [{"export_label": "Name"}]}, _df())
    name = dq["rows"][0]
    assert name["completeness"] == 100.0
    assert name["duplicate_rate"] == 0.0


def test_compute_empty_df_has_no_data():
    assert compute_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": []}
    assert compute_data_quality({}, None) == {"has_data": False, "rows": []}


def test_compute_bad_column_yields_all_none(monkeypatch):
    import src.reports.data_quality as dq_mod

    def _boom(col, s):
        raise ValueError("boom")

    monkeypatch.setattr(dq_mod, "_column_row", _boom)
    dq = compute_data_quality({"questions": [{"export_label": "Name"}]}, _df())
    row = dq["rows"][0]
    assert row["column"] == "Name"
    assert row["completeness"] is None
    assert row["outlier_rate"] is None
    assert row["duplicate_rate"] is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_data_quality.py -v -k compute`
Expected: FAIL — `ImportError: cannot import name 'compute_data_quality'`.

- [ ] **Step 3: Implement the numeric core + formatter**

Replace the bodies of `_column_row` and `build_data_quality` in `src/reports/data_quality.py`, and add `compute_data_quality`. The file's docstring, imports, `_DASH`, `_pct`, and `_columns` stay as-is. New content for the section from `_column_row` onward:

```python
def _column_row(col: str, s: pd.Series) -> Dict:
    """Numeric per-column row. Values are floats (0-100) or None when N/A."""
    ns = null_stats(s)
    total = ns["present"] + ns["missing"]
    completeness = (ns["present"] / total * 100) if total else None
    n = len(s)
    duplicate_rate = (s.duplicated(keep="first").sum() / n * 100) if n else None
    o = numeric_outliers(s)
    nums = pd.to_numeric(s, errors="coerce").dropna()
    outlier_rate = (o["count"] / len(nums) * 100) if (o["bounds"] is not None and len(nums)) else None
    return {"column": str(col), "completeness": completeness,
            "outlier_rate": outlier_rate, "duplicate_rate": duplicate_rate}


def compute_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                         repeat_tables: Optional[Dict] = None) -> Dict:
    """Numeric per-column completeness / outlier / duplicate rate for the main table.

    Shape: {"has_data": bool,
            "rows": [{"column": str, "completeness": float|None,
                      "outlier_rate": float|None, "duplicate_rate": float|None}, ...]}
    """
    if main_df is None or len(main_df) == 0:
        return {"has_data": False, "rows": []}
    rows: List[Dict] = []
    for col in _columns(cfg, main_df):
        try:
            rows.append(_column_row(col, main_df[col]))
        except Exception as e:  # noqa: BLE001 — one bad column must not sink the section
            log.warning(f"data_quality: column '{col}' failed: {e}")
            rows.append({"column": str(col), "completeness": None,
                         "outlier_rate": None, "duplicate_rate": None})
    return {"has_data": bool(rows), "rows": rows}


def _fmt(x: Optional[float]) -> str:
    return _pct(x) if x is not None else _DASH


def build_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                       repeat_tables: Optional[Dict] = None) -> Dict:
    """String-formatted DQ overview for the report's {{ data_quality }} section.

    Thin formatter over compute_data_quality: floats -> "95.0%", None -> "—".
    """
    numeric = compute_data_quality(cfg, main_df, repeat_tables)
    if not numeric["has_data"]:
        return {"has_data": False, "rows": []}
    rows = [{"column": r["column"],
             "completeness":   _fmt(r["completeness"]),
             "outlier_rate":   _fmt(r["outlier_rate"]),
             "duplicate_rate": _fmt(r["duplicate_rate"])}
            for r in numeric["rows"]]
    return {"has_data": True, "rows": rows}
```

- [ ] **Step 4: Run the full data_quality test file**

Run: `PYTHONPATH=. pytest tests/test_data_quality.py -v`
Expected: PASS — both the new `compute_*` tests and the pre-existing string-format tests (`test_rows_have_formatted_metrics_from_questions`, `test_outlier_rate_for_numeric_column`, etc.) green.

- [ ] **Step 5: Run the summaries DQ test (shared module)**

Run: `PYTHONPATH=. pytest tests/test_summaries_data_quality.py -v`
Expected: PASS — no regression in the other consumer of this module.

- [ ] **Step 6: Commit**

```bash
git add src/reports/data_quality.py tests/test_data_quality.py
git commit -m "feat(data-quality): numeric compute_data_quality core + formatter split"
```

---

## Task 2: `GET /api/data-quality` endpoint

Read-only endpoint mirroring the `/api/profile` load + monkeypatch pattern, plus PII redaction like `/api/validate`. Graceful (HTTP 200, `has_data:false`) when no data is downloaded.

**Files:**
- Modify: `web/main.py`
- Create: `tests/test_data_quality_api.py`

- [ ] **Step 1: Write the failing endpoint tests**

Create `tests/test_data_quality_api.py`:

```python
import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_data_quality_endpoint_returns_numeric_rows(monkeypatch):
    cfg = {"questions": [
        {"export_label": "Phone", "category": "qualitative"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    main_df = pd.DataFrame({
        "_id":   [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        "Phone": ["x", None, "y", "z", "w", None, "v", "u", "t", "s"],  # 80% complete
        "Age":   [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],            # 1 outlier
    })
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, {}))

    resp = TestClient(wm.app).get("/api/data-quality")
    assert resp.status_code == 200
    body = resp.json()
    assert body["has_data"] is True
    by = {r["column"]: r for r in body["rows"]}
    assert by["Phone"]["completeness"] == 80.0
    assert by["Phone"]["outlier_rate"] is None
    assert by["Age"]["outlier_rate"] == 10.0


def test_data_quality_endpoint_no_data(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    body = TestClient(wm.app).get("/api/data-quality").json()
    assert body["has_data"] is False
    assert body["rows"] == []
    assert "message" in body
```

- [ ] **Step 2: Run to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_data_quality_api.py -v`
Expected: FAIL — endpoint returns 404 (route not defined).

- [ ] **Step 3: Add the endpoint in `web/main.py`**

Insert immediately after the `data_profile` function (the `@app.get("/api/profile")` block, ends near line 1480). Match its structure, add PII + the numeric core:

```python
@app.get("/api/data-quality")
async def data_quality_overview():
    """Per-column completeness / outlier-rate / duplicate-rate for the main table
    of the latest download session, post-PII-redaction. Read-only. Mirrors the
    report's {{ data_quality }} section as numeric values for the web panel."""
    from src.reports.data_quality import compute_data_quality
    from src.utils.pii import apply_pii
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"has_data": False, "rows": [], "message": "No downloaded data. Run download first."}
    df, repeats = apply_pii(df, repeats, cfg)
    return compute_data_quality(cfg, df, repeats)
```

- [ ] **Step 4: Run to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_data_quality_api.py -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `PYTHONPATH=. pytest -q`
Expected: all pre-existing tests pass; 7 new tests added across Tasks 1–2.

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_data_quality_api.py
git commit -m "feat(data-quality): GET /api/data-quality endpoint"
```

---

## Task 3: `DataQualityPanel.jsx` + Validate tab wiring + styles

Render the numeric DQ rows as a threshold-colored, sortable table above the findings list. No JS test runner exists in this repo, so this task is verified by a clean `vite build` plus a manual smoke check.

**Files:**
- Create: `frontend/src/components/DataQualityPanel.jsx`
- Modify: `frontend/src/pages/Validate.jsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Create `frontend/src/components/DataQualityPanel.jsx`**

```jsx
import { useEffect, useState } from 'react';

// Threshold bands (see spec). completeness: higher is better; rates: lower is better.
function band(metric, v) {
  if (v === null || v === undefined) return 'na';
  if (metric === 'completeness') return v >= 95 ? 'good' : v >= 80 ? 'warn' : 'bad';
  return v < 5 ? 'good' : v <= 15 ? 'warn' : 'bad';   // outlier_rate, duplicate_rate
}

const fmt = (v) => (v === null || v === undefined ? '—' : `${v.toFixed(1)}%`);

const METRICS = [
  { key: 'completeness',   label: 'Completeness' },
  { key: 'outlier_rate',   label: 'Outlier rate' },
  { key: 'duplicate_rate', label: 'Duplicate rate' },
];

export default function DataQualityPanel() {
  const [data, setData] = useState(null);   // null | { has_data, rows, message? }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState({ key: 'completeness', dir: 'asc' }); // worst-first default

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/data-quality');
        const body = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(body.detail || `Request failed (${r.status})`); return; }
        setData(body);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  if (loading) return <div className="dq-panel dq-panel--muted">Loading data quality…</div>;
  if (error)   return <div className="dq-panel dq-panel--muted">Data quality unavailable: {error}</div>;
  if (!data || !data.has_data)
    return <div className="dq-panel dq-panel--muted">{data?.message || 'No downloaded data — run Download first.'}</div>;

  const rows = [...data.rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av === null || av === undefined) return 1;   // nulls always last
    if (bv === null || bv === undefined) return -1;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  return (
    <div className="dq-panel">
      <div className="dq-panel__title">Data quality overview</div>
      <table className="dq-table">
        <thead>
          <tr>
            <th>Column</th>
            {METRICS.map((m) => (
              <th key={m.key} className="dq-th--metric" onClick={() => toggleSort(m.key)}>
                {m.label}{sort.key === m.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.column}>
              <td className="dq-td--col">{r.column}</td>
              {METRICS.map((m) => (
                <td key={m.key} className="dq-cell" data-band={band(m.key, r[m.key])}>
                  {fmt(r[m.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Render it in `frontend/src/pages/Validate.jsx`**

Add the import after the existing `PageHeader` import (line 2):

```jsx
import DataQualityPanel from '../components/DataQualityPanel.jsx';
```

Then render the panel between the `<PageHeader .../>` closing tag and the `{loading && ...}` line (i.e. right after the `/>` of PageHeader, around line 35):

```jsx
      <DataQualityPanel />
```

- [ ] **Step 3: Add styles to `frontend/src/styles.css`**

Append after the existing `validate-finding` block (after line 652):

```css
/* Data quality overview panel (Validate tab) */
.dq-panel { margin: 0 8px 28px; }
.dq-panel--muted { color: var(--ink-3); font-size: 13px; padding: 16px 0; }
.dq-panel__title { font-size: 13px; font-weight: 600; color: var(--ink-2); margin-bottom: 10px; }
.dq-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.dq-table th, .dq-table td { text-align: left; padding: 7px 12px; border-bottom: 1px solid var(--line, #e5e7eb); }
.dq-th--metric { cursor: pointer; user-select: none; color: var(--ink-3); font-weight: 600; }
.dq-td--col { font-family: var(--font-mono, monospace); font-weight: 600; }
.dq-cell { font-variant-numeric: tabular-nums; }
.dq-cell[data-band="good"] { color: #15803d; }
.dq-cell[data-band="warn"] { color: var(--warn, #b45309); }
.dq-cell[data-band="bad"]  { color: var(--danger, #b91c1c); font-weight: 600; }
.dq-cell[data-band="na"]   { color: var(--ink-3); }
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd frontend && npm run build`
Expected: build succeeds with no errors (first run auto-installs deps).

- [ ] **Step 5: Manual smoke check**

Run: `./scripts/serve.sh` and open the forwarded port → Validate tab.
Expected: with downloaded data, the DQ table appears above the findings, metrics are colored by band, and clicking a metric header re-sorts. With no data, a quiet "run Download first" line shows and the findings section still renders independently.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DataQualityPanel.jsx \
        frontend/src/pages/Validate.jsx frontend/src/styles.css
git commit -m "feat(data-quality): DQ overview panel in the Validate tab"
```

---

## Task 4: Document the endpoint + panel in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the validation/profile note**

In `CLAUDE.md`, find the line (near line 181):

```
> - *Validation* (missingness, outliers, duplicates, type issues) runs in the web **Validate** tab via `POST /api/validate`; the detectors live in `src/data/validate.py`.
```

Append a sibling bullet immediately after it:

```
> - *Data-quality overview* (per-column completeness / outlier-rate / duplicate-rate for the main table) is served read-only at `GET /api/data-quality` and rendered as a threshold-colored, sortable panel atop the **Validate** tab. It reuses `compute_data_quality` in `src/reports/data_quality.py` — the same numeric core the report's `{{ data_quality }}` section formats.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(data-quality): note /api/data-quality + Validate-tab panel"
```

---

## Self-review notes

- **Spec coverage:** numeric core (Task 1), endpoint with graceful no-data + PII (Task 2), Validate-tab panel with thresholds + sorting (Task 3), docs (Task 4). All spec sections mapped.
- **Report contract preserved:** `build_data_quality` keeps its `"95.0%"` / `"—"` output; existing `tests/test_data_quality.py` string assertions and `tests/test_summaries_data_quality.py` remain the regression guard.
- **Type consistency:** numeric rows use `completeness` / `outlier_rate` / `duplicate_rate` as `float|None` throughout (core, endpoint, panel `band()`/`fmt()`); thresholds match the spec table (95/80; 5/15).
- **Non-goals honored:** main table only; no per-repeat-table or table-level metrics.
