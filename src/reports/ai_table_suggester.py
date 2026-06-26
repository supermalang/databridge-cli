"""
ai_table_suggester.py — LLM-powered tables configuration suggester.

A table is a chart-like recipe rendered with the existing `table` chart type
(a PNG frequency/breakdown table). Given the questions in config.yml, asks the
LLM to propose a complete tables: block ready to paste into config.yml. Each
entry becomes a {{ table_<name> }} placeholder in the Word template.

Called by the suggest-tables CLI command.
"""
import json
import logging
import re
from typing import Dict, List, Optional

import yaml

log = logging.getLogger(__name__)


def suggest_tables(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
) -> List[Dict]:
    """Ask the LLM to propose a tables: config block from the questions in cfg.

    Args:
        cfg:          full config dict (needs questions + ai sections)
        out_path:     if set, write the YAML block to this file path
        user_request: optional free-text instruction from the end user

    Returns:
        List of table config dicts ready to be merged into cfg["tables"].
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

    log.info("Requesting table suggestions from LLM…")
    tables = _get_suggestions(ai_cfg, cfg, user_request)
    log.info(f"Received {len(tables)} table suggestion(s).")

    if out_path:
        _write_yaml(tables, out_path)
        log.info(f"Table suggestions written → {out_path}")
    else:
        _print_yaml(tables)
    return tables


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2500)

    variables = _build_variables(cfg, user_request)
    messages, config = lf_client.get_prompt("table_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="table_suggester",
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
        f"USER REQUEST (prioritise this when choosing tables): {user_request.strip()}\n\n"
        if user_request and user_request.strip() else ""
    )

    # Columns block — group by category for clarity.
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
    columns_block = (
        "AVAILABLE COLUMNS (by category):\n" + "\n".join(col_lines) + "\n\n"
    ) if col_lines else ""

    # Repeat groups block — tables can set source: <key>.
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
            "REPEAT GROUP COLUMNS (set source: <key> at the table top level — exactly as printed):\n"
            + "\n".join(rg_lines) + "\n\n"
        )

    # Existing tables — avoid duplicates.
    existing = cfg.get("tables", []) or []
    existing_block = ""
    if existing:
        existing_names = [t.get("name") for t in existing]
        existing_block = f"Tables already configured (do not duplicate): {', '.join(existing_names)}\n\n"

    return {
        "header_line": header_line,
        "form_alias": form_alias,
        "user_request_line": user_request_line,
        "columns_block": columns_block,
        "repeat_groups_block": repeat_groups_block,
        "existing_block": existing_block,
        "language": (cfg.get("ai") or {}).get("language") or "English",
    }


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(tables: List[Dict], path: str) -> None:
    block = yaml.dump({"tables": tables}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(tables: List[Dict]) -> None:
    print("\n# ── AI-suggested tables — paste into config.yml ──────────────────\n")
    print(yaml.dump({"tables": tables}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
        log.warning("Could not parse JSON from LLM table suggestions.")
        return []
    tables = data.get("tables", [])
    if not isinstance(tables, list):
        log.warning("LLM returned unexpected structure — expected {\"tables\": [...]}")
        return []
    # Force the chart type — a table IS a chart rendered as a PNG table.
    for t in tables:
        if isinstance(t, dict):
            t["type"] = "table"
    return tables
