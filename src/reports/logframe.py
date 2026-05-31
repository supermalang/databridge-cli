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
                "indicators": [
                    {"name": str, "value": str, "baseline": str,
                     "target": str, "pct_achievement": str}, ...],
                # node-level achievement from the indicator flagged primary: true
                # (empty strings when no primary indicator on this node):
                "primary_indicator":    str,
                "node_value":           str,
                "node_target":          str,
                "node_pct_achievement": str,
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

    # Index indicators by framework_ref; track the primary indicator per node
    # (first one flagged primary: true) for the node-level achievement.
    indicators_by_ref: Dict[str, List[Dict]] = {}
    primary_by_ref: Dict[str, Dict] = {}
    for ind in cfg.get("indicators", []) or []:
        ref = ind.get("framework_ref")
        if not ref:
            continue
        name = ind.get("name", "")
        entry = {
            "name":            name,
            "value":           indicators_context.get(f"ind_{name}", ""),
            "baseline":        indicators_context.get(f"ind_{name}_baseline", ""),
            "target":          indicators_context.get(f"ind_{name}_target", ""),
            "pct_achievement": indicators_context.get(f"ind_{name}_pct_achievement", ""),
        }
        indicators_by_ref.setdefault(ref, []).append(entry)
        if ind.get("primary") and ref not in primary_by_ref:
            primary_by_ref[ref] = entry

    rows: List[Dict] = []

    def _row(node_id: str, label: str, level: str) -> Dict:
        prim = primary_by_ref.get(node_id)
        return {
            "id":                  node_id,
            "label":               label,
            "level":               level,
            "indent":              _LEVEL_INDENT.get(level, 0),
            "indicators":          indicators_by_ref.get(node_id, []),
            "primary_indicator":   prim["name"] if prim else "",
            "node_value":          prim["value"] if prim else "",
            "node_target":         prim["target"] if prim else "",
            "node_pct_achievement": prim["pct_achievement"] if prim else "",
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
