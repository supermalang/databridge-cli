"""Data-quality overview for the report: per-column completeness / outlier /
duplicate rate, reusing src.data.profile primitives. Mirrors logframe.

Shape: {"has_data": bool,
        "rows": [{"column": str, "completeness": str, "outlier_rate": str, "duplicate_rate": str}, ...]}
Percentages are formatted strings ("95.0%"); outlier_rate is "—" for non-numeric columns.
"""
from __future__ import annotations
import logging
from typing import Dict, List, Optional
import pandas as pd

from src.data.profile import null_stats, numeric_outliers

log = logging.getLogger(__name__)

_DASH = "—"


def _pct(x: float) -> str:
    return f"{x:.1f}%"


def _columns(cfg: Dict, df: pd.DataFrame) -> List[str]:
    cols: List[str] = []
    for q in (cfg.get("questions") or []):
        col = q.get("export_label") or q.get("label") or q.get("kobo_key")
        if col and col in df.columns and col not in cols:
            cols.append(col)
    if not cols:
        cols = [c for c in df.columns if not str(c).startswith("_")]
    return cols


def _column_row(col: str, s: pd.Series) -> Dict:
    ns = null_stats(s)
    total = ns["present"] + ns["missing"]
    completeness = _pct(ns["present"] / total * 100) if total else _DASH
    n = len(s)
    duplicate_rate = _pct(s.duplicated(keep="first").sum() / n * 100) if n else _DASH
    o = numeric_outliers(s)
    nums = pd.to_numeric(s, errors="coerce").dropna()
    outlier_rate = _pct(o["count"] / len(nums) * 100) if (o["bounds"] is not None and len(nums)) else _DASH
    return {"column": str(col), "completeness": completeness,
            "outlier_rate": outlier_rate, "duplicate_rate": duplicate_rate}


def build_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                       repeat_tables: Optional[Dict] = None) -> Dict:
    """Per-column completeness / outlier / duplicate rate for the report's main table."""
    if main_df is None or len(main_df) == 0:
        return {"has_data": False, "rows": []}
    rows: List[Dict] = []
    for col in _columns(cfg, main_df):
        try:
            rows.append(_column_row(col, main_df[col]))
        except Exception as e:  # noqa: BLE001 — one bad column must not sink the section
            log.warning(f"data_quality: column '{col}' failed: {e}")
            rows.append({"column": str(col), "completeness": _DASH,
                         "outlier_rate": _DASH, "duplicate_rate": _DASH})
    return {"has_data": bool(rows), "rows": rows}
