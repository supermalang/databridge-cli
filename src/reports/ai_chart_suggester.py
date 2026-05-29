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
from typing import Dict, List, Optional  # noqa: F401

import yaml

log = logging.getLogger(__name__)


def suggest_charts(
    cfg: Dict,
    out_path: Optional[str] = None,
    user_request: str = "",
) -> List[Dict]:
    """Ask the LLM to propose a charts: config block from the questions in cfg.

    Args:
        cfg:          full config dict (needs questions + ai sections)
        out_path:     if set, write the YAML block to this file path
        user_request: optional free-text instruction from the end user
                      (e.g. "focus on geographic distribution")

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
    charts = _get_suggestions(ai_cfg, cfg, user_request)
    log.info(f"Received {len(charts)} chart suggestion(s).")

    if out_path:
        _write_yaml(charts, out_path)
        log.info(f"Chart suggestions written → {out_path}")
    else:
        _print_yaml(charts)

    return charts


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, cfg: Dict, user_request: str = "") -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 3000)

    variables = _build_variables(cfg, user_request)
    messages, _config = lf_client.get_prompt("chart_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="chart_suggester",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
    )

    return _parse(raw)


def _build_variables(cfg: Dict, user_request: str = "") -> Dict:
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

    # PII awareness — flag redacted columns so the LLM avoids them.
    pii_cfg = cfg.get("pii") or {}
    pii_lines = []
    consent_col = pii_cfg.get("consent_column")
    if consent_col:
        pii_lines.append(f"  consent column: {consent_col} (rows are filtered before render)")
    for r in (pii_cfg.get("redact") or []):
        pii_lines.append(f"  column '{r['column']}' is redacted via strategy '{r.get('strategy', '?')}'")
    pii_block = ""
    if pii_lines:
        pii_block = "PII REDACTION (avoid these columns in chart suggestions — they will be masked or dropped at render time):\n" + "\n".join(pii_lines) + "\n\n"

    return {
        "header_line": header_line,
        "form_alias": form_alias,
        "user_request_line": user_request_line,
        "columns_block": columns_block,
        "repeat_groups_block": repeat_groups_block,
        "views_block": views_block,
        "pii_block": pii_block,
        "existing_block": existing_block,
    }


# ── output ────────────────────────────────────────────────────────────────────

def _write_yaml(charts: List[Dict], path: str) -> None:
    block = yaml.dump({"charts": charts}, allow_unicode=True, default_flow_style=False, sort_keys=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(block)


def _print_yaml(charts: List[Dict]) -> None:
    print("\n# ── AI-suggested charts — paste into config.yml ──────────────────\n")
    print(yaml.dump({"charts": charts}, allow_unicode=True, default_flow_style=False, sort_keys=False))


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
