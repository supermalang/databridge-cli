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
from src.data.profile import null_stats, numeric_outliers


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
        ns = null_stats(df[col])
        count = ns["missing"]
        if count == 0:
            continue
        pct = count / n            # raw — matches original severity behavior
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


# Regex-style word fragments that strongly suggest a column holds PII.
# Match case-insensitive on the whole column name string.
_PII_PATTERNS = [
    "name", "phone", "tel", "mobile", "email", "address",
    "gps", "lat", "lon", "coord", "geo",
    "id_number", "national_id", "passport",
    "dob", "birth", "age_exact",
]


def find_potential_pii(df: pd.DataFrame, questions: List[Dict]) -> List[Dict]:
    """Suggest columns that LOOK like PII based on their column name."""
    if df is None or len(df) == 0:
        return []
    findings: List[Dict] = []
    for col in df.columns:
        lower = str(col).lower()
        if any(p in lower for p in _PII_PATTERNS):
            findings.append({
                "severity": "info",
                "column":   str(col),
                "kind":     "potential_pii",
                "message":  f"Column '{col}' looks like it may contain PII — consider adding it to pii.redact",
                "count":    int(len(df)),
                "pct":      1.0,
                "examples": [],
            })
    return findings


def find_orphan_framework_refs(cfg: Dict) -> List[Dict]:
    """Flag indicators whose `framework_ref` points to a non-existent node.

    Returns [] when no framework is configured (nothing to validate against).
    """
    from src.utils.framework import validate_refs
    orphans = validate_refs(cfg)
    if not orphans:
        return []
    return [
        {
            "severity": "warning",
            "column":   o["indicator"],
            "kind":     "orphan_framework_ref",
            "message":  f"Indicator '{o['indicator']}' references framework node '{o['ref']}' which doesn't exist",
            "count":    1,
            "pct":      0.0,
            "examples": [o["ref"]],
        }
        for o in orphans
    ]


def validate_dataset(cfg: Dict, df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Run all detectors against the main DataFrame and return a report envelope.

    repeat_tables is accepted for forward-compatibility (a future detector pass
    will surface findings across repeat groups) but is unused in the MVP.
    """
    questions = cfg.get("questions", []) or []
    if df is None:
        df = pd.DataFrame()

    findings: List[Dict] = []
    findings += compute_missingness(df)
    findings += find_numeric_outliers(df, questions)
    findings += find_duplicates(df)
    findings += find_type_issues(df, questions)
    findings += find_orphan_framework_refs(cfg)
    pii_findings = find_potential_pii(df, questions)
    declared_pii_cols = {r.get("column") for r in (cfg.get("pii", {}).get("redact") or [])}
    findings += [f for f in pii_findings if f["column"] not in declared_pii_cols]

    # Sort: errors first, then warnings, then info; within a tier, larger count first.
    severity_rank = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda f: (severity_rank.get(f["severity"], 9), -f["count"]))

    summary = {"error": 0, "warning": 0, "info": 0}
    for f in findings:
        if f["severity"] in summary:
            summary[f["severity"]] += 1

    return {
        "n_rows":    int(len(df)),
        "n_columns": int(df.shape[1]),
        "checks":    findings,
        "summary":   summary,
    }
