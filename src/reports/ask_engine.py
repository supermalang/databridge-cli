"""The "Ask" question engine (Layer 4, Slice 1).

Question -> data-aware catalog (from the Layer 2 profile) -> LLM proposes chart
recipes -> validate against chart-type role requirements -> render locally ->
ground captions in computed values -> return. Charts can be saved into config.charts.
"""
from __future__ import annotations
import base64
import json
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

log = logging.getLogger(__name__)


def build_catalog(profile: Dict[str, Dict]) -> Dict:
    """Condense a profile_dataset result into a compact, token-friendly, data-aware
    catalog for the proposer prompt. Excludes linkage columns; keeps roles, cardinality,
    missingness, low-cardinality top-values, and numeric range."""
    tables = []
    for tname, tp in (profile or {}).items():
        cols = []
        for c in tp.get("columns", []):
            if c.get("role") == "linkage":
                continue
            entry = {
                "name": c["name"],
                "role": c.get("role"),
                "distinct": c.get("distinct"),
                "missing_pct": c.get("missing_pct"),
            }
            if "top_values" in c:
                entry["top_values"] = [tv["value"] for tv in c["top_values"]]
            if c.get("role") == "quantitative" and "min" in c:
                entry["min"] = c["min"]
                entry["max"] = c["max"]
            cols.append(entry)
        tables.append({"name": tname, "rows": tp.get("rows", 0), "columns": cols})
    return {"tables": tables}
