import logging
from pathlib import Path
from typing import Dict, List, Any, Optional
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
    platform = cfg.get("api", {}).get("platform", "kobo").lower()
    log.info(f"Fetching schema for UID '{cfg['form']['uid']}' ({platform}) ...")
    asset = client.get_form_schema()
    questions = _parse_schema(asset, platform)
    if not questions:
        raise ValueError("No questions found. Check form UID and token permissions.")
    existing = {q["kobo_key"]: q for q in cfg.get("questions", [])}
    merged = []
    for q in questions:
        if q["kobo_key"] in existing:
            prev = existing[q["kobo_key"]]
            prev_cat = prev.get("category", q["category"])
            q["category"] = prev_cat if prev_cat != "undefined" else q["category"]
            q["export_label"] = prev.get("export_label", q["export_label"])
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

def _parse_schema(asset: Dict, platform: str = "kobo") -> List[Dict]:
    if platform == "ona":
        survey = asset if isinstance(asset, list) else asset.get("children", [])
        return _parse_ona_recursive(survey, [], [])
    else:
        survey = asset.get("content", {}).get("survey", [])
        choices_raw = asset.get("content", {}).get("choices", [])
        choice_map = _build_kobo_choice_map(choices_raw)
        return _parse_kobo_flat(survey, choice_map)


def _build_kobo_choice_map(choices_raw: List[Dict]) -> Dict[str, Dict[str, str]]:
    """Build {list_name: {code: label}} from asset["content"]["choices"]."""
    result: Dict[str, Dict[str, str]] = {}
    for item in choices_raw:
        list_name = item.get("list_name", "")
        name = str(item.get("name", "")).strip()
        label = _resolve_label(item.get("label", name))
        if list_name and name:
            result.setdefault(list_name, {})[name] = label
    return result


def _parse_kobo_flat(survey: List[Dict], choice_map: Optional[Dict] = None) -> List[Dict]:
    """Parse Kobo's flat survey list with begin_group/end_group markers."""
    questions: List[Dict] = []
    group_stack: List[str] = []
    repeat_stack: List[str] = []
    for item in survey:
        raw_type = item.get("type", "")
        if raw_type == "begin_group":
            group_stack.append(item.get("name", "")); continue
        if raw_type == "begin_repeat":
            name = item.get("name", "")
            group_stack.append(name)
            repeat_stack.append(name)
            continue
        if raw_type == "end_group":
            if group_stack: group_stack.pop()
            continue
        if raw_type == "end_repeat":
            if group_stack: group_stack.pop()
            if repeat_stack: repeat_stack.pop()
            continue
        q = _make_question(item, raw_type, group_stack, repeat_stack, choice_map)
        if q:
            questions.append(q)
    return questions


_ONA_TYPE_ALIASES = {
    "select one": "select_one",
    "select many": "select_multiple",
    "select all that apply": "select_multiple",
}

def _normalize_ona_type(raw_type: str) -> str:
    """Normalize Ona type strings to match Kobo conventions."""
    return _ONA_TYPE_ALIASES.get(raw_type.strip().lower(), raw_type)


def _parse_ona_recursive(children: List[Dict], group_stack: List[str], repeat_stack: List[str]) -> List[Dict]:
    """Parse Ona's recursive children structure."""
    questions: List[Dict] = []
    for item in children:
        raw_type = _normalize_ona_type(item.get("type", ""))
        name = item.get("name", "")
        nested = item.get("children", [])
        if raw_type == "group" and nested:
            group_stack.append(name)
            questions.extend(_parse_ona_recursive(nested, group_stack, repeat_stack))
            group_stack.pop()
        elif raw_type == "repeat" and nested:
            group_stack.append(name)
            repeat_stack.append(name)
            questions.extend(_parse_ona_recursive(nested, group_stack, repeat_stack))
            repeat_stack.pop()
            group_stack.pop()
        else:
            # For Ona, choices are embedded as children of select questions
            ona_choices = None
            base_type = raw_type.strip().split()[0]
            if base_type in ("select_one", "select_multiple") and nested:
                ona_choices = {
                    str(c.get("name", "")).strip(): _resolve_label(c.get("label", c.get("name", "")))
                    for c in nested if c.get("name")
                }
            q = _make_question(item, raw_type, group_stack, repeat_stack, ona_choices)
            if q:
                questions.append(q)
    return questions


def _make_question(item: Dict, raw_type: str, group_stack: List[str], repeat_stack: List[str],
                   choice_map: Optional[Dict] = None) -> Optional[Dict]:
    """Build a question dict from a survey item, or return None if it should be skipped."""
    parts = raw_type.strip().split()
    q_type = parts[0] if parts else raw_type
    choice_list = parts[1] if len(parts) > 1 else None
    if q_type in SKIP_TYPES:
        return None
    name = item.get("name", "").strip()
    if not name or any(name.startswith(p) for p in SKIP_PREFIXES):
        return None
    group_path = "/".join(group_stack)
    kobo_key = f"{group_path}/{name}" if group_path else name
    label = _resolve_label(item.get("label", name))
    repeat_group = repeat_stack[-1] if repeat_stack else None
    # Resolve choices: for Kobo, look up by choice_list name; for Ona, choice_map is already the inline dict
    choices = None
    if choice_map:
        if choice_list:
            choices = choice_map.get(choice_list) or None
        elif q_type in ("select_one", "select_multiple"):
            # Ona inline: choice_map passed directly as {code: label}
            choices = choice_map or None
    return {
        "kobo_key": kobo_key, "label": label, "type": q_type,
        "category": TYPE_CATEGORY_MAP.get(q_type, "undefined"),
        "group": group_path, "choice_list": choice_list, "export_label": label,
        "repeat_group": repeat_group, "choices": choices,
    }

def _resolve_label(label: Any) -> str:
    if isinstance(label, str): return label.strip()
    if isinstance(label, list) and label: return str(label[0]).strip()
    if isinstance(label, dict):
        for v in label.values():
            if v: return str(v).strip()
    return str(label)
