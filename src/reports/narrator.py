"""
narrator.py — LLM-powered narrative generation for report placeholders.

Fills {{ summary_text }}, {{ observations }}, {{ recommendations }} in the Word
template by calling an OpenAI-compatible or Anthropic API.

Returns a dict with the three keys; falls back to empty strings on any failure
or if no ai config is present.
"""
import json
import logging
import re
from typing import Any, Dict, List

import pandas as pd

log = logging.getLogger(__name__)

_EMPTY = {"summary_text": "", "observations": "", "recommendations": ""}


def generate_narrative(
    ai_cfg: Dict,
    report_cfg: Dict,
    df: "pd.DataFrame",
    stats_table: List[Dict],
    indicators: Dict[str, str],
    charts_cfg: List[Dict],
) -> Dict[str, str]:
    """
    Return {"summary_text": str, "observations": str, "recommendations": str}.
    Falls back to empty strings silently (with a warning) on any error.
    """
    if not ai_cfg:
        return _EMPTY

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = int(ai_cfg.get("max_tokens", 1500))

    # api_key is left as "env:..." when the env var was not set
    if not api_key or str(api_key).startswith("env:"):
        log.warning("AI narrative: api_key not resolved — skipping narrative generation.")
        return _EMPTY

    system_prompt = ai_cfg.get("custom_prompt") or _default_system_prompt()
    user_prompt   = _build_user_prompt(ai_cfg, report_cfg, df, stats_table, indicators, charts_cfg)

    try:
        if provider == "anthropic":
            raw = _call_anthropic(api_key, model, system_prompt, user_prompt, max_tokens)
        else:
            raw = _call_openai(
                api_key, model, system_prompt, user_prompt, max_tokens,
                base_url=ai_cfg.get("base_url"),
            )
        return _parse_response(raw)
    except Exception as exc:
        log.warning(f"AI narrative generation failed ({type(exc).__name__}: {exc}) — using empty strings.")
        return _EMPTY


# ── prompts ───────────────────────────────────────────────────────────────────

def _default_system_prompt() -> str:
    return (
        "You are an expert humanitarian data analyst and report writer. "
        "You will receive structured survey data and must produce clear, professional "
        "narrative text for a Word report. "
        "Always respond with valid JSON only — no markdown fences, no extra commentary. "
        'Return exactly: {"summary_text": "...", "observations": "...", "recommendations": "..."}'
    )


def _build_user_prompt(ai_cfg, report_cfg, df, stats_table, indicators, charts_cfg) -> str:
    language = ai_cfg.get("language", "English")
    lines = [
        f"Write narrative sections for a monitoring report in {language}.",
        f"Report title: {report_cfg.get('title', 'Report')}",
        f"Period: {report_cfg.get('period', '')}",
        f"Total submissions: {len(df):,}",
        "",
    ]

    if indicators:
        lines.append("KEY INDICATORS:")
        for key, val in indicators.items():
            label = key.replace("ind_", "").replace("_", " ").title()
            lines.append(f"  - {label}: {val}")
        lines.append("")

    if stats_table:
        lines.append("QUANTITATIVE STATISTICS:")
        for row in stats_table:
            lines.append(
                f"  - {row['label']}: n={row['n']}, mean={row['mean']}, "
                f"median={row['median']}, min={row['min']}, max={row['max']}"
            )
        lines.append("")

    # Categorical summaries — cap at 8 columns / 5 values to keep prompt bounded
    cat_cols = [c for c in df.columns if df[c].dtype == object][:8]
    if cat_cols:
        lines.append("CATEGORICAL DATA SUMMARIES (top values):")
        for col in cat_cols:
            vc = df[col].value_counts().head(5)
            total = df[col].notna().sum()
            if total:
                parts = [f"{v} ({c}, {c/total*100:.0f}%)" for v, c in vc.items()]
            else:
                parts = [f"{v} ({c})" for v, c in vc.items()]
            lines.append(f"  - {col}: {', '.join(parts)}")
        lines.append("")

    if charts_cfg:
        lines.append("CHARTS INCLUDED IN THIS REPORT:")
        for c in charts_cfg:
            lines.append(f"  - {c.get('title', c.get('name', ''))} ({c.get('type', '')})")
        lines.append("")

    lines += [
        "Based on the data above, write three sections:",
        "  1. summary_text: A 2–3 sentence executive summary.",
        "  2. observations: 3–5 bullet observations (use \\n• as bullet separator).",
        "  3. recommendations: 2–4 actionable recommendations (use \\n• as bullet separator).",
        "",
        'Return ONLY a JSON object with keys "summary_text", "observations", "recommendations".',
    ]
    return "\n".join(lines)


# ── callers ───────────────────────────────────────────────────────────────────

def _call_openai(api_key, model, system_prompt, user_prompt, max_tokens, base_url=None) -> str:
    try:
        from openai import OpenAI
    except ImportError:
        raise ImportError("openai package not installed. Run: pip install openai>=1.0.0")

    kwargs: Dict[str, Any] = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url

    client = OpenAI(**kwargs)
    resp = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        response_format={"type": "json_object"},
    )
    return resp.choices[0].message.content


def _call_anthropic(api_key, model, system_prompt, user_prompt, max_tokens) -> str:
    try:
        import anthropic
    except ImportError:
        raise ImportError("anthropic package not installed. Run: pip install anthropic>=0.20.0")

    client = anthropic.Anthropic(api_key=api_key)
    msg = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return msg.content[0].text


# ── parser ────────────────────────────────────────────────────────────────────

def _parse_response(raw: str) -> Dict[str, str]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if not match:
            log.warning("AI narrative: could not parse JSON from LLM response.")
            return _EMPTY
        try:
            data = json.loads(match.group())
        except json.JSONDecodeError:
            log.warning("AI narrative: malformed JSON in LLM response.")
            return _EMPTY
    return {
        "summary_text":    str(data.get("summary_text", "")),
        "observations":    str(data.get("observations", "")),
        "recommendations": str(data.get("recommendations", "")),
    }
