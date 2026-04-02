import logging
from pathlib import Path
from typing import Dict, List, Any
from src.utils.config import write_config

log = logging.getLogger(__name__)

TYPE_CATEGORY_MAP = {
    "select_one": "categorical", "select_multiple": "categorical",
    "integer": "quantitative", "decimal": "quantitative", "range": "quantitative",
    "text": "qualitative", "note": "qualitative",
    "gps": "geographical", "geotrace": "geographical", "geoshape": "geographical",
    "date": "date", "datetime": "date", "time": "date",
}
SKIP_TYPES = {"start","end","deviceid","simserial","phonenumber","audit","calculate"}
SKIP_PREFIXES = ("_","meta/","formhub/","__")

def fetch_and_write_questions(client, cfg: Dict, config_path: Path) -> None:
    log.info(f"Fetching schema for UID '{cfg['form']['uid']}' ...")
    asset = client.get_form_schema()
    questions = _parse_schema(asset)
    if not questions:
        raise ValueError("No questions found. Check form UID and token permissions.")
    existing = {q["kobo_key"]: q for q in cfg.get("questions", [])}
    merged = []
    for q in questions:
        if q["kobo_key"] in existing:
            q["category"] = existing[q["kobo_key"]].get("category", q["category"])
            q["export_label"] = existing[q["kobo_key"]].get("export_label", q["export_label"])
        merged.append(q)
    cfg["questions"] = merged
    write_config(cfg, config_path)
    by_cat: Dict[str,int] = {}
    for q in merged:
        by_cat[q["category"]] = by_cat.get(q["category"], 0) + 1
    log.info(f"Written {len(merged)} questions to config.yml:")
    for cat, count in sorted(by_cat.items()):
        log.info(f"  {cat:<15} {count} question(s)")
    log.info("Next: edit config.yml, then run: python3 src/data/make.py download")

def _parse_schema(asset: Dict) -> List[Dict]:
    survey = asset.get("content", {}).get("survey", [])
    questions: List[Dict] = []
    group_stack: List[str] = []
    for item in survey:
        raw_type = item.get("type", "")
        if raw_type in ("begin_group","begin_repeat"):
            group_stack.append(item.get("name","")); continue
        if raw_type in ("end_group","end_repeat"):
            if group_stack: group_stack.pop()
            continue
        parts = raw_type.strip().split()
        q_type = parts[0] if parts else raw_type
        choice_list = parts[1] if len(parts) > 1 else None
        if q_type in SKIP_TYPES: continue
        name = item.get("name","").strip()
        if not name or any(name.startswith(p) for p in SKIP_PREFIXES): continue
        group_path = "/".join(group_stack)
        kobo_key = f"{group_path}/{name}" if group_path else name
        label = _resolve_label(item.get("label", name))
        questions.append({
            "kobo_key": kobo_key, "label": label, "type": q_type,
            "category": TYPE_CATEGORY_MAP.get(q_type, "undefined"),
            "group": group_path, "choice_list": choice_list, "export_label": label,
        })
    return questions

def _resolve_label(label: Any) -> str:
    if isinstance(label, str): return label.strip()
    if isinstance(label, list) and label: return str(label[0]).strip()
    if isinstance(label, dict):
        for v in label.values():
            if v: return str(v).strip()
    return str(label)
