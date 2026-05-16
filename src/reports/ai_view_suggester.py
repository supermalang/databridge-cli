"""
ai_view_suggester.py — LLM-powered views configuration suggester.

Given the questions, repeat groups, and existing charts in config.yml, asks
the LLM to propose 3-6 useful views: virtual tables that pre-join parent
categoricals into repeat groups, aggregate per-group totals, or stitch
together cross-source data so charts can use a single named source.

Called by the suggest-views CLI command.
"""
import json
import logging
import re
from typing import Any, Dict, List, Optional

import yaml

log = logging.getLogger(__name__)


# ── Prompts ──────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a data engineer designing virtual tables (views) for a survey reporting pipeline. "
    "Views let charts and summaries reference a single named source instead of doing joins/aggregations inline. "
    "Given the survey's main columns, repeat groups, existing views, and existing charts, propose 3-6 named views "
    "that unlock common analyses.\n\n"
    "View YAML shape (top-level keys, NOT inside an options block):\n"
    "  name:        snake_case identifier — referenced by charts as `source: <name>`\n"
    "  source:      'main' OR an exact repeat-group key (printed below)\n"
    "  join_parent: [parent_col_name, ...]  (optional; only valid when source != 'main')\n"
    "                bring main-table columns into a repeat-group view for slicing\n"
    "  filter:      pandas .query() expression  (optional)\n"
    "  group_by:    column name to group on  (optional — turns the view into an aggregated table)\n"
    "  question:    numeric column to aggregate (required if group_by is set)\n"
    "  agg:         sum | mean | count | max | min  (default sum)\n\n"
    "What makes a good view (aim for a mix):\n"
    "  - Repeat + parent slicer: a repeat group with key parent categoricals joined in\n"
    "    (e.g. source=demographic_repeat, join_parent=[Wilaya, Moughataa, Village])\n"
    "  - Per-group aggregate: same as above but with group_by + question + agg\n"
    "    (e.g. group_by=Wilaya, question=Nombre d'habitants, agg=sum → one row per Wilaya)\n"
    "  - Filtered subset: rows of one source matching a meaningful condition\n"
    "    (e.g. filter=\"Nombre de ménages > 0\")\n"
    "  - Cross-source bridge: when multiple repeat groups need to be analyzed together,\n"
    "    propose per-source aggregated views that share a common key (e.g. Wilaya),\n"
    "    so downstream charts can use either independently\n\n"
    "Rules:\n"
    "  - source: must be EXACTLY one of the keys printed in the REPEAT GROUPS block, or 'main'\n"
    "  - join_parent, group_by, question must be exact column names from the lists below\n"
    "  - Avoid duplicating any existing view (listed below)\n"
    "  - Each view's name must be snake_case and unique\n"
    "  - Return ONLY valid JSON: {\"views\": [ ... ]} — no markdown, no explanation"
)

# Format slots: {header_line} {form_alias} {user_request_line}
#               {main_cols_block} {repeat_groups_block} {existing_views_block} {existing_charts_block}
USER_PROMPT_TEMPLATE = """\
{header_line}Form: {form_alias}

{user_request_line}{main_cols_block}{repeat_groups_block}{existing_views_block}{existing_charts_block}Suggest a views: configuration block. Return JSON only."""


def suggest_views(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
    system_prompt: str = SYSTEM_PROMPT,
    user_prompt_template: str = USER_PROMPT_TEMPLATE,
) -> List[Dict]:
    """Ask the LLM to propose a views: config block from the questions in cfg."""
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise ValueError("No ai: section in config.yml. Configure AI first.")
    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key not resolved — check your env variable.")
    if not cfg.get("questions"):
        raise ValueError("No questions in config.yml. Run fetch-questions first.")

    log.info("Requesting view suggestions from LLM…")
    views = _get_suggestions(ai_cfg, cfg, system_prompt, user_prompt_template, user_request)
    log.info(f"Received {len(views)} view suggestion(s).")

    if out_path:
        _write_yaml(views, out_path)
        log.info(f"View suggestions written → {out_path}")
    else:
        _print_yaml(views)
    return views


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, system_prompt: str, user_prompt_template: str, user_request: str = "") -> List[Dict]:
    from src.utils.prompts import system_prompt as _resolve_system, append_extra
    prompts_cfg = cfg.get("prompts", {})
    system = _resolve_system("view_suggester", prompts_cfg, system_prompt)
    user   = append_extra(_user_prompt(cfg, user_prompt_template, user_request), "view_suggester", prompts_cfg)

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2500)

    if provider == "anthropic":
        raw = _call_anthropic(api_key, model, system, user, max_tokens)
    else:
        raw = _call_openai(api_key, model, system, user, max_tokens, base_url=ai_cfg.get("base_url"))
    return _parse(raw)


def _user_prompt(cfg: Dict, template: str = USER_PROMPT_TEMPLATE, user_request: str = "") -> str:
    from src.data.transform import _repeat_path
    questions = cfg.get("questions", [])
    form_alias = cfg.get("form", {}).get("alias", "survey")
    report_title = cfg.get("report", {}).get("title", "")

    header_line = f"Report: {report_title}\n" if report_title else ""
    user_request_line = (
        f"USER REQUEST (prioritise this when choosing views): {user_request.strip()}\n\n"
        if user_request and user_request.strip() else ""
    )

    # Main-table columns by category — these are candidates for join_parent and group_by.
    main_by_cat: Dict[str, List[str]] = {}
    for q in questions:
        if q.get("repeat_group"):
            continue
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            main_by_cat.setdefault(cat, []).append(label)
    main_lines = []
    for cat in ("categorical", "quantitative", "date", "geographical", "qualitative", "undefined"):
        cols = main_by_cat.get(cat, [])
        if cols:
            main_lines.append(f"  {cat}: {', '.join(cols)}")
    main_cols_block = (
        "MAIN TABLE COLUMNS (candidates for join_parent and group_by, by category):\n"
        + "\n".join(main_lines) + "\n\n"
    ) if main_lines else ""

    # Repeat groups with canonical full-path keys + numeric columns (aggregation targets).
    repeat_groups: Dict[str, Dict[str, List[str]]] = {}
    for q in questions:
        rg = q.get("repeat_group")
        if not rg:
            continue
        full_path = _repeat_path(q) or rg
        source_key = full_path.replace("/", "_")
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            repeat_groups.setdefault(source_key, {}).setdefault(cat, []).append(label)
    repeat_groups_block = ""
    if repeat_groups:
        rg_lines = []
        for key, by_cat in repeat_groups.items():
            rg_lines.append(f"  source: {key}")
            for cat in ("categorical", "quantitative", "date", "geographical", "qualitative", "undefined"):
                cols = by_cat.get(cat, [])
                if cols:
                    rg_lines.append(f"      {cat}: {', '.join(cols)}")
        repeat_groups_block = (
            "REPEAT GROUPS (use source: <key> exactly as printed):\n"
            + "\n".join(rg_lines) + "\n\n"
        )

    # Existing views — avoid duplicates.
    existing_views = cfg.get("views", []) or []
    existing_views_block = ""
    if existing_views:
        ev_lines = []
        for v in existing_views:
            name = v.get("name", "")
            desc = f"source={v.get('source','main')}"
            if v.get("group_by"): desc += f", group_by={v['group_by']}, question={v.get('question','')}, agg={v.get('agg','sum')}"
            if v.get("filter"):   desc += f", filter={v['filter']!r}"
            ev_lines.append(f"  {name}: {desc}")
        existing_views_block = "EXISTING VIEWS (do not duplicate):\n" + "\n".join(ev_lines) + "\n\n"

    # Existing charts — analytical context (what views would unlock or simplify).
    existing_charts = cfg.get("charts", []) or []
    existing_charts_block = ""
    if existing_charts:
        ec_lines = []
        for c in existing_charts:
            qs = ", ".join(c.get("questions", []) or [])
            src = c.get("source") or (c.get("options", {}) or {}).get("source") or "auto"
            ec_lines.append(f"  {c.get('name','?')} ({c.get('type','?')}): source={src}, questions=[{qs}]")
        existing_charts_block = "EXISTING CHARTS (for context — propose views that would simplify or unlock these):\n" + "\n".join(ec_lines) + "\n\n"

    return template.format(
        header_line=header_line,
        form_alias=form_alias,
        user_request_line=user_request_line,
        main_cols_block=main_cols_block,
        repeat_groups_block=repeat_groups_block,
        existing_views_block=existing_views_block,
        existing_charts_block=existing_charts_block,
    )


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(views: List[Dict], path: str) -> None:
    block = yaml.dump({"views": views}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(views: List[Dict]) -> None:
    print("\n# ── AI-suggested views — paste into config.yml ───────────────────\n")
    print(yaml.dump({"views": views}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
        log.warning("Could not parse JSON from LLM view suggestions.")
        return []
    views = data.get("views", [])
    if not isinstance(views, list):
        log.warning("LLM returned unexpected structure — expected {\"views\": [...]}")
        return []
    return views
