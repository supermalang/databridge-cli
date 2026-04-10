"""
ai_template_generator.py — LLM-powered Word template generation.

Asks the LLM to design a report layout (JSON spec), then renders it into a
.docx using python-docx helpers from template_generator.py.

Called by the ai-generate-template CLI command.
"""
import json
import logging
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

from docx import Document

from src.reports.template_generator import (
    _chart_ph, _descriptor, _divider, _editable,
    _heading, _margins, _meta, _note, _ref_table,
)

log = logging.getLogger(__name__)


# ── public entry point ────────────────────────────────────────────────────────

def ai_generate_template(
    cfg: Dict,
    out_path: Path,
    description: str,
    pages: int = 10,
    language: str = "English",
    summary_prompt: str = None,
) -> Path:
    """Generate a Word template from an LLM layout spec and save to out_path."""
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise ValueError("No ai: section in config.yml. Configure AI first.")

    log.info("Requesting layout from LLM…")
    spec = _get_layout_spec(ai_cfg, cfg, description, pages, language, summary_prompt=summary_prompt)
    log.info(f"Layout received: {len(spec.get('sections', []))} sections")

    doc = Document()
    _margins(doc)

    # Fixed header — always present
    _heading(doc, "{{ report_title }}", 0)
    _meta(doc, "Period", "{{ period }}")
    _meta(doc, "Submissions", "{{ n_submissions }}")
    _meta(doc, "Generated", "{{ generated_at }}")
    _divider(doc)

    # Build indicator lookup
    ind_map = {
        ind["name"]: ind.get("label", ind["name"])
        for ind in cfg.get("indicators", [])
    }

    for section in spec.get("sections", []):
        _heading(doc, section.get("heading", ""), section.get("level", 1))
        for item in section.get("content", []):
            _render_item(doc, item, ind_map, cfg)
        _divider(doc)

    # Always append placeholder reference
    _heading(doc, "Placeholder Reference", 1)
    _note(doc, "Delete this section before sharing.")
    _ref_table(doc, cfg)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    log.info(f"AI template saved → {out_path}")
    return out_path


# ── item renderer ─────────────────────────────────────────────────────────────

def _render_item(doc, item: Dict, ind_map: Dict, cfg: Dict):
    t = item.get("type", "")

    if t == "editable":
        ph = item.get("placeholder", "")
        hint = item.get("hint", "")
        _editable(doc, f"{{{{ {ph} }}}}", hint)

    elif t == "chart":
        name = item.get("name", "")
        # Find chart title for descriptor
        title = next(
            (c.get("title", name) for c in cfg.get("charts", []) if c.get("name") == name),
            name,
        )
        chart_type = next(
            (c.get("type", "") for c in cfg.get("charts", []) if c.get("name") == name),
            "",
        )
        if chart_type:
            _descriptor(doc, f"{chart_type.replace('_', ' ').title()}")
        _chart_ph(doc, f"{{{{ chart_{name} }}}}")
        doc.add_paragraph()

    elif t == "indicator":
        name = item.get("name", "")
        label = ind_map.get(name, name.replace("_", " ").title())
        _meta(doc, label, f"{{{{ ind_{name} }}}}")

    elif t == "summary":
        name = item.get("name", "")
        # Find label from config summaries
        summary_cfg = cfg.get("summaries", [])
        label = next(
            (s.get("label", name) for s in summary_cfg if s.get("name") == name),
            name.replace("_", " ").title(),
        )
        _descriptor(doc, label)
        _editable(doc, f"{{{{ summary_{name} }}}}", hint="")

    elif t == "text":
        text = item.get("text", "")
        if text:
            doc.add_paragraph(text)

    elif t == "divider":
        _divider(doc)

    elif t == "stats_table":
        from docx.shared import Pt, RGBColor
        quant = [q for q in cfg.get("questions", []) if q.get("category") == "quantitative"]
        if quant:
            for text, sz, color, italic in [
                ("{%p for row in stats_table %}", 9, RGBColor(0x1D, 0x9E, 0x75), True),
                ("{{ row.label }}: n={{ row.n }}, mean={{ row.mean }}, median={{ row.median }}", 9, RGBColor(0x1D, 0x9E, 0x75), True),
                ("{%p endfor %}", 9, RGBColor(0x1D, 0x9E, 0x75), True),
            ]:
                p = doc.add_paragraph()
                r = p.add_run(text)
                r.font.size = Pt(sz)
                r.font.color.rgb = color
                r.font.italic = italic


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_layout_spec(ai_cfg: Dict, cfg: Dict, description: str, pages: int, language: str, summary_prompt: str = None) -> Dict:
    system_prompt = _system_prompt()
    user_prompt = _user_prompt(cfg, description, pages, language, summary_prompt=summary_prompt)

    provider = ai_cfg.get("provider", "openai").lower()
    api_key = ai_cfg.get("api_key", "")
    model = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 2000)  # layout needs more tokens

    if not api_key or str(api_key).startswith("env:"):
        raise ValueError("AI api_key not resolved. Set the environment variable.")

    if provider == "anthropic":
        raw = _call_anthropic(api_key, model, system_prompt, user_prompt, max_tokens)
    else:
        raw = _call_openai(api_key, model, system_prompt, user_prompt, max_tokens,
                           base_url=ai_cfg.get("base_url"))

    return _parse_spec(raw)


def _system_prompt() -> str:
    return (
        "You are a senior Monitoring & Evaluation (M&E) specialist and report designer. "
        "Your task is to design structured Word report templates for data analysis and M&E reporting. "
        "The tone is professional, evidence-based, and analytical — suitable for donors, programme managers, and field coordinators. "
        "Reports follow standard M&E structure: context, key performance indicators, findings by theme, "
        "geographic breakdown, trends over time, qualitative observations, and actionable recommendations.\n\n"
        "Given a project background, available charts/indicators/summaries, and a target page count, "
        "design a structured report template layout. "
        "Return ONLY valid JSON — no markdown fences, no explanation.\n"
        'Exact structure: {"sections": [{"heading": str, "level": 1 or 2, "content": [...]}]}\n\n'
        "Content item types:\n"
        '  {"type":"editable","placeholder":"summary_text"|"observations"|"recommendations","hint":"<specific guidance for the writer>"}\n'
        '  {"type":"chart","name":"<chart_name>"}  — only names from the provided list\n'
        '  {"type":"indicator","name":"<indicator_name>"}  — only names from the provided list\n'
        '  {"type":"summary","name":"<summary_name>"}  — only names from the provided list\n'
        '  {"type":"text","text":"..."}  — static introductory or analytical text; may reference {{ period }}, {{ n_submissions }}, {{ generated_at }}\n'
        '  {"type":"divider"}\n'
        '  {"type":"stats_table"}  — descriptive statistics table for numeric variables\n\n'
        "Layout rules:\n"
        "  - Use EVERY provided chart exactly once, in a contextually appropriate section\n"
        "  - Use EVERY provided indicator and summary exactly once\n"
        "  - Open with an Executive Summary section containing key indicators and the summary_text editable\n"
        "  - Group charts and summaries thematically (e.g. coverage, demographics, food security, geography)\n"
        "  - Place a Findings section per major theme, each with an introductory text item, then charts/summaries\n"
        "  - End with Observations (editable) and Recommendations (editable) sections\n"
        "  - Write hint text for editable placeholders as concrete, actionable guidance for the report author — "
        "    e.g. 'Describe coverage rates by region, highlight any groups falling below target thresholds, and note data quality issues.'\n"
        "  - intro text items should be short orienting sentences in the report language, referencing {{ period }} and {{ n_submissions }} where relevant\n"
        "  - For a N-page report, create approximately N/2 top-level sections\n"
        "  - Do NOT invent chart, indicator, or summary names — use only those provided\n"
        "  - Return JSON only"
    )


def _user_prompt(cfg: Dict, description: str, pages: int, language: str, summary_prompt: str = None) -> str:
    lines = [
        f"Project background and context: {description}",
        f"Target report length: {pages} pages",
        f"Report language: {language}",
    ]
    if summary_prompt:
        lines.append(f"Executive summary guidance (use as hint for the summary_text editable): {summary_prompt}")
    lines.append("")

    # Improvement 3 — pass chart questions so LLM can group charts into logical sections
    charts = cfg.get("charts", [])
    if charts:
        lines.append("Available charts:")
        for c in charts:
            questions_str = ", ".join(c.get("questions", []))
            detail = f"{c.get('title', c['name'])}"
            if questions_str:
                detail += f" — columns: {questions_str}"
            lines.append(f"  - {c['name']} ({c.get('type', '')}): {detail}")
        lines.append("")

    indicators = cfg.get("indicators", [])
    if indicators:
        lines.append("Available indicators:")
        for ind in indicators:
            lines.append(f"  - {ind['name']}: {ind.get('label', ind['name'])} ({ind.get('stat', '')})")
        lines.append("")

    # Improvement 2 — include summaries so LLM places them in the template
    summaries = cfg.get("summaries", [])
    if summaries:
        lines.append("Available summaries (computed text paragraphs):")
        for s in summaries:
            stat = s.get("stat", "")
            questions_str = ", ".join(s.get("questions", []))
            detail = s.get("label", s["name"])
            if questions_str:
                detail += f" — {questions_str}"
            lines.append(f"  - {s['name']} ({stat}): {detail}")
        lines.append("")

    # Named views — inform LLM of pre-built data tables so it can note them in chart hints
    views = cfg.get("views", [])
    if views:
        lines.append("Named data views (virtual tables used as chart/summary sources):")
        for v in views:
            name = v.get("name", "")
            gb   = v.get("group_by", "")
            q_v  = v.get("question", "")
            desc = f"source: {v.get('source', 'main')}"
            if v.get("join_parent"): desc += f", joined with {', '.join(v['join_parent'])}"
            if gb and q_v:           desc += f", {v.get('agg','sum')}({q_v}) by {gb}"
            lines.append(f"  - {name}: {desc}")
        lines.append("")

    # Improvement 1 — pass actual question labels grouped by category
    questions = cfg.get("questions", [])
    if questions:
        cat_counts = Counter(q.get("category", "undefined") for q in questions)
        lines.append("Survey questions by category:")
        for cat in ("categorical", "quantitative", "qualitative", "date", "geographical", "undefined"):
            qs = [
                q.get("export_label") or q.get("label") or q["kobo_key"]
                for q in questions if q.get("category") == cat
            ]
            if qs:
                # Cap to 10 per category to keep prompt bounded
                sample = qs[:10]
                suffix = f" (+{len(qs)-10} more)" if len(qs) > 10 else ""
                lines.append(f"  {cat}: {', '.join(sample)}{suffix}")
        lines.append("")

    lines.append("Design a report template layout following the JSON spec.")
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
            {"role": "user", "content": user_prompt},
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

def _parse_spec(raw: str) -> Dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
    log.warning("Could not parse LLM layout spec — using minimal fallback.")
    return {"sections": [
        {"heading": "Executive Summary", "level": 1, "content": [
            {"type": "editable", "placeholder": "summary_text",
             "hint": "Summarize the key findings, coverage rates, and any critical gaps or trends observed during the reporting period."}
        ]},
        {"heading": "Key Findings", "level": 1, "content": [
            {"type": "text", "text": "This section presents the main findings from the {{ period }} data collection ({{ n_submissions }} submissions)."}
        ]},
        {"heading": "Observations", "level": 1, "content": [
            {"type": "editable", "placeholder": "observations",
             "hint": "Document factual observations from the data — patterns, outliers, and comparisons against targets or baselines."}
        ]},
        {"heading": "Recommendations", "level": 1, "content": [
            {"type": "editable", "placeholder": "recommendations",
             "hint": "List actionable recommendations for programme teams, with priority level and responsible party where possible."}
        ]},
    ]}
