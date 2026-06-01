"""
ai_pii_suggester.py — LLM-powered PII (personally-identifiable information) suggester.

Given the questions in config.yml, asks the LLM which questions likely contain
personally-identifiable information (names, phone numbers, exact GPS, national
IDs, addresses, emails, dates of birth, free-text that often holds names, etc.)
so the user can flag them `pii: true` and keep them out of LLM catalogs / redact
them on export.

The model is instructed to be reasonably INCLUSIVE for PII (recall matters for
privacy) while only flagging plausible PII.

Mirrors the structure of ai_hidden_suggester.py: build a metadata-only catalog,
fetch a prompt via lf_client, call lf_client.chat with a structured output
schema, and parse the JSON. ONLY metadata (kobo_key, label, type, group) is sent
to the LLM — never choices, values, or data.
"""
import json
import logging
import re
from typing import Dict, List  # noqa: F401

log = logging.getLogger(__name__)


def suggest_pii(cfg: Dict) -> Dict:
    """Ask the LLM which questions likely contain PII.

    Args:
        cfg: full config dict (needs questions + ai sections).

    Returns:
        On success: {"suggestions": [kobo_key, ...],
                     "reasons": {kobo_key: short_reason}}.
        When AI is not configured / no resolvable api_key:
                    {"suggestions": [], "message": "AI not configured"}.
    """
    ai_cfg = cfg.get("ai") or {}
    api_key = ai_cfg.get("api_key", "")
    if not ai_cfg or not api_key or str(api_key).startswith("env:"):
        return {"suggestions": [], "message": "AI not configured"}

    questions = cfg.get("questions", []) or []
    if not questions:
        return {"suggestions": [], "reasons": {}}

    # Valid keys we may return — only kobo_keys present in the input.
    valid_keys = {q.get("kobo_key") for q in questions if q.get("kobo_key")}

    try:
        items = _get_suggestions(ai_cfg, questions)
    except Exception as exc:  # noqa: BLE001
        log.warning(f"pii_suggester failed ({type(exc).__name__}: {exc}).")
        return {"suggestions": [], "reasons": {}}

    suggestions: List[str] = []
    reasons: Dict[str, str] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        key = item.get("kobo_key")
        if key not in valid_keys or key in reasons:
            continue
        suggestions.append(key)
        reasons[key] = (item.get("reason") or "").strip()

    log.info(f"pii_suggester proposed {len(suggestions)} field(s) as PII.")
    return {"suggestions": suggestions, "reasons": reasons}


# ── LLM interaction ───────────────────────────────────────────────────────────

def _get_suggestions(ai_cfg: Dict, questions: List[Dict]) -> List[Dict]:
    from src.utils import lf_client

    provider   = ai_cfg.get("provider", "openai").lower()
    api_key    = ai_cfg.get("api_key", "")
    model      = ai_cfg.get("model", "gpt-4o")
    max_tokens = max(int(ai_cfg.get("max_tokens", 1500)), 1500)

    variables = _build_variables(questions)
    messages, config = lf_client.get_prompt("pii_suggester", variables)
    raw = lf_client.chat(
        messages,
        model=model,
        provider=provider,
        api_key=api_key,
        max_tokens=max_tokens,
        trace_name="pii_suggester",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
        output_schema=config.get("output_schema"),
    )
    return _parse(raw)


def _build_variables(questions: List[Dict]) -> Dict:
    """Build a compact catalog line per question using ONLY metadata:
    kobo_key | type | group | label. Never includes choices or values."""
    lines = []
    for q in questions:
        key = q.get("kobo_key", "")
        if not key:
            continue
        qtype = q.get("type", "") or ""
        group = q.get("group", "") or ""
        label = q.get("label", "") or ""
        lines.append(
            f"  - kobo_key: {key} | type: {qtype} | group: {group} | label: {label}"
        )
    return {"questions_block": "\n".join(lines)}


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
        log.warning("Could not parse JSON from LLM PII suggestions.")
        return []
    items = data.get("suggestions", [])
    if not isinstance(items, list):
        log.warning("LLM returned unexpected structure — expected {\"suggestions\": [...]}")
        return []
    return items
