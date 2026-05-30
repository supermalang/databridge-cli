# Layer 1 — Base Tables (Recursive Flattening + Linkage) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flatten Kobo/Ona submissions into one base table per repeat level — including nested sub-repeats — with linkage columns so any level joins to its immediate parent and to the root submission.

**Architecture:** Extract the repeat-table construction out of `load_data` into a new, pure, testable module `src/data/flatten.py`. It walks the repeat-group hierarchy (derived from slash-path prefixes), descending *through lists* (the current bug is that `_resolve_nested` only walks dicts), and emits linkage columns on every row. `load_data` calls it, then applies the existing type-cast and choice-label steps unchanged. A read-only `/api/base-tables` endpoint exposes the resulting catalog to the web UI (web-first delivery).

**Tech Stack:** Python 3, pandas, pytest, FastAPI (+ `fastapi.testclient`).

**Scope note / deferred:** Column-name **slugification + dedup** (the other Layer-1 item in the architecture doc) is intentionally NOT in this plan — it renames every column and would break existing configs and the 138-test suite. It is deferred to a separate "Layer 1b" migration plan. This plan keeps repeat-table column names as the existing `export_label` values (last-wins on duplicates, matching current behavior) so all downstream consumers and tests keep working.

---

## Backward-compatibility contract (must hold after this plan)

- `repeat_tables` is still keyed by the full slash-path (e.g. `household/members`).
- Every repeat row still has `_parent_index` equal to the **root submission id** (the existing meaning), so `apply_filters` (transform.py:253), `apply_computed_columns` (transform.py:284,289), `join_repeat_to_main` (transform.py:655), and `builder._filter_repeat_tables_by_split` keep working unchanged.
- Repeat columns are still the `export_label` values; `_cast` and `apply_choice_labels` are applied exactly as before.
- New columns are added (all underscore-prefixed, so the cast/choice-label loops — which iterate `questions` — never touch them): `_root_id`, `_parent_row_id`, `_row_id`. (`_parent_index` and `_row_index` already existed.)
- Empty repeat groups are omitted from `repeat_tables` (current behavior).
- The full existing suite (`pytest tests/`) stays green.

## Linkage column semantics

For a row at any repeat level:

| Column | Meaning | Top-level repeat | Sub-repeat |
|---|---|---|---|
| `_root_id` | id of the root submission this row descends from | submission `_id` | submission `_id` |
| `_parent_index` | **alias of `_root_id`** (backward-compat) | = `_root_id` | = `_root_id` |
| `_parent_row_id` | `_row_id` of the immediate parent repeat row | = `_root_id` (the submission) | parent row's `_row_id` |
| `_row_id` | stable composite id `"<parent_row_id>.<idx>"` | `"12.0"` | `"12.0.1"` |
| `_row_index` | position within the immediate parent | `0,1,2…` | `0,1,2…` |

Example (root submission id `12`, member index `0`, that member's illness index `1`):
`members._row_id = "12.0"`, `illnesses._parent_row_id = "12.0"`, `illnesses._row_id = "12.0.1"`, `illnesses._root_id = 12`.

---

## File structure

- **Create:** `src/data/flatten.py` — pure flattening logic (no cfg, no I/O).
- **Create:** `tests/test_flatten.py` — unit tests for the flattening module.
- **Modify:** `src/data/transform.py` — `load_data` calls `build_repeat_tables` instead of the inline single-level loop (replaces lines ~169-201).
- **Create:** `tests/test_load_data_nested.py` — integration test that nested repeats populate through `load_data`.
- **Modify:** `web/main.py` — add `GET /api/base-tables` catalog endpoint.
- **Create:** `tests/test_base_tables_api.py` — endpoint test.
- **Modify:** `CLAUDE.md` — document the repeat-table linkage columns.

---

## Task 1: `_dedup_labels` helper

**Files:**
- Create: `src/data/flatten.py`
- Test: `tests/test_flatten.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_flatten.py
from src.data.flatten import _dedup_labels


def test_dedup_labels_suffixes_duplicates_in_order():
    assert _dedup_labels(["Region", "Region", "Age", "Region"]) == [
        "Region", "Region_1", "Age", "Region_2",
    ]


def test_dedup_labels_leaves_unique_untouched():
    assert _dedup_labels(["A", "B", "C"]) == ["A", "B", "C"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.data.flatten'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/data/flatten.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/flatten.py tests/test_flatten.py
git commit -m "feat(flatten): add _dedup_labels helper for base-table construction"
```

---

## Task 2: `_parent_repeat` hierarchy helper

**Files:**
- Modify: `src/data/flatten.py`
- Test: `tests/test_flatten.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_flatten.py
from src.data.flatten import _parent_repeat


def test_parent_repeat_top_level_has_no_parent():
    paths = ["household/members", "household/members/illnesses"]
    assert _parent_repeat("household/members", paths) is None


def test_parent_repeat_returns_nearest_ancestor():
    paths = ["household/members", "household/members/illnesses"]
    assert _parent_repeat("household/members/illnesses", paths) == "household/members"


def test_parent_repeat_picks_longest_prefix():
    paths = ["a", "a/b", "a/b/c"]
    assert _parent_repeat("a/b/c", paths) == "a/b"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_flatten.py::test_parent_repeat_returns_nearest_ancestor -v`
Expected: FAIL — `ImportError: cannot import name '_parent_repeat'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/flatten.py
def _parent_repeat(path: str, repeat_paths) -> Optional[str]:
    """Return the nearest ancestor repeat path, or None if the parent is the root."""
    prefixes = [p for p in repeat_paths if p != path and path.startswith(p + "/")]
    if not prefixes:
        return None
    return max(prefixes, key=lambda p: p.count("/"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/flatten.py tests/test_flatten.py
git commit -m "feat(flatten): add _parent_repeat hierarchy resolver"
```

---

## Task 3: Array + field resolvers (tolerant key matching)

**Files:**
- Modify: `src/data/flatten.py`
- Test: `tests/test_flatten.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_flatten.py
from src.data.flatten import _resolve_array, _read_field


def test_resolve_array_matches_full_path_key():
    container = {"household/members": [{"x": 1}]}
    assert _resolve_array(container, "household/members", "household/members") == [{"x": 1}]


def test_resolve_array_matches_relative_key():
    member = {"members/illnesses": [{"t": "flu"}]}
    assert _resolve_array(member, "household/members/illnesses", "illnesses") == [{"t": "flu"}]


def test_resolve_array_matches_leaf_key():
    member = {"illnesses": [{"t": "flu"}]}
    assert _resolve_array(member, "household/members/illnesses", "illnesses") == [{"t": "flu"}]


def test_resolve_array_returns_none_when_absent():
    assert _resolve_array({"other": 1}, "a/b", "b") is None


def test_read_field_tries_full_then_relative_then_leaf():
    q = {"kobo_key": "household/members/name"}
    assert _read_field({"household/members/name": "A"}, q) == "A"
    assert _read_field({"members/name": "B"}, q) == "B"
    assert _read_field({"name": "C"}, q) == "C"
    assert _read_field({"other": "Z"}, q) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_flatten.py::test_resolve_array_matches_leaf_key -v`
Expected: FAIL — `ImportError: cannot import name '_resolve_array'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/flatten.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/flatten.py tests/test_flatten.py
git commit -m "feat(flatten): add tolerant array/field key resolvers"
```

---

## Task 4: `build_repeat_tables` — single-level parity

**Files:**
- Modify: `src/data/flatten.py`
- Test: `tests/test_flatten.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_flatten.py
from src.data.flatten import build_repeat_tables


def _single_level_fixture():
    submissions = [
        {"_id": 12, "region": "North",
         "household/members": [
             {"household/members/name": "A", "household/members/age": 30},
             {"household/members/name": "B", "household/members/age": 5},
         ]},
        {"_id": 13, "region": "South", "household/members": []},
    ]
    repeat_groups = {
        "household/members": [
            {"kobo_key": "household/members/name", "export_label": "Name", "category": "qualitative"},
            {"kobo_key": "household/members/age", "export_label": "Age", "category": "quantitative"},
        ]
    }
    return submissions, repeat_groups


def test_build_repeat_tables_single_level_rows_and_values():
    submissions, repeat_groups = _single_level_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    members = tables["household/members"]
    assert len(members) == 2
    assert list(members["Name"]) == ["A", "B"]
    assert list(members["Age"]) == [30, 5]


def test_build_repeat_tables_single_level_linkage_matches_root_id():
    submissions, repeat_groups = _single_level_fixture()
    members = build_repeat_tables(submissions, repeat_groups)["household/members"]
    # backward-compat: _parent_index is the root submission id (int 12), not a string
    assert list(members["_parent_index"]) == [12, 12]
    assert list(members["_root_id"]) == [12, 12]
    assert list(members["_parent_row_id"]) == [12, 12]
    assert list(members["_row_id"]) == ["12.0", "12.1"]
    assert list(members["_row_index"]) == [0, 1]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_flatten.py::test_build_repeat_tables_single_level_rows_and_values -v`
Expected: FAIL — `ImportError: cannot import name 'build_repeat_tables'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/data/flatten.py
def build_repeat_tables(
    submissions: List[dict],
    repeat_groups: Dict[str, List[dict]],
) -> Dict[str, pd.DataFrame]:
    """Flatten every repeat level into a base table keyed by full repeat-path.

    repeat_groups: {full_path: [question dicts]} (as built by load_data).
    Returns {full_path: DataFrame} with LINKAGE_COLS + one column per question
    (export_label). Empty groups yield an empty DataFrame.
    """
    # Process parents before children so a child can descend into parent entries.
    order = sorted(repeat_groups.keys(), key=lambda p: p.count("/"))
    # entries_by_table[path] = list of (row_id, entry_dict, root_id) to descend into.
    entries_by_table: Dict[str, List] = {}
    tables: Dict[str, pd.DataFrame] = {}

    def _root_seed():
        seed = []
        for i, sub in enumerate(submissions):
            rid = sub.get("_id", sub.get("_index", i))
            seed.append((rid, sub, rid))
        return seed

    for path in order:
        parent = _parent_repeat(path, repeat_groups.keys())
        if parent is None:
            parent_entries = _root_seed()
            rel = path
        else:
            parent_entries = entries_by_table.get(parent, [])
            rel = path[len(parent) + 1:]

        questions = repeat_groups[path]
        labels = [q.get("export_label") or q.get("label") or q["kobo_key"] for q in questions]

        rows = []
        child_entries = []
        for parent_row_id, parent_entry, root_id in parent_entries:
            arr = _resolve_array(parent_entry, path, rel)
            if not isinstance(arr, list):
                continue
            for idx, entry in enumerate(arr):
                if not isinstance(entry, dict):
                    continue
                row_id = f"{parent_row_id}.{idx}"
                row = {
                    "_parent_index": root_id,
                    "_root_id": root_id,
                    "_parent_row_id": parent_row_id,
                    "_row_id": row_id,
                    "_row_index": idx,
                }
                for q, label in zip(questions, labels):
                    row[label] = _read_field(entry, q)
                rows.append(row)
                child_entries.append((row_id, entry, root_id))
        entries_by_table[path] = child_entries
        tables[path] = (
            pd.DataFrame(rows) if rows
            else pd.DataFrame(columns=LINKAGE_COLS + labels)
        )

    return tables
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```bash
git add src/data/flatten.py tests/test_flatten.py
git commit -m "feat(flatten): build_repeat_tables with root-linked single-level base tables"
```

---

## Task 5: `build_repeat_tables` — nested sub-repeats (the core fix)

**Files:**
- Test: `tests/test_flatten.py` (no implementation change — Task 4's code already handles nesting; this task proves it and guards against regression)

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_flatten.py
def _nested_fixture():
    submissions = [
        {"_id": 12,
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
                  {"household/members/illnesses/type": "cold"},
              ]},
             {"household/members/name": "B",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "fever"},
              ]},
         ]},
    ]
    repeat_groups = {
        "household/members": [
            {"kobo_key": "household/members/name", "export_label": "Name", "category": "qualitative"},
        ],
        "household/members/illnesses": [
            {"kobo_key": "household/members/illnesses/type", "export_label": "Illness", "category": "qualitative"},
        ],
    }
    return submissions, repeat_groups


def test_nested_subrepeat_is_populated_not_empty():
    # On the pre-fix code this table was EMPTY (the bug). It must now have 3 rows.
    submissions, repeat_groups = _nested_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    illnesses = tables["household/members/illnesses"]
    assert len(illnesses) == 3
    assert list(illnesses["Illness"]) == ["flu", "cold", "fever"]


def test_nested_subrepeat_links_to_immediate_parent_and_root():
    submissions, repeat_groups = _nested_fixture()
    tables = build_repeat_tables(submissions, repeat_groups)
    members = tables["household/members"]
    illnesses = tables["household/members/illnesses"]
    # member A is _row_id "12.0", member B is "12.1"
    assert list(members["_row_id"]) == ["12.0", "12.1"]
    # flu+cold belong to member A (12.0); fever to member B (12.1)
    assert list(illnesses["_parent_row_id"]) == ["12.0", "12.0", "12.1"]
    assert list(illnesses["_row_id"]) == ["12.0.0", "12.0.1", "12.1.0"]
    # every illness still traces to the root submission
    assert list(illnesses["_root_id"]) == [12, 12, 12]
    # join illnesses -> members on _parent_row_id == _row_id works
    joined = illnesses.merge(members[["_row_id", "Name"]],
                             left_on="_parent_row_id", right_on="_row_id",
                             suffixes=("", "_member"))
    assert list(joined["Name"]) == ["A", "A", "B"]
```

- [ ] **Step 2: Run test to verify it fails (then passes)**

Run: `PYTHONPATH=. pytest tests/test_flatten.py::test_nested_subrepeat_is_populated_not_empty -v`
Expected: PASS — Task 4's recursive descent already handles this. (If it FAILS, the descent in Task 4 is wrong — fix `build_repeat_tables`, do not weaken the test.)

- [ ] **Step 3: (no implementation change)**

This task is a behavioral guard. If both tests pass, proceed. If not, the bug is in `build_repeat_tables`'s parent-descent loop.

- [ ] **Step 4: Run the full flatten suite**

Run: `PYTHONPATH=. pytest tests/test_flatten.py -v`
Expected: PASS (14 passed)

- [ ] **Step 5: Commit**

```bash
git add tests/test_flatten.py
git commit -m "test(flatten): guard nested sub-repeat linkage (root + immediate parent)"
```

---

## Task 6: Integrate `build_repeat_tables` into `load_data`

**Files:**
- Modify: `src/data/transform.py` (replace the repeat-table loop, currently lines ~169-201)
- Test: `tests/test_load_data_nested.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_load_data_nested.py
from src.data.transform import load_data


def test_load_data_populates_nested_repeats():
    submissions = [
        {"_id": 12, "region": "North",
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
              ]},
         ]},
    ]
    cfg = {"questions": [
        {"kobo_key": "region", "export_label": "Region", "category": "categorical"},
        {"kobo_key": "household/members/name", "export_label": "Name",
         "category": "qualitative", "group": "household/members", "repeat_group": "members"},
        {"kobo_key": "household/members/illnesses/type", "export_label": "Illness",
         "category": "qualitative", "group": "household/members/illnesses", "repeat_group": "illnesses"},
    ]}
    main_df, repeat_tables = load_data(submissions, cfg)

    assert list(main_df["Region"]) == ["North"]
    assert "household/members" in repeat_tables
    assert "household/members/illnesses" in repeat_tables
    illnesses = repeat_tables["household/members/illnesses"]
    assert list(illnesses["Illness"]) == ["flu"]
    assert list(illnesses["_root_id"]) == [12]
    # backward-compat linkage column still present and equal to root id
    assert list(illnesses["_parent_index"]) == [12]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_load_data_nested.py -v`
Expected: FAIL — `KeyError: 'household/members/illnesses'` (sub-repeat empty/missing on current code).

- [ ] **Step 3: Replace the repeat-table loop in `load_data`**

In `src/data/transform.py`, add the import near the top (after the existing imports):

```python
from src.data.flatten import build_repeat_tables
```

Then replace the entire current repeat-table block (from the comment `# --- Repeat tables ---` through the `repeat_tables` construction loop, ending just before `return df, repeat_tables`) with:

```python
    # --- Repeat tables (recursive, multi-level, root-linked) ---
    repeat_tables: Dict[str, pd.DataFrame] = {}
    built = build_repeat_tables(submissions, repeat_groups)
    for group_name, rdf in built.items():
        if rdf.empty:
            log.info(f"No data for repeat group '{group_name}'")
            continue
        group_questions = repeat_groups[group_name]
        for q in group_questions:
            label = q.get("export_label") or q.get("label") or q["kobo_key"]
            if label in rdf.columns:
                rdf[label] = _cast(rdf[label], q.get("category", "undefined"))
        rdf = apply_choice_labels(rdf, group_questions)
        repeat_tables[group_name] = rdf
        log.info(f"Loaded {len(rdf)} rows for repeat group '{group_name}'")

    return df, repeat_tables
```

(Leave the main-table construction and the `repeat_groups` dict-building loop above it untouched.)

- [ ] **Step 4: Run the new test, then the full suite**

Run: `PYTHONPATH=. pytest tests/test_load_data_nested.py -v`
Expected: PASS (1 passed)

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS — all previously-passing tests still pass (no regressions). If any test asserts an exact repeat-table column set, update it to allow the added `_root_id`/`_parent_row_id`/`_row_id` columns (these are additive linkage columns, not a behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/data/transform.py tests/test_load_data_nested.py
git commit -m "feat(transform): use recursive build_repeat_tables for multi-level base tables"
```

---

## Task 7: Linkage columns survive export → reload round-trip

**Files:**
- Test: `tests/test_load_data_nested.py` (add a round-trip test)

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_load_data_nested.py
import yaml
from src.data.transform import load_data, export_data, load_processed_data


def test_linkage_columns_survive_csv_roundtrip(tmp_path):
    submissions = [
        {"_id": 12,
         "household/members": [
             {"household/members/name": "A",
              "household/members/illnesses": [
                  {"household/members/illnesses/type": "flu"},
              ]},
         ]},
    ]
    cfg = {
        "form": {"alias": "survey"},
        "export": {"format": "csv", "output_dir": str(tmp_path)},
        "questions": [
            {"kobo_key": "household/members/name", "export_label": "Name",
             "category": "qualitative", "group": "household/members", "repeat_group": "members"},
            {"kobo_key": "household/members/illnesses/type", "export_label": "Illness",
             "category": "qualitative", "group": "household/members/illnesses", "repeat_group": "illnesses"},
        ],
    }
    main_df, repeat_tables = load_data(submissions, cfg)
    export_data(main_df, cfg, repeat_tables)

    _, reloaded = load_processed_data(cfg)
    # repeat tables reload under the underscored ("safe") name
    illnesses = reloaded["household_members_illnesses"]
    assert "_row_id" in illnesses.columns
    assert "_parent_row_id" in illnesses.columns
    assert list(illnesses["Illness"]) == ["flu"]
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `PYTHONPATH=. pytest tests/test_load_data_nested.py::test_linkage_columns_survive_csv_roundtrip -v`
Expected: PASS — linkage columns are ordinary DataFrame columns, so they export to CSV and reload automatically. (If the reload key differs, adjust the expected key to match `load_processed_data`'s underscored naming; do not change production code for this — it is a read-back naming detail.)

- [ ] **Step 3: (no implementation change expected)**

If the test fails because the reloaded table is missing entirely, verify `export_data` wrote the sub-repeat file (`survey_household_members_illnesses_*.csv` in `tmp_path`) and that `load_processed_data`'s glob matched it.

- [ ] **Step 4: Run the suite**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS (no regressions)

- [ ] **Step 5: Commit**

```bash
git add tests/test_load_data_nested.py
git commit -m "test(transform): linkage columns survive csv export/reload round-trip"
```

---

## Task 8: `GET /api/base-tables` catalog endpoint (web-first)

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_base_tables_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_base_tables_api.py
import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_base_tables_catalog(monkeypatch):
    main_df = pd.DataFrame({"_id": [12], "Region": ["North"]})
    members = pd.DataFrame({
        "_parent_index": [12], "_root_id": [12], "_parent_row_id": [12],
        "_row_id": ["12.0"], "_row_index": [0], "Name": ["A"],
    })
    illnesses = pd.DataFrame({
        "_parent_index": [12], "_root_id": [12], "_parent_row_id": ["12.0"],
        "_row_id": ["12.0.0"], "_row_index": [0], "Illness": ["flu"],
    })
    repeats = {
        "household_members": members,
        "household_members_illnesses": illnesses,
    }
    monkeypatch.setattr(wm, "load_config", lambda *_a, **_k: {})
    monkeypatch.setattr(wm, "load_processed_data", lambda *_a, **_k: (main_df, repeats))

    client = TestClient(wm.app)
    resp = client.get("/api/base-tables")
    assert resp.status_code == 200
    tables = {t["name"]: t for t in resp.json()["tables"]}

    assert tables["main"]["rows"] == 1
    assert tables["main"]["parent"] is None
    assert "Region" in tables["main"]["columns"]

    assert tables["household_members"]["parent"] == "main"
    assert tables["household_members_illnesses"]["parent"] == "household_members"
    # linkage columns are reported separately from data columns
    assert "Illness" in tables["household_members_illnesses"]["columns"]
    assert "_row_id" in tables["household_members_illnesses"]["linkage"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. pytest tests/test_base_tables_api.py -v`
Expected: FAIL — 404 (route not defined) or `AttributeError` on `load_processed_data` if not imported in `web.main`.

- [ ] **Step 3: Add the endpoint**

In `web/main.py`, ensure `load_processed_data` is importable in the module (add to the existing `from src.data.transform import ...` line if absent):

```python
from src.data.transform import load_processed_data
```

Then add the route (near the other read-only `/api/*` GET routes):

```python
@app.get("/api/base-tables")
def base_tables():
    """Catalog of the flattened base tables for the latest download session.

    Returns row counts, data columns, linkage columns, and the parent table for
    each repeat level so the UI can show the table hierarchy. Read-only.
    """
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"tables": [], "message": "No downloaded data. Run download first."}

    def _entry(name, frame, parent):
        cols = list(frame.columns)
        return {
            "name": name,
            "rows": int(len(frame)),
            "parent": parent,
            "columns": [c for c in cols if not c.startswith("_")],
            "linkage": [c for c in cols if c.startswith("_")],
        }

    # Reloaded repeat tables are keyed by the underscored ("safe") name; derive
    # the parent table by longest underscored-prefix match, falling back to main.
    names = list(repeats.keys())

    def _parent_of(name):
        prefixes = [p for p in names if p != name and name.startswith(p + "_")]
        return max(prefixes, key=lambda p: p.count("_")) if prefixes else "main"

    tables = [_entry("main", df, None)]
    for name, frame in repeats.items():
        tables.append(_entry(name, frame, _parent_of(name)))
    return {"tables": tables}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. pytest tests/test_base_tables_api.py -v`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add web/main.py tests/test_base_tables_api.py
git commit -m "feat(api): add GET /api/base-tables catalog endpoint"
```

---

## Task 9: Document the linkage columns

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a section to CLAUDE.md**

Under the `### Export routing (src/data/transform.py)` subsection in the "Key implementation details" area, add:

```markdown
### Base-table linkage columns (src/data/flatten.py)
`load_data` flattens submissions into a main table plus one base table per repeat
level (including nested sub-repeats) via `build_repeat_tables`. Every repeat row
carries linkage columns:

- `_root_id` — id of the root submission the row descends from
- `_parent_index` — alias of `_root_id` (kept for backward-compat with filters,
  computed columns, `join_repeat_to_main`, and split reports)
- `_parent_row_id` — `_row_id` of the immediate parent repeat row
  (equals `_root_id` for top-level repeats)
- `_row_id` — stable composite id, e.g. `"12.0.1"` (root 12 → member 0 → illness 1)
- `_row_index` — position within the immediate parent

Join any level to its parent on `_parent_row_id == parent._row_id`, or to the
root on `_root_id == main._id`. The catalog is exposed read-only at
`GET /api/base-tables`.
```

- [ ] **Step 2: Verify the doc references are accurate**

Run: `PYTHONPATH=. pytest tests/ -q`
Expected: PASS (full suite green — confirms the documented behavior matches the code).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document base-table linkage columns and /api/base-tables"
```

---

## Self-review notes

- **Spec coverage:** Layer 1's "recursive multi-level flattening" and "immediate-parent + root linkage" are covered by Tasks 4–6. "Types set from schema category" is preserved by the cast loop in Task 6. The architecture doc's "slugify + dedup names" is **explicitly deferred** to Layer 1b (see Scope note) because it is a breaking change; `_dedup_labels` (Task 1) is built and unit-tested so Layer 1b can adopt it. Web-first delivery is honored by Task 8.
- **Backward compatibility:** `_parent_index` stays equal to the root submission id (int), verified in Tasks 4 and 6; the full suite is re-run in Tasks 6, 7, and 9.
- **Type consistency:** `build_repeat_tables`, `_parent_repeat`, `_resolve_array`, `_read_field`, `_dedup_labels`, and `LINKAGE_COLS` names are used identically across tasks and in `load_data`/the endpoint.
- **No placeholders:** every code and command step contains complete content.
