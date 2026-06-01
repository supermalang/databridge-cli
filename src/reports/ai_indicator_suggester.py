"""
ai_indicator_suggester.py — LLM-powered indicators configuration suggester.

Indicators become single-number stats (`{{ ind_<name> }}`) in the Word
template. Given the questions in config.yml, asks the LLM to propose an
indicators: block covering the analytically meaningful counts, totals,
averages, and data-quality metrics.

Called by the suggest-indicators CLI command.
"""
import json
import logging
import re
from typing import Dict, List, Optional

import yaml

log = logging.getLogger(__name__)


def suggest_indicators(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
) -> List[Dict]:
    """Ask the LLM to propose an indicators: config block from the questions in cfg.

    Returns [] gracefully when AI is unconfigured.
    """
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        return []
    api_key = ai_cfg.get("api_key", "")
    if not api_key or str(api_key).startswith("env:"):
        return []
    if not cfg.get("questions"):
        return []

    log.info("Requesting indicator suggestions from LLM…")
    indicators = _get_suggestions(ai_cfg, cfg, user_request)
    log.info(f"Received {len(indicators)} indicator suggestion(s).")

    if out_path:
        _write_yaml(indicators, out_path)
        log.info(f"Indicator suggestions written → {out_path}")
    else:
        _print_yaml(indicators)
    return indicators


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2500)

    variables = _build_variables(cfg, user_request)
    messages, config = lf_client.get_prompt("indicator_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="indicator_suggester",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
        output_schema=config.get("output_schema"),
    )
    return _parse(raw)


def _build_variables(cfg: Dict, user_request: str = "") -> Dict:
    from src.data.transform import _repeat_path
    from src.utils.config import llm_safe_questions
    # Never expose hidden or PII-flagged columns' metadata to the LLM.
    questions = llm_safe_questions(cfg)
    form_alias = cfg.get("form", {}).get("alias", "survey")
    report_title = cfg.get("report", {}).get("title", "")

    header_line = f"Report: {report_title}\n" if report_title else ""
    user_request_line = (
        f"USER REQUEST (prioritise this when choosing indicators): {user_request.strip()}\n\n"
        if user_request and user_request.strip() else ""
    )

    # Main-table columns by category.
    by_cat: Dict[str, List[str]] = {}
    for q in questions:
        if q.get("repeat_group"):
            continue
        cat = q.get("category", "undefined")
        label = q.get("export_label") or q.get("label") or q.get("kobo_key", "")
        if label:
            by_cat.setdefault(cat, []).append(label)
    col_lines = []
    for cat in ("quantitative", "categorical", "date", "qualitative", "geographical", "undefined"):
        cols = by_cat.get(cat, [])
        if cols:
            col_lines.append(f"  {cat}: {', '.join(cols)}")
    columns_block = (
        "MAIN TABLE COLUMNS (by category):\n" + "\n".join(col_lines) + "\n\n"
    ) if col_lines else ""

    # Repeat-group columns — indicators can reference these via source: <key>.
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
            for cat in ("quantitative", "categorical", "date", "geographical", "qualitative", "undefined"):
                cols = by.get(cat, [])
                if cols:
                    rg_lines.append(f"      {cat}: {', '.join(cols)}")
        repeat_groups_block = (
            "REPEAT GROUP COLUMNS (set source: <key> exactly as printed):\n"
            + "\n".join(rg_lines) + "\n\n"
        )

    # Existing indicators — avoid duplicates.
    existing = cfg.get("indicators", []) or []
    existing_block = ""
    if existing:
        ex_lines = [f"  {i.get('name','?')}: stat={i.get('stat','?')}, question={i.get('question','')}" for i in existing]
        existing_block = "EXISTING INDICATORS (do not duplicate):\n" + "\n".join(ex_lines) + "\n\n"

    return {
        "header_line": header_line,
        "form_alias": form_alias,
        "user_request_line": user_request_line,
        "columns_block": columns_block,
        "repeat_groups_block": repeat_groups_block,
        "existing_block": existing_block,
    }


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(indicators: List[Dict], path: str) -> None:
    block = yaml.dump({"indicators": indicators}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(indicators: List[Dict]) -> None:
    print("\n# ── AI-suggested indicators — paste into config.yml ──────────────\n")
    print(yaml.dump({"indicators": indicators}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
        log.warning("Could not parse JSON from LLM indicator suggestions.")
        return []
    indicators = data.get("indicators", [])
    if not isinstance(indicators, list):
        log.warning("LLM returned unexpected structure — expected {\"indicators\": [...]}")
        return []
    return indicators
