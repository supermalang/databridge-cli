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
