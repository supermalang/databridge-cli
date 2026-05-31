"""
ai_summary_suggester.py — LLM-powered summaries configuration suggester.

Summaries become text paragraphs (`{{ summary_<name> }}`) in the Word
template. Given the questions and existing charts, asks the LLM to
propose 4-8 useful summaries covering the analytically meaningful
columns and topic areas.

Called by the suggest-summaries CLI command.
"""
import json
import logging
import re
from typing import Dict, List, Optional

import yaml

log = logging.getLogger(__name__)


def suggest_summaries(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
) -> List[Dict]:
    """Ask the LLM to propose a summaries: config block from the questions in cfg."""
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise ValueError("No ai: section in config.yml. Configure AI first.")
    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key not resolved — check your env variable.")
    if not cfg.get("questions"):
        raise ValueError("No questions in config.yml. Run fetch-questions first.")

    log.info("Requesting summary suggestions from LLM…")
    summaries = _get_suggestions(ai_cfg, cfg, user_request)
    log.info(f"Received {len(summaries)} summary suggestion(s).")

    if out_path:
        _write_yaml(summaries, out_path)
        log.info(f"Summary suggestions written → {out_path}")
    else:
        _print_yaml(summaries)
    return summaries


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2500)

    variables = _build_variables(cfg, user_request)
    messages, config = lf_client.get_prompt("summary_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="summary_suggester",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
        output_schema=config.get("output_schema"),
    )
    return _parse(raw)


def _build_variables(cfg: Dict, user_request: str = "") -> Dict:
    from src.data.transform import _repeat_path
    questions = cfg.get("questions", [])
    form_alias = cfg.get("form", {}).get("alias", "survey")
    report_title = cfg.get("report", {}).get("title", "")

    header_line = f"Report: {report_title}\n" if report_title else ""
    user_request_line = (
        f"USER REQUEST (prioritise this when choosing summaries): {user_request.strip()}\n\n"
        if user_request and user_request.strip() else ""
    )

    # Columns by category — same as chart suggester.
    by_cat: Dict[str, List[str]] = {}
    for q in questions:
        if q.get("repeat_group"):
            continue
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            by_cat.setdefault(cat, []).append(label)
    col_lines = []
    for cat in ("categorical", "quantitative", "date", "qualitative", "geographical", "undefined"):
        cols = by_cat.get(cat, [])
        if cols:
            col_lines.append(f"  {cat}: {', '.join(cols)}")
    columns_block = (
        "MAIN TABLE COLUMNS (by category):\n" + "\n".join(col_lines) + "\n\n"
    ) if col_lines else ""

    # Repeat-group columns — summaries can reference these too (build-report handles the join).
    repeat_groups: Dict[str, Dict[str, List[str]]] = {}
    for q in questions:
        rg = q.get("repeat_group")
        if not rg:
            continue
        full_path = _repeat_path(q) or rg
        key = full_path.replace("/", "_")
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            repeat_groups.setdefault(key, {}).setdefault(cat, []).append(label)
    repeat_groups_block = ""
    if repeat_groups:
        rg_lines = []
        for key, by in repeat_groups.items():
            rg_lines.append(f"  source: {key}")
            for cat in ("categorical", "quantitative", "date", "geographical", "qualitative", "undefined"):
                cols = by.get(cat, [])
                if cols:
                    rg_lines.append(f"      {cat}: {', '.join(cols)}")
        repeat_groups_block = (
            "REPEAT GROUP COLUMNS (also available — group by category):\n"
            + "\n".join(rg_lines) + "\n\n"
        )

    existing_summaries = cfg.get("summaries", []) or []
    existing_summaries_block = ""
    if existing_summaries:
        es_lines = []
        for s in existing_summaries:
            es_lines.append(f"  {s.get('name','?')}: stat={s.get('stat','?')}, questions={s.get('questions',[])}")
        existing_summaries_block = "EXISTING SUMMARIES (do not duplicate):\n" + "\n".join(es_lines) + "\n\n"

    existing_charts = cfg.get("charts", []) or []
    existing_charts_block = ""
    if existing_charts:
        ec_lines = []
        for c in existing_charts:
            ec_lines.append(f"  {c.get('name','?')} ({c.get('type','?')}): questions={c.get('questions',[])}")
        existing_charts_block = "EXISTING CHARTS (for context — summaries should complement, not restate, these):\n" + "\n".join(ec_lines) + "\n\n"

    return {
        "header_line": header_line,
        "form_alias": form_alias,
        "user_request_line": user_request_line,
        "columns_block": columns_block,
        "repeat_groups_block": repeat_groups_block,
        "existing_summaries_block": existing_summaries_block,
        "existing_charts_block": existing_charts_block,
    }


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(summaries: List[Dict], path: str) -> None:
    block = yaml.dump({"summaries": summaries}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(summaries: List[Dict]) -> None:
    print("\n# ── AI-suggested summaries — paste into config.yml ───────────────\n")
    print(yaml.dump({"summaries": summaries}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
        log.warning("Could not parse JSON from LLM summary suggestions.")
        return []
    summaries = data.get("summaries", [])
    if not isinstance(summaries, list):
        log.warning("LLM returned unexpected structure — expected {\"summaries\": [...]}")
        return []
    return summaries
