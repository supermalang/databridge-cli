# M&E — Disaggregated Indicators Design

**Date:** 2026-05-31
**Status:** Design (owner directed "continue" into M&E core; decisions locked below; review async)
**Roadmap:** M&E core, building on the existing indicators engine (`src/reports/indicators.py`) + framework/logframe. Closes the top M&E gap: indicators broken down by an equity dimension (sex, region, age group, …).

---

## 1. Goal

Let a single indicator be **disaggregated** by one or more dimension columns — e.g. "doses administered, **by region** and **by sex**" — computed locally, in one indicator config, rendered as a small breakdown table. The overall scalar (`{{ ind_<name> }}`) is unchanged; disaggregation adds a structured breakdown alongside it. Fully **backward-compatible**: indicators without the new field behave exactly as today.

---

## 2. Decisions (locked)

- **New field `disaggregate_by`** on an indicator config: a column name (string) or list of columns. When present, the same `stat` is computed **per group** of those column(s) (pandas `groupby`), reusing the existing `_compute` logic so every stat (count/sum/mean/percent/most_common/…) disaggregates identically.
- **Outputs (added to the context dict):**
  - `ind_<name>_breakdown` — a **list** of `{"group": <label>, "value": <raw>, "formatted": <formatted>}` rows, for Jinja iteration in templates and JSON in the API. Multi-column groups join with `" / "` (e.g. `"North / Female"`).
  - `ind_<name>_table` — a plain-text fallback (`"<group>: <formatted>"` per line) for templates that don't loop.
  - The scalar `ind_<name>` (overall, undisaggregated) is still produced.
- **Reuse, don't fork:** breakdown groups call the existing `_compute(ind, group_df)` so behavior matches the scalar exactly. `_format` is reused for each group's value.
- **Fail-soft per feature:** a bad/missing `disaggregate_by` column logs a warning and yields `ind_<name>_breakdown = []` / `ind_<name>_table = "N/A"`, but the scalar `ind_<name>` still computes (matches the engine's existing fail-soft style).
- **Ordering:** groups use pandas `groupby` default sort (ascending by group key) — deterministic; value-descending sort is a later refinement.
- **Scope:** current-period breakdown only — disaggregation is **not** crossed with multi-period (`per_period`) in this slice (keeps the combinatorics bounded). The preview API surfaces the breakdown; the **frontend field + breakdown display is Slice 2** (this slice is engine + API + docs).

**Out of scope (later):** frontend `disaggregate_by` input + breakdown table in the IndicatorModal (Slice 2); disaggregation × periods; value-sorted/top-N breakdowns; framework-node target aggregation.

---

## 3. Architecture

### `src/reports/indicators.py`
- In `compute_indicators`, after the scalar `context[f"ind_{name}"]` is set (and using the same `ind_df` already resolved via `_resolve_source`), if `ind.get("disaggregate_by")`:
  ```python
  try:
      rows = _compute_breakdown(ind, ind_df, fmt)
      context[f"ind_{name}_breakdown"] = rows
      context[f"ind_{name}_table"] = _render_breakdown_table(rows)
  except Exception as e:
      log.warning(f"Indicator '{name}' disaggregation failed: {e}")
      context[f"ind_{name}_breakdown"] = []
      context[f"ind_{name}_table"] = "N/A"
  ```
- New `_compute_breakdown(ind, ind_df, fmt) -> list[dict]`:
  - Normalize `disaggregate_by` to a column list; raise `ValueError` if any column is absent from `ind_df`.
  - `ind_df.groupby(cols, dropna=False, sort=True)`; for each `(key, group_df)`: label = the value (or `" / "`-joined tuple, with `None`→`"(blank)"`), `val = _compute(ind, group_df)`, append `{"group": label, "value": val, "formatted": _format(val, fmt, ind)}`.
- New `_render_breakdown_table(rows) -> str`: `"\n".join(f"{r['group']}: {r['formatted']}" for r in rows)` (empty string for no rows).

### `web/main.py` — `POST /api/indicators/preview`
- Before narrowing the preview df, collect disaggregation columns so they survive: `preview_cols = ([question] if question else []) + dis_cols` and call `_pick_preview_df(df, preview_cols, _questions)` (instead of just `[question]`). The existing missing-`question` check is unchanged.
- After `compute_indicators([ind], df)`, also read `breakdown = result.get(f"ind_{name}_breakdown", [])` and include it in the response: `return {"value": value, "n_rows": ..., "trend": trend, "breakdown": breakdown}`.

### Docs
- CLAUDE.md: add `disaggregate_by` to the indicators config annotation and document `{{ ind_<name>_breakdown }}` (loopable) + `{{ ind_<name>_table }}` (text) placeholders.

## 4. Error handling
Per-indicator and per-feature fail-soft: the whole `compute_indicators` loop already wraps each indicator in try/except (→ `ind_<name> = "N/A"`); the new breakdown block adds its own inner try so a disaggregation problem never blanks the scalar. Missing columns raise inside `_compute_breakdown` and are caught. The preview endpoint returns `breakdown: []` when none.

## 5. Testing (TDD)
`tests/test_indicators_disaggregation.py` (new):
- `sum` disaggregated by one column → breakdown rows per group with correct per-group sums; `ind_<name>` equals the overall sum; rows sorted by group.
- `count` disaggregated by one column → per-group counts.
- two-column disaggregation → group labels joined with `" / "`.
- missing `disaggregate_by` column → `ind_<name>_breakdown == []`, `_table == "N/A"`, **scalar still present** (fail-soft).
- no `disaggregate_by` → no `_breakdown`/`_table` keys (backward-compat).
- `_render_breakdown_table` format (one `group: value` line per row).
`tests/test_indicators_preview_api.py` (new or extend an existing API test): `POST /api/indicators/preview` with a `disaggregate_by` indicator returns a non-empty `breakdown` list (using a tmp data file under `data/processed`, matching existing preview-test patterns). Full suite green (currently 316).

## 6. Risks
- **Context value types:** `ind_<name>_breakdown` is a list (other `ind_*` values are strings). Confirmed safe: docxtpl/Jinja iterate lists fine, the narrator only inspects `_target`/`_baseline` suffixes, and JSON serialization handles lists. No consumer assumes all `ind_*` are strings.
- **High-cardinality dimensions** could yield many rows; acceptable for now (M&E dimensions are typically low-cardinality). Top-N is a later refinement.
