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

bar              | 1 categorical              | top_n, sort(value|label|none)
horizontal_bar   | 1 categorical              | top_n, sort  — best for long labels
stacked_bar      | 2 categorical [x, stack]   | top_n, normalize(true=100%)
grouped_bar      | 2 categorical [cat, group] | top_n, sort
pie              | 1 categorical              | top_n
donut            | 1 categorical              | top_n
line             | 1 date [+ 1 numeric]       | freq(day|week|month|year)
area             | 1 date [+ 1 numeric]       | freq
histogram        | 1 quantitative             | bins
scatter          | 2 quantitative             | xlabel, ylabel
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

Common OPTIONS (all types — go inside `options:`): width_inches, height_inches, color(hex), xlabel, ylabel
Dedup / multi (inside `options:`): distinct_by(col), expand_multi(true)
Scoping (TOP-LEVEL keys — NOT inside `options:`): filter("pandas query"), sample(int), source("repeat/path"|"view_name"), join_parent([cols])
Grouped aggregation OPTIONS (bar/horizontal_bar — inside `options:`): value_col(col), agg(sum|mean|count|max|min)
  — use value_col when the x-axis is a category and bars should show a numeric aggregate
    rather than row counts. Pair with a named view as source for pre-joined data.
"""


# ── Prompts (edit these to refine the model's behavior) ──────────────────────
# Or override at runtime by passing `system_prompt` / `user_prompt_template`
# to suggest_charts(), or by setting prompts.chart_suggester in config.yml.

SYSTEM_PROMPT = (
    "You are an expert data analyst and M&E specialist. "
    "Given a list of survey questions (with their categories and labels), "
    "you propose a complete, ready-to-use charts configuration for a monitoring report. "
    "You have access to the full chart type catalog below.\n\n"
    + _CHART_CATALOG
    + "\n\n"
    "Chart YAML shape — TOP-LEVEL keys vs OPTIONS:\n"
    "  Top-level keys (siblings of `name`, `type`, `questions`):\n"
    "    source, join_parent, filter, sample, aggregate\n"
    "  Inside `options:` (chart rendering parameters):\n"
    "    top_n, sort, normalize, freq, bins, target, scale, neutral, stat, columns,\n"
    "    male_value, female_value, basemap, color_by, size, color, width_inches,\n"
    "    height_inches, xlabel, ylabel, distinct_by, expand_multi, data_type,\n"
    "    value_col, agg\n"
    "  NEVER put source / join_parent / filter / sample / aggregate inside options.\n\n"
    "Rules:\n"
    "  - Use only column names that exist in the provided questions list (export_label values)\n"
    "  - Choose chart types that match the column categories (categorical, quantitative, date, etc.)\n"
    "  - Aim for 6–12 charts covering the most analytically meaningful questions\n"
    "  - Prioritise disaggregation (stacked_bar, grouped_bar, box_plot) over simple counts\n"
    "  - For each chart include: name, title, type, questions, and relevant options\n"
    "  - name must be snake_case, no spaces\n"
    "  - PREFER named views over raw repeat groups: if a NAMED VIEW exists that already\n"
    "    pre-joins or aggregates the data you need, set `source: <view_name>` and skip\n"
    "    join_parent / value_col / agg — the view has done that work. Only fall back to\n"
    "    raw repeat groups when no suitable view exists.\n"
    "  - Single-source rule: ALL questions in one chart must come from the SAME table —\n"
    "    either main, or a single repeat group (set source: to that repeat path), or a\n"
    "    single named view. NEVER mix columns from different repeat groups in one chart.\n"
    "    If a chart's columns naturally span sources, either split it into per-source\n"
    "    charts, or first define a view that joins/aggregates them and use source: <view>.\n"
    "  - When a chart uses a repeat-group source, parent-table categoricals used as the\n"
    "    x-axis or grouping dimension must be listed in join_parent: [...] (top-level).\n"
    "  - Return ONLY valid JSON: {\"charts\": [ ... ]} — no markdown, no explanation"
)

# Format slots: {header_line} {form_alias} {user_request_line}
#               {columns_block} {repeat_groups_block} {views_block} {existing_block}
# Each *_block / *_line is either "" or its filled-in content terminating with "\n\n".
USER_PROMPT_TEMPLATE = """\
{header_line}Form: {form_alias}

{user_request_line}{columns_block}{repeat_groups_block}{views_block}{existing_block}Suggest a charts: configuration block. Return JSON only."""


def suggest_charts(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
    system_prompt: str = SYSTEM_PROMPT,
    user_prompt_template: str = USER_PROMPT_TEMPLATE,
) -> List[Dict]:
    """Ask the LLM to propose a charts: config block from the questions in cfg.

    Args:
        cfg:                  full config dict (needs questions + ai sections)
        out_path:             if set, write the YAML block to this file path
        user_request:         optional free-text instruction from the end user
                              (e.g. "focus on geographic distribution")
        system_prompt:        defaults to module-level SYSTEM_PROMPT
        user_prompt_template: defaults to module-level USER_PROMPT_TEMPLATE

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
    charts = _get_suggestions(ai_cfg, cfg, system_prompt, user_prompt_template, user_request)
    log.info(f"Received {len(charts)} chart suggestion(s).")

    if out_path:
        _write_yaml(charts, out_path)
        log.info(f"Chart suggestions written → {out_path}")
    else:
        _print_yaml(charts)

    return charts


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, system_prompt: str, user_prompt_template: str, user_request: str = "") -> List[Dict]:
    from src.utils.prompts import system_prompt as _resolve_system, append_extra
    prompts_cfg = cfg.get("prompts", {})
    system = _resolve_system("chart_suggester", prompts_cfg, system_prompt)
    user   = append_extra(_user_prompt(cfg, user_prompt_template, user_request), "chart_suggester", prompts_cfg)

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


def _user_prompt(cfg: Dict, template: str = USER_PROMPT_TEMPLATE, user_request: str = "") -> str:
    questions = cfg.get("questions", [])
    form_alias = cfg.get("form", {}).get("alias", "survey")
    report_title = cfg.get("report", {}).get("title", "")

    header_line = f"Report: {report_title}\n" if report_title else ""
    user_request_line = (
        f"USER REQUEST (prioritise this when choosing charts): {user_request.strip()}\n\n"
        if user_request and user_request.strip() else ""
    )

    # Columns block — group questions by category for clarity
    by_cat: Dict[str, List[str]] = {}
    for q in questions:
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            by_cat.setdefault(cat, []).append(label)
    col_lines = []
    for cat in ("categorical", "quantitative", "date", "qualitative", "geographical", "undefined"):
        cols = by_cat.get(cat, [])
        if cols:
            col_lines.append(f"  {cat}: {', '.join(cols)}")
    columns_block = "AVAILABLE COLUMNS (by category):\n" + "\n".join(col_lines) + "\n\n" if col_lines else ""

    # Repeat groups block — LLM can suggest source: for those.
    # The canonical source: identifier is the full slash-path with "/" replaced by "_"
    # (this is what load_processed_data uses as repeat_tables keys).
    from src.data.transform import _repeat_path
    repeat_groups: Dict[str, List[str]] = {}
    for q in questions:
        rg = q.get("repeat_group")
        if rg:
            label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
            full_path = _repeat_path(q) or rg
            source_key = full_path.replace("/", "_")
            repeat_groups.setdefault(source_key, []).append(label)
    repeat_groups_block = ""
    if repeat_groups:
        rg_lines = [f"  source: {rg} — columns: {', '.join(cols)}" for rg, cols in repeat_groups.items()]
        repeat_groups_block = (
            "REPEAT GROUP COLUMNS (set source: <key> at the chart top level — exactly as printed):\n"
            + "\n".join(rg_lines) + "\n\n"
        )

    # Views block — pre-joined/aggregated tables the LLM can reference as source
    views = cfg.get("views", [])
    views_block = ""
    if views:
        v_lines = []
        for v in views:
            name = v.get("name", "")
            src  = v.get("source", "main")
            jp   = ", ".join(v.get("join_parent", []))
            gb   = v.get("group_by", "")
            q_v  = v.get("question", "")
            desc = f"source={src}"
            if jp:  desc += f", joined with: {jp}"
            if gb:  desc += f", grouped by: {gb}"
            if q_v: desc += f", aggregates {q_v} ({v.get('agg', 'sum')})"
            col_names = [cs.get("rename") or cs.get("name") for cs in v.get("columns", [])]
            if col_names:
                desc += f", columns: {', '.join(col_names)}"
            v_lines.append(f"  {name}: {desc}")
        v_lines.append("  Tip: for charts on an aggregated view (group_by + agg), the numeric column is already computed — for bar/horizontal_bar just set questions=[<group_by>, <numeric>] and the chart will plot the aggregated values. Do not re-specify value_col/agg/join_parent.")
        views_block = (
            "PREFERRED SOURCES — NAMED VIEWS (use source: <name> first; they pre-encode joins/aggs):\n"
            + "\n".join(v_lines) + "\n\n"
        )

    # Existing charts block — avoid duplicates
    existing = cfg.get("charts", [])
    existing_block = ""
    if existing:
        existing_names = [c.get("name") for c in existing]
        existing_block = f"Charts already configured (do not duplicate): {', '.join(existing_names)}\n\n"

    return template.format(
        header_line=header_line,
        form_alias=form_alias,
        user_request_line=user_request_line,
        columns_block=columns_block,
        repeat_groups_block=repeat_groups_block,
        views_block=views_block,
        existing_block=existing_block,
    )


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
    data = None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group())
            except json.JSONDecodeError:
                pass
    if data is None:
        log.warning("Could not parse JSON from LLM chart suggestions.")
        return []
    charts = data.get("charts", [])
    if not isinstance(charts, list):
        log.warning("LLM returned unexpected structure — expected {\"charts\": [...]}")
        return []
    return charts
