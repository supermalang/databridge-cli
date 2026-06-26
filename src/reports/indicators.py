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
  completeness   : % of present (non-blank, non-null) values in the question column
  outlier_rate   : % of a numeric column's values outside the 3×IQR fence (0 for non-numeric)
  duplicate_rate : % of rows that are redundant duplicates of the column's value
  grouped_agg    : two-step aggregation across a parent column — first aggregates
                   repeat rows per group (agg: sum|mean|count|max|min), then applies
                   outer_stat (sum|mean|count|max|min) to the resulting group values.
                   Requires group_by (use with join_parent to bring in parent columns).
                   e.g. "average total students across all departments":
                     source: villages, join_parent: [Departement],
                     group_by: Departement, agg: sum, outer_stat: mean

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
  direction    : "increase" (default, higher-is-better: value/target) or
                 "decrease" (lower-is-better: target/value). Affects pct_achievement only.
  Exposes extra placeholders: ind_<name>_baseline, ind_<name>_target, ind_<name>_pct_achievement

Disaggregation (optional):
  disaggregate_by : column name (str) or list of column names to group by.
  When present, in addition to the flat scalar ind_<name>, the engine also computes:
    ind_<name>_breakdown : list of {group, value, formatted} dicts (sorted by group key)
    ind_<name>_table     : plain-text fallback string ("Group: value\\n...")
  If a disaggregate_by column is not found, breakdown is set to [] and table to "N/A"
  (fail-soft); the overall scalar is still computed normally.
"""
import logging
from typing import Dict, List, Optional
import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

_DQ_NEEDS_QUESTION = {"completeness", "outlier_rate", "duplicate_rate"}


def compute_indicators(
    indicators: List[Dict],
    df: pd.DataFrame,
    repeat_tables: Optional[Dict[str, pd.DataFrame]] = None,
    per_period: Optional[Dict[str, Dict]] = None,
    per_form: Optional[Dict[str, Dict]] = None,
) -> Dict[str, str]:
    """Return a dict of {ind_<name>: formatted_value} for all indicators.

    When repeat_tables is provided, indicators can use `source:` to compute
    against a repeat-group DataFrame instead of the main table.

    per_period (optional): {period_slug: {"df": main_df, "repeat_tables": {...}, "label": "...", "is_baseline": bool}}
        When provided, each indicator is also computed against every period in per_period.
        The result populates `ind_<name>_p_<slug>` placeholders, plus `_delta` and `_pct_change`
        when a baseline period exists.

    per_form (optional, ME-4): {alias: {"df": main_df, "repeat_tables": {...}}}
        Multi-form bundle. An indicator may carry a `form:` selector naming the
        alias it reads from (e.g. `form: baseline` vs `form: endline`) — enabling
        pre/post and difference-in-differences. Absent `form:` (or absent
        per_form) → the positional ``df`` is used, so single-form is unchanged.
    """
    if repeat_tables is None:
        repeat_tables = {}
    context = {}
    for ind in indicators:
        name = ind.get("name")
        if not name:
            continue
        try:
            # ME-4: an indicator may select a form alias from the per_form bundle;
            # otherwise it reads the positional df (single-form, unchanged).
            base_df, base_repeats = df, repeat_tables
            form_alias = ind.get("form")
            if per_form and form_alias:
                bundle = per_form.get(form_alias)
                if bundle is None:
                    raise ValueError(
                        f"indicator '{name}' references unknown form '{form_alias}'"
                    )
                base_df = bundle["df"]
                base_repeats = bundle.get("repeat_tables", {})
            # Resolve data source for this indicator
            ind_df = _resolve_source(ind, base_df, base_repeats)
            value = _compute(ind, ind_df)
            fmt = ind.get("format", "number")
            context[f"ind_{name}"] = _format(value, fmt, ind)
            if ind.get("disaggregate_by"):
                try:
                    rows = _compute_breakdown(ind, ind_df, fmt)
                    context[f"ind_{name}_breakdown"] = rows
                    context[f"ind_{name}_table"] = _render_breakdown_table(rows)
                except Exception as e:
                    log.warning(f"Indicator '{name}' disaggregation failed: {e}")
                    context[f"ind_{name}_breakdown"] = []
                    context[f"ind_{name}_table"] = "N/A"
            if ind.get("framework_ref"):
                context[f"ind_{name}_framework_ref"] = ind["framework_ref"]

            if per_period:
                values_by_slug = {}
                for slug, bundle in per_period.items():
                    try:
                        p_df  = _resolve_source(ind, bundle["df"], bundle.get("repeat_tables", {}))
                        p_val = _compute(ind, p_df)
                        values_by_slug[slug] = p_val
                        context[f"ind_{name}_p_{slug}"] = _format(p_val, fmt, ind)
                    except Exception as e:
                        log.warning(f"Indicator '{name}' for period '{slug}' failed: {e}")
                        context[f"ind_{name}_p_{slug}"] = "N/A"

                # delta + pct change vs baseline period
                baseline_slug = next((s for s, b in per_period.items() if b.get("is_baseline")), None)
                if baseline_slug and baseline_slug in values_by_slug:
                    try:
                        base = float(values_by_slug[baseline_slug])
                        cur  = float(value)
                        context[f"ind_{name}_delta"] = _format(cur - base, fmt, ind)
                        if base != 0:
                            context[f"ind_{name}_pct_change"] = f"{((cur - base) / base) * 100:,.1f}%"
                        else:
                            context[f"ind_{name}_pct_change"] = "N/A"
                    except (TypeError, ValueError):
                        context[f"ind_{name}_delta"] = "N/A"
                        context[f"ind_{name}_pct_change"] = "N/A"

            # Baseline / target extra placeholders
            baseline = ind.get("baseline")
            target = ind.get("target")
            if baseline is not None:
                context[f"ind_{name}_baseline"] = _format(baseline, fmt, ind)
            if target is not None:
                context[f"ind_{name}_target"] = _format(target, fmt, ind)
            if target is not None and target != 0:
                direction = str(ind.get("direction", "increase")).lower()
                try:
                    v = float(value)
                    t = float(target)
                    if direction == "decrease":
                        pct = (t / v * 100) if v != 0 else None  # lower-is-better
                    else:
                        pct = v / t * 100                        # higher-is-better (default)
                    context[f"ind_{name}_pct_achievement"] = (
                        f"{pct:,.1f}%" if pct is not None else "N/A"
                    )
                    # RAG traffic-light status (ME-2): only when thresholds are set.
                    status = _rag_status(pct, ind.get("warning"), ind.get("critical"))
                    if status is not None:
                        context[f"ind_{name}_status"] = status
                except (TypeError, ValueError, ZeroDivisionError):
                    context[f"ind_{name}_pct_achievement"] = "N/A"
        except Exception as e:
            log.warning(f"Indicator '{name}' failed: {e}")
            context[f"ind_{name}"] = "N/A"
    return context


def build_equity_charts(cfg: Dict) -> List[Dict]:
    """Build disaggregation chart specs for the equity / inclusion lens (ME-1).

    One chart spec is produced per indicator x equity dimension, so a single
    ``equity_dimensions:`` config line yields a full disaggregation section in
    the report. Each spec is shaped like the rest of the chart engine
    (mirrors ``default_charts.default_charts_from_questions``):

        {"name", "title", "type", "questions"}

    The chart ``type`` is ``stacked_bar`` (a grouped/stacked categorical
    comparison across the equity dimension). The indicator's measured column and
    the equity dimension are both referenced in ``questions`` so the dimension
    drives the disaggregation.

    Returns ``[]`` when ``equity_dimensions`` is absent/empty OR there are no
    indicators — nothing to disaggregate.
    """
    from src.utils.periods import slugify

    dimensions = cfg.get("equity_dimensions") or []
    indicators = cfg.get("indicators") or []
    if not dimensions or not indicators:
        return []

    charts: List[Dict] = []
    used_names = set()
    for ind in indicators:
        ind_name = ind.get("name")
        if not ind_name:
            continue
        measure = ind.get("question") or ind_name
        for dim in dimensions:
            if not dim:
                continue
            base = slugify(f"equity_{ind_name}_{dim}") or f"equity_chart_{len(charts) + 1}"
            name, i = base, 2
            while name in used_names:
                name = f"{base}_{i}"
                i += 1
            used_names.add(name)
            charts.append({
                "name": name,
                "title": f"{ind_name} by {dim}",
                "type": "stacked_bar",
                "questions": [measure, dim],
            })
    return charts


def _rag_status(pct, warning, critical) -> Optional[str]:
    """RAG traffic-light status on the pct_achievement scale (ME-2).

    Returns None when no thresholds are configured. Otherwise:
        pct >= warning             -> "ok"       (green)
        critical <= pct < warning  -> "warning"  (amber)
        pct < critical             -> "critical" (red)

    Either threshold may be omitted; the missing band simply does not apply.
    """
    if warning is None and critical is None:
        return None
    if pct is None:
        return None
    try:
        p = float(pct)
    except (TypeError, ValueError):
        return None
    if warning is not None and p >= float(warning):
        return "ok"
    if critical is not None and p >= float(critical):
        return "warning"
    if critical is not None:
        return "critical"
    # only a warning threshold set and pct below it -> warning
    return "warning"


def build_traffic_light_table(indicators_cfg: List[Dict], indicators_context: Dict) -> Dict:
    """Build a red/amber/green progress table for the report (ME-2).

    One row per indicator that defines a ``target``. Each row carries the
    formatted baseline / target / actual / pct values from the indicators
    context, plus the RAG ``status`` (defaults to "ok" when no thresholds set).

    Returns ``{"rows": [{indicator, baseline, target, actual, pct, status}, ...]}``.
    """
    rows: List[Dict] = []
    for ind in indicators_cfg:
        name = ind.get("name")
        if not name or ind.get("target") is None:
            continue
        rows.append({
            "indicator": name,
            "baseline":  indicators_context.get(f"ind_{name}_baseline", "—"),
            "target":    indicators_context.get(f"ind_{name}_target", "—"),
            "actual":    indicators_context.get(f"ind_{name}", "—"),
            "pct":       indicators_context.get(f"ind_{name}_pct_achievement", "—"),
            "status":    indicators_context.get(f"ind_{name}_status", "ok"),
        })
    return {"rows": rows}


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

    join_cols = ind.get("join_parent")
    if join_cols and source and source != "main":
        from src.data.transform import join_repeat_to_main
        df = join_repeat_to_main(df, main_df, join_cols)

    if filter_expr:
        try:
            from src.data.transform import safe_query
            df = safe_query(df, filter_expr)
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

    if stat in _DQ_NEEDS_QUESTION and not (question or questions):
        raise ValueError(f"{stat} requires a question/column")

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

    if stat == "grouped_agg":
        group_by = ind.get("group_by")
        if not group_by:
            raise ValueError("stat 'grouped_agg' requires 'group_by'")
        if group_by not in df.columns:
            raise ValueError(f"group_by column '{group_by}' not found — did you forget join_parent?")
        agg_fn = ind.get("agg", "sum")
        outer_stat = ind.get("outer_stat", "sum")
        numeric = pd.to_numeric(series, errors="coerce")
        grouped = numeric.groupby(df[group_by]).agg(agg_fn).dropna()
        outer_ops = {"sum": grouped.sum, "mean": grouped.mean,
                     "count": grouped.count, "max": grouped.max, "min": grouped.min}
        if outer_stat not in outer_ops:
            raise ValueError(f"unknown outer_stat '{outer_stat}' — use sum|mean|count|max|min")
        return outer_ops[outer_stat]()

    if stat == "completeness":
        from src.data.profile import null_stats
        ns = null_stats(series)
        total = ns["present"] + ns["missing"]
        return (ns["present"] / total * 100) if total else 0.0

    if stat == "outlier_rate":
        from src.data.profile import numeric_outliers
        nums = pd.to_numeric(series, errors="coerce").dropna()
        n = len(nums)
        return (numeric_outliers(series)["count"] / n * 100) if n else 0.0

    if stat == "duplicate_rate":
        n = len(series)
        return (series.duplicated(keep="first").sum() / n * 100) if n else 0.0

    # numeric stats
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        label = str(questions or question)
        raise ValueError(f"no numeric data in column(s) '{label}'")

    if stat == "sum":
        return numeric.sum()
    if stat == "mean":
        weight_col = ind.get("weight_column")
        if weight_col:
            if weight_col not in df.columns:
                raise ValueError(f"weight_column '{weight_col}' not found in data")
            weights = pd.to_numeric(df[weight_col], errors="coerce")
            # Align on index and keep only rows where BOTH value and weight are numeric.
            vals = pd.to_numeric(series, errors="coerce")
            paired = pd.DataFrame({"v": vals, "w": weights}).dropna()
            if paired.empty or paired["w"].sum() == 0:
                raise ValueError(f"no weighted data in column '{question}' with weights '{weight_col}'")
            return float(np.average(paired["v"], weights=paired["w"]))
        return numeric.mean()
    if stat == "median":
        return numeric.median()
    if stat == "min":
        return numeric.min()
    if stat == "max":
        return numeric.max()

    raise ValueError(f"unknown stat '{stat}'")


def _compute_breakdown(ind: Dict, ind_df: pd.DataFrame, fmt: str) -> List[Dict]:
    """Compute the indicator's stat per group of its disaggregate_by column(s).
    Returns a list of {group, value, formatted} rows (sorted by group key)."""
    dis = ind.get("disaggregate_by")
    cols = [dis] if isinstance(dis, str) else list(dis)
    missing = [c for c in cols if c not in ind_df.columns]
    if missing:
        raise ValueError(f"disaggregate_by column(s) not found in data: {missing}")
    rows: List[Dict] = []
    for key, group_df in ind_df.groupby(cols, dropna=False, sort=True):
        if isinstance(key, tuple):
            label = " / ".join("(blank)" if pd.isna(k) else str(k) for k in key)
        else:
            label = "(blank)" if pd.isna(key) else str(key)
        val = _compute(ind, group_df)
        rows.append({"group": label, "value": val, "formatted": _format(val, fmt, ind)})
    return rows


def _render_breakdown_table(rows: List[Dict]) -> str:
    """Plain-text fallback: one 'group: formatted' line per breakdown row."""
    return "\n".join(f"{r['group']}: {r['formatted']}" for r in rows)


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
