"""Results-framework (logframe) helpers.

A "framework" is a Goal → Outcomes → Outputs hierarchy. Indicators link to a
node via `framework_ref`. When `cfg["framework"]` is absent the project is in
"no-framework mode" — all helpers return None or []/[].
"""
from __future__ import annotations
from typing import Dict, List, Optional


def build_tree(cfg: Dict) -> Optional[Dict]:
    """Return the framework as a nested tree, or None if no framework is set.

    Tree shape:
        {id, label, level, children: [{id, label, level, children: [...]}]}

    When there is no `goal` but there are outcomes, the top of the tree is a
    synthetic root with id="(no goal)" so callers can iterate uniformly.
    """
    fw = cfg.get("framework") or {}
    outcomes = fw.get("outcomes", []) or []
    outputs  = fw.get("outputs",  []) or []
    if not (fw or outcomes or outputs):
        return None

    # Index outputs by their parent (outcome) id
    outputs_by_outcome: Dict[str, List[Dict]] = {}
    for op in outputs:
        outputs_by_outcome.setdefault(op.get("parent", ""), []).append(op)

    def _output_node(op: Dict) -> Dict:
        return {"id": op["id"], "label": op.get("label", ""), "level": "output", "children": []}

    def _outcome_node(oc: Dict) -> Dict:
        kids = [_output_node(op) for op in outputs_by_outcome.get(oc["id"], [])]
        return {"id": oc["id"], "label": oc.get("label", ""), "level": "outcome", "children": kids}

    goal = fw.get("goal")
    if goal:
        return {
            "id":       goal.get("id", "GOAL"),
            "label":    goal.get("label", ""),
            "level":    "goal",
            "children": [_outcome_node(oc) for oc in outcomes],
        }
    # No goal: synthetic root for uniform iteration
    return {
        "id":       "(no goal)",
        "label":    "(no goal set)",
        "level":    "goal",
        "children": [_outcome_node(oc) for oc in outcomes],
    }


def find_node(cfg: Dict, node_id: str) -> Optional[Dict]:
    """Look up a node by id across goal/outcomes/outputs. Returns dict with
    {id, label, level} or None."""
    fw = cfg.get("framework") or {}
    goal = fw.get("goal")
    if goal and goal.get("id") == node_id:
        return {"id": goal["id"], "label": goal.get("label", ""), "level": "goal"}
    for oc in fw.get("outcomes", []) or []:
        if oc.get("id") == node_id:
            return {"id": oc["id"], "label": oc.get("label", ""), "level": "outcome"}
    for op in fw.get("outputs", []) or []:
        if op.get("id") == node_id:
            return {"id": op["id"], "label": op.get("label", ""), "level": "output"}
    return None


def enumerate_nodes(cfg: Dict) -> List[Dict]:
    """Flat list of every framework node with breadcrumbs.

    Each entry: {id, label, level, breadcrumb}.
    breadcrumb is " › "-joined labels from root to node.
    """
    fw = cfg.get("framework") or {}
    out: List[Dict] = []
    goal = fw.get("goal")
    goal_label = goal.get("label", "") if goal else ""
    if goal:
        out.append({"id": goal["id"], "label": goal["label"], "level": "goal", "breadcrumb": goal["label"]})

    outcome_label_by_id: Dict[str, str] = {}
    for oc in fw.get("outcomes", []) or []:
        bc = f"{goal_label} › {oc['label']}" if goal_label else oc["label"]
        outcome_label_by_id[oc["id"]] = oc["label"]
        out.append({"id": oc["id"], "label": oc["label"], "level": "outcome", "breadcrumb": bc})

    for op in fw.get("outputs", []) or []:
        parent_label = outcome_label_by_id.get(op.get("parent", ""), "")
        parts = [goal_label, parent_label, op["label"]]
        parts = [p for p in parts if p]
        out.append({"id": op["id"], "label": op["label"], "level": "output", "breadcrumb": " › ".join(parts)})
    return out


def validate_refs(cfg: Dict) -> List[Dict]:
    """Return a list of indicators whose framework_ref does not exist.

    Each entry: {"indicator": name, "ref": <broken ref>}.
    Returns [] when there is no framework (nothing to validate against).
    """
    if not (cfg.get("framework") or {}):
        return []
    valid_ids = {n["id"] for n in enumerate_nodes(cfg)}
    orphans: List[Dict] = []
    for ind in cfg.get("indicators", []) or []:
        ref = ind.get("framework_ref")
        if ref and ref not in valid_ids:
            orphans.append({"indicator": ind.get("name", "?"), "ref": ref})
    return orphans
