"""Build a provenance dict for the Word template.

Exposes the audit trail: when the report was generated, when the data was
downloaded, how many submissions were used, which filters were applied,
and a short hash of the config so two reports can be compared.
"""
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import pandas as pd


def build_provenance(
    cfg: Dict,
    df: pd.DataFrame,
    data_downloaded_at: Optional[str] = None,
) -> Dict:
    """Return a dict with provenance fields for Jinja rendering.

    Args:
        cfg: full config.yml dict
        df: the main DataFrame the report was rendered from
        data_downloaded_at: ISO timestamp of the data file's mtime, or None

    Returns dict with keys:
        generated_at, data_downloaded_at, n_submissions, filters,
        config_hash, period, footer
    """
    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
    n = int(len(df)) if df is not None else 0
    filters = list(cfg.get("filters") or [])
    period = (cfg.get("report") or {}).get("period", "") or ""

    # Stable hash of the config — excludes anything time-varying or secret.
    cfg_for_hash = {
        "form":       cfg.get("form", {}),
        "questions":  [q.get("kobo_key") for q in (cfg.get("questions") or [])],
        "filters":    filters,
        "charts":     [c.get("name") for c in (cfg.get("charts") or [])],
        "indicators": [i.get("name") for i in (cfg.get("indicators") or [])],
        "summaries":  [s.get("name") for s in (cfg.get("summaries") or [])],
        "views":      [v.get("name") for v in (cfg.get("views") or [])],
    }
    blob = json.dumps(cfg_for_hash, sort_keys=True, ensure_ascii=False).encode("utf-8")
    config_hash = hashlib.sha256(blob).hexdigest()[:12]

    parts = [f"Generated {generated_at}", f"n={n}"]
    if period:
        parts.append(f"period={period}")
    if data_downloaded_at:
        parts.append(f"data {data_downloaded_at}")
    parts.append(f"cfg {config_hash}")
    footer = " · ".join(parts)

    return {
        "generated_at":       generated_at,
        "data_downloaded_at": data_downloaded_at or "",
        "n_submissions":      n,
        "filters":            filters,
        "config_hash":        config_hash,
        "period":             period,
        "footer":             footer,
    }


def data_mtime(data_dir: Path, alias: str) -> Optional[str]:
    """Find the latest main data file for the given form alias and return its
    mtime as an ISO string, or None if not found."""
    candidates = sorted(
        Path(data_dir).glob(f"{alias}_data_*.csv"),
        key=lambda p: p.stat().st_mtime, reverse=True,
    )
    if not candidates:
        return None
    ts = datetime.fromtimestamp(candidates[0].stat().st_mtime)
    return ts.strftime("%Y-%m-%d %H:%M")
