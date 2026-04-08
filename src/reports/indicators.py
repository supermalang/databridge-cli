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

Per-item scoping (optional):
  source       : "main" (default) or a repeat-group path like "household/members"
  filter       : pandas .query() expression applied before computing
  sample       : limit to N random rows before computing

Baseline / target (optional):
  baseline     : previous measurement value (numeric)
  target       : goal value (numeric)
  Exposes extra placeholders: ind_<name>_baseline, ind_<name>_target, ind_<name>_pct_achievement
"""
import logging
from typing import Dict, List, Optional
import pandas as pd

log = logging.getLogger(__name__)


def compute_indicators(
    indicators: List[Dict],
    df: pd.DataFrame,
    repeat_tables: Optional[Dict[str, pd.DataFrame]] = None,
) -> Dict[str, str]:
    """Return a dict of {ind_<name>: formatted_value} for all indicators.

    When repeat_tables is provided, indicators can use `source:` to compute
    against a repeat-group DataFrame instead of the main table.
    """
    if repeat_tables is None:
        repeat_tables = {}
    context = {}
    for ind in indicators:
        name = ind.get("name")
        if not name:
            continue
        try:
            # Resolve data source for this indicator
            ind_df = _resolve_source(ind, df, repeat_tables)
            value = _compute(ind, ind_df)
            fmt = ind.get("format", "number")
            context[f"ind_{name}"] = _format(value, fmt, ind)

            # Baseline / target extra placeholders
            baseline = ind.get("baseline")
            target = ind.get("target")
            if baseline is not None:
                context[f"ind_{name}_baseline"] = _format(baseline, fmt, ind)
            if target is not None:
                context[f"ind_{name}_target"] = _format(target, fmt, ind)
            if target is not None and target != 0:
                try:
                    pct = float(value) / float(target) * 100
                    context[f"ind_{name}_pct_achievement"] = f"{pct:,.1f}%"
                except (TypeError, ValueError):
                    context[f"ind_{name}_pct_achievement"] = "N/A"
        except Exception as e:
            log.warning(f"Indicator '{name}' failed: {e}")
            context[f"ind_{name}"] = "N/A"
    return context


def _resolve_source(ind: Dict, main_df: pd.DataFrame, repeat_tables: Dict) -> pd.DataFrame:
    """Select and scope the DataFrame for one indicator."""
    source = ind.get("source")
    filter_expr = ind.get("filter")
    sample_n = ind.get("sample")

    if source and source != "main":
        df = repeat_tables.get(source)
        if df is None:
            log.warning(f"Indicator source '{source}' not found — using main df")
            df = main_df
    else:
        df = main_df

    if filter_expr:
        try:
            df = df.query(filter_expr)
        except Exception as e:
            log.warning(f"Indicator filter '{filter_expr}' failed: {e} — skipped")

    if sample_n and len(df) > sample_n:
        df = df.sample(n=sample_n, random_state=42)

    return df


def _compute(ind: Dict, df: pd.DataFrame):
    stat = ind.get("stat", "count")
    question = ind.get("question")
    questions = ind.get("questions")  # multi-column path

    # dedup_by: deduplicate df by a key column before computing
    dedup_col = ind.get("dedup_by")
    if dedup_col:
        if dedup_col not in df.columns:
            raise ValueError(f"dedup_by column '{dedup_col}' not found in data")
        df = df.drop_duplicates(subset=[dedup_col], keep="first")

    if not questions and not question:
        # no question — just count rows
        return len(df)

    if questions:
        # Multi-column path: combine columns row-wise, then apply stat
        missing = [q for q in questions if q not in df.columns]
        if missing:
            raise ValueError(f"columns not found in data: {missing}")
        combine = ind.get("combine", "sum")
        cols = df[questions].apply(pd.to_numeric, errors="coerce")
        combine_ops = {"sum": cols.sum, "mean": cols.mean, "min": cols.min, "max": cols.max}
        if combine not in combine_ops:
            raise ValueError(f"unknown combine '{combine}' — use sum|mean|min|max")
        series = combine_ops[combine](axis=1)
    else:
        # Single-column path (original behaviour)
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
        label = str(questions or question)
        raise ValueError(f"no numeric data in column(s) '{label}'")

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
