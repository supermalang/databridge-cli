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
from typing import Any, Dict, List, Optional

import pandas as pd

log = logging.getLogger(__name__)

_EMPTY = {"summary_text": "", "observations": "", "recommendations": ""}


# ── Prompts (edit these to refine the model's behavior) ──────────────────────
# Or override at runtime by passing `system_prompt` / `user_prompt_template`
# to generate_narrative(), or by setting prompts.narrator in config.yml.

SYSTEM_PROMPT = (
    "You are an expert humanitarian data analyst and report writer. "
    "You will receive structured survey data and must produce clear, professional "
    "narrative text for a Word report. "
    "Always respond with valid JSON only — no markdown fences, no extra commentary. "
    'Return exactly: {"summary_text": "...", "observations": "...", "recommendations": "..."}'
)

# Format slots: {language} {title} {period} {n_submissions}
#               {scope_line} {indicators_block} {stats_block}
#               {categorical_block} {summaries_block} {charts_block}
# Each *_block is either "" or "HEADER:\n  - item\n  ...\n\n".
USER_PROMPT_TEMPLATE = """\
Write narrative sections for a monitoring report in {language}.
Report title: {title}
Period: {period}
Total submissions: {n_submissions}
{scope_line}
{indicators_block}{stats_block}{categorical_block}{summaries_block}{charts_block}Based on the data above, write three sections:
  1. summary_text: A 2–3 sentence executive summary.
  2. observations: 3–5 bullet observations (use \\n• as bullet separator).
  3. recommendations: 2–4 actionable recommendations (use \\n• as bullet separator).

Return ONLY a JSON object with keys "summary_text", "observations", "recommendations"."""


def generate_narrative(
    ai_cfg: Dict,
    report_cfg: Dict,
    df: "pd.DataFrame",
    stats_table: List[Dict],
    indicators: Dict[str, str],
    charts_cfg: List[Dict],
    summaries: Optional[Dict[str, str]] = None,
    split_value: Optional[str] = None,
    questions_cfg: Optional[List[Dict]] = None,
    prompts_cfg: Optional[Dict] = None,
    system_prompt: str = SYSTEM_PROMPT,
    user_prompt_template: str = USER_PROMPT_TEMPLATE,
) -> Dict[str, str]:
    """
    Return {"summary_text": str, "observations": str, "recommendations": str}.
    Falls back to empty strings silently (with a warning) on any error.

    Args:
        summaries:             computed summary texts (summary_<name>: text) — fed into the
                               prompt so the LLM references actual distribution findings
        split_value:           when building a split report, the value being rendered
                               (e.g. "Kédougou") so the LLM knows it's site-specific
        questions_cfg:         questions list from config — used to label categorical columns
                               with their human-readable question labels instead of raw keys
        prompts_cfg:           cfg.get("prompts", {}) — admin YAML overrides; if present,
                               override `system_prompt` and append `extra` to the user prompt
        system_prompt:         system prompt string. Defaults to module-level SYSTEM_PROMPT
        user_prompt_template:  user prompt format string. Defaults to USER_PROMPT_TEMPLATE
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

    from src.utils.prompts import system_prompt as _resolve_system, append_extra
    system_prompt = _resolve_system("narrator", prompts_cfg, system_prompt)
    user_prompt   = _build_user_prompt(
        ai_cfg, report_cfg, df, stats_table, indicators, charts_cfg,
        summaries=summaries, split_value=split_value, questions_cfg=questions_cfg,
        template=user_prompt_template,
    )
    user_prompt   = append_extra(user_prompt, "narrator", prompts_cfg)

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


# ── user-prompt builder ──────────────────────────────────────────────────────

def _build_user_prompt(
    ai_cfg, report_cfg, df, stats_table, indicators, charts_cfg,
    summaries=None, split_value=None, questions_cfg=None,
    template: str = USER_PROMPT_TEMPLATE,
) -> str:
    language = ai_cfg.get("language", "English")

    scope_line = (
        f"Scope: this report covers data for '{split_value}' only."
        if split_value else ""
    )

    # Indicators block — group base names with their baseline/target/% achievement
    indicators_block = ""
    if indicators:
        base_keys = [k for k in indicators if not any(
            k.endswith(s) for s in ("_baseline", "_target", "_pct_achievement")
        )]
        items = []
        for key in base_keys:
            label = key.replace("ind_", "").replace("_", " ").title()
            val = indicators[key]
            extra = []
            baseline = indicators.get(f"{key}_baseline")
            target   = indicators.get(f"{key}_target")
            pct      = indicators.get(f"{key}_pct_achievement")
            if baseline: extra.append(f"baseline {baseline}")
            if target:   extra.append(f"target {target}")
            if pct:      extra.append(f"{pct} achieved")
            suffix = f" ({', '.join(extra)})" if extra else ""
            items.append(f"  - {label}: {val}{suffix}")
        indicators_block = "KEY INDICATORS:\n" + "\n".join(items) + "\n\n"

    # Quantitative stats block
    stats_block = ""
    if stats_table:
        items = [
            f"  - {row['label']}: n={row['n']}, mean={row['mean']}, "
            f"median={row['median']}, min={row['min']}, max={row['max']}"
            for row in stats_table
        ]
        stats_block = "QUANTITATIVE STATISTICS:\n" + "\n".join(items) + "\n\n"

    # Categorical block — use export labels, cap 8 cols / 5 values
    categorical_block = ""
    col_to_label = {}
    if questions_cfg:
        for q in questions_cfg:
            lbl = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
            if lbl:
                col_to_label[lbl] = lbl  # export_label IS the df column name
    cat_cols = [c for c in df.columns if df[c].dtype == object][:8]
    if cat_cols:
        items = []
        for col in cat_cols:
            display = col_to_label.get(col, col)
            vc = df[col].value_counts().head(5)
            total = df[col].notna().sum()
            if total:
                parts = [f"{v} ({cnt/total*100:.0f}%)" for v, cnt in vc.items()]
            else:
                parts = [f"{v}" for v, _ in vc.items()]
            items.append(f"  - {display}: {', '.join(parts)}")
        categorical_block = "CATEGORICAL DATA SUMMARIES (top values):\n" + "\n".join(items) + "\n\n"

    # Computed summaries block
    summaries_block = ""
    if summaries:
        relevant = {k: v for k, v in summaries.items() if v and v != "N/A"}
        if relevant:
            items = [
                f"  - {key.replace('summary_', '').replace('_', ' ').title()}: {text}"
                for key, text in relevant.items()
            ]
            summaries_block = "COMPUTED DATA SUMMARIES (reference these findings in your narrative):\n" + "\n".join(items) + "\n\n"

    # Charts block
    charts_block = ""
    if charts_cfg:
        items = []
        for c in charts_cfg:
            qs = ", ".join(c.get("questions", []))
            title = c.get("title", c.get("name", ""))
            ctype = c.get("type", "")
            items.append(f"  - {title} ({ctype}){f': {qs}' if qs else ''}")
        charts_block = "CHARTS INCLUDED IN THIS REPORT:\n" + "\n".join(items) + "\n\n"

    return template.format(
        language=language,
        title=report_cfg.get("title", "Report"),
        period=report_cfg.get("period", ""),
        n_submissions=f"{len(df):,}",
        scope_line=scope_line,
        indicators_block=indicators_block,
        stats_block=stats_block,
        categorical_block=categorical_block,
        summaries_block=summaries_block,
        charts_block=charts_block,
    )


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
