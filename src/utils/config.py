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
    for key in REQUIRED_KEYS:
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
