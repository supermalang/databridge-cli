"""Deterministic starter charts from saved questions (no LLM).

Used by `run-all --auto-charts` so the pipeline can produce a report on a fresh
config. One chart per chartable question; other categories are skipped.
"""
from __future__ import annotations
import logging
from typing import Dict, List

from src.utils.periods import slugify

log = logging.getLogger(__name__)

# question category -> single-question chart type
DEFAULT_CHART_BY_CATEGORY = {
    "categorical": "bar",
    "quantitative": "histogram",
}
MAX_DEFAULT_CHARTS = 25


def default_charts_from_questions(cfg: Dict) -> List[Dict]:
    """Return a deterministic list of chart dicts derived from cfg['questions'].
    Empty when there are no chartable (categorical/quantitative) questions."""
    questions = cfg.get("questions") or []
    charts: List[Dict] = []
    used_names = set()
    eligible = 0
    for q in questions:
        ctype = DEFAULT_CHART_BY_CATEGORY.get((q or {}).get("category"))
        if not ctype:
            continue
        col = q.get("export_label") or q.get("label") or q.get("kobo_key")
        if not col:
            continue
        eligible += 1
        if len(charts) >= MAX_DEFAULT_CHARTS:
            continue
        name = slugify(col) or f"chart_{len(charts) + 1}"
        base, i = name, 2
        while name in used_names:
            name = f"{base}_{i}"
            i += 1
        used_names.add(name)
        charts.append({"name": name, "title": col, "type": ctype, "questions": [col]})
    if eligible > len(charts):
        log.warning(
            f"default_charts: {eligible} chartable questions but capped at "
            f"{MAX_DEFAULT_CHARTS}; skipped {eligible - len(charts)}."
        )
    return charts
