# Data Quality — Outlier-Rate & Duplicate-Rate Indicators Design

**Date:** 2026-05-31
**Status:** Design (owner assented to "my lean"; decisions locked)
**Roadmap:** Second data-quality slice, mirroring the `completeness` stat (#19). Adds two more deterministic DQ stats; a dedicated DQ report section is still deferred until the metric set settles.

---

## 1. Goal

Two more first-class data-quality indicator stats, same pattern as `completeness`:
- **`outlier_rate`** — % of a numeric column's values beyond the 3×IQR fence, via `profile.numeric_outliers` (single source of truth for outliers).
- **`duplicate_rate`** — % of rows that are redundant duplicates of a key column's value.

Both run through the existing indicators engine (disaggregable, framework-linkable), return a 0–100 number, and pair with `format: percent`.

---

## 2. Decisions (locked)

- **`outlier_rate`** = `numeric_outliers(series)["count"] / N * 100`, where `N` = count of numeric-coerced non-null values. `0.0` when `N == 0` or no IQR fence (constant/too-few — `numeric_outliers` returns count 0). Numeric column → belongs in the Ask engine's `_NUMERIC_STATS` (quantitative-role required there).
- **`duplicate_rate`** = `series.duplicated(keep="first").sum() / len(series) * 100` — the fraction of rows that are redundant copies (all but the first occurrence). Applies to any column (a key/ID). `0.0` on empty. NOT numeric-only.
- **Both require a `question`** (the column to measure) — extend the existing completeness guard to a shared set so any of these DQ stats without a column raises a clear `ValueError`.
- **Reuse the engine:** add branches in `_compute` next to `completeness`; `_format` + `disaggregate_by` + framework linking work unchanged.
- **Single source of truth:** `outlier_rate` calls `profile.numeric_outliers` (same 3×IQR logic as the Profile/Validate tabs). `duplicate_rate` uses pandas `duplicated` inline (profile exposes no standalone duplicate primitive; the logic is unambiguous).

**Out of scope (still deferred — owner direction):** table/overall completeness; inter-enumerator variance; a dedicated "Data Quality" report section.

---

## 3. Architecture

### `src/reports/indicators.py` — `_compute`
- Replace the single completeness guard with a shared one:
  ```python
  _DQ_NEEDS_QUESTION = {"completeness", "outlier_rate", "duplicate_rate"}
  ...
  if stat in _DQ_NEEDS_QUESTION and not (question or questions):
      raise ValueError(f"{stat} requires a question/column")
  ```
  (Define `_DQ_NEEDS_QUESTION` at module level.)
- Add branches alongside `completeness` (operating on the raw `series`, before numeric-coercion path):
  ```python
  if stat == "outlier_rate":
      from src.data.profile import numeric_outliers
      nums = pd.to_numeric(series, errors="coerce").dropna()
      n = len(nums)
      return (numeric_outliers(series)["count"] / n * 100) if n else 0.0

  if stat == "duplicate_rate":
      n = len(series)
      return (series.duplicated(keep="first").sum() / n * 100) if n else 0.0
  ```
- Update the module docstring stat list.

### `src/reports/ask_engine.py`
- `INDICATOR_STATS` += `"outlier_rate"`, `"duplicate_rate"`.
- `_NUMERIC_STATS` += `"outlier_rate"` (so `_validate_indicator` requires a quantitative column for it). `duplicate_rate` stays out of `_NUMERIC_STATS` (any column, needs question).
- `_INDICATOR_STATS_BLOCK` += two lines describing them.

### `frontend/src/pages/Composition.jsx`
- `INDICATOR_STATS` array += `'outlier_rate'`, `'duplicate_rate'`.

### Docs
- CLAUDE.md indicators stat list += `outlier_rate`, `duplicate_rate`.

## 4. Error handling
Within the engine's per-indicator try (fail-soft → `"N/A"`). No-column raises (caught). Empty/constant data → `0.0`. `numeric_outliers` already guards short/constant series.

## 5. Testing (TDD)
`tests/test_indicators_dq_rates.py` (new):
- `outlier_rate`: a numeric column with a clear outlier → expected % (e.g. 1 of 10 beyond 3×IQR); a constant/short column → `0.0`; non-numeric column → `0.0`.
- `duplicate_rate`: a column with repeats → `redundant / total * 100` (e.g. `[a,a,b,c]` → 25.0); all-unique → `0.0`; empty → `0.0`.
- both: no `question` → `_compute` raises; `compute_indicators` → `"N/A"`.
- `disaggregate_by` works with `duplicate_rate` (per-group).
`tests/test_ask_engine.py` (extend): `outlier_rate` on a quantitative column validates True, on a categorical column fails ("quantitative"); `duplicate_rate` on any column with a question validates True, without a question fails.
Full suite green (currently 338). Frontend: clean `npm run build`.

## 6. Risks
- **`duplicate_rate` and NaN:** pandas `duplicated` treats repeated NaN as duplicates; for a key column that should be non-null, counting missing-key repeats as duplicates is acceptable (still a quality issue). Documented.
- **Format:** like completeness, returns 0–100; needs `format: percent` for `"%"` display (documented).
