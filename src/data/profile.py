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
