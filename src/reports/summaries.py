"""
summaries.py — Named text summaries computed from downloaded data.

Each summary in config.yml produces a {{ summary_<name> }} placeholder
in the Word template, rendered as a text paragraph.

Supported stat types:
  distribution      : Top-N value breakdown sentence for one categorical column
  stats             : Descriptive statistics sentence for one numeric column
  crosstab          : Row × column breakdown for two categorical columns
  trend             : Time-series count or sum over a date column
  data_quality      : Completeness %, duplicate count, outlier flags per column
  keyword_frequency : Top-N word/token frequencies for one text column
  correlation       : Pearson or Spearman correlation pairs for numeric columns
  ai                : AI-generated paragraph (requires ai: config section)

Per-item scoping (optional on any summary):
  source : "main" (default) or a repeat-group path like "household/members"
  filter : pandas .query() expression applied before computing
  sample : limit to N random rows before computing

Common options: top_n, freq (trend), method (correlation), language (keyword_frequency|ai)
"""
import logging
import re
from typing import Dict, List, Optional
import pandas as pd

log = logging.getLogger(__name__)


def compute_summaries(
    summaries_cfg: List[Dict],
    df: pd.DataFrame,
    ai_cfg: Optional[Dict] = None,
    repeat_tables: Optional[Dict[str, pd.DataFrame]] = None,
) -> Dict[str, str]:
    """Return {"summary_<name>": "text", ...} for all configured summaries."""
    if repeat_tables is None:
        repeat_tables = {}
    context = {}
    for s in summaries_cfg:
        name = s.get("name")
        if not name:
            continue
        try:
            scoped_df = _resolve_source(s, df, repeat_tables)
            context[f"summary_{name}"] = _compute_summary(s, scoped_df, ai_cfg)
        except Exception as e:
            log.warning(f"Summary '{name}' failed: {e}")
            context[f"summary_{name}"] = "N/A"
    return context


def _resolve_source(s: Dict, main_df: pd.DataFrame, repeat_tables: Dict) -> pd.DataFrame:
    """Select, filter, and sample the DataFrame for one summary."""
    source = s.get("source")
    filter_expr = s.get("filter")
    sample_n = s.get("sample")

    if source and source != "main":
        df = repeat_tables.get(source)
        if df is None:
            log.warning(f"Summary source '{source}' not found — using main df")
            df = main_df
    else:
        df = main_df
        # Auto-detect: pick the DataFrame that best contains all requested columns.
        # Priority 1 — first DataFrame (main first, then repeat tables) that has ALL columns.
        # Priority 2 — fallback to max-hits when no single DataFrame has a clean match.
        if repeat_tables:
            questions = s.get("questions", [])
            if questions:
                candidates = [("main", main_df)] + list(repeat_tables.items())
                found_all = next(
                    (cdf for _, cdf in candidates if all(q in cdf.columns for q in questions)),
                    None,
                )
                if found_all is not None:
                    df = found_all
                else:
                    best_hits = sum(1 for q in questions if q in df.columns)
                    for rdf in repeat_tables.values():
                        hits = sum(1 for q in questions if q in rdf.columns)
                        if hits > best_hits:
                            best_hits = hits
                            df = rdf

    join_cols = s.get("join_parent")
    if join_cols and source and source != "main":
        from src.data.transform import join_repeat_to_main
        df = join_repeat_to_main(df, main_df, join_cols)

    if filter_expr:
        try:
            df = df.query(filter_expr)
        except Exception as e:
            log.warning(f"Summary filter '{filter_expr}' failed: {e} — skipped")

    if sample_n and len(df) > sample_n:
        df = df.sample(n=sample_n, random_state=42)

    return df


def _compute_summary(s: Dict, df: pd.DataFrame, ai_cfg: Optional[Dict]) -> str:
    stat = s.get("stat", "distribution")
    questions = s.get("questions", [])
    top_n = s.get("top_n", 5)

    # For data_quality, missing columns are part of the report — don't raise
    if stat != "data_quality":
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

    if stat == "data_quality":
        return _data_quality_text(df, questions if questions else list(df.columns))

    if stat == "keyword_frequency":
        if not questions:
            raise ValueError("stat 'keyword_frequency' requires at least one question")
        return _keyword_frequency_text(df[questions[0]], top_n, s.get("language", "en"))

    if stat == "correlation":
        if len(questions) < 2:
            raise ValueError("stat 'correlation' requires at least two questions")
        return _correlation_text(df, questions, s.get("method", "pearson"))

    if stat == "ai":
        return _ai_text(df, questions, s.get("prompt", ""), ai_cfg, s.get("language"), s.get("example"))

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
    example: Optional[str] = None,
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
        f"Write a summary in {lang} of the following data.\n"
        + (f"Focus: {prompt}\n" if prompt else "")
        + "\nDATA:\n"
        + "\n".join(data_lines)
        + (f"\n\nIMPORTANT: Your output must strictly follow this example — same format, same length, same structure. Only replace the values with those from the data above:\n{example}" if example else "")
        + "\n\nReturn only the output text — no headers, no JSON, no markdown."
    )
    system_prompt = (
        "You are a humanitarian data analyst. Write clear, professional text "
        "for a monitoring report. Be concise and data-driven."
        + (" When an example format is provided, it overrides all default style choices — match it exactly." if example else "")
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


def _data_quality_text(df: pd.DataFrame, questions: List[str]) -> str:
    """Report completeness, duplicates, and outliers for the given columns."""
    total = len(df)
    if total == 0:
        return "No data available."

    parts = [f"Total: {total:,} rows."]

    # Completeness per requested column
    completeness_parts = []
    for col in questions:
        if col not in df.columns:
            completeness_parts.append(f"{col} (missing column)")
            continue
        pct_complete = (df[col].notna().sum() / total) * 100
        completeness_parts.append(f"{col} {pct_complete:.1f}%")
    if completeness_parts:
        parts.append(f"Completeness: {', '.join(completeness_parts)}.")

    # Duplicates across the whole DataFrame
    dup_count = int(df.duplicated().sum())
    parts.append(f"Duplicate rows: {dup_count:,}.")

    # Outliers (IQR method) for numeric columns in the question list
    outlier_parts = []
    for col in questions:
        if col not in df.columns:
            continue
        numeric = pd.to_numeric(df[col], errors="coerce").dropna()
        if len(numeric) < 4:
            continue
        q1, q3 = numeric.quantile(0.25), numeric.quantile(0.75)
        iqr = q3 - q1
        if iqr == 0:
            continue
        n_outliers = int(((numeric < q1 - 1.5 * iqr) | (numeric > q3 + 1.5 * iqr)).sum())
        if n_outliers > 0:
            outlier_parts.append(f"{col}: {n_outliers} flagged")
    if outlier_parts:
        parts.append(f"Outliers (IQR): {', '.join(outlier_parts)}.")

    return " ".join(parts)


def _keyword_frequency_text(series: pd.Series, top_n: int, language: str = "en") -> str:
    """Return a sentence with the top-N most frequent words in a text column."""
    # Minimal built-in stop words for common languages
    _STOP_WORDS: Dict[str, set] = {
        "en": {"the","a","an","and","or","but","in","on","at","to","for","of","with",
               "is","are","was","were","be","been","have","has","had","i","you","we",
               "they","it","this","that","not","no","so","if","by","as","from","into"},
        "fr": {"le","la","les","un","une","des","de","du","et","ou","à","au","aux",
               "en","dans","sur","par","pour","avec","est","sont","être","avoir","que",
               "qui","il","elle","ils","elles","je","tu","nous","vous","se","ne","pas"},
        "ar": {"في","من","على","إلى","أن","هو","هي","هم","التي","الذي","وهو","هذا","هذه"},
        "es": {"el","la","los","las","un","una","de","del","al","en","y","o","pero",
               "que","por","para","con","se","es","son","a","su","sus"},
    }
    stop_words = _STOP_WORDS.get(language.lower(), _STOP_WORDS["en"])

    # Try to use nltk if available for richer stop words
    try:
        from nltk.corpus import stopwords as _sw
        import nltk
        lang_map = {"en": "english", "fr": "french", "ar": "arabic", "es": "spanish"}
        nltk_lang = lang_map.get(language.lower(), "english")
        try:
            stop_words = set(_sw.words(nltk_lang))
        except LookupError:
            nltk.download("stopwords", quiet=True)
            stop_words = set(_sw.words(nltk_lang))
    except ImportError:
        pass  # fall back to built-in list

    text = " ".join(series.dropna().astype(str).tolist()).lower()
    tokens = re.findall(r"[a-zA-ZÀ-ÿ\u0600-\u06FF]{3,}", text)
    freq: Dict[str, int] = {}
    for token in tokens:
        if token not in stop_words:
            freq[token] = freq.get(token, 0) + 1

    if not freq:
        return "No text data available."

    top = sorted(freq.items(), key=lambda x: x[1], reverse=True)[:top_n]
    items = ", ".join(f"{w} ({n:,})" for w, n in top)
    return f"Top {len(top)} words: {items}."


def _correlation_text(df: pd.DataFrame, questions: List[str], method: str = "pearson") -> str:
    """Narrate pairwise correlations between numeric columns."""
    numeric_cols = [q for q in questions if q in df.columns]
    if len(numeric_cols) < 2:
        return "Not enough numeric columns for correlation."

    nums = df[numeric_cols].apply(pd.to_numeric, errors="coerce")
    if nums.dropna(how="all").empty:
        return "No numeric data available."

    corr = nums.corr(method=method)
    sentences = []
    seen = set()
    for i, col_a in enumerate(numeric_cols):
        for col_b in numeric_cols[i + 1:]:
            pair = (col_a, col_b)
            if pair in seen:
                continue
            seen.add(pair)
            try:
                r = corr.loc[col_a, col_b]
            except KeyError:
                continue
            if pd.isna(r):
                continue
            abs_r = abs(r)
            if abs_r < 0.1:
                continue  # negligible — skip
            strength = (
                "very strong" if abs_r >= 0.8 else
                "strong" if abs_r >= 0.6 else
                "moderate" if abs_r >= 0.4 else
                "weak"
            )
            direction = "positive" if r > 0 else "negative"
            sentences.append(
                f"{col_a} \u2194 {col_b}: r={r:.2f} ({direction} {strength})"
            )

    if not sentences:
        return "No meaningful correlations found."
    return f"{method.capitalize()} correlations — " + ". ".join(sentences) + "."
