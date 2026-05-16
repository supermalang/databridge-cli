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


def find_numeric_outliers(df: pd.DataFrame, questions: List[Dict]) -> List[Dict]:
    """Flag rows where a quantitative column's value is outside [Q1 - 3*IQR, Q3 + 3*IQR].

    3*IQR (vs the textbook 1.5) is a deliberate choice: M&E surveys often have
    legitimate skew (e.g. population counts), and 1.5*IQR generates too much
    noise. 3*IQR catches the obviously-mistyped values (Age=999, NumStudents=-1).
    """
    if df is None or len(df) == 0:
        return []
    quant_cols = {q.get("export_label") for q in questions if q.get("category") == "quantitative"}
    findings: List[Dict] = []
    n = len(df)
    for col in df.columns:
        if col not in quant_cols:
            continue
        s = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(s) < 4:  # IQR needs enough data to be meaningful
            continue
        q1, q3 = s.quantile([0.25, 0.75])
        iqr = q3 - q1
        if iqr == 0:
            continue  # constant column — nothing to flag
        lo, hi = q1 - 3 * iqr, q3 + 3 * iqr
        outliers = s[(s < lo) | (s > hi)]
        count = int(len(outliers))
        if count == 0:
            continue
        pct = count / n
        sev = _severity_for_pct(pct) or "info"  # outliers always show, even at 1 row
        examples = outliers.head(5).tolist()
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "outlier_iqr",
            "message":  f"{count} value(s) outside [{lo:.1f}, {hi:.1f}] (3×IQR bounds)",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": examples,
        })
    return findings


def find_duplicates(df: pd.DataFrame) -> List[Dict]:
    """Flag rows that share an identifier column.

    Looks for canonical Kobo identifiers in this priority order:
      _uuid > _id > _index
    """
    if df is None or len(df) == 0:
        return []
    id_col = next((c for c in ("_uuid", "_id", "_index") if c in df.columns), None)
    if id_col is None:
        return []
    counts = df[id_col].value_counts()
    dup_ids = counts[counts > 1]
    if dup_ids.empty:
        return []
    affected_rows = int(dup_ids.sum())  # total rows involved in any duplicate group
    n = len(df)
    pct = affected_rows / n
    return [{
        "severity": "error",  # duplicated identifiers are always serious
        "column":   id_col,
        "kind":     "duplicate_id",
        "message":  f"{affected_rows} rows share a duplicated {id_col} across {len(dup_ids)} group(s)",
        "count":    affected_rows,
        "pct":      round(pct, 4),
        "examples": [str(v) for v in dup_ids.head(5).index.tolist()],
    }]


def find_type_issues(df: pd.DataFrame, questions: List[Dict]) -> List[Dict]:
    """Flag rows where a quantitative column holds a non-numeric, non-blank string.

    Distinguishes "broken data type" from "missing data": NaN and blank are
    handled by compute_missingness; this detector targets values like 'n/a',
    'TBD', '--', which suggest data entry sloppiness rather than absence.
    """
    if df is None or len(df) == 0:
        return []
    quant_cols = {q.get("export_label") for q in questions if q.get("category") == "quantitative"}
    findings: List[Dict] = []
    n = len(df)
    for col in df.columns:
        if col not in quant_cols:
            continue
        s = df[col]
        as_str = s.astype(str).str.strip()
        coerced = pd.to_numeric(as_str, errors="coerce")
        bad_mask = coerced.isna() & (as_str != "") & ~s.isna()
        count = int(bad_mask.sum())
        if count == 0:
            continue
        pct = count / n
        sev = _severity_for_pct(pct) or "info"
        examples = as_str[bad_mask].head(5).tolist()
        findings.append({
            "severity": sev,
            "column":   str(col),
            "kind":     "type_quantitative_nonnumeric",
            "message":  f"{count} non-numeric value(s) in a quantitative column",
            "count":    count,
            "pct":      round(pct, 4),
            "examples": examples,
        })
    return findings
