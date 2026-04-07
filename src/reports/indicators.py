"""
Compute user-defined indicators from downloaded data.

Each indicator in config.yml produces a {{ ind_<name> }} placeholder
in the Word template, rendered as formatted text (not a chart image).

Supported stats:
  count          : number of non-null rows
  count_distinct : number of unique non-null values (e.g. 20 communes out of 100 submissions)
  sum            : total of numeric column
  mean           : average of numeric column
  median         : median of numeric column
  min / max      : min/max of numeric column
  percent        : % of rows where column == filter_value
  most_common    : most frequent value in column

Supported formats:
  number       : integer with thousands separator  → "4,832"
  decimal      : 1 decimal place                   → "4.2"
  percent      : appends %                         → "58.3%"
  text         : plain string                      → "Nouakchott"
"""
import logging
from typing import Dict, List
import pandas as pd

log = logging.getLogger(__name__)


def compute_indicators(indicators: List[Dict], df: pd.DataFrame) -> Dict[str, str]:
    """Return a dict of {ind_<name>: formatted_value} for all indicators."""
    context = {}
    for ind in indicators:
        name = ind.get("name")
        if not name:
            continue
        try:
            value = _compute(ind, df)
            context[f"ind_{name}"] = _format(value, ind.get("format", "number"), ind)
        except Exception as e:
            log.warning(f"Indicator '{name}' failed: {e}")
            context[f"ind_{name}"] = "N/A"
    return context


def _compute(ind: Dict, df: pd.DataFrame):
    stat = ind.get("stat", "count")
    question = ind.get("question")

    # dedup_by: deduplicate df by a key column before computing
    dedup_col = ind.get("dedup_by")
    if dedup_col:
        if dedup_col not in df.columns:
            raise ValueError(f"dedup_by column '{dedup_col}' not found in data")
        df = df.drop_duplicates(subset=[dedup_col], keep="first")

    if not question:
        # no question — just count rows
        return len(df)

    if question not in df.columns:
        raise ValueError(f"column '{question}' not found in data")

    series = df[question]

    if stat == "count":
        return series.notna().sum()

    if stat == "count_distinct":
        return series.dropna().nunique()

    if stat == "percent":
        filter_val = ind.get("filter_value")
        if filter_val is None:
            raise ValueError("stat 'percent' requires filter_value")
        total = series.notna().sum()
        if total == 0:
            return 0.0
        matched = (series.astype(str) == str(filter_val)).sum()
        return matched / total * 100

    if stat == "most_common":
        vc = series.dropna().value_counts()
        return str(vc.index[0]) if len(vc) else "N/A"

    # numeric stats
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        raise ValueError(f"no numeric data in column '{question}'")

    if stat == "sum":
        return numeric.sum()
    if stat == "mean":
        return numeric.mean()
    if stat == "median":
        return numeric.median()
    if stat == "min":
        return numeric.min()
    if stat == "max":
        return numeric.max()

    raise ValueError(f"unknown stat '{stat}'")


def _format(value, fmt: str, ind: Dict) -> str:
    decimals = ind.get("decimals", 1)
    if fmt == "percent":
        try:
            return f"{float(value):,.{decimals}f}%"
        except (TypeError, ValueError):
            return str(value)
    if fmt == "decimal":
        try:
            return f"{float(value):,.{decimals}f}"
        except (TypeError, ValueError):
            return str(value)
    if fmt == "text":
        return str(value)
    # default: number
    try:
        return f"{int(round(float(value))):,}"
    except (TypeError, ValueError):
        return str(value)
