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


def _parent_repeat(path: str, repeat_paths) -> Optional[str]:
    """Return the nearest ancestor repeat path, or None if the parent is the root."""
    prefixes = [p for p in repeat_paths if p != path and path.startswith(p + "/")]
    if not prefixes:
        return None
    return max(prefixes, key=lambda p: p.count("/"))


def _resolve_array(container: dict, full_path: str, rel_path: str):
    """Find a repeat array inside *container*, trying several key forms.

    Kobo/Ona JSON is inconsistent about whether a nested repeat array is keyed
    by its full path, a root-relative path, or just the leaf segment.
    """
    if not isinstance(container, dict):
        return None
    field = full_path.split("/")[-1]
    root_relative = "/".join(full_path.split("/")[1:]) if "/" in full_path else field
    for key in (full_path, rel_path, root_relative, field):
        val = container.get(key)
        if isinstance(val, list):
            return val
    # Fall back to walking nested dicts along rel_path (plain-group nesting).
    obj = container
    for part in rel_path.split("/"):
        if isinstance(obj, dict) and part in obj:
            obj = obj[part]
        else:
            return None
    return obj if isinstance(obj, list) else None


def _read_field(entry: dict, q: dict):
    """Read one question's value from a repeat entry, trying key forms."""
    key = q["kobo_key"]
    field = key.split("/")[-1]
    relative = "/".join(key.split("/")[1:]) if "/" in key else field
    for k in (key, relative, field):
        if k in entry:
            return entry[k]
    return None
