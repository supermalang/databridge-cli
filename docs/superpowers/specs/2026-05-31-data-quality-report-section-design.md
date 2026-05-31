# Data Quality — Report Overview Section Design

**Date:** 2026-05-31
**Status:** Design (owner directed "continue" → DQ report section, auto-overview; decisions locked)
**Roadmap:** Third data-quality slice. Turns the per-column DQ stats (completeness/outlier/duplicate, PRs #19–#20) into an **auto-generated overview table** in the report — no per-indicator setup needed.

---

## 1. Goal

A "Data Quality" section in the generated report showing, per key column: **completeness %**, **outlier rate**, **duplicate rate** — computed automatically across the configured questions. Surfaces as a `{{ data_quality }}` Jinja context key (mirroring `{{ logframe }}`) and rendered by the auto-template.

---

## 2. Decisions (locked)

- **New `build_data_quality(cfg, main_df, repeat_tables=None)`** returning `{"has_data": bool, "rows": [{"column", "completeness", "outlier_rate", "duplicate_rate"}]}`. Percentages are pre-formatted strings (`"95.0%"`); `outlier_rate` is `"—"` for non-numeric columns.
- **Same numbers as the shipped stats:** reuse `profile.null_stats` (completeness), `profile.numeric_outliers` (outlier rate over numeric non-null count), and pandas `duplicated(keep="first")` (duplicate rate) — identical to the `completeness`/`outlier_rate`/`duplicate_rate` indicator stats.
- **Columns = the curated question set:** the configured `questions`' `export_label` (→ `label` → `kobo_key`) columns that exist in `main_df`; if no questions are configured, fall back to all non-linkage (`_`-prefixed excluded) columns of `main_df`.
- **`outlier_rate` shown only when the column is genuinely numeric** — i.e. `numeric_outliers` returns a real IQR fence (`bounds is not None`) and there are numeric values; otherwise `"—"`. (Data-driven, no reliance on declared category.)
- **Wiring mirrors logframe:** `builder.py` adds `data_quality` to the render context; the auto-template (`template_generator.py`) renders a "Data Quality" section guarded by `{% if data_quality.has_data %}`.
- **Auto, on the main table only** for this slice (per-repeat-table DQ is a later refinement).

**Out of scope (still deferred):** table-level metrics (% fully-complete rows), inter-enumerator variance, a web/Validate-tab surface (the Validate tab already shows DQ findings; this slice is the report section), per-repeat-table DQ.

---

## 3. Architecture

### `src/reports/data_quality.py` (new)
```python
build_data_quality(cfg, main_df, repeat_tables=None) -> {"has_data": bool, "rows": [...]}
```
- `has_data` False (rows `[]`) when `main_df` is None/empty.
- Column selection per §2; per column compute completeness (`null_stats`), duplicate rate (`duplicated`), outlier rate (`numeric_outliers`, `"—"` when no fence). All formatted as `"NN.N%"` strings.
- Pure (no I/O, no LLM); reuses `src.data.profile` primitives.

### `src/reports/builder.py`
- Near the `logframe = build_logframe(...)` line, add `data_quality = build_data_quality(self.cfg, df, repeat_tables)`; add `"data_quality": data_quality,` to the `context` dict.

### `src/reports/template_generator.py`
- Add a "Data Quality" section (after the logframe section) — a bold heading + a loop, both wrapped in `{% if data_quality.has_data %}`:
  ```
  {% for row in data_quality.rows %}{{ row.column }}: complete {{ row.completeness }}, outliers {{ row.outlier_rate }}, duplicates {{ row.duplicate_rate }}\n{% endfor %}
  ```

### Docs
- CLAUDE.md placeholders: `{{ data_quality }}` (has_data / rows of {column, completeness, outlier_rate, duplicate_rate}).

## 4. Error handling
Pure + total: empty/None df → `has_data: False`. Each column wrapped so a single bad column degrades to `"—"` rather than failing the section (defensive try per column). The template section is gated on `has_data`, so configs without data/questions render nothing.

## 5. Testing (TDD)
`tests/test_data_quality.py` (new):
- mixed df (a complete col, a col with a blank/NaN, a numeric col with an outlier, a column with duplicates) → rows carry correctly formatted completeness/outlier/duplicate strings.
- non-numeric column → `outlier_rate == "—"`.
- columns are taken from `cfg["questions"]` export_labels when present; linkage `_`-columns excluded in the no-questions fallback.
- empty df → `{"has_data": False, "rows": []}`.
`tests/test_template_generator_logframe.py` or a new test: the generated template contains the `data_quality.has_data` / `data_quality.rows` Jinja.
Existing `test_build_report_smoke` / `test_framework_e2e` stay green (proves builder context + template render with the new key). Full suite green (currently 350).

## 6. Risks
- **Many columns** (no questions configured → all columns) could make a long section; acceptable for v1 (curated questions are the normal path). A future `top_n`/selection can refine.
- **Numeric-looking codes** (e.g. an ID stored as int) would get an `outlier_rate`; harmless (informational). The curated question set usually avoids this.
