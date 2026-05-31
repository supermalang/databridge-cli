"""The "Ask" question engine (Layer 4, Slice 1).

Question -> data-aware catalog (from the Layer 2 profile) -> LLM proposes chart
recipes -> validate against chart-type role requirements -> render locally ->
ground captions in computed values -> return. Charts can be saved into config.charts.
"""
from __future__ import annotations
import base64
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

from src.utils import lf_client

log = logging.getLogger(__name__)


def build_catalog(profile: Dict[str, Dict]) -> Dict:
    """Condense a profile_dataset result into a compact, token-friendly, data-aware
    catalog for the proposer prompt. Excludes linkage columns; keeps roles, cardinality,
    missingness, low-cardinality top-values, and numeric range."""
    tables = []
    for tname, tp in (profile or {}).items():
        cols = []
        for c in tp.get("columns", []):
            if c.get("role") == "linkage":
                continue
            entry = {
                "name": c["name"],
                "role": c.get("role"),
                "distinct": c.get("distinct"),
                "missing_pct": c.get("missing_pct"),
            }
            if "top_values" in c:
                entry["top_values"] = [tv["value"] for tv in c["top_values"]]
            if c.get("role") == "quantitative" and "min" in c:
                entry["min"] = c["min"]
                entry["max"] = c["max"]
            cols.append(entry)
        tables.append({"name": tname, "rows": tp.get("rows", 0), "columns": cols})
    return {"tables": tables}


# type -> (check(n_cat, n_quant, n_date) -> bool, human requirement)
CHART_REQS = {
    "bar":            (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "horizontal_bar": (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "pie":            (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "donut":          (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "line":           (lambda c, q, d: d >= 1, "≥1 date column"),
    "area":           (lambda c, q, d: d >= 1, "≥1 date column"),
    "histogram":      (lambda c, q, d: q >= 1, "≥1 quantitative column"),
    "scatter":        (lambda c, q, d: q >= 2, "≥2 quantitative columns"),
    "box_plot":       (lambda c, q, d: c >= 1 and q >= 1, "1 categorical + 1 quantitative"),
    "grouped_bar":    (lambda c, q, d: c >= 2, "≥2 categorical columns"),
    "stacked_bar":    (lambda c, q, d: c >= 2, "≥2 categorical columns"),
    "heatmap":        (lambda c, q, d: c >= 2, "≥2 categorical columns"),
}


def validate_recipe(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    """Validate a proposed chart recipe against the profile. Returns (ok, reason)."""
    ctype = recipe.get("type")
    if ctype not in CHART_REQS:
        return False, f"unsupported chart type '{ctype}'"
    source = recipe.get("source") or "main"
    tp = profile.get(source)
    if tp is None:
        return False, f"unknown source table '{source}'"
    roles = {c["name"]: c.get("role") for c in tp.get("columns", [])}
    cols = list(recipe.get("questions") or [])
    if recipe.get("group_by"):
        cols.append(recipe["group_by"])
    if not cols:
        return False, "no columns specified"
    for c in cols:
        if c not in roles:
            return False, f"column '{c}' not found in '{source}'"
    col_roles = [roles[c] for c in cols]
    n_cat = col_roles.count("categorical")
    n_quant = col_roles.count("quantitative")
    n_date = col_roles.count("date")
    check, requirement = CHART_REQS[ctype]
    if not check(n_cat, n_quant, n_date):
        return False, f"'{ctype}' needs {requirement}"
    return True, ""


_CHART_TYPES_BLOCK = "\n".join(f"- {t}: {req}" for t, (_chk, req) in CHART_REQS.items())


def _parse_charts(raw: str) -> List[Dict]:
    """Parse {"charts": [...]} from an LLM response, tolerating fences/prose."""
    import re
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except (ValueError, TypeError):
            return []
    charts = data.get("charts") if isinstance(data, dict) else None
    return charts if isinstance(charts, list) else []


def propose_charts(question: str, catalog: Dict, ai_cfg: Dict) -> List[Dict]:
    """Ask the LLM for 1–3 chart recipes for the question. Returns [] on any failure."""
    provider = (ai_cfg.get("provider") or "openai").lower()
    variables = {
        "question": question,
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "chart_types": _CHART_TYPES_BLOCK,
    }
    try:
        messages = lf_client.get_prompt("ask_charts", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_charts",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: propose_charts failed: {e}")
        return []
    return _parse_charts(raw)[:3]
