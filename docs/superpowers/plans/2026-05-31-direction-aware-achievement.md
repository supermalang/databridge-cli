# Direction-aware Achievement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compute `pct_achievement` correctly for lower-is-better indicators via an optional `direction: increase|decrease` field, with `increase` as a fully backward-compatible default.

**Architecture:** A localized change to the `pct_achievement` branch of `compute_indicators` in `src/reports/indicators.py`. Node-level (primary) achievement in `logframe.py` reads the already-computed string and needs no change. `baseline`/`target`/`direction` are YAML-only (no frontend change), matching the existing pattern.

**Tech Stack:** Python 3.12 + pandas.

**Spec:** [`../specs/2026-05-31-direction-aware-achievement-design.md`](../specs/2026-05-31-direction-aware-achievement-design.md)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/reports/indicators.py` | modify | Direction-aware `pct_achievement` (lines ~135–140) + docstring note |
| `tests/test_indicators_direction.py` | create | Direction unit tests (matches the focused `test_indicators_*` convention) |
| `CLAUDE.md` | modify | Document `direction:` in the indicators config section |

---

## Task 1: Direction-aware `pct_achievement`

**Files:**
- Modify: `src/reports/indicators.py`
- Create: `tests/test_indicators_direction.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_indicators_direction.py`:

```python
import pandas as pd
from src.reports.indicators import compute_indicators


def _ind(**kw):
    base = {"name": "a", "stat": "sum", "question": "V", "target": 100}
    base.update(kw)
    return base


# A 'sum' of V = 80 across the rows below.
def _df(total=80):
    return pd.DataFrame({"V": [total]})


def test_increase_default_unchanged():
    # No direction key -> existing value/target behavior (80/100 = 80%).
    ctx = compute_indicators([_ind()], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"


def test_increase_explicit_matches_default():
    ctx = compute_indicators([_ind(direction="increase")], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"


def test_decrease_met_is_100():
    # target 100, value 100 -> 100% (lower-is-better, met exactly)
    ctx = compute_indicators([_ind(direction="decrease")], _df(100))
    assert ctx["ind_a_pct_achievement"] == "100.0%"


def test_decrease_missed_below_100():
    # target 100, value 200 -> 100/200 = 50% (still well above target = missed)
    ctx = compute_indicators([_ind(direction="decrease")], _df(200))
    assert ctx["ind_a_pct_achievement"] == "50.0%"


def test_decrease_overachieved_above_100():
    # target 100, value 50 -> 100/50 = 200% (went below target = good)
    ctx = compute_indicators([_ind(direction="decrease")], _df(50))
    assert ctx["ind_a_pct_achievement"] == "200.0%"


def test_decrease_zero_value_is_na():
    # value 0 -> division by zero -> "N/A" (guarded)
    ctx = compute_indicators([_ind(direction="decrease")], _df(0))
    assert ctx["ind_a_pct_achievement"] == "N/A"


def test_unknown_direction_falls_back_to_increase():
    ctx = compute_indicators([_ind(direction="sideways")], _df(80))
    assert ctx["ind_a_pct_achievement"] == "80.0%"
```

- [ ] **Step 2: Run to verify failure**

Run: `PYTHONPATH=. pytest tests/test_indicators_direction.py -v`
Expected: FAIL — the `decrease` cases currently compute `value/target` (e.g. `test_decrease_missed_below_100` gets `200.0%` instead of `50.0%`).

- [ ] **Step 3: Implement direction-aware computation**

In `src/reports/indicators.py`, replace the existing `pct_achievement` block (currently):

```python
            if target is not None and target != 0:
                try:
                    pct = float(value) / float(target) * 100
                    context[f"ind_{name}_pct_achievement"] = f"{pct:,.1f}%"
                except (TypeError, ValueError):
                    context[f"ind_{name}_pct_achievement"] = "N/A"
```

with:

```python
            if target is not None and target != 0:
                direction = str(ind.get("direction", "increase")).lower()
                try:
                    v = float(value)
                    t = float(target)
                    if direction == "decrease":
                        pct = (t / v * 100) if v != 0 else None  # lower-is-better
                    else:
                        pct = v / t * 100                        # higher-is-better (default)
                    context[f"ind_{name}_pct_achievement"] = (
                        f"{pct:,.1f}%" if pct is not None else "N/A"
                    )
                except (TypeError, ValueError):
                    context[f"ind_{name}_pct_achievement"] = "N/A"
```

- [ ] **Step 4: Add a docstring note**

In the module docstring's "Baseline / target (optional)" block (around lines 38–41), add a line after the `target` description:

```
  direction    : "increase" (default, higher-is-better: value/target) or
                 "decrease" (lower-is-better: target/value). Affects pct_achievement only.
```

- [ ] **Step 5: Run the new tests to verify pass**

Run: `PYTHONPATH=. pytest tests/test_indicators_direction.py -v`
Expected: PASS — 7 tests.

- [ ] **Step 6: Run the full suite (regression — logframe + existing indicator tests)**

Run: `PYTHONPATH=. pytest -q`
Expected: all pass, including `tests/test_logframe.py` (whose achievement assertions use no `direction`, so the default `increase` path keeps `"50.0%"` etc.).

- [ ] **Step 7: Commit**

```bash
git add src/reports/indicators.py tests/test_indicators_direction.py
git commit -m "feat(M&E): direction-aware pct_achievement (increase|decrease)"
```

---

## Task 2: Document `direction:` in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the indicators config annotation**

In `CLAUDE.md`, find the `indicators:` block in the "config.yml — full annotated
structure" section. The stat comment line reads:

```
# stat: count | count_distinct | sum | mean | median | min | max | percent | most_common | grouped_agg |
#       completeness (% present, non-blank) | outlier_rate (% beyond 3xIQR) | duplicate_rate (% redundant)
#       — the latter three are data-quality stats; pair with format: percent
```

Immediately after that comment block (before the first `- name:` entry), add:

```
# direction: increase (default, higher-is-better → pct_achievement = value/target)
#            | decrease (lower-is-better → target/value). Set on "reduce X" indicators
#            so achievement is correct when the goal is to bring a number down.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(M&E): document indicator direction field"
```

---

## Self-review notes

- **Spec coverage:** direction field with increase default (Task 1), decrease formula + zero-guard + unknown fallback (Task 1 tests), docs (Task 2). Node-level achievement and frontend are out of scope by design (spec) — logframe inherits the corrected string; no UI for YAML-only target/baseline/direction.
- **Backward compatibility:** the `increase` default path is byte-identical to the old formula; `tests/test_logframe.py` is the regression guard.
- **No placeholders / type consistency:** `pct` is `float|None`; `"N/A"` on None or bad input; `direction` lowercased with fail-soft fallback.
