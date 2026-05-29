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
from typing import Dict, List, Optional

import yaml

log = logging.getLogger(__name__)


def suggest_views(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
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
    views = _get_suggestions(ai_cfg, cfg, user_request)
    log.info(f"Received {len(views)} view suggestion(s).")

    if out_path:
        _write_yaml(views, out_path)
        log.info(f"View suggestions written → {out_path}")
    else:
        _print_yaml(views)
    return views


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2500)

    variables = _build_variables(cfg, user_request)
    messages, _config = lf_client.get_prompt("view_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="view_suggester",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
    )
    return _parse(raw)


def _build_variables(cfg: Dict, user_request: str = "") -> Dict:
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

    return {
        "header_line": header_line,
        "form_alias": form_alias,
        "user_request_line": user_request_line,
        "main_cols_block": main_cols_block,
        "repeat_groups_block": repeat_groups_block,
        "existing_views_block": existing_views_block,
        "existing_charts_block": existing_charts_block,
    }


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(views: List[Dict], path: str) -> None:
    block = yaml.dump({"views": views}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(views: List[Dict]) -> None:
    print("\n# ── AI-suggested views — paste into config.yml ───────────────────\n")
    print(yaml.dump({"views": views}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
