# Per-repeat-table Data Quality — Design

**Date:** 2026-05-31
**Status:** Approved autonomously (user delegated) — ready for plan
**Track:** Data quality. Closes the "Per-repeat-table DQ" item in
[`../plans/STATUS.md`](../plans/STATUS.md).

---

## Problem

`compute_data_quality` / `build_data_quality`
([`src/reports/data_quality.py`](../../src/reports/data_quality.py)) accept a
`repeat_tables` argument but **ignore it** — DQ covers the main table only. Surveys
with repeat groups (household members, illnesses, villages…) get no quality signal
for those base tables, in either the report's `{{ data_quality }}` section or the
web panel.

## Goal

Compute per-column completeness / outlier-rate / duplicate-rate for **every base
table** (main + each repeat table), and surface them in both the report and the
Validate-tab web panel — **without breaking the existing main-table contract**.

## Decision (made autonomously per user delegation): additive shape

Keep `has_data` and `rows` (the main table) exactly as today; **add** a `tables`
key for repeat tables.

```python
# compute_data_quality (numeric)
{"has_data": bool,
 "rows":   [ {column, completeness, outlier_rate, duplicate_rate}, ... ],   # main table
 "tables": [ {"name": str, "rows": [ {...}, ... ]}, ... ]}                   # one per non-empty repeat table
# build_data_quality formats rows + tables[].rows into "95.0%"/"—" strings, same as before.
```

- `rows` continues to mean **the main table** — existing template loop
  (`{% for row in data_quality.rows %}`) and the web panel's main table keep working
  untouched.
- `tables`: one entry per repeat table that has rows, in `repeat_tables` dict order,
  `name` = the repeat-table key. Per-table columns selected by the existing
  `_columns(cfg, table_df)` (configured question labels if they match, else all
  non-`_` columns — so repeat-group fields are covered via the fallback).
- **`has_data` stays tied to the main table** (a repeat row cannot exist without a
  parent submission, so main-empty ⇒ no repeats). When main is empty:
  `{"has_data": False, "rows": [], "tables": []}`.
- `tables` is **always present** (possibly `[]`) so consumers can read it
  unconditionally. (This changes the exact-dict shape returned for the empty case,
  so the two exact-equality empty-case tests in `tests/test_data_quality.py` get
  `"tables": []` added — a deliberate, documented contract update.)

**Why additive, not `tables[0] = main`:** an additive `tables` key leaves the
report template, the web panel's main table, and all but two existing tests
untouched. Collapsing main into `tables` would churn every consumer for no
functional gain.

## Scope

**In:**
- `src/reports/data_quality.py` — compute + format `tables`.
- `src/reports/template_generator.py` — render a per-repeat-table DQ sub-section
  after the main rows.
- `frontend/src/components/DataQualityPanel.jsx` — render the main table (unchanged)
  plus one labelled sub-section per `tables` entry.
- Tests + `CLAUDE.md` placeholder doc.

**Out (unchanged by design):**
- `src/reports/summaries.py` — its `_data_quality_text` is an independent
  implementation; not touched.
- `builder.py` — already passes `repeat_tables` to `build_data_quality`; no change.
- The `/api/data-quality` endpoint body — it already returns
  `compute_data_quality(...)` verbatim, so `tables` flows through with no endpoint
  edit; only the panel that renders it changes.
- Table-level metrics (% fully-complete rows, per-table duplicate rate) — a separate
  STATUS.md item; not in scope.

## Behavior contract

- Empty/`None` main → `{"has_data": False, "rows": [], "tables": []}`.
- A repeat table with 0 rows is **omitted** from `tables`.
- A bad column inside any table degrades to an all-`None`/`"—"` row (same
  log-and-continue rule already used for main).
- `repeat_tables=None` (or `{}`) → `tables: []`, `rows` = main as today.

## Web panel

`DataQualityPanel.jsx` keeps its current fetch/sort/threshold logic. Refactor the
table render into a small reusable inner piece so it draws:
1. the main table (heading "Data quality overview", as now), then
2. one sub-section per `data_quality.tables` entry, each with a `t.name` subheading
   and the same threshold-colored, sortable table over `t.rows`.

Each sub-table sorts independently. No-data and error states unchanged.

## Report template

After the main `{% for row in data_quality.rows %}` loop, add:

```
{% for t in data_quality.tables %}
{{ t.name }}
{% for row in t.rows %}{{ row.column }}: complete {{ row.completeness }}, outliers {{ row.outlier_rate }}, duplicates {{ row.duplicate_rate }}
{% endfor %}{% endfor %}
```

(kept inside the existing `{% if data_quality.has_data %}` guard).

## Testing

- `compute_data_quality`: `tables` entry per non-empty repeat table with numeric
  values; empty repeat table omitted; `repeat_tables` absent → `tables: []`;
  empty main → `{has_data:False, rows:[], tables:[]}`.
- `build_data_quality`: `tables[].rows` formatted as `"%"`/`"—"` strings; main `rows`
  unchanged.
- Update the two existing exact-equality empty-case tests to include `"tables": []`.
- Endpoint: `/api/data-quality` returns `tables` when repeats are passed.
- Template: generated doc contains `data_quality.tables` loop markup (extend the
  existing `test_template_renders_data_quality_section`).
- Frontend: `npm run build` clean + manual smoke (no JS test runner).

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/data_quality.py` | modify | Compute + format `tables` per repeat table |
| `tests/test_data_quality.py` | modify | `tables` tests + update 2 empty-case assertions |
| `tests/test_data_quality_api.py` | modify | Endpoint returns `tables` with repeats |
| `src/reports/template_generator.py` | modify | Per-repeat-table DQ sub-section loop |
| `tests/test_template_generator_logframe.py` | modify | Assert `data_quality.tables` markup present |
| `frontend/src/components/DataQualityPanel.jsx` | modify | Render main + per-table sub-sections |
| `CLAUDE.md` | modify | Update `{{ data_quality }}` placeholder doc to mention `tables` |
