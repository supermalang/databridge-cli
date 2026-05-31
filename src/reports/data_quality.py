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
    """Numeric per-column row. Values are floats (0-100) or None when N/A."""
    ns = null_stats(s)
    total = ns["present"] + ns["missing"]
    completeness = (ns["present"] / total * 100) if total else None
    n = len(s)
    duplicate_rate = (s.duplicated(keep="first").sum() / n * 100) if n else None
    o = numeric_outliers(s)
    nums = pd.to_numeric(s, errors="coerce").dropna()
    outlier_rate = (o["count"] / len(nums) * 100) if (o["bounds"] is not None and len(nums)) else None
    return {"column": str(col), "completeness": completeness,
            "outlier_rate": outlier_rate, "duplicate_rate": duplicate_rate}


def compute_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                         repeat_tables: Optional[Dict] = None) -> Dict:
    """Numeric per-column completeness / outlier / duplicate rate for the main table.

    Shape: {"has_data": bool,
            "rows": [{"column": str, "completeness": float|None,
                      "outlier_rate": float|None, "duplicate_rate": float|None}, ...]}
    """
    if main_df is None or len(main_df) == 0:
        return {"has_data": False, "rows": []}
    rows: List[Dict] = []
    for col in _columns(cfg, main_df):
        try:
            rows.append(_column_row(col, main_df[col]))
        except Exception as e:  # noqa: BLE001 — one bad column must not sink the section
            log.warning(f"data_quality: column '{col}' failed: {e}")
            rows.append({"column": str(col), "completeness": None,
                         "outlier_rate": None, "duplicate_rate": None})
    return {"has_data": bool(rows), "rows": rows}


def _fmt(x: Optional[float]) -> str:
    return _pct(x) if x is not None else _DASH


def build_data_quality(cfg: Dict, main_df: Optional[pd.DataFrame],
                       repeat_tables: Optional[Dict] = None) -> Dict:
    """String-formatted DQ overview for the report's {{ data_quality }} section.

    Thin formatter over compute_data_quality: floats -> "95.0%", None -> "—".
    """
    numeric = compute_data_quality(cfg, main_df, repeat_tables)
    if not numeric["has_data"]:
        return {"has_data": False, "rows": []}
    rows = [{"column": r["column"],
             "completeness":   _fmt(r["completeness"]),
             "outlier_rate":   _fmt(r["outlier_rate"]),
             "duplicate_rate": _fmt(r["duplicate_rate"])}
            for r in numeric["rows"]]
    return {"has_data": True, "rows": rows}
