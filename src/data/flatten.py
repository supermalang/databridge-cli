"""Recursive multi-level flattening of Kobo/Ona submissions into base tables.

A "base table" is a flat DataFrame for one repeat level. Every row carries
linkage columns so any level can be joined to its immediate parent and to the
root submission. Repeat groups are identified by their full slash-path
(e.g. "household/members"); nesting is derived from path prefixes
("household/members/illnesses" is a child of "household/members").
"""
from typing import Dict, List, Optional
import pandas as pd

LINKAGE_COLS = ["_parent_index", "_root_id", "_parent_row_id", "_row_id", "_row_index"]


def _dedup_labels(labels: List[str]) -> List[str]:
    """Return labels with duplicates suffixed _1, _2, … preserving order."""
    seen: Dict[str, int] = {}
    out: List[str] = []
    for label in labels:
        if label in seen:
            seen[label] += 1
            out.append(f"{label}_{seen[label]}")
        else:
            seen[label] = 0
            out.append(label)
    return out
