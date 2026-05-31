"""Build a Jinja-friendly logframe table from the framework + computed indicators.

The returned dict has shape:
    {
        "has_framework": bool,
        "rows": [
            {
                "id":        str,
                "label":     str,
                "level":     "goal" | "outcome" | "output",
                "indent":    int,                    # 0 for goal, 1 outcome, 2 output
                "indicators": [{"name": str, "value": str}, ...],
            },
            ...
        ],
    }

Order: depth-first (goal, then each outcome, then each output under that outcome).
Templates can iterate `{% for row in logframe.rows %}` and indent visually
based on `row.indent`.
"""
from __future__ import annotations
from typing import Dict, List


_LEVEL_INDENT = {"goal": 0, "outcome": 1, "output": 2}


def build_logframe(cfg: Dict, indicators_context: Dict[str, str]) -> Dict:
    """Build the logframe data structure for Jinja rendering."""
    fw = cfg.get("framework") or {}
    if not fw:
        return {"has_framework": False, "rows": []}

    # Index indicators by framework_ref
    indicators_by_ref: Dict[str, List[Dict]] = {}
    for ind in cfg.get("indicators", []) or []:
        ref = ind.get("framework_ref")
        if not ref:
            continue
        name = ind.get("name", "")
        value = indicators_context.get(f"ind_{name}", "")
        indicators_by_ref.setdefault(ref, []).append({"name": name, "value": value})

    rows: List[Dict] = []

    def _row(node_id: str, label: str, level: str) -> Dict:
        return {
            "id":         node_id,
            "label":      label,
            "level":      level,
            "indent":     _LEVEL_INDENT.get(level, 0),
            "indicators": indicators_by_ref.get(node_id, []),
        }

    goal = fw.get("goal")
    if goal:
        rows.append(_row(goal["id"], goal.get("label", ""), "goal"))

    outputs_by_outcome: Dict[str, List[Dict]] = {}
    for op in fw.get("outputs", []) or []:
        outputs_by_outcome.setdefault(op.get("parent", ""), []).append(op)

    for oc in fw.get("outcomes", []) or []:
        rows.append(_row(oc["id"], oc.get("label", ""), "outcome"))
        for op in outputs_by_outcome.get(oc["id"], []):
            rows.append(_row(op["id"], op.get("label", ""), "output"))

    return {"has_framework": True, "rows": rows}
