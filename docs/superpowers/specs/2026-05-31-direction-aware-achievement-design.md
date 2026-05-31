# Direction-aware achievement — Design

**Date:** 2026-05-31
**Status:** Approved autonomously (user delegated; see "Decision" below) — ready for plan
**Track:** M&E methodology. Closes the "Direction-aware achievement" item in
[`../plans/STATUS.md`](../plans/STATUS.md).

---

## Problem

`pct_achievement` in [`src/reports/indicators.py`](../../src/reports/indicators.py)
is computed as `value / target * 100` (line ~137). This assumes **higher is
better**. For "reduce X" indicators (lower-is-better — e.g. "reduce stunting to
10%"), this is wrong: a value of 12 against a target of 10 reports **120%
achieved** when in reality the target has been *missed* (you're still above it).

## Goal

Add an optional `direction` field to an indicator so achievement is computed
correctly for both senses, **without changing any existing report's numbers**.

## Decision (made autonomously per user delegation)

- **Field:** `direction: increase | decrease`, default `increase`.
- **`increase` (default):** `pct = value / target * 100` — **unchanged**. Every
  existing config keeps its current achievement numbers (no `direction` key = no
  behavior change).
- **`decrease`:** `pct = target / value * 100` — the lower-is-better mirror.
  - target 10, value 10 → 100% (met)
  - target 10, value 20 → 50% (missed)
  - target 10, value 5  → 200% (over-achieved — went below target, which is good)
  - `value == 0`: undefined (÷0) → emit `"N/A"` (guarded), consistent with how the
    existing code emits `"N/A"` on bad input.

**Parked alternative (recommend, do not build now):** the academically-standard
*baseline-anchored* formula `(value − baseline) / (target − baseline) * 100` is
direction-agnostic and arguably more correct when a baseline exists. It is **not**
chosen here because it would silently change achievement numbers for existing
`increase` indicators that have a `baseline` set, and it belongs with the broader
**Indicator metadata catalog / PIRS** item (unit/direction/frequency/baseline
semantics) rather than this small fix. Flag to the user at end of session.

## Scope

- **In:** `pct_achievement` computation in `src/reports/indicators.py`; module
  docstring; unit tests.
- **Out (unchanged, by design):**
  - **Node-level (primary) achievement** — `src/reports/logframe.py` reads the
    already-computed `ind_<name>_pct_achievement` string from context, so it
    inherits the corrected value automatically. No change.
  - **Frontend** — `baseline`/`target` are already YAML-only (the IndicatorModal
    doesn't expose them), so `direction` is YAML-only too, matching the existing
    pattern. No UI change. (A future PIRS/metadata UI can surface all three together.)
  - `_delta` / `_pct_change` (period comparison) — orthogonal, untouched.

## Behavior contract

In `compute_indicators`, where `target is not None and target != 0`:

```python
direction = str(ind.get("direction", "increase")).lower()
try:
    v = float(value); t = float(target)
    if direction == "decrease":
        pct = (t / v * 100) if v != 0 else None   # None -> "N/A"
    else:
        pct = v / t * 100
    context[f"ind_{name}_pct_achievement"] = f"{pct:,.1f}%" if pct is not None else "N/A"
except (TypeError, ValueError):
    context[f"ind_{name}_pct_achievement"] = "N/A"
```

An unrecognized `direction` value falls back to `increase` (fail-soft, no error).

## Testing

- `increase` (explicit) and **no `direction`** (default) both give `value/target`
  → regression guard that existing behavior is preserved.
- `decrease`: met (100%), missed (<100%), over-achieved (>100%).
- `decrease` with `value == 0` → `"N/A"`.
- Unknown `direction` (e.g. `"sideways"`) falls back to increase.
- Existing `tests/test_logframe.py` achievement assertions stay green (they use
  no `direction`, so default path).

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/indicators.py` | modify | Direction-aware `pct_achievement`; docstring note |
| `tests/test_indicators_direction.py` | create | Direction unit tests (new file, keeps existing test files focused) |
| `CLAUDE.md` | modify | Document `direction:` in the indicators config section |
