"""
ai_ask_examples.py — starter questions for the Ask tab.

Produces a short list of natural-language questions a user could ask about their
data. Prefers AI-generated suggestions (grounded in the survey's columns via the
`ask_examples` prompt); falls back to deterministic, schema-derived questions when
no AI connection is configured or the AI call fails. Pure metadata — never reads
submission values, and only ever sees LLM-safe (non-hidden, non-PII) columns.
"""
import json
import logging
import re
from typing import Dict, List

from src.utils.config import llm_safe_questions

log = logging.getLogger(__name__)


def _label(q: Dict) -> str:
    return q.get("export_label") or q.get("label") or q.get("kobo_key") or ""


def schema_examples(cfg: Dict, limit: int = 5) -> List[str]:
    """Deterministic starter questions derived from the question schema. Picks a
    mix — count, distribution, average-by-group, trend, ranking — referencing real
    column labels. Always returns at least one generic question."""
    by_cat: Dict[str, List[str]] = {}
    for q in llm_safe_questions(cfg):
        lbl = _label(q)
        if lbl:
            by_cat.setdefault(q.get("category") or "undefined", []).append(lbl)
    cats = by_cat.get("categorical", [])
    nums = by_cat.get("quantitative", [])
    has_date = bool(by_cat.get("date"))

    out: List[str] = []
    if cats:
        out.append(f"How many submissions by {cats[0]}?")
    if nums:
        out.append(f"Show the distribution of {nums[0]}")
    if nums and cats:
        out.append(f"What is the average {nums[0]} by {cats[0]}?")
    if has_date:
        out.append("How did submissions change over time?")
    rank_cat = cats[1] if len(cats) > 1 else (cats[0] if cats else None)
    if rank_cat:
        out.append(f"Which {rank_cat} had the most responses?")
    if not out:
        out = ["How many submissions in total?", "Show the distribution of responses"]

    seen, res = set(), []
    for e in out:
        if e not in seen:
            seen.add(e)
            res.append(e)
    return res[:limit]


def _build_variables(cfg: Dict) -> Dict:
    lines = []
    for q in llm_safe_questions(cfg)[:60]:
        lbl = _label(q)
        if lbl:
            lines.append(f"- {lbl} ({q.get('category') or 'undefined'})")
    return {
        "form_alias": (cfg.get("form") or {}).get("alias", "survey"),
        "columns_block": "\n".join(lines) if lines else "(no columns available)",
    }


def _parse_questions(raw: str) -> List[str]:
    data = None
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if m:
            try:
                data = json.loads(m.group())
            except json.JSONDecodeError:
                pass
    qs = data.get("questions") if isinstance(data, dict) else None
    return [str(x).strip() for x in (qs or []) if str(x).strip()]


def _ai_examples(ai_cfg: Dict, cfg: Dict, limit: int) -> List[str]:
    from src.utils import lf_client

    provider = (ai_cfg.get("provider") or "openai").lower()
    messages, config = lf_client.get_prompt("ask_examples", _build_variables(cfg))
    raw = lf_client.chat(
        messages,
        model=ai_cfg.get("model", "gpt-4o"),
        provider=provider,
        api_key=ai_cfg.get("api_key", ""),
        max_tokens=max(int(ai_cfg.get("max_tokens", 1500) or 1500), 400),
        trace_name="ask_examples",
        base_url=ai_cfg.get("base_url"),
        json_mode=(provider != "anthropic"),
        output_schema=config.get("output_schema"),
    )
    return _parse_questions(raw)[:limit]


def ai_available(cfg: Dict) -> bool:
    """True when the config has an AI provider + a resolved api_key. (load_config
    leaves an `env:` prefix in place when the variable is unset → treated as off.)"""
    ai_cfg = cfg.get("ai") or {}
    api_key = str(ai_cfg.get("api_key", "") or "")
    return bool(ai_cfg and api_key and not api_key.startswith("env:"))


def suggest_examples(cfg: Dict, limit: int = 5) -> Dict:
    """Return {"examples": [...], "source": "ai"|"schema"}. Tries AI when available,
    falls back to schema-derived questions on any failure."""
    if ai_available(cfg):
        try:
            ex = _ai_examples(cfg["ai"], cfg, limit)
            if ex:
                return {"examples": ex, "source": "ai"}
        except Exception as e:  # noqa: BLE001 — examples are non-critical; degrade to schema
            log.info(f"ask_examples AI failed, using schema fallback: {e}")
    return {"examples": schema_examples(cfg, limit), "source": "schema"}
