"""Period registry helpers for multi-period support.

A "period" is a named data-collection round (baseline / Q1 / midline / etc).
The registry lives under cfg["periods"] with this shape:

    periods:
      current:  "Q2 2026"
      baseline: "Q1 2026"
      registry:
        - label:   "Q1 2026"
          slug:    "q1_2026"
          started: 2026-01-01
          ended:   2026-03-31

When the registry is absent the project is in "single-period mode" — all
helpers return None so callers can fall back to legacy behavior.
"""
from __future__ import annotations
import re
import unicodedata
from typing import Dict, List, Optional


_SLUG_MAX = 32


def slugify(label: str) -> str:
    """Filesystem-safe slug from a period label."""
    s = unicodedata.normalize("NFD", label or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^a-zA-Z0-9]+", "_", s).strip("_").lower()
    return s[:_SLUG_MAX]


def _ensure_slug(entry: Dict) -> Dict:
    """Return a copy of a registry entry with `slug` populated."""
    out = dict(entry)
    if not out.get("slug"):
        out["slug"] = slugify(out.get("label", ""))
    return out


def current_period(cfg: Dict) -> Optional[Dict]:
    """Return {label, slug, ...} for the active period, or None in single-period mode."""
    p = cfg.get("periods") or {}
    label = p.get("current")
    if not label:
        return None
    for entry in p.get("registry", []) or []:
        if entry.get("label") == label:
            return _ensure_slug(entry)
    return {"label": label, "slug": slugify(label)}


def baseline_period(cfg: Dict) -> Optional[Dict]:
    """Return {label, slug, ...} for the baseline period, or None."""
    p = cfg.get("periods") or {}
    label = p.get("baseline")
    if not label:
        return None
    for entry in p.get("registry", []) or []:
        if entry.get("label") == label:
            return _ensure_slug(entry)
    return {"label": label, "slug": slugify(label)}


def all_periods(cfg: Dict) -> List[Dict]:
    """Return every registry entry as {label, slug, ...} dicts (slug auto-filled)."""
    p = cfg.get("periods") or {}
    return [_ensure_slug(e) for e in (p.get("registry", []) or [])]


def parse_period_arg(cfg: Dict, arg: Optional[str]) -> Optional[Dict]:
    """Resolve a CLI --period argument to a period dict.

    Priority: explicit `arg` > cfg.periods.current > None.
    An unknown label creates an ephemeral dict (the period need not be
    pre-registered — the writer will register it via /api/periods later).
    """
    if arg:
        return next(
            (e for e in all_periods(cfg) if e["label"] == arg),
            {"label": arg, "slug": slugify(arg)},
        )
    return current_period(cfg)


def period_data_glob(alias: str, slug: str) -> str:
    """Glob pattern for a period's main data files (used by load_processed_data)."""
    return f"{alias}_{slug}_data_*"
