# Data Quality — Completeness Indicator Design

**Date:** 2026-05-31
**Status:** Design (owner directed "continue" → data-quality, starting with completeness; decisions locked)
**Roadmap:** First slice of "data-quality indicators." Deliberately narrow: a deterministic **completeness** stat, surfaced as a regular indicator. Wider DQ metrics (outliers/duplicates/enumerator-variance) are explicitly deferred pending the owner's input on scope + placement.

---

## 1. Goal

Let a column's **completeness** (% of present, non-blank values) be a first-class indicator — created in the IndicatorModal, placed in reports via `{{ ind_<name> }}`, disaggregated, and framework-linked like any other indicator. Computed deterministically from `profile.py`'s `null_stats` (the single source of truth for missingness).

---

## 2. Decisions (locked)

- **New `completeness` stat** on an indicator. Value = `present / (present + missing) * 100`, where present/missing come from `src.data.profile.null_stats(series)` (so "missing" includes NaN **and** blank-after-strip — consistent with the Profile/Validate tabs).
- **Requires a `question`** (the column to measure). With no column it raises a clear `ValueError` (not a silent row-count).
- **Returns a 0–100 number**; pair with `format: percent` to render `"85.0%"`. (No implicit format change — the engine keeps `format` explicit; docs + the modal hint say to use `percent`.)
- **Reuses everything:** runs through the existing `_compute`/`_format`, so completeness supports `source`, `filter`, `disaggregate_by` (completeness per group), `framework_ref`, `primary`, periods — no special-casing beyond the stat itself.
- **Wiring:** add `completeness` to the Ask engine's `INDICATOR_STATS` allowlist + its prompt stat-block (so the Ask tab can propose/validate it), and to the frontend `INDICATOR_STATS` dropdown.

**Out of scope (deferred — need owner direction):** table/overall completeness (% fully-complete rows); outlier-rate, duplicate-rate, inter-enumerator-variance indicators; a dedicated "Data Quality" report section. This slice is completeness-per-column only.

---

## 3. Architecture

### `src/reports/indicators.py` — `_compute`
- Guard early: if `stat == "completeness"` and there is no `question`/`questions`, raise `ValueError("completeness requires a question/column")` (before the no-column `return len(df)` shortcut).
- After `series` is built, add a branch:
  ```python
  if stat == "completeness":
      from src.data.profile import null_stats
      ns = null_stats(series)
      total = ns["present"] + ns["missing"]
      return (ns["present"] / total * 100) if total else 0.0
  ```
- Update the module docstring's stat list.

### `src/reports/ask_engine.py`
- Add `"completeness"` to `INDICATOR_STATS` (it is NOT in `_NUMERIC_STATS`, so `_validate_indicator` requires a question but no quantitative-role check — completeness applies to any column). Add a line to `_INDICATOR_STATS_BLOCK`: `"- completeness: % of present (non-blank) values in a column"`.

### `frontend/src/pages/Composition.jsx`
- Add `'completeness'` to the `INDICATOR_STATS` array (drives the Stat dropdown). The modal already has a Format field; the user sets it to `percent`.

### Docs
- CLAUDE.md: add `completeness` to the indicators stat documentation.

## 4. Error handling
Total/fail-soft within the existing engine: completeness with no column raises (caught by the per-indicator try → `ind_<name> = "N/A"`); empty data → `0.0`. `null_stats` already handles `n == 0`.

## 5. Testing (TDD)
`tests/test_indicators_completeness.py` (new):
- column with some blanks/NaN → completeness % = present/total*100 (e.g. 3 present of 4 → 75.0, rendered `"75.0%"` with `format: percent`).
- blanks-after-strip count as missing (a `" "` cell is missing) — matches `null_stats`.
- no `question` → indicator yields `"N/A"` (fail-soft via the engine's per-indicator guard) OR raises in `_compute` (test `_compute` directly for the raise, and `compute_indicators` for the `"N/A"`).
- `disaggregate_by` works with completeness (per-group completeness).
`tests/` (ask_engine): a `completeness` recipe with a question validates True; without a question validates False. (Mirror existing `_validate_indicator` tests.)
Full suite green (currently 330). Frontend: clean `npm run build`.

## 6. Risks
- **Format default:** a user who forgets `format: percent` sees `"75"` (rounded) instead of `"75.0%"`. Mitigated by docs + modal hint; not worth special-casing the engine. (A future refinement could default completeness to percent.)
- **`null_stats` import inside `_compute`:** local import avoids any import cycle (`profile.py` doesn't import `indicators.py`, but local import is the file's convention and keeps it safe).
