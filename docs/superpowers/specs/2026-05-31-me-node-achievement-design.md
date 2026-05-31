# M&E — Node-Level Achievement (Primary Indicator) Design

**Date:** 2026-05-31
**Status:** Design (owner chose "option 1 with my recommendation"; decisions locked)
**Roadmap:** M&E core, following disaggregated indicators (#14/#15) and per-indicator logframe achievement (#16). Adds a node-level achievement to the results framework **without** fuzzy multi-indicator aggregation.

---

## 1. Goal

Give each framework node (goal/outcome/output) an overall **achievement** by designating one of its linked indicators as **primary** (`primary: true`). The logframe rows expose the primary indicator's value/target/% as node-level fields, so a template can show "Outcome 1 — 50% achieved" without the engine having to guess how to combine multiple indicators.

---

## 2. Decisions (locked)

- **`primary: true`** is an optional boolean on an indicator config. The node's achievement = that indicator's already-computed `value` / `target` / `pct_achievement`.
- **No aggregation, no averaging.** If a node has multiple indicators, only the one flagged `primary` drives the node achievement. If **none** is flagged primary, the node-level fields are empty `""` (the per-indicator rows are still listed, as today).
- **First wins** if more than one indicator under the same node is flagged primary (deterministic; a config smell, not an error).
- **Additive to the row, not the indicator entry.** The per-indicator entry shape (`{name, value, baseline, target, pct_achievement}` from #16) is **unchanged** (so existing tests/templates are untouched). New keys live on the row.
- **Settable from the web:** a `Primary` checkbox in the IndicatorModal writes `primary: true`.

**Out of scope:** averaging/sum roll-ups; weighting; per-node target independent of indicators; auto-template rendering of the new node fields (templates/auto-gen can consume them later).

---

## 3. Architecture

### `src/reports/logframe.py`
- While indexing indicators by `framework_ref`, also track the **primary** entry per ref: `primary_by_ref[ref] = entry` for the first indicator with `ind.get("primary")` truthy (skip if ref already has one).
- Each row gains:
  - `primary_indicator`: the primary indicator's `name` (or `""`).
  - `node_value`, `node_target`, `node_pct_achievement`: copied from the primary entry's `value`/`target`/`pct_achievement` (or `""` when no primary).
- The per-indicator `indicators` list is unchanged.

### `frontend/src/pages/Composition.jsx` — `IndicatorModal`
- New `primary` checkbox (state from `initial?.primary`); on submit, `if (primary) item.primary = true;`.

### Docs
- `{{ logframe }}` note: rows also carry `primary_indicator` + `node_value`/`node_target`/`node_pct_achievement`. Config annotation: `primary: true` on an indicator.

## 4. Error handling
Total/fail-soft: missing `primary` → empty node fields; the primary entry is just a reference to an already-built indicator entry, so no extra computation can fail. Backward-compatible (additive row keys; entry shape and existing values unchanged).

## 5. Testing (TDD)
`tests/test_logframe.py` (extend):
- node with a `primary` indicator that has a target → `row.primary_indicator == name`, `row.node_pct_achievement == "<pct>"`, `node_value`/`node_target` set.
- node with indicators but none primary → `primary_indicator == ""` and `node_pct_achievement == ""`.
- two indicators flagged primary under one node → first wins (deterministic).
- existing entry-shape assertions still pass (entry shape unchanged).
Full suite green (currently 325). Frontend: clean `npm run build`.

## 6. Risks
- **Row key additions** could collide with a template variable name — `primary_indicator`/`node_*` are namespaced under each row dict, no global collision.
- **Primary on an indicator with no target** → `node_pct_achievement` is `""` (the indicator simply has no achievement); acceptable and expected.
