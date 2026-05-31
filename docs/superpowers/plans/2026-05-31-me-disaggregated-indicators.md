# M&E — Disaggregated Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A single indicator can be disaggregated by one or more dimension columns via a new `disaggregate_by` field, producing `ind_<name>_breakdown` (list) + `ind_<name>_table` (text) alongside the unchanged scalar `ind_<name>`. Backward-compatible.

**Architecture:** Reuse the existing `_compute`/`_format` per group inside `compute_indicators`; expose the breakdown through the indicators preview API. Frontend is a separate slice.

**Tech Stack:** Python (pandas, pytest), FastAPI.

**Spec:** `docs/superpowers/specs/2026-05-31-me-disaggregated-indicators-design.md`. On `main`: orchestrator complete; suite 316.

## File structure
- **Modify:** `src/reports/indicators.py` (new `_compute_breakdown`, `_render_breakdown_table`; hook in `compute_indicators`).
- **Create:** `tests/test_indicators_disaggregation.py`.
- **Modify:** `web/main.py` (`preview_indicator`: keep disagg cols, return `breakdown`).
- **Create:** `tests/test_indicators_preview_api.py`.
- **Modify:** `CLAUDE.md`.

---

## Task 1: Engine disaggregation

**Files:** Modify `src/reports/indicators.py`; Test `tests/test_indicators_disaggregation.py`.

- [ ] **Step 1: Write failing tests** in `tests/test_indicators_disaggregation.py`:

```python
import pandas as pd
from src.reports.indicators import compute_indicators, _render_breakdown_table


def _df():
    return pd.DataFrame({
        "Region": ["North", "North", "South", "South", "South"],
        "Sex":    ["F", "M", "F", "M", "F"],
        "Doses":  [10, 20, 5, 7, 3],
    })


def test_sum_disaggregated_by_one_column():
    ctx = compute_indicators(
        [{"name": "doses", "stat": "sum", "question": "Doses", "disaggregate_by": "Region"}], _df())
    assert ctx["ind_doses"] == "45"   # overall, number-formatted
    rows = ctx["ind_doses_breakdown"]
    by = {r["group"]: r["value"] for r in rows}
    assert by == {"North": 30, "South": 15}
    assert [r["group"] for r in rows] == ["North", "South"]   # sorted by group
    assert {r["formatted"] for r in rows} == {"30", "15"}


def test_count_disaggregated():
    ctx = compute_indicators(
        [{"name": "n", "stat": "count", "question": "Doses", "disaggregate_by": "Sex"}], _df())
    by = {r["group"]: r["value"] for r in ctx["ind_n_breakdown"]}
    assert by == {"F": 3, "M": 2}


def test_two_column_disaggregation_joins_labels():
    ctx = compute_indicators(
        [{"name": "d", "stat": "sum", "question": "Doses", "disaggregate_by": ["Region", "Sex"]}], _df())
    groups = {r["group"] for r in ctx["ind_d_breakdown"]}
    assert "North / F" in groups and "South / M" in groups


def test_missing_disaggregate_column_is_failsoft():
    ctx = compute_indicators(
        [{"name": "d", "stat": "sum", "question": "Doses", "disaggregate_by": "Nope"}], _df())
    assert ctx["ind_d"] == "45"             # scalar still computed
    assert ctx["ind_d_breakdown"] == []
    assert ctx["ind_d_table"] == "N/A"


def test_no_disaggregate_by_is_backward_compatible():
    ctx = compute_indicators([{"name": "d", "stat": "sum", "question": "Doses"}], _df())
    assert ctx["ind_d"] == "45"
    assert "ind_d_breakdown" not in ctx
    assert "ind_d_table" not in ctx


def test_render_breakdown_table():
    rows = [{"group": "North", "value": 30, "formatted": "30"},
            {"group": "South", "value": 15, "formatted": "15"}]
    assert _render_breakdown_table(rows) == "North: 30\nSouth: 15"
    assert _render_breakdown_table([]) == ""
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_indicators_disaggregation.py -v` — expect FAIL (`_render_breakdown_table` missing; no breakdown keys).

- [ ] **Step 3: Edit `src/reports/indicators.py`:**
  (a) In `compute_indicators`, immediately after the line `context[f"ind_{name}"] = _format(value, fmt, ind)` (and before the `if ind.get("framework_ref"):` block), insert:
  ```python
            if ind.get("disaggregate_by"):
                try:
                    rows = _compute_breakdown(ind, ind_df, fmt)
                    context[f"ind_{name}_breakdown"] = rows
                    context[f"ind_{name}_table"] = _render_breakdown_table(rows)
                except Exception as e:
                    log.warning(f"Indicator '{name}' disaggregation failed: {e}")
                    context[f"ind_{name}_breakdown"] = []
                    context[f"ind_{name}_table"] = "N/A"
  ```
  (`ind_df` and `fmt` are already in scope at this point.)
  (b) Add these two module-level functions (after `_compute`, before `_format`):
  ```python
  def _compute_breakdown(ind: Dict, ind_df: pd.DataFrame, fmt: str) -> List[Dict]:
      """Compute the indicator's stat per group of its disaggregate_by column(s).
      Returns a list of {group, value, formatted} rows (sorted by group key)."""
      dis = ind.get("disaggregate_by")
      cols = [dis] if isinstance(dis, str) else list(dis)
      missing = [c for c in cols if c not in ind_df.columns]
      if missing:
          raise ValueError(f"disaggregate_by column(s) not found in data: {missing}")
      rows: List[Dict] = []
      for key, group_df in ind_df.groupby(cols, dropna=False, sort=True):
          if isinstance(key, tuple):
              label = " / ".join("(blank)" if pd.isna(k) else str(k) for k in key)
          else:
              label = "(blank)" if pd.isna(key) else str(key)
          val = _compute(ind, group_df)
          rows.append({"group": label, "value": val, "formatted": _format(val, fmt, ind)})
      return rows


  def _render_breakdown_table(rows: List[Dict]) -> str:
      """Plain-text fallback: one 'group: formatted' line per breakdown row."""
      return "\n".join(f"{r['group']}: {r['formatted']}" for r in rows)
  ```
  (c) Update the module docstring: add a "Disaggregation (optional)" note documenting `disaggregate_by` and the `ind_<name>_breakdown` / `ind_<name>_table` outputs.

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_indicators_disaggregation.py -v` (6 passed). Full suite `PYTHONPATH=. python -m pytest tests/ -q` (no regressions; expect ~322).

- [ ] **Step 5: Commit**
```bash
git add src/reports/indicators.py tests/test_indicators_disaggregation.py
git commit -m "feat(indicators): disaggregate_by — per-group breakdown + text table (backward-compatible)"
```

---

## Task 2: Preview API exposes breakdown

**Files:** Modify `web/main.py`; Test `tests/test_indicators_preview_api.py`.

- [ ] **Step 1: Write failing test** in `tests/test_indicators_preview_api.py`:

```python
import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_preview_returns_breakdown(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "DATA_DIR", tmp_path)
    pd.DataFrame({"Region": ["N", "N", "S"], "Doses": [10, 20, 5]}).to_csv(
        tmp_path / "survey_data.csv", index=False)
    client = TestClient(wm.app)
    resp = client.post("/api/indicators/preview", json={
        "indicator": {"name": "doses", "stat": "sum", "question": "Doses", "disaggregate_by": "Region"},
        "data_file": "survey_data.csv",
    })
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["value"] == "30"   # overall sum, number-formatted
    by = {r["group"]: r["value"] for r in body["breakdown"]}
    assert by == {"N": 30, "S": 5}


def test_preview_no_disaggregation_returns_empty_breakdown(tmp_path, monkeypatch):
    monkeypatch.setattr(wm, "DATA_DIR", tmp_path)
    pd.DataFrame({"Doses": [10, 20, 5]}).to_csv(tmp_path / "survey_data.csv", index=False)
    client = TestClient(wm.app)
    resp = client.post("/api/indicators/preview", json={
        "indicator": {"name": "doses", "stat": "sum", "question": "Doses"},
        "data_file": "survey_data.csv",
    })
    assert resp.status_code == 200
    assert resp.json()["breakdown"] == []
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_indicators_preview_api.py -v` — expect FAIL (no `breakdown` key; or disagg column dropped by the preview narrowing → empty).

- [ ] **Step 3: Edit `preview_indicator` in `web/main.py`** (the `POST /api/indicators/preview` handler ~line 627). Find this region:
  ```python
      ind = payload.indicator
      question = ind.get("question")
      if question:
          df = _pick_preview_df(df, [question], _questions)
      if question and question not in df.columns:
          ...
      try:
          result = compute_indicators([ind], df)
          key = f"ind_{ind.get('name', 'preview')}"
          value = result.get(key, "N/A")
      except Exception as e:
          raise HTTPException(status_code=400, detail=f"Indicator error: {e}")
  ```
  Change it to (keep disaggregation columns in the narrowed df, and capture the breakdown):
  ```python
      ind = payload.indicator
      name = ind.get("name", "preview")
      question = ind.get("question")
      dis = ind.get("disaggregate_by")
      dis_cols = [dis] if isinstance(dis, str) else list(dis or [])
      preview_cols = ([question] if question else []) + dis_cols
      if preview_cols:
          df = _pick_preview_df(df, preview_cols, _questions)
      if question and question not in df.columns:
          available = sorted(df.columns.tolist())
          raise HTTPException(status_code=400, detail=f"Column '{question}' not found in data. Available: {available}")
      try:
          result = compute_indicators([ind], df)
          value = result.get(f"ind_{name}", "N/A")
          breakdown = result.get(f"ind_{name}_breakdown", [])
      except Exception as e:
          raise HTTPException(status_code=400, detail=f"Indicator error: {e}")
  ```
  (Keep the existing trend-computation block as-is; it uses `ind.get('name', 'preview')` which still matches `name`.) Then update the final `return` of this handler:
  ```python
      return {"value": value, "n_rows": len(df), "trend": trend, "breakdown": breakdown}
  ```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_indicators_preview_api.py -v` (2 pass). Full suite green.

- [ ] **Step 5: Commit**
```bash
git add web/main.py tests/test_indicators_preview_api.py
git commit -m "feat(web): indicators preview returns disaggregation breakdown"
```

---

## Task 3: Docs

**Files:** Modify `CLAUDE.md`.

- [ ] **Step 1:** In the `indicators:` config annotation block (search `framework_ref links it to a framework node`), add a `disaggregate_by` example line, e.g. under an indicator:
  ```yaml
      disaggregate_by: [Region, Sex]   # optional — also compute this stat per group; adds ind_<name>_breakdown + ind_<name>_table
  ```

- [ ] **Step 2:** In the Word-template placeholders section (search `{{ ind_<name> }}        ← one per indicator`), add:
  ```
  {{ ind_<name>_breakdown }}  ← list of {group,value,formatted} when the indicator sets disaggregate_by (loop in the template)
  {{ ind_<name>_table }}      ← plain-text "group: value" fallback for the same breakdown
  ```

- [ ] **Step 3: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` (green).

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md
git commit -m "docs: document indicator disaggregate_by + breakdown placeholders"
```

---

## Self-review notes
- **Spec coverage:** `disaggregate_by` per-group compute reusing `_compute`/`_format` (T1) ✓; breakdown list + text table outputs (T1) ✓; fail-soft + backward-compat (T1 tests) ✓; preview API keeps disagg cols + returns breakdown (T2) ✓; docs (T3) ✓.
- **Type/name consistency:** `_compute_breakdown(ind, ind_df, fmt) -> List[Dict]`, `_render_breakdown_table(rows) -> str`; context keys `ind_<name>_breakdown` (list) / `ind_<name>_table` (str); API response key `breakdown`; field name `disaggregate_by` consistent across engine/spec/API/docs.
- **Backward-compat:** breakdown keys only added when `disaggregate_by` set (asserted by `test_no_disaggregate_by_is_backward_compatible`); scalar unchanged.
- **No placeholders:** complete code/commands throughout.
