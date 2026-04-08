"""
ai_chart_suggester.py — LLM-powered chart configuration suggester.

Given the questions in config.yml, asks the LLM to propose a complete
charts: block ready to paste into config.yml. The LLM receives the full
chart type catalog (with column type requirements and key options) so it
can make grounded, specific suggestions rather than generic ones.

Called by the suggest-charts CLI command.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import yaml

log = logging.getLogger(__name__)

# Full catalog passed verbatim to the LLM so it knows exactly what's available.
_CHART_CATALOG = """
CHART TYPE CATALOG
==================
Each entry: type | requires | key options | notes

bar              | 1 categorical              | top_n, sort(value|label|none), color, group_by
horizontal_bar   | 1 categorical              | top_n, sort, color, group_by  — best for long labels
stacked_bar      | 2 categorical [x, stack]   | top_n, normalize(true=100%)
grouped_bar      | 2 categorical [cat, group] | top_n, sort
pie              | 1 categorical              | top_n
donut            | 1 categorical              | top_n
line             | 1 date [+ 1 numeric]       | freq(day|week|month|year)
area             | 1 date [+ 1 numeric]       | freq
histogram        | 1 quantitative             | bins, group_by
scatter          | 2 quantitative             | color, xlabel, ylabel
box_plot         | 1 quantitative + 1 cat     | top_n  — distribution per group
heatmap          | 2 categorical              | top_n  — frequency matrix
treemap          | 1 categorical              | top_n
waterfall        | 1 categorical              | top_n, sort
funnel           | 1 categorical              | top_n  — ordered pipeline stages
table            | 1 categorical              | top_n  — renders as PNG table
bullet_chart     | 1 quantitative             | target(REQUIRED int)
likert           | 1 categorical (scale)      | scale([list of ordered labels]), neutral
scorecard        | 1+ any                     | stat(count|mean|sum), columns(int)
pyramid          | age_group + gender cols    | male_value, female_value
dot_map          | lat + lon cols             | basemap(true/false), color_by, size

Common options (all types): width_inches, height_inches, xlabel, ylabel
Dedup / multi: distinct_by(col), expand_multi(true)
Scoping: filter("pandas query"), sample(int), source("repeat/path"), join_parent([cols])
"""


def suggest_charts(cfg: Dict, out_path: Optional[str] = None) -> List[Dict]:
    """Ask the LLM to propose a charts: config block from the questions in cfg.

    Args:
        cfg:      full config dict (needs questions + ai sections)
        out_path: if set, write the YAML block to this file path

    Returns:
        List of chart config dicts ready to be merged into cfg["charts"].
    """
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise ValueError("No ai: section in config.yml. Configure AI first.")

    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key not resolved — check your env variable.")

    questions = cfg.get("questions", [])
    if not questions:
        raise ValueError("No questions in config.yml. Run fetch-questions first.")

    log.info("Requesting chart suggestions from LLM…")
    charts = _get_suggestions(ai_cfg, cfg)
    log.info(f"Received {len(charts)} chart suggestion(s).")

    if out_path:
        _write_yaml(charts, out_path)
        log.info(f"Chart suggestions written → {out_path}")
    else:
        _print_yaml(charts)

    return charts


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict) -> List[Dict]:
    system = _system_prompt()
    user   = _user_prompt(cfg)

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 3000)

    if provider == "anthropic":
        raw = _call_anthropic(api_key, model, system, user, max_tokens)
    else:
        raw = _call_openai(api_key, model, system, user, max_tokens,
                           base_url=ai_cfg.get("base_url"))

    return _parse(raw)


def _system_prompt() -> str:
    return (
        "You are an expert data analyst and M&E specialist. "
        "Given a list of survey questions (with their categories and labels), "
        "you propose a complete, ready-to-use charts configuration for a monitoring report. "
        "You have access to the full chart type catalog below.\n\n"
        + _CHART_CATALOG
        + "\n\n"
        "Rules:\n"
        "  - Use only column names that exist in the provided questions list (export_label values)\n"
        "  - Choose chart types that match the column categories (categorical, quantitative, date, etc.)\n"
        "  - Aim for 6–12 charts covering the most analytically meaningful questions\n"
        "  - Prioritise disaggregation (stacked_bar, grouped_bar, box_plot) over simple counts\n"
        "  - For each chart include: name, title, type, questions, and relevant options\n"
        "  - name must be snake_case, no spaces\n"
        "  - Return ONLY valid JSON: {\"charts\": [ ... ]} — no markdown, no explanation"
    )


def _user_prompt(cfg: Dict) -> str:
    questions = cfg.get("questions", [])
    form_alias = cfg.get("form", {}).get("alias", "survey")
    report_title = cfg.get("report", {}).get("title", "")

    lines = []
    if report_title:
        lines.append(f"Report: {report_title}")
    lines.append(f"Form: {form_alias}")
    lines.append("")

    # Group questions by category for clarity
    by_cat: Dict[str, List[str]] = {}
    for q in questions:
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            by_cat.setdefault(cat, []).append(label)

    lines.append("AVAILABLE COLUMNS (by category):")
    for cat in ("categorical", "quantitative", "date", "qualitative", "geographical", "undefined"):
        cols = by_cat.get(cat, [])
        if cols:
            lines.append(f"  {cat}: {', '.join(cols)}")
    lines.append("")

    # Repeat groups — LLM can suggest source: for those
    repeat_groups: Dict[str, List[str]] = {}
    for q in questions:
        rg = q.get("repeat_group")
        if rg:
            label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
            repeat_groups.setdefault(rg, []).append(label)
    if repeat_groups:
        lines.append("REPEAT GROUP COLUMNS (use source: 'group/path' to access):")
        for rg, cols in repeat_groups.items():
            lines.append(f"  {rg}: {', '.join(cols)}")
        lines.append("")

    # Existing charts — avoid duplicates
    existing = cfg.get("charts", [])
    if existing:
        existing_names = [c.get("name") for c in existing]
        lines.append(f"Charts already configured (do not duplicate): {', '.join(existing_names)}")
        lines.append("")

    lines.append("Suggest a charts: configuration block. Return JSON only.")
    return "\n".join(lines)


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(charts: List[Dict], path: str) -> None:
    block = yaml.dump({"charts": charts}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(charts: List[Dict]) -> None:
    print("\n# ── AI-suggested charts — paste into config.yml ──────────────────\n")
    print(yaml.dump({"charts": charts}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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

def _parse(raw: str) -> List[Dict]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                pass
        log.warning("Could not parse JSON from LLM chart suggestions.")
        return []
    charts = data.get("charts", [])
    if not isinstance(charts, list):
        log.warning("LLM returned unexpected structure — expected {\"charts\": [...]}")
        return []
    return charts
