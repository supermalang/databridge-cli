"""Build-report staleness for `run-all` (Orchestrator Slice 2).

Content-based fingerprints + a sidecar so `run-all` can skip rebuilding an
up-to-date report. Safe-toward-rebuild: any uncertainty -> "stale" -> rebuild.
"""
from __future__ import annotations
import hashlib
import json
import logging
from pathlib import Path
from typing import Dict, Optional

log = logging.getLogger(__name__)

STATE_FILENAME = ".run_all_state.json"
# Config sections that affect a built report; any change here invalidates the cache.
_CONFIG_KEYS = ["charts", "indicators", "summaries", "views", "report",
                "framework", "pii", "periods", "questions"]


def _report_dir(cfg: Dict) -> Path:
    return Path(cfg.get("report", {}).get("output_dir", "reports"))


def data_fingerprint(cfg: Dict) -> Optional[str]:
    """sha256 (truncated) over the CONTENT of the data build-report would read for
    the current period. None when no data exists. Filename timestamps are ignored —
    only the data values matter (so an identical re-download yields the same fp)."""
    from src.data.transform import load_processed_data
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return None
    except Exception as e:  # noqa: BLE001
        log.warning(f"run_state: data_fingerprint load failed ({e}); treating as stale.")
        return None
    h = hashlib.sha256()
    h.update(df.to_csv(index=False).encode("utf-8"))
    for name in sorted(repeats or {}):
        h.update(name.encode("utf-8"))
        h.update(repeats[name].to_csv(index=False).encode("utf-8"))
    return h.hexdigest()[:16]


def config_fingerprint(cfg: Dict) -> str:
    """sha256 (truncated) over the report-relevant config sections (stable JSON)."""
    subset = {k: cfg.get(k) for k in _CONFIG_KEYS}
    blob = json.dumps(subset, sort_keys=True, default=str, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()[:16]


def load_state(cfg: Dict) -> Dict:
    try:
        return json.loads((_report_dir(cfg) / STATE_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(cfg: Dict, data_fp: Optional[str], config_fp: str, built_at: str) -> None:
    rdir = _report_dir(cfg)
    try:
        rdir.mkdir(parents=True, exist_ok=True)
        (rdir / STATE_FILENAME).write_text(
            json.dumps({"data": data_fp, "config": config_fp, "built_at": built_at}),
            encoding="utf-8",
        )
    except OSError as e:  # noqa: BLE001
        log.warning(f"run_state: could not save state: {e}")


def report_is_current(cfg: Dict) -> bool:
    """True iff a report exists AND the sidecar matches the current data + config
    fingerprints. Any miss / error -> False (rebuild)."""
    rdir = _report_dir(cfg)
    if not rdir.exists() or not any(rdir.glob("*.docx")):
        return False
    state = load_state(cfg)
    if not state:
        return False
    data_fp = data_fingerprint(cfg)
    if data_fp is None:
        return False
    return state.get("data") == data_fp and state.get("config") == config_fingerprint(cfg)
