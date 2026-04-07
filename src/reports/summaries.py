"""
summaries.py — Named text summaries computed from downloaded data.

Each summary in config.yml produces a {{ summary_<name> }} placeholder
in the Word template, rendered as a text paragraph.

Supported stat types:
  distribution : Top-N value breakdown sentence for one categorical column
  stats        : Descriptive statistics sentence for one numeric column
  crosstab     : Row × column breakdown for two categorical columns
  trend        : Time-series count or sum over a date column
  ai           : AI-generated paragraph (requires ai: config section)

Common options: top_n, freq (trend), prompt (ai), language (ai)
"""
import logging
from typing import Dict, List, Optional
import pandas as pd

log = logging.getLogger(__name__)


def compute_summaries(
    summaries_cfg: List[Dict],
    df: pd.DataFrame,
    ai_cfg: Optional[Dict] = None,
) -> Dict[str, str]:
    """Return {"summary_<name>": "text", ...} for all configured summaries."""
    context = {}
    for s in summaries_cfg:
        name = s.get("name")
        if not name:
            continue
        try:
            context[f"summary_{name}"] = _compute_summary(s, df, ai_cfg)
        except Exception as e:
            log.warning(f"Summary '{name}' failed: {e}")
            context[f"summary_{name}"] = "N/A"
    return context


def _compute_summary(s: Dict, df: pd.DataFrame, ai_cfg: Optional[Dict]) -> str:
    stat = s.get("stat", "distribution")
    questions = s.get("questions", [])
    top_n = s.get("top_n", 5)

    missing = [q for q in questions if q not in df.columns]
    if missing:
        raise ValueError(f"columns not found: {missing}")

    if stat == "distribution":
        if not questions:
            raise ValueError("stat 'distribution' requires at least one question")
        return _distribution_text(df[questions[0]], top_n)

    if stat == "stats":
        if not questions:
            raise ValueError("stat 'stats' requires at least one question")
        return _stats_text(df[questions[0]])

    if stat == "crosstab":
        if len(questions) < 2:
            raise ValueError("stat 'crosstab' requires two questions")
        return _crosstab_text(df, questions[0], questions[1], top_n)

    if stat == "trend":
        if not questions:
            raise ValueError("stat 'trend' requires at least one question")
        freq = s.get("freq", "month")
        value_col = questions[1] if len(questions) > 1 else None
        return _trend_text(df, questions[0], freq, value_col)

    if stat == "ai":
        return _ai_text(df, questions, s.get("prompt", ""), ai_cfg, s.get("language"))

    raise ValueError(f"unknown stat '{stat}'")


# ── stat implementations ───────────────────────────────────────────────────────

def _distribution_text(series: pd.Series, top_n: int) -> str:
    series = series.dropna().astype(str)
    total = len(series)
    if total == 0:
        return "No data available."
    vc = series.value_counts().head(top_n)
    parts = [f"{v} ({c/total*100:.0f}%)" for v, c in vc.items()]
    lead = parts[0]
    rest = ", ".join(parts[1:])
    if rest:
        return f"Leading response: {lead}. Others: {rest}."
    return f"All responses: {lead}."


def _stats_text(series: pd.Series) -> str:
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        return "No numeric data available."
    n = len(numeric)
    mean = numeric.mean()
    median = numeric.median()
    mn = numeric.min()
    mx = numeric.max()
    return (
        f"n={n:,}, mean={mean:,.1f}, median={median:,.1f}, "
        f"range {mn:,.1f}\u2013{mx:,.1f}."
    )


def _crosstab_text(df: pd.DataFrame, q0: str, q1: str, top_n: int) -> str:
    ct = pd.crosstab(df[q0], df[q1])
    ct = ct.loc[ct.sum(axis=1).nlargest(top_n).index]
    sentences = []
    for row_label, row in ct.iterrows():
        row_total = row.sum()
        if row_total == 0:
            continue
        parts = [f"{col} {v/row_total*100:.0f}%" for col, v in row.items() if v > 0]
        sentences.append(f"{row_label}: {', '.join(parts[:5])}.")
    return " ".join(sentences) if sentences else "No data available."


def _trend_text(df: pd.DataFrame, date_col: str, freq: str, value_col: Optional[str]) -> str:
    freq_map   = {"day": "D", "week": "W", "month": "ME", "year": "YE"}
    label_fmt  = {"day": "%d %b", "week": "W%V %Y", "month": "%b %Y", "year": "%Y"}
    pd_freq    = freq_map.get(freq, "ME")
    fmt        = label_fmt.get(freq, "%b %Y")

    dates = pd.to_datetime(df[date_col], errors="coerce")
    if dates.isna().all():
        return "No date data available."

    tmp = df.copy()
    tmp["_date"] = dates
    tmp = tmp.dropna(subset=["_date"]).set_index("_date")

    if value_col:
        numeric = pd.to_numeric(tmp[value_col], errors="coerce")
        series = numeric.resample(pd_freq).sum().dropna()
        agg_label = "total"
    else:
        series = tmp.resample(pd_freq).size()
        agg_label = "submissions"

    if series.empty:
        return "No trend data available."

    parts = [f"{idx.strftime(fmt)} {int(v):,}" for idx, v in series.items()]
    return f"{freq.capitalize()} {agg_label}: {', '.join(parts)}."


def _ai_text(
    df: pd.DataFrame,
    questions: List[str],
    prompt: str,
    ai_cfg: Optional[Dict],
    language: Optional[str],
) -> str:
    if not ai_cfg:
        raise ValueError("stat 'ai' requires an ai: section in config.yml")

    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key not resolved — check your env variable")

    provider   = ai_cfg.get("provider", "openai").lower()
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = int(ai_cfg.get("max_tokens", 500))
    lang       = language or ai_cfg.get("language", "English")

    # Build a compact data snippet for the LLM
    data_lines = []
    for q in questions:
        if q not in df.columns:
            continue
        col = df[q].dropna()
        if col.empty:
            continue
        numeric = pd.to_numeric(col, errors="coerce").dropna()
        if len(numeric) > len(col) * 0.5:
            data_lines.append(
                f"{q}: n={len(numeric):,}, mean={numeric.mean():,.1f}, "
                f"median={numeric.median():,.1f}, "
                f"range {numeric.min():,.1f}\u2013{numeric.max():,.1f}"
            )
        else:
            vc = col.astype(str).value_counts().head(5)
            total = col.notna().sum()
            parts = [f"{v} ({c/total*100:.0f}%)" for v, c in vc.items()]
            data_lines.append(f"{q}: {', '.join(parts)}")

    user_prompt = (
        f"Write a concise paragraph in {lang} summarizing the following data.\n"
        + (f"Focus: {prompt}\n" if prompt else "")
        + "\nDATA:\n"
        + "\n".join(data_lines)
        + "\n\nReturn only the paragraph text — no headers, no JSON, no markdown."
    )
    system_prompt = (
        "You are a humanitarian data analyst. Write clear, professional narrative "
        "text for a monitoring report. Be concise and data-driven."
    )

    from src.reports.narrator import _call_openai, _call_anthropic

    if provider == "anthropic":
        raw = _call_anthropic(api_key, model, system_prompt, user_prompt, max_tokens)
    else:
        raw = _call_openai(
            api_key, model, system_prompt, user_prompt, max_tokens,
            base_url=ai_cfg.get("base_url"),
        )
    return raw.strip()
