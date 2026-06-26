import os, logging
from pathlib import Path
from typing import Dict, Any
import yaml

log = logging.getLogger(__name__)
CONFIG_PATH = Path("config.yml")
REQUIRED_KEYS = ["api", "form"]

def load_config(path: Path = CONFIG_PATH) -> Dict:
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}\nCopy sample.config.yml → config.yml")
    with open(path, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    cfg = _resolve_env(cfg)
    # Multi-form (ME-4): forms are listed under api.forms, so a top-level `form`
    # key is not required. Single-form still requires `form` (unchanged).
    multiform = bool((cfg.get("api", {}) or {}).get("forms"))
    required = ["api"] if multiform else REQUIRED_KEYS
    for key in required:
        if key not in cfg:
            raise ValueError(f"Missing key '{key}' in {path}")
    platform = cfg.get("api", {}).get("platform", "kobo").lower()
    if platform not in ("kobo", "ona"):
        raise ValueError(f"api.platform must be 'kobo' or 'ona', got '{platform}'")
    return cfg

def write_config(cfg: Dict, path: Path = CONFIG_PATH) -> None:
    with open(path, "w", encoding="utf-8") as f:
        yaml.dump(cfg, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
    log.info(f"Config updated → {path}")

def is_effective_hidden(q: Dict) -> bool:
    """A question's effective-hidden state: explicit `hidden: true`, else
    defaults to True for `note` type fields."""
    return bool(q.get("hidden", q.get("type") == "note"))


def is_pii(q: Dict) -> bool:
    """Whether a question is flagged as containing PII (sensitive)."""
    return bool(q.get("pii"))


def llm_safe_questions(cfg: Dict) -> list:
    """Return cfg['questions'] EXCLUDING any question that is effective-hidden
    or PII-flagged. This is the single gate enforcing the rule that LLM features
    must never see hidden or sensitive columns' metadata."""
    questions = cfg.get("questions", []) or []
    return [q for q in questions
            if not is_effective_hidden(q) and not is_pii(q)]


def llm_safe_column_names(cfg: Dict) -> set:
    """Export-label/label/kobo_key names of the llm-safe questions — useful for
    dropping unsafe columns from a data-derived catalog (e.g. a profile)."""
    names: set = set()
    for q in llm_safe_questions(cfg):
        for k in ("export_label", "label", "kobo_key"):
            v = q.get(k)
            if v:
                names.add(v)
    return names


def question_column_name(q: Dict):
    """The DataFrame column name a question maps to: export_label → label → kobo_key."""
    return q.get("export_label") or q.get("label") or q.get("kobo_key")


def excluded_column_names(cfg: Dict) -> set:
    """Resolved column names of questions that are effective-hidden OR PII-flagged.
    These are dropped from the analytical/EDA views (profile, validate, data-quality)
    so those stages match Load/Analyze/Present, which never surface hidden/PII data."""
    names: set = set()
    for q in cfg.get("questions", []) or []:
        if is_effective_hidden(q) or is_pii(q):
            col = question_column_name(q)
            if col:
                names.add(col)
    return names


def drop_excluded_columns(cfg: Dict, df, repeats):
    """Return (df, repeats) with every hidden/PII column removed from the main table
    and each repeat table. No-op when nothing is flagged. Linkage/computed columns
    (not tied to a flagged question) are preserved."""
    excl = excluded_column_names(cfg)
    if not excl:
        return df, repeats
    def _drop(t):
        if t is None:
            return t
        cols = [c for c in t.columns if c in excl]
        return t.drop(columns=cols, errors="ignore") if cols else t
    df = _drop(df)
    repeats = {name: _drop(t) for name, t in (repeats or {}).items()}
    return df, repeats


def _resolve_env(cfg: Dict) -> Dict:
    def _walk(obj: Any) -> Any:
        if isinstance(obj, dict): return {k: _walk(v) for k, v in obj.items()}
        if isinstance(obj, list): return [_walk(v) for v in obj]
        if isinstance(obj, str) and obj.startswith("env:"):
            var = obj[4:].strip()
            val = os.environ.get(var)
            if val is None: log.warning(f"Env var '{var}' not set.")
            return val or obj
        return obj
    return _walk(cfg)
