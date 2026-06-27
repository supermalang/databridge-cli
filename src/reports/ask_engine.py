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


def build_catalog(profile: Dict[str, Dict], cfg: Optional[Dict] = None) -> Dict:
    """Condense a profile_dataset result into a compact, token-friendly, data-aware
    catalog for the proposer prompt. Excludes linkage columns; keeps roles, cardinality,
    missingness, low-cardinality top-values, and numeric range.

    When cfg is provided, any column whose matching question is effective-hidden or
    PII-flagged is dropped so its values/metadata never reach the LLM."""
    unsafe_names: set = set()
    if cfg is not None:
        from src.utils.config import is_effective_hidden, is_pii
        for q in (cfg.get("questions", []) or []):
            if is_effective_hidden(q) or is_pii(q):
                for k in ("export_label", "label", "kobo_key"):
                    v = q.get(k)
                    if v:
                        unsafe_names.add(v)
    tables = []
    for tname, tp in (profile or {}).items():
        cols = []
        for c in tp.get("columns", []):
            if c.get("role") == "linkage":
                continue
            if c.get("name") in unsafe_names:
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
    "table":          (lambda c, q, d: c >= 1, "≥1 categorical column"),
}


def validate_recipe(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    """Validate a proposed recipe (chart, table, or indicator) against the profile. (ok, reason).

    A `table` is a chart-like recipe rendered with the `table` chart type, so it is
    validated exactly like a chart with type forced to "table"."""
    kind = recipe.get("kind", "chart")
    if kind == "indicator":
        return _validate_indicator(recipe, profile)
    if kind == "table":
        return _validate_chart({**recipe, "type": "table"}, profile)
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
                   "min", "max", "percent", "most_common", "completeness",
                   "outlier_rate", "duplicate_rate"}
_NUMERIC_STATS = {"sum", "mean", "median", "min", "max", "outlier_rate"}
_INDICATOR_STATS_BLOCK = (
    "- count: number of rows (no column)\n"
    "- count_distinct: unique values of a column\n"
    "- most_common: most frequent value of a column\n"
    "- sum / mean / median / min / max: a quantitative column\n"
    "- percent: share of rows where a column equals filter_value (needs filter_value)\n"
    "- completeness: % of present (non-blank) values in a column (data quality)\n"
    "- outlier_rate: % of a quantitative column's values beyond the 3xIQR fence (data quality)\n"
    "- duplicate_rate: % of rows that are redundant duplicates of a column's value (data quality)"
)


def _loads_lenient(raw: str) -> Optional[Dict]:
    """Parse a JSON object from an LLM response, tolerating ```json fences / prose.

    Providers without enforced output schemas (e.g. Anthropic on the schema-less
    ask_* prompts) often wrap their JSON in a fenced code block — a bare
    json.loads then throws. Fall back to the first {...} span. Returns the dict,
    or None if nothing parseable.
    """
    import re
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except (ValueError, TypeError):
            return None
    return data if isinstance(data, dict) else None


def _parse_items(raw: str) -> List[Dict]:
    """Parse {"items": [...]} from an LLM response, tolerating fences/prose."""
    data = _loads_lenient(raw)
    items = data.get("items") if data else None
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
        "language": ai_cfg.get("language") or "English",
    }
    try:
        messages, _config = lf_client.get_prompt("ask_propose", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_propose",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
            output_schema=_config.get("output_schema"),
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
        messages, _config = lf_client.get_prompt(
            "ask_caption",
            {"charts_block": charts_block, "language": ai_cfg.get("language") or "English"},
        )
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=600,
            trace_name="ask_caption",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
            output_schema=_config.get("output_schema"),
        )
        data = _loads_lenient(raw)
        caps = data.get("captions", {}) if data else {}
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


def _execute_item(recipe: Dict, profile: Dict[str, Dict], df: pd.DataFrame,
                  repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Validate + execute one recipe (chart or indicator). Returns a valid entry
    {"kind","recipe","png"|"value","summary","title"} or {"skip": reason, "title": title}."""
    kind = recipe.get("kind", "chart")
    title = (recipe.get("title") or recipe.get("name")
             or (recipe.get("stat") if kind == "indicator" else recipe.get("type")) or kind)
    ok, reason = validate_recipe(recipe, profile)
    if not ok:
        return {"skip": reason, "title": title}
    if kind == "indicator":
        value = compute_indicator(recipe, df, repeat_tables or {})
        if value is None:
            return {"skip": "could not compute this indicator", "title": title}
        stat = recipe.get("stat", "")
        qcol = recipe.get("question")
        summary = f"{value} ({stat}{' of ' + qcol if qcol else ''})"
        return {"kind": "indicator", "recipe": recipe, "value": value, "summary": summary, "title": title}
    # chart and table both render via the chart engine; a table forces type "table".
    render_recipe_in = {**recipe, "type": "table"} if kind == "table" else recipe
    rendered = render_recipe(render_recipe_in, df, repeat_tables or {})
    if rendered is None:
        return {"skip": f"could not render this {kind}", "title": title}
    png, summary = rendered
    return {"kind": kind, "recipe": recipe, "png": png, "summary": summary, "title": title}


def ask(question: str, cfg: Dict, df: pd.DataFrame,
        repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Full ask loop (charts + indicators). Returns
    {"proposals": [...], "skipped": [...], "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposals": [], "skipped": [],
                "message": "Configure an AI provider in Sources to ask questions."}

    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile, cfg)

    items = propose_items(question, catalog, ai_cfg)
    if not items:
        return {"proposals": [], "skipped": [],
                "message": "Couldn't turn that into an answer — try rephrasing."}

    valid, skipped = [], []
    for r in items:
        out = _execute_item(r, profile, df, repeat_tables or {})
        if "skip" in out:
            skipped.append({"title": out["title"], "reason": out["skip"]})
        else:
            valid.append(out)

    # Disambiguate duplicate names within this batch (captions map 1:1; UI keys unique).
    seen_names = set()
    for v in valid:
        base = v["recipe"].get("name") or v["title"] or v["kind"]
        name = base
        i = 2
        while name in seen_names:
            name = f"{base}_{i}"
            i += 1
        seen_names.add(name)
        v["recipe"] = {**v["recipe"], "name": name}

    captions = ground_captions(
        [{"name": v["recipe"]["name"], "title": v["title"], "summary": v["summary"]} for v in valid],
        ai_cfg,
    )
    proposals = []
    for v in valid:
        name = v["recipe"]["name"]
        base = {"kind": v["kind"], "recipe": v["recipe"], "caption": captions.get(name, v["title"])}
        if v["kind"] == "indicator":
            base["value"] = v["value"]
        else:
            try:
                base["image"] = _b64_png(v["png"])
            except Exception as e:  # noqa: BLE001
                log.warning(f"ask: could not read chart image for '{name}': {e}")
                skipped.append({"title": v["title"], "reason": "chart image unavailable"})
                continue
        proposals.append(base)
    return {"proposals": proposals, "skipped": skipped, "message": None}


def compute_indicator(recipe: Dict, df: pd.DataFrame,
                      repeat_tables: Dict[str, pd.DataFrame]) -> Optional[str]:
    """Compute a single indicator's formatted value via the indicator engine.
    Returns the value string, or None on failure / N/A."""
    from src.reports.indicators import compute_indicators
    name = recipe.get("name") or "indicator"
    ind = {k: v for k, v in recipe.items() if k != "kind"}
    ind["name"] = name
    # A `percent` stat returns e.g. 58.3; without an explicit format it renders as "58"
    # (default number). Default to the percent format so it shows "58.3%".
    if ind.get("stat") == "percent" and "format" not in ind:
        ind["format"] = "percent"
    try:
        result = compute_indicators([ind], df, repeat_tables or {})
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: compute_indicator failed for '{name}': {e}")
        return None
    val = result.get(f"ind_{name}")
    if val is None or val == "N/A":
        return None
    return val


def _propose_refinement(recipe: Dict, kind: str, instruction: str,
                        catalog: Dict, ai_cfg: Dict) -> Optional[Dict]:
    """Ask the LLM for a revised single recipe. Returns the item dict or None on failure."""
    provider = (ai_cfg.get("provider") or "openai").lower()
    variables = {
        "current_kind": kind,
        "current_recipe": json.dumps({k: v for k, v in recipe.items() if k != "kind"}, ensure_ascii=False),
        "instruction": instruction,
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "chart_types": _CHART_TYPES_BLOCK,
        "indicator_stats": _INDICATOR_STATS_BLOCK,
        "language": ai_cfg.get("language") or "English",
    }
    try:
        messages, _config = lf_client.get_prompt("ask_refine", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_refine",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
            output_schema=_config.get("output_schema"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: _propose_refinement failed: {e}")
        return None
    data = _loads_lenient(raw)
    if data and isinstance(data.get("item"), dict):
        return data["item"]
    return None


def refine_item(recipe: Dict, kind: str, instruction: str, cfg: Dict,
                df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Refine one existing answer with a NL instruction. Returns
    {"proposal": {...}|None, "skipped": {title,reason}|None, "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposal": None, "skipped": None,
                "message": "Configure an AI provider in Sources to ask questions."}
    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile, cfg)
    revised = _propose_refinement(recipe, kind, instruction, catalog, ai_cfg)
    if not revised:
        return {"proposal": None, "skipped": None,
                "message": "Couldn't apply that refinement — try rephrasing."}
    revised.setdefault("kind", kind)
    out = _execute_item(revised, profile, df, repeat_tables or {})
    if "skip" in out:
        return {"proposal": None, "skipped": {"title": out["title"], "reason": out["skip"]}, "message": None}
    name = out["recipe"].get("name") or out["title"]
    caps = ground_captions([{"name": name, "title": out["title"], "summary": out["summary"]}], ai_cfg)
    proposal = {"kind": out["kind"], "recipe": out["recipe"], "caption": caps.get(name, out["title"])}
    if out["kind"] == "indicator":
        proposal["value"] = out["value"]
    else:
        try:
            proposal["image"] = _b64_png(out["png"])
        except Exception as e:  # noqa: BLE001
            log.warning(f"ask: refine image read failed: {e}")
            return {"proposal": None, "skipped": {"title": out["title"], "reason": "chart image unavailable"}, "message": None}
    return {"proposal": proposal, "skipped": None, "message": None}


_SAVE_SECTIONS = {"indicator": "indicators", "table": "tables", "chart": "charts"}


def save_recipe(recipe: Dict, cfg: Dict, kind: str = "chart") -> str:
    """Append a recipe to the config section matching `kind`:
    'chart' → cfg['charts'], 'indicator' → cfg['indicators'], 'table' → cfg['tables'].
    De-duplicates the name and strips the 'kind' field; for tables, forces type 'table'.
    Mutates cfg; the caller persists via write_config. Returns the final name."""
    section = _SAVE_SECTIONS.get(kind, "charts")
    items = cfg.setdefault(section, [])
    existing = {c.get("name") for c in items}
    name = recipe.get("name") or kind
    if name in existing:
        i = 2
        while f"{name}_{i}" in existing:
            i += 1
        name = f"{name}_{i}"
    saved = {k: v for k, v in recipe.items() if k != "kind"}
    saved["name"] = name
    if kind == "table":
        saved["type"] = "table"
    items.append(saved)
    return name
