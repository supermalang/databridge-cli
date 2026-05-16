"""Data-quality detectors for the Validate tab.

Each detector returns a list of "finding" dicts with this shape:

    {
        "severity": "info" | "warning" | "error",
        "column":   str,         # export_label or "(row)"
        "kind":     str,         # detector identifier
        "message":  str,         # human one-liner
        "count":    int,         # rows affected
        "pct":      float,       # fraction affected, 0.0-1.0
        "examples": list,        # up to 5 sample bad values or row indices
    }
"""
from __future__ import annotations
from typing import Dict, List, Optional

import pandas as pd


# Severity thresholds, in fraction-of-rows-affected. Below INFO is omitted.
INFO_THRESHOLD    = 0.05   # 5%
WARNING_THRESHOLD = 0.20   # 20%
ERROR_THRESHOLD   = 0.50   # 50%


def _severity_for_pct(pct: float) -> Optional[str]:
    """Map a fraction to a severity bucket, or None if below the floor."""
    if pct >= ERROR_THRESHOLD:   return "error"
    if pct >= WARNING_THRESHOLD: return "warning"
    if pct >= INFO_THRESHOLD:    return "info"
    return None


def compute_missingness(df: pd.DataFrame) -> List[Dict]:
    """Per-column missingness. Empty strings and NaN both count as missing."""
    if df is None or len(df) == 0:
        return []
    n = len(df)
    findings: List[Dict] = []
    for col in df.columns:
        s = df[col]
        missing_mask = s.isna() | (s.astype(str).str.strip() == "")
        count = int(missing_mask.sum())
        if count == 0:
            continue
        pct = count / n
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
    return findings
