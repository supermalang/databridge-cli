# Layer 2 — Data Profiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic profiling engine (`src/data/profile.py`) that computes structured per-column/per-table EDA over all base tables, becomes the single source of truth for shared signals (validate.py + summaries.py consume it), and is exposed web-first via `GET /api/profile` + a read-only Profile tab.

**Architecture:** New pure `profile.py` owns four primitives (`null_stats`, `iqr_bounds`, `numeric_outliers`, `correlations`) and three assemblers (`profile_column`, `profile_table`, `profile_dataset`). `validate.py` and `summaries.py` are refactored to derive their numbers from these primitives (standardizing on 3×IQR — the one intentional behavior change in `summaries.py`'s data_quality block). A FastAPI endpoint and a React tab surface the profile.

**Tech Stack:** Python 3, pandas, pytest, FastAPI (+ `fastapi.testclient`), React/Vite.

**Spec:** `docs/superpowers/specs/2026-05-30-layer2-data-profiling-design.md`. Builds on Layer 1 base tables (now on `main`). Current suite: 156 passing.

---

## Design constants & shared shapes (used across tasks)

- `LOW_CARDINALITY_MAX = 20` — `top_values` computed only when `distinct <= LOW_CARDINALITY_MAX`.
- Default IQR multiplier `k = 3.0` everywhere.
- Roles come from a question's `category`; `_`-prefixed columns are role `"linkage"`; unknown columns are `"undefined"`.
- `null_stats(series) -> {"present": int, "missing": int, "missing_pct": float}` where *missing* = NaN OR blank-after-strip (matches `validate.compute_missingness`).

---

## File structure

- **Create:** `src/data/profile.py` — primitives + structured profile (pure, no I/O, no LLM).
- **Modify:** `src/data/validate.py` — `compute_missingness`, `find_numeric_outliers` derive from profile primitives.
- **Modify:** `src/reports/summaries.py` — `_data_quality_text`, `_correlation_text` derive from profile primitives (1.5×→3×).
- **Modify:** `web/main.py` — add `GET /api/profile`.
- **Create:** `frontend/src/pages/Profile.jsx`; **Modify:** `frontend/src/App.jsx` (register tab); styles reuse existing tokens.
- **Tests:** `tests/test_profile.py`, `tests/test_profile_api.py`, plus an update to the summaries data_quality test.

---

## Task 1: Primitives — `null_stats`, `iqr_bounds`, `numeric_outliers`

**Files:**
- Create: `src/data/profile.py`
- Test: `tests/test_profile.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_profile.py
import pandas as pd
from src.data.profile import null_stats, iqr_bounds, numeric_outliers


def test_null_stats_counts_nan_and_blank_as_missing():
    s = pd.Series(["a", "", None, "b"])
    assert null_stats(s) == {"present": 2, "missing": 2, "missing_pct": 0.5}


def test_null_stats_empty_series():
    assert null_stats(pd.Series([], dtype=object)) == {"present": 0, "missing": 0, "missing_pct": 0.0}


def test_iqr_bounds_3x_default():
    s = pd.Series([10, 12, 14, 16, 18, 20])
    lo, hi = iqr_bounds(s)
    # q1=12.5, q3=17.5, iqr=5 → [12.5-15, 17.5+15] = [-2.5, 32.5]
    assert round(lo, 1) == -2.5 and round(hi, 1) == 32.5


def test_iqr_bounds_none_when_too_few_or_constant():
    assert iqr_bounds(pd.Series([1, 2, 3])) is None        # < 4 values
    assert iqr_bounds(pd.Series([5, 5, 5, 5])) is None      # iqr == 0


def test_numeric_outliers_flags_extreme_value():
    s = pd.Series([10, 12, 14, 16, 18, 999])
    out = numeric_outliers(s)
    assert out["count"] == 1
    assert out["examples"] == [999]
    assert out["bounds"] is not None


def test_numeric_outliers_empty_when_no_bounds():
    assert numeric_outliers(pd.Series([1, 2, 3])) == {"count": 0, "bounds": None, "examples": []}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.data.profile'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/data/profile.py
"""Deterministic data profiling: structured per-column/per-table EDA signals.

Pure computation — no LLM, no I/O. This module is the single source of truth for
the data-quality signals also surfaced by validate.py (findings) and
summaries.py (narrative). Profiles every base table produced by Layer 1.
"""
from typing import Dict, List, Optional
import pandas as pd

LOW_CARDINALITY_MAX = 20


def null_stats(series: pd.Series) -> Dict:
    """Present/missing counts. Missing = NaN OR blank-after-strip."""
    n = len(series)
    if n == 0:
        return {"present": 0, "missing": 0, "missing_pct": 0.0}
    missing_mask = series.isna() | (series.astype(str).str.strip() == "")
    missing = int(missing_mask.sum())
    return {"present": n - missing, "missing": missing, "missing_pct": round(missing / n, 4)}


def iqr_bounds(series: pd.Series, k: float = 3.0) -> Optional[tuple]:
    """[Q1 - k*IQR, Q3 + k*IQR] over numeric-coerced values, or None.

    Returns None when fewer than 4 numeric values or a constant column (IQR == 0).
    k defaults to 3.0 (M&E surveys are legitimately skewed; 1.5 is too noisy).
    """
    s = pd.to_numeric(series, errors="coerce").dropna()
    if len(s) < 4:
        return None
    q1, q3 = s.quantile(0.25), s.quantile(0.75)
    iqr = q3 - q1
    if iqr == 0:
        return None
    return (q1 - k * iqr, q3 + k * iqr)


def numeric_outliers(series: pd.Series, k: float = 3.0) -> Dict:
    """Count + bounds + up-to-5 example values outside the k*IQR fence."""
    bounds = iqr_bounds(series, k)
    if bounds is None:
        return {"count": 0, "bounds": None, "examples": []}
    lo, hi = bounds
    s = pd.to_numeric(series, errors="coerce").dropna()
    out = s[(s < lo) | (s > hi)]
    return {"count": int(len(out)), "bounds": [float(lo), float(hi)], "examples": out.head(5).tolist()}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.py tests/test_profile.py
git commit -m "feat(profile): add null_stats, iqr_bounds, numeric_outliers primitives"
```

---

## Task 2: Primitive — `correlations`

**Files:**
- Modify: `src/data/profile.py`
- Test: `tests/test_profile.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_profile.py
from src.data.profile import correlations


def test_correlations_returns_strong_pair():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [2, 4, 6, 8, 10], "c": [5, 3, 6, 2, 9]})
    result = correlations(df, ["a", "b", "c"])
    pair = next(p for p in result if {p["a"], p["b"]} == {"a", "b"})
    assert pair["method"] == "pearson"
    assert round(pair["r"], 2) == 1.0


def test_correlations_skips_below_threshold_and_needs_two_columns():
    df = pd.DataFrame({"a": [1, 2, 3, 4]})
    assert correlations(df, ["a"]) == []
    # near-zero correlation is filtered out
    df2 = pd.DataFrame({"a": [1, 2, 3, 4], "b": [1, 1, 1, 2]})
    assert all(abs(p["r"]) >= 0.1 for p in correlations(df2, ["a", "b"]))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py::test_correlations_returns_strong_pair -v`
Expected: FAIL — `ImportError: cannot import name 'correlations'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/profile.py
def correlations(df: pd.DataFrame, columns: List[str],
                 method: str = "pearson", threshold: float = 0.1) -> List[Dict]:
    """Pairwise correlations among numeric columns with |r| >= threshold.

    Iterates columns in order, upper triangle only (i < j), skipping NaN and
    sub-threshold pairs. Returns [{"a","b","method","r"}].
    """
    cols = [c for c in columns if c in df.columns]
    if len(cols) < 2:
        return []
    nums = df[cols].apply(pd.to_numeric, errors="coerce")
    if nums.dropna(how="all").empty:
        return []
    corr = nums.corr(method=method)
    out: List[Dict] = []
    for i, a in enumerate(cols):
        for b in cols[i + 1:]:
            try:
                r = corr.loc[a, b]
            except KeyError:
                continue
            if pd.isna(r) or abs(r) < threshold:
                continue
            out.append({"a": a, "b": b, "method": method, "r": round(float(r), 4)})
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.py tests/test_profile.py
git commit -m "feat(profile): add correlations primitive"
```

---

## Task 3: `profile_column`

**Files:**
- Modify: `src/data/profile.py`
- Test: `tests/test_profile.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_profile.py
from src.data.profile import profile_column


def test_profile_column_quantitative():
    s = pd.Series([10, 12, 14, 16, 18, 999], name="Age")
    p = profile_column(s, "quantitative")
    assert p["name"] == "Age" and p["role"] == "quantitative"
    assert p["count"] == 6 and p["missing"] == 0 and p["distinct"] == 6
    assert p["min"] == 10.0 and p["max"] == 999.0
    assert p["outlier_count"] == 1 and p["outlier_bounds"] is not None


def test_profile_column_quantitative_type_issue():
    s = pd.Series(["10", "n/a", "12", ""], name="Count")
    p = profile_column(s, "quantitative")
    # "n/a" is a non-blank value that fails numeric coercion; "" is blank (missing, not a type issue)
    assert p["type_issue_count"] == 1


def test_profile_column_categorical_low_cardinality_has_top_values():
    s = pd.Series(["A", "A", "B", None], name="Region")
    p = profile_column(s, "categorical")
    assert p["high_cardinality"] is False
    top = {d["value"]: d["count"] for d in p["top_values"]}
    assert top == {"A": 2, "B": 1}


def test_profile_column_high_cardinality_suppresses_values():
    s = pd.Series([f"v{i}" for i in range(25)], name="FreeText")
    p = profile_column(s, "qualitative")
    assert p["high_cardinality"] is True
    assert "top_values" not in p


def test_profile_column_date_range():
    s = pd.Series(["2026-01-01", "2026-01-31", None], name="When")
    p = profile_column(s, "date")
    assert p["min_date"].startswith("2026-01-01")
    assert p["span_days"] == 30


def test_profile_column_linkage_is_minimal():
    s = pd.Series([1, 2, 3], name="_root_id")
    p = profile_column(s, "linkage")
    assert p["role"] == "linkage"
    assert "min" not in p and "top_values" not in p
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py::test_profile_column_quantitative -v`
Expected: FAIL — `ImportError: cannot import name 'profile_column'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/profile.py
def profile_column(series: pd.Series, role: str) -> Dict:
    """Structured profile for one column. Fail-soft: role-specific stats that
    raise are skipped, leaving the always-computed fields intact."""
    ns = null_stats(series)
    prof = {
        "name": series.name,
        "role": role,
        "count": ns["present"],
        "missing": ns["missing"],
        "missing_pct": ns["missing_pct"],
        "distinct": int(series.dropna().nunique()),
        "type_issue_count": 0,
    }
    if role == "linkage":
        return prof
    try:
        if role == "quantitative":
            coerced = pd.to_numeric(series, errors="coerce")
            nonblank = series.notna() & (series.astype(str).str.strip() != "")
            prof["type_issue_count"] = int((nonblank & coerced.isna()).sum())
            valid = coerced.dropna()
            if len(valid):
                prof.update({
                    "min": float(valid.min()), "max": float(valid.max()),
                    "mean": float(valid.mean()), "median": float(valid.median()),
                    "std": float(valid.std()) if len(valid) > 1 else 0.0,
                    "q1": float(valid.quantile(0.25)), "q3": float(valid.quantile(0.75)),
                })
                o = numeric_outliers(series)
                prof["outlier_count"] = o["count"]
                prof["outlier_bounds"] = o["bounds"]
        elif role == "date":
            d = pd.to_datetime(series, errors="coerce").dropna()
            if len(d):
                prof["min_date"] = d.min().isoformat()
                prof["max_date"] = d.max().isoformat()
                prof["span_days"] = int((d.max() - d.min()).days)
        else:  # categorical, qualitative, geographical, undefined
            distinct = prof["distinct"]
            prof["high_cardinality"] = distinct > LOW_CARDINALITY_MAX
            if not prof["high_cardinality"]:
                vc = series.dropna().value_counts()
                total = int(vc.sum())
                prof["top_values"] = [
                    {"value": str(v), "count": int(c),
                     "pct": round(c / total, 4) if total else 0.0}
                    for v, c in vc.head(LOW_CARDINALITY_MAX).items()
                ]
    except Exception:
        pass  # fail-soft: keep the always-computed fields
    return prof
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: PASS (14 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.py tests/test_profile.py
git commit -m "feat(profile): add profile_column (role-aware, fail-soft)"
```

---

## Task 4: `profile_table`

**Files:**
- Modify: `src/data/profile.py`
- Test: `tests/test_profile.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_profile.py
from src.data.profile import profile_table


def test_profile_table_columns_correlations_duplicates():
    df = pd.DataFrame({
        "_id": [1, 1, 3],            # duplicate id (two rows share id 1)
        "Region": ["N", "S", "N"],
        "Age": [10, 20, 30],
        "Income": [100, 200, 300],
    })
    role_map = {"Region": "categorical", "Age": "quantitative", "Income": "quantitative"}
    tp = profile_table(df, role_map)
    assert tp["rows"] == 3
    names = {c["name"]: c for c in tp["columns"]}
    assert names["_id"]["role"] == "linkage"
    assert names["Region"]["role"] == "categorical"
    # Age & Income perfectly correlate
    assert any({p["a"], p["b"]} == {"Age", "Income"} for p in tp["correlations"])
    assert tp["duplicates"]["id_col"] == "_id"
    assert tp["duplicates"]["duplicate_rows"] == 2 and tp["duplicates"]["groups"] == 1


def test_profile_table_no_duplicates_returns_none():
    df = pd.DataFrame({"_id": [1, 2], "X": [3, 4]})
    tp = profile_table(df, {"X": "quantitative"})
    assert tp["duplicates"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py::test_profile_table_columns_correlations_duplicates -v`
Expected: FAIL — `ImportError: cannot import name 'profile_table'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/profile.py
def profile_table(df: pd.DataFrame, role_map: Dict[str, str]) -> Dict:
    """Profile one base table: per-column profiles + numeric correlations +
    duplicate-id info. role_map maps column name -> role; `_`-prefixed columns
    are treated as linkage; unknown columns default to "undefined".
    """
    cols = list(df.columns)
    columns = []
    for c in cols:
        role = "linkage" if str(c).startswith("_") else role_map.get(c, "undefined")
        columns.append(profile_column(df[c], role))

    numeric_cols = [c for c in cols
                    if not str(c).startswith("_") and role_map.get(c) == "quantitative"]
    corrs = correlations(df, numeric_cols)

    id_col = next((c for c in ("_uuid", "_id", "_index") if c in df.columns), None)
    duplicates = None
    if id_col is not None:
        counts = df[id_col].value_counts()
        dgroups = counts[counts > 1]
        if not dgroups.empty:
            duplicates = {
                "id_col": id_col,
                "duplicate_rows": int(dgroups.sum()),
                "groups": int(len(dgroups)),
            }

    return {"name": None, "rows": int(len(df)), "columns": columns,
            "correlations": corrs, "duplicates": duplicates}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: PASS (16 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.py tests/test_profile.py
git commit -m "feat(profile): add profile_table (columns + correlations + duplicates)"
```

---

## Task 5: `profile_dataset`

**Files:**
- Modify: `src/data/profile.py`
- Test: `tests/test_profile.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_profile.py
from src.data.profile import profile_dataset


def test_profile_dataset_covers_main_and_repeat_tables():
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
        {"export_label": "Illness", "category": "qualitative"},
    ]}
    main_df = pd.DataFrame({"_id": [1, 2], "Region": ["N", "S"], "Age": [10, 20]})
    repeats = {"household/members": pd.DataFrame({
        "_parent_index": [1, 1], "_row_id": ["1.0", "1.1"], "Illness": ["flu", "cold"],
    })}
    profiles = profile_dataset(cfg, main_df, repeats)
    assert set(profiles.keys()) == {"main", "household/members"}
    assert profiles["main"]["name"] == "main" and profiles["main"]["rows"] == 2
    members = profiles["household/members"]
    illness_col = next(c for c in members["columns"] if c["name"] == "Illness")
    assert illness_col["role"] == "qualitative"
    # linkage columns recognized in the repeat table
    assert next(c for c in members["columns"] if c["name"] == "_row_id")["role"] == "linkage"


def test_profile_dataset_empty_repeats():
    cfg = {"questions": []}
    profiles = profile_dataset(cfg, pd.DataFrame({"_id": [1]}), {})
    assert set(profiles.keys()) == {"main"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py::test_profile_dataset_covers_main_and_repeat_tables -v`
Expected: FAIL — `ImportError: cannot import name 'profile_dataset'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/profile.py
def profile_dataset(cfg: Dict, main_df: pd.DataFrame,
                    repeat_tables: Optional[Dict[str, pd.DataFrame]]) -> Dict[str, Dict]:
    """Profile main + every base table. role_map is built once from cfg questions
    (export_label -> category) and applied to every table's columns."""
    role_map: Dict[str, str] = {}
    for q in cfg.get("questions", []) or []:
        label = q.get("export_label") or q.get("label") or q.get("kobo_key")
        if label:
            role_map[label] = q.get("category", "undefined")

    out: Dict[str, Dict] = {}
    main_prof = profile_table(main_df, role_map)
    main_prof["name"] = "main"
    out["main"] = main_prof
    for name, rdf in (repeat_tables or {}).items():
        tp = profile_table(rdf, role_map)
        tp["name"] = name
        out[name] = tp
    return out
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py -v`
Expected: PASS (18 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/profile.py tests/test_profile.py
git commit -m "feat(profile): add profile_dataset over all base tables"
```

---

## Task 6: Refactor `validate.py` to consume profile primitives

**Files:**
- Modify: `src/data/validate.py` (`compute_missingness` ~lines 35-60, `find_numeric_outliers` ~lines 63-102)
- Test: `tests/test_profile.py` (add an agreement test)

- [ ] **Step 1: Write the failing test** (asserts validate and profile agree, plus a guard the refactor preserves behavior)

```python
# add to tests/test_profile.py
import pandas as pd
from src.data import validate as V
from src.data.profile import numeric_outliers


def test_validate_outliers_match_profile_primitive():
    df = pd.DataFrame({"Age": [10, 12, 14, 16, 18, 999]})
    questions = [{"export_label": "Age", "category": "quantitative"}]
    findings = V.find_numeric_outliers(df, questions)
    assert len(findings) == 1
    prof = numeric_outliers(df["Age"])
    assert findings[0]["count"] == prof["count"]
    lo, hi = prof["bounds"]
    assert findings[0]["message"] == f"{prof['count']} value(s) outside [{lo:.1f}, {hi:.1f}] (3×IQR bounds)"
```

- [ ] **Step 2: Run test to verify it passes against current code, then refactor without breaking it**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py::test_validate_outliers_match_profile_primitive -v`
Expected: PASS already (current code uses the same 3×IQR + message format). This test pins the contract so the refactor below cannot drift.

- [ ] **Step 3: Refactor `compute_missingness` to use `null_stats`**

In `src/data/validate.py`, add to the imports at the top:
```python
from src.data.profile import null_stats, numeric_outliers
```
Replace the body of the `for col in df.columns:` loop inside `compute_missingness` so the missing count/pct come from `null_stats` (keep the severity logic and finding shape identical):
```python
    for col in df.columns:
        ns = null_stats(df[col])
        count = ns["missing"]
        if count == 0:
            continue
        pct = ns["missing_pct"]
        sev = _severity_for_pct(pct)
        if sev is None:
            continue
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "missingness",
            "message":  f"{count} of {n} rows ({pct:.0%}) are missing or blank",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": [],
        })
```
(Note: `pct` from `null_stats` is already rounded to 4 dp; `round(pct, 4)` is a harmless no-op kept for shape clarity. `n` remains `len(df)` as before.)

- [ ] **Step 4: Refactor `find_numeric_outliers` to use `numeric_outliers`**

Replace the per-column computation block inside `find_numeric_outliers` (the `s = pd.to_numeric(...)` through the `findings.append(...)`) with:
```python
    for col in df.columns:
        if col not in quant_cols:
            continue
        o = numeric_outliers(df[col])  # 3×IQR, returns count/bounds/examples
        if o["bounds"] is None or o["count"] == 0:
            continue
        lo, hi = o["bounds"]
        count = o["count"]
        pct = count / n
        sev = _severity_for_pct(pct) or "info"
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "outlier_iqr",
            "message":  f"{count} value(s) outside [{lo:.1f}, {hi:.1f}] (3×IQR bounds)",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": o["examples"],
        })
```

- [ ] **Step 5: Run the agreement test AND the full validate suite**

Run: `PYTHONPATH=. python -m pytest tests/test_profile.py tests/ -q`
Expected: 156 prior + new profile tests all pass; **no validate test regresses**. If a validate test checks exact `examples` ordering, confirm `numeric_outliers` returns the same `.head(5)` order (it does). Report any test you had to touch.

- [ ] **Step 6: Commit**

```bash
git add src/data/validate.py tests/test_profile.py
git commit -m "refactor(validate): derive missingness + outliers from profile primitives"
```

---

## Task 7: Refactor `summaries.py` to consume profile primitives (3×IQR convergence)

**Files:**
- Modify: `src/reports/summaries.py` (`_data_quality_text` ~lines 357-398, `_correlation_text` ~lines 446-487)
- Test: locate and update the existing data_quality summary test

- [ ] **Step 1: Find the existing data_quality test and pin the new expectation**

Run: `grep -rn "data_quality\|Outliers (IQR)\|_data_quality_text" tests/`
Read the matching test. The current code flags outliers at **1.5×IQR**; after this task it flags at **3×IQR**, so a value that was an outlier at 1.5× but not at 3× will no longer be counted. Update that test's expected outlier count/sentence to the 3× result. If NO existing test asserts the outlier count, add this test:

```python
# tests/test_summaries_data_quality.py
import pandas as pd
from src.reports.summaries import _data_quality_text


def test_data_quality_uses_3x_iqr():
    # 30 is outside 1.5×IQR but inside 3×IQR for this spread → must NOT be flagged at 3×
    df = pd.DataFrame({"V": [10, 11, 12, 13, 14, 15, 30]})
    text = _data_quality_text(df, ["V"])
    assert "Outliers (IQR)" not in text  # nothing flagged at 3×IQR
```

- [ ] **Step 2: Run the test to verify it fails against current (1.5×) code**

Run: `PYTHONPATH=. python -m pytest tests/test_summaries_data_quality.py -v` (or the existing test you updated)
Expected: FAIL — current 1.5× code flags `V: 1 flagged`, so `"Outliers (IQR)"` is present.

- [ ] **Step 3: Refactor `_data_quality_text` to use `numeric_outliers` (3×)**

In `src/reports/summaries.py` add to the imports near the top:
```python
from src.data.profile import numeric_outliers, correlations
```
Replace the outlier block in `_data_quality_text` (the `numeric = pd.to_numeric...` loop computing `n_outliers` at 1.5×) with:
```python
    outlier_parts = []
    for col in questions:
        if col not in df.columns:
            continue
        o = numeric_outliers(df[col])  # 3×IQR via the shared primitive
        if o["count"] > 0:
            outlier_parts.append(f"{col}: {o['count']} flagged")
    if outlier_parts:
        parts.append(f"Outliers (IQR): {', '.join(outlier_parts)}.")
```

- [ ] **Step 4: Refactor `_correlation_text` to source r-values from the `correlations` primitive**

Replace the pair-iteration block in `_correlation_text` (everything from `corr = nums.corr(...)` down to the end of the `for` loops that build `sentences`) with a loop over the primitive's output, preserving the exact sentence format:
```python
    sentences = []
    for pair in correlations(df, numeric_cols, method=method, threshold=0.1):
        r = pair["r"]
        abs_r = abs(r)
        strength = (
            "very strong" if abs_r >= 0.8 else
            "strong" if abs_r >= 0.6 else
            "moderate" if abs_r >= 0.4 else
            "weak"
        )
        direction = "positive" if r > 0 else "negative"
        sentences.append(f"{pair['a']} ↔ {pair['b']}: r={r:.2f} ({direction} {strength})")
```
Leave the function's early-return guards (`< 2` columns, no numeric data) and the trailing `if not sentences: return "No meaningful correlations found."` / final return untouched. (The primitive uses the same i<j order and 0.1 threshold, so existing correlation output is preserved.)

- [ ] **Step 5: Run the data_quality test AND the full suite**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass, including any correlation/summary tests (output format unchanged) and the updated data_quality expectation. Report exact count and any test you adjusted (and why).

- [ ] **Step 6: Commit**

```bash
git add src/reports/summaries.py tests/
git commit -m "refactor(summaries): consume profile primitives; standardize on 3xIQR"
```

---

## Task 8: `GET /api/profile` endpoint

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_profile_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_profile_api.py
import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_profile_endpoint_returns_per_table_profiles(monkeypatch):
    cfg = {"questions": [
        {"export_label": "Region", "category": "categorical"},
        {"export_label": "Age", "category": "quantitative"},
    ]}
    main_df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "S", "N"], "Age": [10, 20, 30]})
    repeats = {"household_members": pd.DataFrame({
        "_parent_index": [1], "_row_id": ["1.0"], "Name": ["A"],
    })}
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    client = TestClient(wm.app)
    resp = client.get("/api/profile")
    assert resp.status_code == 200
    profiles = {p["name"]: p for p in resp.json()["profiles"]}
    assert "main" in profiles and "household_members" in profiles
    assert profiles["main"]["rows"] == 3
    age = next(c for c in profiles["main"]["columns"] if c["name"] == "Age")
    assert age["role"] == "quantitative" and "median" in age


def test_profile_endpoint_no_data(monkeypatch):
    def _raise(*_a, **_k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.get("/api/profile").json()
    assert body["profiles"] == [] and "message" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_profile_api.py -v`
Expected: FAIL — 404 (route missing).

- [ ] **Step 3: Add the endpoint**

In `web/main.py`, add to the module-level imports (alongside the existing `from src.data.transform import load_processed_data` added in Layer 1):
```python
from src.data.profile import profile_dataset
```
Add the route near the other read-only `/api/*` GET routes (e.g. right after `/api/base-tables`):
```python
@app.get("/api/profile")
async def data_profile():
    """Structured EDA profile of every base table for the latest download
    session (row counts, per-column stats, correlations, duplicates). Read-only."""
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"profiles": [], "message": "No downloaded data. Run download first."}
    profiles = profile_dataset(cfg, df, repeats)
    return {"profiles": list(profiles.values())}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_profile_api.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full suite, then commit**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass.

```bash
git add web/main.py tests/test_profile_api.py
git commit -m "feat(api): add GET /api/profile (structured EDA over base tables)"
```

---

## Task 9: Read-only "Profile" tab (frontend, web-first)

**Files:**
- Create: `frontend/src/pages/Profile.jsx`
- Modify: `frontend/src/App.jsx` (register the tab)

- [ ] **Step 1: Create `frontend/src/pages/Profile.jsx`**

Mirrors the existing `Validate.jsx` fetch/loading/error pattern and uses the shared `PageHeader`.

```jsx
import { useEffect, useState } from 'react';
import PageHeader from './PageHeader.jsx';

function ColumnRow({ c }) {
  const detail =
    c.role === 'quantitative' && c.min != null
      ? `min ${c.min} · med ${c.median} · max ${c.max}${c.outlier_count ? ` · ${c.outlier_count} outliers` : ''}`
      : c.role === 'date' && c.min_date
      ? `${String(c.min_date).slice(0, 10)} → ${String(c.max_date).slice(0, 10)} (${c.span_days}d)`
      : c.top_values
      ? c.top_values.slice(0, 4).map(t => `${t.value} (${t.count})`).join(', ')
      : c.high_cardinality
      ? `high cardinality (${c.distinct} distinct)`
      : '';
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{c.name}</td>
      <td style={{ color: 'var(--ink-3)' }}>{c.role}</td>
      <td>{(c.missing_pct * 100).toFixed(1)}%</td>
      <td>{c.distinct}</td>
      <td style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>{detail}</td>
    </tr>
  );
}

export default function Profile() {
  const [profiles, setProfiles] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await fetch('/api/profile');
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
        setProfiles(data.profiles || []);
        setMessage(data.message || null);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        eyebrow="Data profile"
        title="Understand your"
        accent="tables."
        sub="A read-only EDA snapshot of every base table: completeness, cardinality, ranges, outliers, and correlations."
      />
      {loading && <div style={{ color: 'var(--ink-3)', textAlign: 'center', padding: 60 }}>Profiling…</div>}
      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>
          <div style={{ fontWeight: 600 }}>Profiling failed</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 13, marginTop: 6 }}>{error}</div>
        </div>
      )}
      {profiles && profiles.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)' }}>
          {message || 'No data to profile. Run Download first.'}
        </div>
      )}
      {profiles && profiles.map(t => (
        <details key={t.name} open style={{ margin: '0 8px 16px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 8 }}>
          <summary style={{ cursor: 'pointer', padding: '10px 14px', fontWeight: 600 }}>
            {t.name} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>· {t.rows.toLocaleString()} rows · {t.columns.length} columns</span>
          </summary>
          <div style={{ padding: '0 14px 14px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-3)' }}>
                  <th style={{ padding: '6px 8px' }}>Column</th>
                  <th style={{ padding: '6px 8px' }}>Role</th>
                  <th style={{ padding: '6px 8px' }}>Missing</th>
                  <th style={{ padding: '6px 8px' }}>Distinct</th>
                  <th style={{ padding: '6px 8px' }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {t.columns.filter(c => c.role !== 'linkage').map(c => <ColumnRow key={c.name} c={c} />)}
              </tbody>
            </table>
            {t.correlations?.length > 0 && (
              <div style={{ marginTop: 10, color: 'var(--ink-3)', fontSize: 12.5 }}>
                Correlations: {t.correlations.map(p => `${p.a}↔${p.b} (r=${p.r.toFixed(2)})`).join('; ')}
              </div>
            )}
            {t.duplicates && (
              <div style={{ marginTop: 6, color: 'var(--warn, #b45309)', fontSize: 12.5 }}>
                {t.duplicates.duplicate_rows} rows share a duplicated {t.duplicates.id_col} across {t.duplicates.groups} group(s).
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Register the tab in `frontend/src/App.jsx`**

Add the import after the other page imports (after line 9):
```jsx
import Profile from './pages/Profile.jsx';
```
Add an entry to the `TABS` array — place it as a secondary tab just before the `templates` entry so the numbered pipeline (1–5) is unchanged:
```jsx
  { id: 'profile',     label: 'Profile',                           component: Profile, secondary: true },
```

- [ ] **Step 3: Verify the frontend builds**

Run:
```bash
cd /workspaces/databridge-cli/frontend && (test -d node_modules || npm install) && npm run build
```
Expected: Vite build completes with no errors (the new page compiles and `App.jsx` resolves the `Profile` import). There is no JS unit-test harness in this repo, so a clean production build is the verification gate.

- [ ] **Step 4: Confirm backend suite still green**

Run: `cd /workspaces/databridge-cli && PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass (no backend change in this task).

- [ ] **Step 5: Commit**

```bash
cd /workspaces/databridge-cli
git add frontend/src/pages/Profile.jsx frontend/src/App.jsx
git commit -m "feat(ui): add read-only Profile tab backed by /api/profile"
```

---

## Task 10: Document the profiling module

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a subsection to CLAUDE.md**

After the `### Base-table linkage columns (src/data/flatten.py)` subsection added in Layer 1, insert:

```markdown
### Data profiling (src/data/profile.py)
`profile_dataset(cfg, main_df, repeat_tables)` computes a deterministic, structured
EDA profile for every base table — per-column `role`, completeness, cardinality,
numeric stats + 3×IQR outliers, date ranges, low-cardinality top values, plus
per-table numeric correlations and duplicate-id info. It is the single source of
truth for these signals: `validate.py` (findings) and `summaries.py` (narrative)
derive their numbers from `profile.py`'s primitives (`null_stats`, `iqr_bounds`,
`numeric_outliers`, `correlations`). No LLM, no I/O.

`top_values` are computed only for low-cardinality columns (≤ `LOW_CARDINALITY_MAX`,
default 20) so the profile never surfaces individual free-text/PII values.

Exposed read-only at `GET /api/profile`; rendered in the **Profile** tab.
```

- [ ] **Step 2: Verify consistency with the code**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: full suite green — confirms the documented behavior matches the code.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the data profiling module and /api/profile"
```

---

## Self-review notes

- **Spec coverage:** profiling engine (Tasks 1-5) ✓; all base tables (Task 5) ✓; convergence + 3×IQR (Tasks 6-7) ✓; privacy-aware top_values (Task 3, `LOW_CARDINALITY_MAX`) ✓; `GET /api/profile` (Task 8) ✓; read-only Profile tab (Task 9) ✓; fail-soft (Task 3 try/except) ✓; docs (Task 10) ✓.
- **Type/name consistency:** `null_stats` returns `present/missing/missing_pct`; `numeric_outliers` returns `count/bounds/examples`; `correlations` returns `[{a,b,method,r}]`; `profile_table` returns `{name,rows,columns,correlations,duplicates}`; `profile_dataset` returns `{name: TableProfile}` and the endpoint serializes `list(.values())`. These names are used identically in the refactors (Tasks 6-7), endpoint (Task 8), and UI (Task 9).
- **Behavior change:** only `summaries.py` data_quality outlier count (1.5×→3×), pinned by the updated test in Task 7.
- **No placeholders:** every code/command step is complete. Frontend verified via production build (no JS test harness exists).
