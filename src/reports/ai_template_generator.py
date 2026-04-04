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
) -> Path:
    """Generate a Word template from an LLM layout spec and save to out_path."""
    ai_cfg = cfg.get("ai")
    if not ai_cfg:
        raise ValueError("No ai: section in config.yml. Configure AI first.")

    log.info("Requesting layout from LLM…")
    spec = _get_layout_spec(ai_cfg, cfg, description, pages, language)
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

def _get_layout_spec(ai_cfg: Dict, cfg: Dict, description: str, pages: int, language: str) -> Dict:
    system_prompt = _system_prompt()
    user_prompt = _user_prompt(cfg, description, pages, language)

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
        "You are a document layout expert specializing in humanitarian and monitoring reports. "
        "Given a project description, available charts/indicators, and a target page count, "
        "design a structured Word report template layout. "
        "Return ONLY valid JSON — no markdown fences, no explanation. "
        'Exact structure: {"sections": [{"heading": str, "level": 1 or 2, "content": [...]}]}\n'
        "Content item types:\n"
        '  {"type":"editable","placeholder":"summary_text"|"observations"|"recommendations","hint":"..."}\n'
        '  {"type":"chart","name":"<chart_name>"}  — only names from the provided list\n'
        '  {"type":"indicator","name":"<indicator_name>"}  — only names from the provided list\n'
        '  {"type":"text","text":"..."}  — static text, may contain {{ period }}, {{ n_submissions }}, {{ generated_at }}\n'
        '  {"type":"divider"}\n'
        '  {"type":"stats_table"}  — numeric stats (only if quantitative questions exist)\n'
        "Rules:\n"
        "  - Use every provided chart exactly once, placed in a contextually appropriate section\n"
        "  - Place indicators in a KPI or executive summary section\n"
        "  - For a N-page report, create approximately N/2 top-level sections\n"
        "  - Do NOT invent chart or indicator names — use only those provided\n"
        "  - Return JSON only"
    )


def _user_prompt(cfg: Dict, description: str, pages: int, language: str) -> str:
    lines = [
        f"Project description: {description}",
        f"Target report length: {pages} pages",
        f"Language: {language}",
        "",
    ]

    charts = cfg.get("charts", [])
    if charts:
        lines.append("Available charts:")
        for c in charts:
            lines.append(f"  - {c['name']} ({c.get('type', '')}): {c.get('title', c['name'])}")
        lines.append("")

    indicators = cfg.get("indicators", [])
    if indicators:
        lines.append("Available indicators:")
        for ind in indicators:
            lines.append(f"  - {ind['name']}: {ind.get('label', ind['name'])} ({ind.get('stat', '')})")
        lines.append("")

    questions = cfg.get("questions", [])
    if questions:
        cat_counts = Counter(q.get("category", "undefined") for q in questions)
        lines.append("Questions by category: " + ", ".join(f"{k}: {v}" for k, v in cat_counts.items()))
        quant_labels = [
            q.get("export_label") or q.get("label") or q["kobo_key"]
            for q in questions if q.get("category") == "quantitative"
        ]
        if quant_labels:
            lines.append(f"Quantitative columns: {', '.join(quant_labels)}")
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
            {"type": "editable", "placeholder": "summary_text", "hint": "Write your summary here."}
        ]},
        {"heading": "Observations", "level": 1, "content": [
            {"type": "editable", "placeholder": "observations", "hint": "List your observations."}
        ]},
        {"heading": "Recommendations", "level": 1, "content": [
            {"type": "editable", "placeholder": "recommendations", "hint": "List your recommendations."}
        ]},
    ]}
