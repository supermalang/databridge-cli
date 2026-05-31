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
    """Validate a proposed recipe (chart or indicator) against the profile. (ok, reason)."""
    if recipe.get("kind", "chart") == "indicator":
        return _validate_indicator(recipe, profile)
    return _validate_chart(recipe, profile)


def _validate_chart(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
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


def _validate_indicator(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    stat = recipe.get("stat")
    if stat not in INDICATOR_STATS:
        return False, f"unsupported indicator stat '{stat}'"
    source = recipe.get("source") or "main"
    tp = profile.get(source)
    if tp is None:
        return False, f"unknown source table '{source}'"
    roles = {c["name"]: c.get("role") for c in tp.get("columns", [])}
    if stat == "count":
        return True, ""
    q = recipe.get("question")
    if not q:
        return False, f"indicator stat '{stat}' needs a question column"
    if q not in roles:
        return False, f"column '{q}' not found in '{source}'"
    if stat in _NUMERIC_STATS and roles[q] != "quantitative":
        return False, f"'{stat}' needs a quantitative column"
    if stat == "percent" and not recipe.get("filter_value"):
        return False, "'percent' needs a filter_value"
    return True, ""


_CHART_TYPES_BLOCK = "\n".join(f"- {t}: {req}" for t, (_chk, req) in CHART_REQS.items())

INDICATOR_STATS = {"count", "count_distinct", "sum", "mean", "median",
                   "min", "max", "percent", "most_common"}
_NUMERIC_STATS = {"sum", "mean", "median", "min", "max"}
_INDICATOR_STATS_BLOCK = (
    "- count: number of rows (no column)\n"
    "- count_distinct: unique values of a column\n"
    "- most_common: most frequent value of a column\n"
    "- sum / mean / median / min / max: a quantitative column\n"
    "- percent: share of rows where a column equals filter_value (needs filter_value)"
)


def _parse_items(raw: str) -> List[Dict]:
    """Parse {"items": [...]} from an LLM response, tolerating fences/prose."""
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
    items = data.get("items") if isinstance(data, dict) else None
    return items if isinstance(items, list) else []


def propose_items(question: str, catalog: Dict, ai_cfg: Dict) -> List[Dict]:
    """Ask the LLM for 1–3 answer items (charts or indicators), each tagged with a
    "kind" (defaulting to "chart"). Returns [] on any failure."""
    provider = (ai_cfg.get("provider") or "openai").lower()
    variables = {
        "question": question,
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "chart_types": _CHART_TYPES_BLOCK,
        "indicator_stats": _INDICATOR_STATS_BLOCK,
    }
    try:
        messages = lf_client.get_prompt("ask_propose", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_propose",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: propose_items failed: {e}")
        return []
    items = _parse_items(raw)[:3]
    for it in items:
        it.setdefault("kind", "chart")
    return items


def _result_summary(recipe: Dict, chart_df: pd.DataFrame) -> str:
    """Compact text of the values a chart actually shows, for caption grounding."""
    cols = list(recipe.get("questions") or [])
    if recipe.get("group_by") and recipe["group_by"] not in cols:
        cols.append(recipe["group_by"])
    parts = []
    for c in cols[:2]:
        if c not in chart_df.columns:
            continue
        s = chart_df[c]
        num = pd.to_numeric(s, errors="coerce")
        if num.notna().sum() >= max(1, len(s) // 2):
            v = num.dropna()
            if len(v):
                parts.append(f"{c}: min={v.min():.1f}, mean={v.mean():.1f}, max={v.max():.1f}")
        else:
            vc = s.dropna().value_counts().head(5)
            parts.append(f"{c}: " + ", ".join(f"{k}={int(n)}" for k, n in vc.items()))
    return "; ".join(parts) or "(no values)"


def render_recipe(recipe: Dict, df: pd.DataFrame,
                  repeat_tables: Dict[str, pd.DataFrame]) -> Optional[Tuple[Path, str]]:
    """Resolve the chart DataFrame and render a PNG. Returns (png_path, result_summary)
    or None if the columns are missing or rendering fails."""
    from src.reports.builder import _pick_df
    from src.data.transform import apply_local_scope
    from src.reports.charts import generate_chart

    questions = list(recipe.get("questions") or [])
    gb = recipe.get("group_by")
    resolved_questions = questions + ([gb] if gb and gb not in questions else [])
    source = recipe.get("source")
    try:
        chart_df = _pick_df(resolved_questions, df, repeat_tables or {}, source=source)
        missing = [q for q in resolved_questions if q not in chart_df.columns]
        if missing:
            return None
        filter_expr = recipe.get("filter")
        if filter_expr:
            chart_df = apply_local_scope(chart_df, {}, filter_expr=filter_expr)
        summary = _result_summary(recipe, chart_df)
        resolved = {**recipe, "questions": resolved_questions}
        png = generate_chart(resolved, chart_df)
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: render_recipe failed for '{recipe.get('name')}': {e}")
        return None
    if png is None or not Path(png).exists():
        return None
    return Path(png), summary


def ground_captions(items: List[Dict], ai_cfg: Dict) -> Dict[str, str]:
    """One batched LLM call to caption each rendered chart from its computed values.
    items: [{"name", "title", "summary"}]. Falls back to the title per chart on failure."""
    fallback = {it["name"]: it.get("title") or it["name"] for it in items}
    if not items:
        return {}
    provider = (ai_cfg.get("provider") or "openai").lower()
    charts_block = "\n".join(f'{it["name"]} — {it.get("title", "")}: {it.get("summary", "")}' for it in items)
    try:
        messages = lf_client.get_prompt("ask_caption", {"charts_block": charts_block})
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=600,
            trace_name="ask_caption",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
        )
        data = json.loads(raw)
        caps = data.get("captions", {}) if isinstance(data, dict) else {}
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: ground_captions failed: {e}")
        caps = {}
    return {it["name"]: (caps.get(it["name"]) or fallback[it["name"]]) for it in items}


def _ai_ready(ai_cfg: Dict) -> bool:
    key = str(ai_cfg.get("api_key", ""))
    return bool(ai_cfg.get("provider")) and bool(key) and not key.startswith("env:")


def _b64_png(path: Path) -> str:
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{data}"


def ask(question: str, cfg: Dict, df: pd.DataFrame,
        repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Full ask loop. Returns {"proposals": [...], "skipped": [...], "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposals": [], "skipped": [],
                "message": "Configure an AI provider in Sources to ask questions."}

    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile)

    recipes = propose_items(question, catalog, ai_cfg)
    if not recipes:
        return {"proposals": [], "skipped": [],
                "message": "Couldn't turn that into a chart — try rephrasing."}

    valid, skipped = [], []
    for r in recipes:
        title = r.get("title") or r.get("name") or r.get("type", "chart")
        ok, reason = validate_recipe(r, profile)
        if not ok:
            skipped.append({"title": title, "reason": reason})
            continue
        rendered = render_recipe(r, df, repeat_tables or {})
        if rendered is None:
            skipped.append({"title": title, "reason": "could not render this chart"})
            continue
        png, summary = rendered
        valid.append({"recipe": r, "png": png, "summary": summary, "title": title})

    # Disambiguate duplicate recipe names within this batch so captions map 1:1
    # and UI keys stay unique (the LLM can occasionally repeat a name).
    seen_names = set()
    for v in valid:
        base = v["recipe"].get("name") or v["title"] or "chart"
        name = base
        i = 2
        while name in seen_names:
            name = f"{base}_{i}"
            i += 1
        seen_names.add(name)
        v["recipe"] = {**v["recipe"], "name": name}

    captions = ground_captions(
        [{"name": v["recipe"].get("name", v["title"]), "title": v["title"], "summary": v["summary"]} for v in valid],
        ai_cfg,
    )
    proposals = [{
        "recipe": v["recipe"],
        "image": _b64_png(v["png"]),
        "caption": captions.get(v["recipe"].get("name", v["title"]), v["title"]),
    } for v in valid]
    return {"proposals": proposals, "skipped": skipped, "message": None}


def compute_indicator(recipe: Dict, df: pd.DataFrame,
                      repeat_tables: Dict[str, pd.DataFrame]) -> Optional[str]:
    """Compute a single indicator's formatted value via the indicator engine.
    Returns the value string, or None on failure / N/A."""
    from src.reports.indicators import compute_indicators
    name = recipe.get("name") or "indicator"
    ind = {k: v for k, v in recipe.items() if k != "kind"}
    ind["name"] = name
    try:
        result = compute_indicators([ind], df, repeat_tables or {})
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: compute_indicator failed for '{name}': {e}")
        return None
    val = result.get(f"ind_{name}")
    if val is None or val == "N/A":
        return None
    return val


def save_recipe(recipe: Dict, cfg: Dict) -> str:
    """Append a chart recipe to cfg['charts'], de-duplicating the name. Mutates cfg;
    the caller persists via write_config. Returns the final saved name."""
    charts = cfg.setdefault("charts", [])
    existing = {c.get("name") for c in charts}
    name = recipe.get("name") or "chart"
    if name in existing:
        i = 2
        while f"{name}_{i}" in existing:
            i += 1
        name = f"{name}_{i}"
    saved = {**recipe, "name": name}
    charts.append(saved)
    return name
