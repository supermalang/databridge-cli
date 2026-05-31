# Per-repeat-table Data Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Data Quality overview from the main table to every base table (main + each repeat table), surfaced in both the report's `{{ data_quality }}` section and the Validate-tab web panel, via an additive `tables` key that leaves the existing main-table contract intact.

**Architecture:** `compute_data_quality` / `build_data_quality` gain a `tables: [{name, rows}]` key (main stays in `rows`). The `/api/data-quality` endpoint already returns `compute_data_quality(...)` verbatim, so `tables` flows through with no endpoint edit. The report template and the web panel render the new per-table sections.

**Tech Stack:** Python 3.12 + pandas; React + Vite (no JS test runner — frontend verified by build + manual smoke).

**Spec:** [`../specs/2026-05-31-per-repeat-table-dq-design.md`](../specs/2026-05-31-per-repeat-table-dq-design.md)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/data_quality.py` | modify | Compute + format `tables` per non-empty repeat table |
| `tests/test_data_quality.py` | modify | `tables` tests + update 2 empty-case assertions |
| `tests/test_data_quality_api.py` | modify | Endpoint returns `tables` with repeats |
| `src/reports/template_generator.py` | modify | Per-repeat-table DQ sub-section loop |
| `tests/test_template_generator_logframe.py` | modify | Assert `data_quality.tables` markup present |
| `frontend/src/components/DataQualityPanel.jsx` | modify | Render main + per-table sub-sections (extract `DQTable`) |
| `frontend/src/styles.css` | modify | Sub-section heading style |
| `CLAUDE.md` | modify | Update `{{ data_quality }}` placeholder doc |

---

## Task 1: Backend — compute + format `tables`

**Files:**
- Modify: `src/reports/data_quality.py`
- Modify: `tests/test_data_quality.py`
- Modify: `tests/test_data_quality_api.py`

- [ ] **Step 1: Update existing empty-case tests + add new tests**

In `tests/test_data_quality.py`, the two exact-equality empty-case assertions must
gain `"tables": []`. Change:

```python
def test_empty_df_has_no_data():
    assert build_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": []}
    assert build_data_quality({}, None) == {"has_data": False, "rows": []}
```
to:
```python
def test_empty_df_has_no_data():
    assert build_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": [], "tables": []}
    assert build_data_quality({}, None) == {"has_data": False, "rows": [], "tables": []}
```

And change:
```python
def test_compute_empty_df_has_no_data():
    assert compute_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": []}
    assert compute_data_quality({}, None) == {"has_data": False, "rows": []}
```
to:
```python
def test_compute_empty_df_has_no_data():
    assert compute_data_quality({}, pd.DataFrame()) == {"has_data": False, "rows": [], "tables": []}
    assert compute_data_quality({}, None) == {"has_data": False, "rows": [], "tables": []}
```

Then append these new tests:

```python
def _repeats():
    # household_members: Name 100% complete & unique; Age has 1 outlier (9999)
    return {"household_members": pd.DataFrame({
        "_root_id": [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
        "Name": ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
        "Age":  [20, 21, 22, 23, 24, 25, 26, 27, 28, 9999],
    })}


def test_compute_includes_repeat_tables():
    dq = compute_data_quality({}, _df(), _repeats())
    assert [t["name"] for t in dq["tables"]] == ["household_members"]
    rows = {r["column"]: r for r in dq["tables"][0]["rows"]}
    assert "_root_id" not in rows                 # linkage col excluded by fallback
    assert rows["Name"]["completeness"] == 100.0
    assert rows["Age"]["outlier_rate"] == 10.0


def test_compute_omits_empty_repeat_table():
    dq = compute_data_quality({}, _df(), {"empty_rt": pd.DataFrame()})
    assert dq["tables"] == []


def test_compute_no_repeats_gives_empty_tables():
    dq = compute_data_quality({}, _df())
    assert dq["tables"] == []


def test_build_formats_repeat_tables():
    dq = build_data_quality({}, _df(), _repeats())
    t = dq["tables"][0]
    assert t["name"] == "household_members"
    by = {r["column"]: r for r in t["rows"]}
    assert by["Name"]["completeness"] == "100.0%"
    assert by["Age"]["outlier_rate"] == "10.0%"
    # main table still in rows, formatted as before
    assert all(isinstance(r["completeness"], str) for r in dq["rows"])
```

(`_df()` and the imports `build_data_quality` / `compute_data_quality` already exist
at the top of this test file.)

- [ ] **Step 2: Run to verify failure**

Run: `PYTHONPATH=. pytest tests/test_data_quality.py -v`
Expected: FAIL — new `tables` key absent (KeyError / assertion), and the updated
empty-case tests fail against the current 2-key dict.

- [ ] **Step 3: Implement `tables` in `src/reports/data_quality.py`**

Extract the per-column loop into a helper and build `tables`. Replace
`compute_data_quality`, add `_rows_for`, and update `build_data_quality` + `_fmt_rows`:

```python
def _rows_for(cfg: Dict, df: pd.DataFrame) -> List[Dict]:
    """Numeric rows for one table's curated/fallback columns (log-and-continue)."""
    rows: List[Dict] = []
    for col in _columns(cfg, df):
        try:
            rows.append(_column_row(col, df[col]))
        except Exception as e:  # noqa: BLE001 — one bad column must not sink the section
            log.warning(f"data_quality: column '{col}' failed: {e}")
            rows.append({"column": str(col), "completeness": None,
                         "outlier_rate": None, "duplicate_rate": None})
    return rows


def compute_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                         repeat_tables: Optional[Dict] = None) -> Dict:
    """Numeric per-column completeness / outlier / duplicate rate per base table.

    Shape: {"has_data": bool,
            "rows":   [ {column, completeness, outlier_rate, duplicate_rate}, ... ],  # main
            "tables": [ {"name": str, "rows": [ {...}, ... ]}, ... ]}                  # repeats
    Values are floats (0-100) or None. A repeat table with 0 rows is omitted.
    """
    if main_df is None or len(main_df) == 0:
        return {"has_data": False, "rows": [], "tables": []}
    rows = _rows_for(cfg, main_df)
    tables: List[Dict] = []
    for name, tdf in (repeat_tables or {}).items():
        if tdf is None or len(tdf) == 0:
            continue
        tables.append({"name": str(name), "rows": _rows_for(cfg, tdf)})
    return {"has_data": bool(rows), "rows": rows, "tables": tables}


def _fmt(x: Optional[float]) -> str:
    return _pct(x) if x is not None else _DASH


def _fmt_rows(rows: List[Dict]) -> List[Dict]:
    return [{"column": r["column"],
             "completeness":   _fmt(r["completeness"]),
             "outlier_rate":   _fmt(r["outlier_rate"]),
             "duplicate_rate": _fmt(r["duplicate_rate"])}
            for r in rows]


def build_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                       repeat_tables: Optional[Dict] = None) -> Dict:
    """String-formatted DQ overview for the report's {{ data_quality }} section.

    Thin formatter over compute_data_quality: floats -> "95.0%", None -> "—".
    """
    numeric = compute_data_quality(cfg, main_df, repeat_tables)
    if not numeric["has_data"]:
        return {"has_data": False, "rows": [], "tables": []}
    return {"has_data": True,
            "rows": _fmt_rows(numeric["rows"]),
            "tables": [{"name": t["name"], "rows": _fmt_rows(t["rows"])}
                       for t in numeric["tables"]]}
```

Also update the **module docstring** (lines 4–13) so both shapes show the `tables`
key:

```python
"""Data-quality overview for the report: per-column completeness / outlier /
duplicate rate per base table, reusing src.data.profile primitives. Mirrors logframe.

Two public functions (both: main table in `rows`, repeat tables in `tables`):
- compute_data_quality: numeric core — floats (0-100) or None per column.
  Shape: {"has_data": bool,
          "rows":   [{"column": str, "completeness": float|None,
                      "outlier_rate": float|None, "duplicate_rate": float|None}, ...],
          "tables": [{"name": str, "rows": [ {...}, ... ]}, ...]}
- build_data_quality: string formatter for the report's {{ data_quality }} section.
  Same shape with each metric formatted ("95.0%"; None maps to "—").
"""
```

- [ ] **Step 4: Run the DQ test file**

Run: `PYTHONPATH=. pytest tests/test_data_quality.py -v`
Expected: PASS — updated empty-case tests + 4 new `tables` tests + all pre-existing
main-table tests.

- [ ] **Step 5: Add the endpoint `tables` test**

In `tests/test_data_quality_api.py`, append:

```python
def test_data_quality_endpoint_includes_repeat_tables(monkeypatch):
    cfg = {"questions": [{"export_label": "Age", "category": "quantitative"}]}
    main_df = pd.DataFrame({"_id": [1, 2, 3], "Age": [10, 20, 30]})
    repeats = {"members": pd.DataFrame({"_root_id": [1, 2, 3], "Name": ["a", "b", "c"]})}
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    body = TestClient(wm.app).get("/api/data-quality").json()
    assert body["has_data"] is True
    assert [t["name"] for t in body["tables"]] == ["members"]
    cols = {r["column"] for r in body["tables"][0]["rows"]}
    assert "Name" in cols and "_root_id" not in cols
```

- [ ] **Step 6: Run the endpoint tests + full suite**

Run: `PYTHONPATH=. pytest tests/test_data_quality_api.py -v && PYTHONPATH=. pytest -q`
Expected: endpoint tests pass; full suite green (the `data_quality` context now
carries an extra `tables` key, which the template tolerates).

- [ ] **Step 7: Commit**

```bash
git add src/reports/data_quality.py tests/test_data_quality.py tests/test_data_quality_api.py
git commit -m "feat(data-quality): per-repeat-table DQ via additive tables key"
```

---

## Task 2: Report template — per-table DQ sub-sections

**Files:**
- Modify: `src/reports/template_generator.py`
- Modify: `tests/test_template_generator_logframe.py`

- [ ] **Step 1: Extend the template test**

In `tests/test_template_generator_logframe.py`, add one assertion to
`test_template_renders_data_quality_section` (after the existing `row.*` assertion
on line 50):

```python
    assert "data_quality.tables" in text and "t.rows" in text
```

- [ ] **Step 2: Run to verify failure**

Run: `PYTHONPATH=. pytest tests/test_template_generator_logframe.py::test_template_renders_data_quality_section -v`
Expected: FAIL — `data_quality.tables` not yet in the generated template.

- [ ] **Step 3: Add the per-table loop to the generated template**

In `src/reports/template_generator.py`, the DQ body run (the `p_dq.add_run(...)`
call, lines ~94–101) currently ends with `{% endfor %}{% endif %}`. Change that run
so the per-table loop is inserted **before** the closing `{% endif %}`, still inside
the `has_data` guard:

```python
    run_dq = p_dq.add_run(
        "{% if data_quality.has_data %}"
        "{% for row in data_quality.rows %}"
        "{{ row.column }}: complete {{ row.completeness }}, "
        "outliers {{ row.outlier_rate }}, duplicates {{ row.duplicate_rate }}\n"
        "{% endfor %}"
        "{% for t in data_quality.tables %}"
        "\n{{ t.name }}\n"
        "{% for row in t.rows %}"
        "{{ row.column }}: complete {{ row.completeness }}, "
        "outliers {{ row.outlier_rate }}, duplicates {{ row.duplicate_rate }}\n"
        "{% endfor %}"
        "{% endfor %}"
        "{% endif %}"
    )
```

- [ ] **Step 4: Run the template test + full suite**

Run: `PYTHONPATH=. pytest tests/test_template_generator_logframe.py -v && PYTHONPATH=. pytest -q`
Expected: PASS, no regressions. (The single unbroken-run rule for chart placeholders
does not apply here — this is plain Jinja text, and the whole block is one run.)

- [ ] **Step 5: Commit**

```bash
git add src/reports/template_generator.py tests/test_template_generator_logframe.py
git commit -m "feat(data-quality): render per-repeat-table DQ in generated template"
```

---

## Task 3: Web panel — main + per-table sub-sections

No JS test runner exists; verify via `vite build` + manual smoke.

**Files:**
- Modify: `frontend/src/components/DataQualityPanel.jsx`
- Modify: `frontend/src/styles.css`

- [ ] **Step 1: Refactor the panel to render main + tables**

Replace the entire contents of `frontend/src/components/DataQualityPanel.jsx` with:

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

// One sortable, threshold-colored table. Each instance sorts independently.
function DQTable({ rows }) {
  const [sort, setSort] = useState({ key: 'completeness', dir: 'asc' }); // ascending = worst-completeness first
  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key];
    if (av === null || av === undefined) return 1;   // nulls always last
    if (bv === null || bv === undefined) return -1;
    return sort.dir === 'asc' ? av - bv : bv - av;
  });

  return (
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
        {sorted.map((r) => (
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
  );
}

export default function DataQualityPanel() {
  const [data, setData] = useState(null);   // null | { has_data, rows, tables, message? }
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div className="dq-panel dq-panel--muted">Loading data quality…</div>;
  if (error)   return <div className="dq-panel dq-panel--muted">Data quality unavailable: {error}</div>;
  if (!data || !data.has_data)
    return <div className="dq-panel dq-panel--muted">{data?.message || 'No downloaded data — run Download first.'}</div>;

  const tables = data.tables || [];

  return (
    <div className="dq-panel">
      <div className="dq-panel__title">Data quality overview</div>
      <DQTable rows={data.rows} />
      {tables.map((t) => (
        <div key={t.name} className="dq-subtable">
          <div className="dq-panel__subtitle">{t.name}</div>
          <DQTable rows={t.rows} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add sub-section styles**

In `frontend/src/styles.css`, after the existing `.dq-cell[data-band="na"]` rule
(the end of the DQ panel block), append:

```css
.dq-subtable { margin-top: 20px; }
.dq-panel__subtitle { font-size: 12.5px; font-weight: 600; color: var(--ink-3); margin-bottom: 8px; font-family: var(--font-mono, monospace); }
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: clean build, no errors.

- [ ] **Step 4: Manual smoke note**

Confirm the JSX/imports compile. Note for human verification: with a survey that has
repeat groups, the panel shows the main table then one labelled sub-table per repeat
group, each independently sortable; surveys with no repeats look exactly as before.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/DataQualityPanel.jsx frontend/src/styles.css
git commit -m "feat(data-quality): per-repeat-table sub-sections in the DQ panel"
```

---

## Task 4: Docs — update the `{{ data_quality }}` placeholder

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the placeholder doc**

In `CLAUDE.md`, find the `{{ data_quality }}` line in the "Word template
placeholders" section:

```
{{ data_quality }}      ← auto DQ overview (has_data / rows of {column, completeness, outlier_rate, duplicate_rate}); main table, per configured questions
```

Replace it with:

```
{{ data_quality }}      ← auto DQ overview (has_data / rows of {column, completeness, outlier_rate, duplicate_rate}) for the main table, plus tables: [{name, rows}] — one entry per non-empty repeat table. Rendered in the auto-template and the web Validate-tab panel.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(data-quality): document tables key on {{ data_quality }}"
```

---

## Self-review notes

- **Spec coverage:** additive `tables` (Task 1), endpoint passthrough verified by test (Task 1 step 5), report rendering (Task 2), web panel (Task 3), docs (Task 4). Summaries + builder + endpoint code untouched as designed.
- **Backward compatibility:** `rows` = main table everywhere; only the two exact-dict empty-case assertions change (documented). The template test uses substring checks, so the added loop is non-breaking; the `has_data`/`rows` markup is unchanged.
- **DRY:** `_rows_for` shared by main + each table; `_fmt_rows` shared by main + each table formatter. `DQTable` shared by the panel's main + sub-sections.
- **Type consistency:** `tables` is `[{name: str, rows: [row]}]` in both numeric and formatted forms; rows use the same `completeness`/`outlier_rate`/`duplicate_rate` keys throughout.
