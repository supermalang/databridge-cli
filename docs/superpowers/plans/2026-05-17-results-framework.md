# Results Framework Hierarchy (Phase B.3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let M&E teams structure their indicators in a Goal → Outcomes → Outputs hierarchy (the standard logframe), link each indicator to a framework node, surface orphan links in the Validate tab, and render the logframe as a `{{ logframe }}` Jinja context key for Word templates.

**Architecture:**
- A top-level `framework:` block in `config.yml` declares the goal/outcomes/outputs hierarchy as nested-by-level YAML (most M&E-friendly format).
- Indicators gain an optional `framework_ref: "<node_id>"` field linking to a node.
- A pure-Python `src/utils/framework.py` exposes the helpers (`build_tree`, `find_node`, `enumerate_nodes`, `validate_refs`).
- The Validate tab gets a fifth detector — orphan-framework-ref — surfacing indicators with broken links.
- `compute_indicators` writes the framework_ref into each indicator's context dict so the logframe can pull the value when rendering.
- A new `src/reports/logframe.py` builds a Word-table-friendly dict that the builder injects as `{{ logframe }}` in the Jinja context.
- A new `FrameworkCard` in the Composition tab manages the framework via `/api/framework` GET/POST.
- Backward compatibility is **mandatory** — configs without `framework:` behave exactly as today.

**Tech Stack:** Python 3.12 + pandas + docxtpl + FastAPI + pytest; React + Vite frontend; no new third-party deps.

**Non-goals:**
- Activity-level (4th tier) — too granular for survey reports, defer until requested.
- Indicator targets/baselines beyond the existing `baseline`/`target` static config fields (the multi-period plan B.2 covers dynamic baselines).
- Auto-generation of the framework from indicators ("infer the goal") — too speculative for an MVP.
- A WYSIWYG framework editor — the Composition UI uses small modal forms, consistent with the rest of the page.

**Backward-compat contract:**
- Configs without `framework:` → `framework_tree(cfg) == None`, `compute_indicators` ignores `framework_ref`, `{{ logframe }}` is an empty dict, Validate tab adds no orphan findings.
- Existing `tests/test_build_report_smoke.py` (single-period, no framework) must pass unchanged.

**Risk + rollback:** 15 tasks, ~2 days subagent-driven. Each commit is atomic. Sub-phase checkpoints after tasks 4, 8, 13.

---

## Sub-phases at a glance

| Sub-phase | Tasks | Delivers |
|---|---|---|
| **B.3.a Schema + helpers** | 1 – 4 | `src/utils/framework.py`, schema validation, orphan-ref detector wired into Validate tab |
| **B.3.b Logframe rendering** | 5 – 8 | `src/reports/logframe.py`, `{{ logframe }}` context key, auto-template integration |
| **B.3.c API + UI** | 9 – 13 | `/api/framework` endpoint, FrameworkCard in Composition, IndicatorModal `framework_ref` dropdown |
| **B.3.d Docs + final** | 14 – 15 | README + CLAUDE.md, final cross-cutting review |

---

## Framework config contract

```yaml
framework:
  goal:
    id:    GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - id:     OC1
      label:  "80% of children under 5 fully vaccinated"
      parent: GOAL
    - id:     OC2
      label:  "All target villages have safe drinking water"
      parent: GOAL
  outputs:
    - id:     OP1.1
      label:  "10,000 vaccination doses administered"
      parent: OC1
    - id:     OP1.2
      label:  "200 health workers trained"
      parent: OC1
    - id:     OP2.1
      label:  "50 boreholes installed and operational"
      parent: OC2
```

- `goal` is optional and singular (a project has at most one strategic goal in MVP).
- `outcomes` and `outputs` are arrays.
- `id` is a user-facing identifier — short, opaque, used in `framework_ref` from indicators.
- `parent` on outputs links to an outcome's id. On outcomes, parent links to the goal (or is absent if no goal).

Indicators link with:

```yaml
indicators:
  - name: vaccinations_administered
    framework_ref: OP1.1
    question: ...
    stat: sum
```

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/utils/framework.py` | create | `build_tree`, `find_node`, `enumerate_nodes`, `validate_refs` |
| `tests/test_framework.py` | create | Unit tests for the helpers |
| `src/data/validate.py:170-201` | modify | Add `find_orphan_framework_refs(cfg, indicators)` detector + plug into `validate_dataset` |
| `tests/test_validate.py` | modify (append) | Tests for the new detector |
| `src/reports/logframe.py` | create | `build_logframe(cfg, indicators_context)` → Jinja-friendly table dict |
| `tests/test_logframe.py` | create | Unit tests |
| `src/reports/builder.py:139-149` | modify | Inject `{{ logframe }}` into the Jinja context |
| `src/reports/template_generator.py` | modify | Auto-template includes a logframe section above the Provenance footer |
| `src/reports/ai_template_generator.py` | modify | System prompt mentions `{{ logframe }}` placeholder |
| `web/main.py` | append | `GET /api/framework`, `POST /api/framework` |
| `tests/test_framework_endpoint.py` | create | Endpoint smoke tests |
| `frontend/src/components/FrameworkPicker.jsx` | create | Reusable dropdown of framework nodes for the IndicatorModal |
| `frontend/src/pages/Composition.jsx` | modify | New `FrameworkCard` subcomponent + IndicatorModal `framework_ref` dropdown |
| `frontend/src/styles.css` | modify (append) | Framework-card styles |
| `README.md` | modify | "Results framework" section |
| `CLAUDE.md` | modify | Annotated `framework:` block in the config example |

---

## Sub-phase B.3.a: Schema + helpers

### Task 1: `src/utils/framework.py` helpers + tests

**Files:**
- Create: `src/utils/framework.py`
- Create: `tests/test_framework.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_framework.py`:

```python
from src.utils.framework import build_tree, find_node, enumerate_nodes, validate_refs


def _sample_cfg():
    return {
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [
                {"id": "OC1", "label": "Outcome 1", "parent": "GOAL"},
                {"id": "OC2", "label": "Outcome 2", "parent": "GOAL"},
            ],
            "outputs":  [
                {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
                {"id": "OP1.2", "label": "Output 1.2", "parent": "OC1"},
                {"id": "OP2.1", "label": "Output 2.1", "parent": "OC2"},
            ],
        },
        "indicators": [
            {"name": "ind_a", "framework_ref": "OP1.1"},
            {"name": "ind_b", "framework_ref": "OP1.2"},
            {"name": "ind_c", "framework_ref": "OC2"},
            {"name": "ind_d", "framework_ref": "MISSING"},
            {"name": "ind_e"},  # no framework_ref
        ],
    }


def test_build_tree_returns_none_without_framework_block():
    assert build_tree({}) is None


def test_build_tree_returns_nested_structure():
    tree = build_tree(_sample_cfg())
    assert tree["id"] == "GOAL"
    assert tree["label"] == "Reduce X"
    assert len(tree["children"]) == 2  # two outcomes
    assert tree["children"][0]["id"] == "OC1"
    assert len(tree["children"][0]["children"]) == 2  # OP1.1 + OP1.2


def test_find_node_returns_node_by_id():
    cfg = _sample_cfg()
    node = find_node(cfg, "OP1.2")
    assert node["label"] == "Output 1.2"
    assert node["level"] == "output"


def test_find_node_returns_none_for_missing_id():
    assert find_node(_sample_cfg(), "DOES_NOT_EXIST") is None


def test_enumerate_nodes_returns_flat_list_with_breadcrumbs():
    nodes = enumerate_nodes(_sample_cfg())
    # 1 goal + 2 outcomes + 3 outputs = 6 nodes
    assert len(nodes) == 6
    op11 = next(n for n in nodes if n["id"] == "OP1.1")
    assert op11["breadcrumb"] == "Reduce X › Outcome 1 › Output 1.1"
    assert op11["level"] == "output"


def test_validate_refs_returns_orphans_only():
    orphans = validate_refs(_sample_cfg())
    # Only ind_d references MISSING which is not in the framework
    assert len(orphans) == 1
    assert orphans[0]["indicator"] == "ind_d"
    assert orphans[0]["ref"] == "MISSING"


def test_validate_refs_empty_when_no_framework():
    cfg = {"indicators": [{"name": "x", "framework_ref": "Q"}]}
    # No framework block → can't validate references, return [] (single-mode safe)
    assert validate_refs(cfg) == []
```

- [ ] **Step 2: Run — expect ImportError**

```bash
pytest tests/test_framework.py -v
```

- [ ] **Step 3: Implement the helpers**

Create `src/utils/framework.py`:

```python
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
```

- [ ] **Step 4: Run — expect 7 pass**

```bash
pytest tests/test_framework.py -v
```

- [ ] **Step 5: Full suite — expect 63 passed (56 + 7)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/framework.py tests/test_framework.py
git commit -m "feat(framework): helpers for tree, lookup, enumerate, validate"
```

---

### Task 2: Orphan-ref detector in Validate tab

**Files:**
- Modify: `src/data/validate.py` (add `find_orphan_framework_refs` + wire into `validate_dataset`)
- Modify: `tests/test_validate.py` (add tests)

- [ ] **Step 1: Append failing tests**

Add to `tests/test_validate.py`:

```python
from src.data.validate import find_orphan_framework_refs


def test_orphans_returns_nothing_when_no_framework():
    cfg = {"indicators": [{"name": "x", "framework_ref": "Q"}]}
    assert find_orphan_framework_refs(cfg) == []


def test_orphans_returns_nothing_when_all_refs_resolve():
    cfg = {
        "framework": {"outputs": [{"id": "OP1", "label": "Output 1", "parent": "OC1"}]},
        "indicators": [{"name": "x", "framework_ref": "OP1"}],
    }
    assert find_orphan_framework_refs(cfg) == []


def test_orphans_flags_broken_ref():
    cfg = {
        "framework": {"outputs": [{"id": "OP1", "label": "Output 1"}]},
        "indicators": [
            {"name": "good", "framework_ref": "OP1"},
            {"name": "bad",  "framework_ref": "MISSING"},
        ],
    }
    findings = find_orphan_framework_refs(cfg)
    assert len(findings) == 1
    f = findings[0]
    assert f["kind"] == "orphan_framework_ref"
    assert f["severity"] == "warning"
    assert f["column"] == "bad"
    assert "MISSING" in f["message"]
    assert f["count"] == 1
```

- [ ] **Step 2: Run — expect 3 fail**

```bash
pytest tests/test_validate.py -v
```

- [ ] **Step 3: Implement the detector + wire into the aggregator**

Append to `src/data/validate.py`:

```python
def find_orphan_framework_refs(cfg: Dict) -> List[Dict]:
    """Flag indicators whose `framework_ref` points to a non-existent node.

    Returns [] when no framework is configured (nothing to validate against).
    """
    from src.utils.framework import validate_refs
    orphans = validate_refs(cfg)
    if not orphans:
        return []
    return [
        {
            "severity": "warning",
            "column":   o["indicator"],
            "kind":     "orphan_framework_ref",
            "message":  f"Indicator '{o['indicator']}' references framework node '{o['ref']}' which doesn't exist",
            "count":    1,
            "pct":      0.0,
            "examples": [o["ref"]],
        }
        for o in orphans
    ]
```

In `validate_dataset`, add the new detector call:

```python
    findings += find_orphan_framework_refs(cfg)
```

Place it after the existing `find_type_issues(df, questions)` call.

- [ ] **Step 4: Run tests — expect all 21 + 3 + ... pass**

```bash
pytest tests/test_validate.py tests/test_framework.py -v
```

- [ ] **Step 5: Full suite — expect 66 passed (63 + 3)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add src/data/validate.py tests/test_validate.py
git commit -m "feat(framework): orphan-framework-ref detector in Validate tab"
```

---

### Task 3: `compute_indicators` annotates results with `framework_ref`

**Files:**
- Modify: `src/reports/indicators.py`

This task makes each indicator's framework_ref visible to the template author via a new placeholder `{{ ind_<name>_framework_ref }}`. The logframe renderer (Task 5) will use this to look up indicator values by framework node.

- [ ] **Step 1: Inspect `compute_indicators`**

```bash
grep -nA 20 "def compute_indicators\|context\[" src/reports/indicators.py | head -40
```

- [ ] **Step 2: Inside the per-indicator loop, after the existing `context[f"ind_{name}"] = ...` line, add the framework_ref placeholder**

Add (immediately after the line that sets the main value placeholder):

```python
            if ind.get("framework_ref"):
                context[f"ind_{name}_framework_ref"] = ind["framework_ref"]
```

That's it. The placeholder is emitted only when the indicator declares one — single-mode users see no change.

- [ ] **Step 3: Full suite — expect 66 still passing**

```bash
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add src/reports/indicators.py
git commit -m "feat(framework): emit ind_<name>_framework_ref placeholder"
```

---

### Task 4: `/api/framework` endpoint (GET + POST) + smoke tests

**Files:**
- Modify: `web/main.py`
- Create: `tests/test_framework_endpoint.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_framework_endpoint.py`:

```python
import yaml
import pytest


@pytest.fixture
def tmp_framework_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    ws.mkdir()
    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "fw", "uid": "x"},
        "questions": [],
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
            "outputs":  [{"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"}],
        },
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def test_get_framework_returns_block(tmp_framework_workspace, api_client):
    r = api_client.get("/api/framework")
    assert r.status_code == 200
    body = r.json()
    assert body["goal"]["id"] == "GOAL"
    assert len(body["outcomes"]) == 1
    assert len(body["outputs"]) == 1


def test_get_framework_returns_empty_when_absent(tmp_path, monkeypatch, api_client):
    ws = tmp_path / "ws2"
    ws.mkdir()
    cfg = {"api": {"platform": "kobo", "url": "x", "token": "x"},
           "form": {"alias": "p", "uid": "x"}, "questions": []}
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    r = api_client.get("/api/framework")
    assert r.status_code == 200
    assert r.json() == {"goal": None, "outcomes": [], "outputs": []}


def test_post_framework_writes_back(tmp_framework_workspace, api_client):
    new_fw = {
        "goal": {"id": "GOAL", "label": "Updated goal"},
        "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
        "outputs": [
            {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
            {"id": "OP1.2", "label": "New output", "parent": "OC1"},
        ],
    }
    r = api_client.post("/api/framework", json=new_fw)
    assert r.status_code == 200
    cfg = yaml.safe_load((tmp_framework_workspace / "config.yml").read_text())
    assert len(cfg["framework"]["outputs"]) == 2
    assert cfg["framework"]["goal"]["label"] == "Updated goal"
```

- [ ] **Step 2: Run — expect 3 fail (endpoints don't exist)**

```bash
pytest tests/test_framework_endpoint.py -v
```

- [ ] **Step 3: Add the endpoints**

Append to `web/main.py` (near the existing `/api/periods` endpoints — same cwd-first config-path pattern). Reuse the `_load_cfg`/`_save_cfg` helpers introduced in Phase B.2.

```python
class FrameworkPayload(BaseModel):
    goal:     Optional[Dict] = None
    outcomes: List[Dict] = []
    outputs:  List[Dict] = []


@app.get("/api/framework")
async def get_framework():
    cfg = _load_cfg()
    fw = cfg.get("framework") or {}
    return {
        "goal":     fw.get("goal"),
        "outcomes": fw.get("outcomes", []) or [],
        "outputs":  fw.get("outputs", []) or [],
    }


@app.post("/api/framework")
async def set_framework(payload: FrameworkPayload):
    cfg = _load_cfg()
    cfg["framework"] = {
        "goal":     payload.goal,
        "outcomes": payload.outcomes,
        "outputs":  payload.outputs,
    }
    _save_cfg(cfg)
    return {"ok": True}
```

If `FrameworkPayload` requires `Dict`/`List`/`Optional` to be imported, verify they already are at the top of `web/main.py` (they should be from earlier endpoint definitions).

- [ ] **Step 4: Run tests — expect 3 pass**

```bash
pytest tests/test_framework_endpoint.py -v
```

- [ ] **Step 5: Full suite — expect 69 passed (66 + 3)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add web/main.py tests/test_framework_endpoint.py
git commit -m "feat(framework): /api/framework GET + POST endpoints"
```

**Checkpoint:** B.3.a complete. Schema + helpers + validation + API. Ready for logframe rendering.

---

## Sub-phase B.3.b: Logframe rendering

### Task 5: `src/reports/logframe.py` — build the logframe data structure

**Files:**
- Create: `src/reports/logframe.py`
- Create: `tests/test_logframe.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_logframe.py`:

```python
from src.reports.logframe import build_logframe


def _sample_cfg_with_indicators():
    return {
        "framework": {
            "goal":     {"id": "GOAL", "label": "Reduce X"},
            "outcomes": [{"id": "OC1", "label": "Outcome 1", "parent": "GOAL"}],
            "outputs":  [
                {"id": "OP1.1", "label": "Output 1.1", "parent": "OC1"},
                {"id": "OP1.2", "label": "Output 1.2", "parent": "OC1"},
            ],
        },
        "indicators": [
            {"name": "a", "framework_ref": "OP1.1"},
            {"name": "b", "framework_ref": "OP1.2"},
            {"name": "c", "framework_ref": "OC1"},
            {"name": "no_ref"},  # no framework_ref — orphan in the indicator sense
        ],
    }


def test_build_logframe_empty_when_no_framework():
    assert build_logframe({}, {}) == {"rows": [], "has_framework": False}


def test_build_logframe_returns_one_row_per_node():
    cfg = _sample_cfg_with_indicators()
    indicators_context = {"ind_a": "100", "ind_b": "50", "ind_c": "75"}
    lf = build_logframe(cfg, indicators_context)
    assert lf["has_framework"] is True
    # 1 goal + 1 outcome + 2 outputs = 4 rows
    assert len(lf["rows"]) == 4
    # Row order: goal, then OC1, then its outputs (OP1.1, OP1.2)
    assert lf["rows"][0]["level"] == "goal"
    assert lf["rows"][1]["level"] == "outcome"
    assert lf["rows"][2]["level"] == "output"
    assert lf["rows"][3]["level"] == "output"


def test_build_logframe_attaches_indicator_values_to_nodes():
    cfg = _sample_cfg_with_indicators()
    indicators_context = {"ind_a": "100", "ind_b": "50", "ind_c": "75"}
    lf = build_logframe(cfg, indicators_context)
    by_id = {r["id"]: r for r in lf["rows"]}
    assert by_id["OP1.1"]["indicators"] == [{"name": "a", "value": "100"}]
    assert by_id["OP1.2"]["indicators"] == [{"name": "b", "value": "50"}]
    assert by_id["OC1"]["indicators"]   == [{"name": "c", "value": "75"}]


def test_build_logframe_handles_indicators_with_no_ref():
    cfg = _sample_cfg_with_indicators()
    # The indicator "no_ref" should not appear in any row's indicators list
    lf = build_logframe(cfg, {"ind_no_ref": "999"})
    for row in lf["rows"]:
        for ind in row["indicators"]:
            assert ind["name"] != "no_ref"
```

- [ ] **Step 2: Run — expect ImportError**

```bash
pytest tests/test_logframe.py -v
```

- [ ] **Step 3: Implement**

Create `src/reports/logframe.py`:

```python
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
```

- [ ] **Step 4: Run — expect 4 pass**

```bash
pytest tests/test_logframe.py -v
```

- [ ] **Step 5: Full suite — expect 73 passed (69 + 4)**

```bash
pytest -v
```

- [ ] **Step 6: Commit**

```bash
git add src/reports/logframe.py tests/test_logframe.py
git commit -m "feat(framework): build_logframe — Jinja-friendly logframe structure"
```

---

### Task 6: Builder injects `{{ logframe }}` into the Jinja context

**Files:**
- Modify: `src/reports/builder.py:139-149` (the context block where provenance is injected)

- [ ] **Step 1: Import + call the helper, inject into context**

In `src/reports/builder.py`, near the existing `from src.utils.provenance import ...` line at the top, add:

```python
from src.reports.logframe import build_logframe
```

In `_render`, right BEFORE the existing `provenance = build_provenance(...)` call, add:

```python
        logframe = build_logframe(self.cfg, indicators)
```

In the `context = {...}` dict, add a `"logframe"` key alongside `"provenance"`:

```python
            "logframe":   logframe,
```

- [ ] **Step 2: Full suite — expect 73 still passing**

```bash
pytest -v
```

The existing `test_build_report_smoke.py` runs without a framework block — `build_logframe(cfg, indicators)` returns `{"has_framework": False, "rows": []}` and the template doesn't reference `{{ logframe }}`, so nothing breaks.

- [ ] **Step 3: Commit**

```bash
git add src/reports/builder.py
git commit -m "feat(framework): inject {{ logframe }} into Jinja context"
```

---

### Task 7: Auto-template generator includes a logframe section

**Files:**
- Modify: `src/reports/template_generator.py`

- [ ] **Step 1: Find a good insertion point**

```bash
grep -n "provenance.footer\|doc.save" src/reports/template_generator.py | head
```

You should see the provenance footer paragraph from Phase A. The logframe section should be ABOVE the placeholder-reference section but visible in the report. Put it just above the provenance footer paragraph.

- [ ] **Step 2: Add the logframe section**

Insert (just before the `{{ provenance.footer }}` paragraph):

```python
    # Logframe table — only renders when the user has a framework configured.
    p = doc.add_paragraph()
    p.style = doc.styles["Normal"]
    run = p.add_run("{% if logframe.has_framework %}Results Framework{% endif %}")
    run.bold = True
    run.font.size = Pt(14)

    p2 = doc.add_paragraph()
    p2.style = doc.styles["Normal"]
    run2 = p2.add_run(
        "{% if logframe.has_framework %}"
        "{% for row in logframe.rows %}"
        "{{ '  ' * row.indent }}{{ row.label }}"
        "{% if row.indicators %}: {% for ind in row.indicators %}{{ ind.name }}={{ ind.value }}{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}\n"
        "{% endfor %}"
        "{% endif %}"
    )
    run2.font.size = Pt(10)
```

Note: this is a TEXT representation (with `\n` for line breaks). A proper Word table would need a different approach (docxtpl's `<docx tags>`). MVP keeps it text-based — readable, copy-paste-able, no parsing surprises.

- [ ] **Step 3: Smoke check**

```bash
mkdir -p /tmp/t7 && PYTHONPATH=. python3 src/data/make.py generate-template --out /tmp/t7/test.docx
python3 -c "
import zipfile
with zipfile.ZipFile('/tmp/t7/test.docx') as z:
    xml = z.read('word/document.xml').decode('utf-8', errors='replace')
print('logframe.has_framework' in xml, 'logframe.rows' in xml)
"
rm -rf /tmp/t7
```

Expected: `True True`.

- [ ] **Step 4: Full suite — expect 73 still passing**

```bash
pytest -v
```

- [ ] **Step 5: Commit**

```bash
git add src/reports/template_generator.py
git commit -m "feat(framework): auto-template includes a logframe section"
```

---

### Task 8: AI template generator awareness

**Files:**
- Modify: `src/reports/ai_template_generator.py` (SYSTEM_PROMPT)

- [ ] **Step 1: Append to the placeholder catalog**

Inside the existing `SYSTEM_PROMPT`, append (matching the existing string-concatenation style):

```
Results framework placeholders (when framework: is configured):
  {% if logframe.has_framework %}…{% endif %}      conditional rendering guard
  {% for row in logframe.rows %}…{% endfor %}      iterate over hierarchy
  Each row has: id, label, level, indent, indicators=[{name, value}, ...]
  {{ ind_<name>_framework_ref }}                    the framework node a given indicator links to
```

- [ ] **Step 2: Verify Python compiles + full suite**

```bash
python3 -m py_compile src/reports/ai_template_generator.py && echo OK
pytest -v
```

Expected: OK + 73 passed.

- [ ] **Step 3: Commit**

```bash
git add src/reports/ai_template_generator.py
git commit -m "docs(framework): AI template generator knows about logframe placeholders"
```

**Checkpoint:** B.3.b complete. Logframe rendering pipeline wired end-to-end.

---

## Sub-phase B.3.c: API + UI

### Task 9: FrameworkPicker component

**Files:**
- Create: `frontend/src/components/FrameworkPicker.jsx`

- [ ] **Step 1: Write the component**

Create with this exact content:

```jsx
import { useEffect, useState } from 'react';

/**
 * Dropdown of framework nodes (goal/outcome/output) with breadcrumb labels.
 * Used by IndicatorModal to set framework_ref.
 */
export default function FrameworkPicker({ value, onChange }) {
  const [nodes, setNodes] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const fw = await (await fetch('/api/framework')).json();
        const flat = [];
        if (fw.goal) flat.push({ id: fw.goal.id, level: 'goal', breadcrumb: fw.goal.label });
        const ocLabel = {};
        for (const oc of (fw.outcomes || [])) {
          ocLabel[oc.id] = oc.label;
          const bc = fw.goal ? `${fw.goal.label} › ${oc.label}` : oc.label;
          flat.push({ id: oc.id, level: 'outcome', breadcrumb: bc });
        }
        for (const op of (fw.outputs || [])) {
          const parts = [fw.goal?.label, ocLabel[op.parent], op.label].filter(Boolean);
          flat.push({ id: op.id, level: 'output', breadcrumb: parts.join(' › ') });
        }
        setNodes(flat);
      } catch { setNodes([]); }
    })();
  }, []);

  return (
    <select
      className="src-input"
      value={value || ''}
      onChange={e => onChange?.(e.target.value || null)}
    >
      <option value="">(no framework link)</option>
      {nodes.map(n => (
        <option key={n.id} value={n.id}>
          [{n.level}] {n.id} — {n.breadcrumb}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Vite serves it**

```bash
./scripts/dev.sh status || ./scripts/dev.sh start
sleep 3
curl -s -o /tmp/fp.js "http://localhost:51730/src/components/FrameworkPicker.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
```

Expected: HTTP 200.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/FrameworkPicker.jsx
git commit -m "feat(ui): FrameworkPicker component"
```

---

### Task 10: IndicatorModal `framework_ref` dropdown

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (IndicatorModal subcomponent)

- [ ] **Step 1: Inspect IndicatorModal**

```bash
grep -nA 30 "function IndicatorModal" frontend/src/pages/Composition.jsx | head -45
```

- [ ] **Step 2: Add framework_ref state + ModalField**

In `IndicatorModal`:

After the existing `useState`s, add:

```jsx
const [frameworkRef, setFrameworkRef] = useState(initial?.framework_ref || '');
```

Import the FrameworkPicker at the top of the file (alongside the other imports):

```jsx
import FrameworkPicker from '../components/FrameworkPicker.jsx';
```

In the `submit()` function, conditionally include the field on the saved item:

```jsx
if (frameworkRef) item.framework_ref = frameworkRef;
```

In the JSX (after the existing fields), add a new `<ModalField>`:

```jsx
<ModalField label="Framework link" hint="Optional. Pick a goal/outcome/output node to link this indicator to.">
  <FrameworkPicker value={frameworkRef} onChange={v => setFrameworkRef(v || '')} />
</ModalField>
```

- [ ] **Step 3: Vite OK + commit**

```bash
curl -s -o /tmp/c.js "http://localhost:51730/src/pages/Composition.jsx?t=$(date +%s)" -w "HTTP %{http_code}\n"
git add frontend/src/pages/Composition.jsx
git commit -m "feat(ui): IndicatorModal framework_ref dropdown"
```

---

### Task 11: FrameworkCard in Composition tab

**Files:**
- Modify: `frontend/src/pages/Composition.jsx` (add a FrameworkCard subcomponent + render it alongside other cards)
- Modify: `frontend/src/styles.css` (append framework card styles)

This is the biggest UI task — adds a CRUD-able framework editor to the Composition page.

- [ ] **Step 1: Append CSS**

Append to `frontend/src/styles.css`:

```css
/* ── Framework card ─────────────────────────────────────────────────────────── */
.framework-tree { padding: 4px 0; }
.framework-node {
  display: grid;
  grid-template-columns: 60px 80px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.framework-node[data-level="goal"]    { background: rgba(13, 148, 136, 0.04); font-weight: 600; }
.framework-node[data-level="outcome"] { padding-left: 28px; }
.framework-node[data-level="output"]  { padding-left: 52px; color: var(--ink-2); }
.framework-node__id    { font-family: var(--font-mono, monospace); color: var(--ink-3); font-size: 11.5px; }
.framework-node__level { color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.framework-node__label { flex: 1; }
```

- [ ] **Step 2: Add the FrameworkCard subcomponent**

In `Composition.jsx`, find a good place to add a new card component (next to `IndicatorsCard`, `SummariesCard`, etc.). Add:

```jsx
function FrameworkCard() {
  const toast = useToast();
  const [fw, setFw] = useState({ goal: null, outcomes: [], outputs: [] });
  const [editing, setEditing] = useState(null);  // null | { level, index, draft }

  const reload = async () => {
    try { setFw(await (await fetch('/api/framework')).json()); }
    catch { /* leave defaults */ }
  };

  useEffect(() => { reload(); }, []);

  const save = async (next) => {
    try {
      const r = await fetch('/api/framework', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (r.ok) { await reload(); toast('Framework saved', 'ok'); }
      else { toast('Save failed', 'err'); }
    } catch (e) { toast(e.message, 'err'); }
  };

  const startEdit = (level, index = null) => {
    let draft = { id: '', label: '', parent: '' };
    if (level === 'goal' && fw.goal) draft = { ...fw.goal };
    if (level === 'outcome' && index != null) draft = { ...fw.outcomes[index] };
    if (level === 'output'  && index != null) draft = { ...fw.outputs[index] };
    setEditing({ level, index, draft });
  };

  const commitEdit = () => {
    const { level, index, draft } = editing;
    if (!draft.id || !draft.label) { toast('id and label required', 'err'); return; }
    const next = { goal: fw.goal, outcomes: [...fw.outcomes], outputs: [...fw.outputs] };
    if (level === 'goal') next.goal = { id: draft.id, label: draft.label };
    else if (level === 'outcome') {
      const entry = { id: draft.id, label: draft.label, parent: draft.parent || fw.goal?.id || '' };
      if (index == null) next.outcomes.push(entry); else next.outcomes[index] = entry;
    }
    else if (level === 'output') {
      const entry = { id: draft.id, label: draft.label, parent: draft.parent };
      if (!entry.parent) { toast('output needs a parent outcome', 'err'); return; }
      if (index == null) next.outputs.push(entry); else next.outputs[index] = entry;
    }
    setEditing(null);
    save(next);
  };

  const remove = (level, index) => {
    if (!confirm('Delete this node?')) return;
    const next = { goal: fw.goal, outcomes: [...fw.outcomes], outputs: [...fw.outputs] };
    if (level === 'goal') next.goal = null;
    else if (level === 'outcome') next.outcomes.splice(index, 1);
    else if (level === 'output')  next.outputs.splice(index, 1);
    save(next);
  };

  // Render tree depth-first
  const outputsByOutcome = {};
  for (const op of (fw.outputs || [])) (outputsByOutcome[op.parent] ||= []).push(op);

  return (
    <div className="comp-card">
      <div className="comp-card__head">
        <div className="comp-card__head-text">
          <div className="comp-card__title">Results framework</div>
          <div className="comp-card__sub">Goal → Outcomes → Outputs. Link indicators to nodes for logframe rendering.</div>
        </div>
        <div className="comp-card__head-actions">
          {!fw.goal && <button className="btn btn-ghost btn-sm" onClick={() => startEdit('goal')}>+ Goal</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => startEdit('outcome')}>+ Outcome</button>
          <button className="btn btn-ghost btn-sm" onClick={() => startEdit('output')}>+ Output</button>
        </div>
      </div>
      <div className="comp-card__body">
        {!fw.goal && (fw.outcomes || []).length === 0 && (
          <p className="empty-state" style={{ padding: 20 }}>No framework configured.</p>
        )}
        <div className="framework-tree">
          {fw.goal && (
            <div className="framework-node" data-level="goal">
              <span className="framework-node__id">{fw.goal.id}</span>
              <span className="framework-node__level">goal</span>
              <span className="framework-node__label">{fw.goal.label}</span>
              <span>
                <button className="icon-btn" title="Edit" onClick={() => startEdit('goal')}>✎</button>
                <button className="icon-btn" title="Delete" onClick={() => remove('goal')}>×</button>
              </span>
            </div>
          )}
          {(fw.outcomes || []).map((oc, i) => (
            <React.Fragment key={oc.id}>
              <div className="framework-node" data-level="outcome">
                <span className="framework-node__id">{oc.id}</span>
                <span className="framework-node__level">outcome</span>
                <span className="framework-node__label">{oc.label}</span>
                <span>
                  <button className="icon-btn" title="Edit" onClick={() => startEdit('outcome', i)}>✎</button>
                  <button className="icon-btn" title="Delete" onClick={() => remove('outcome', i)}>×</button>
                </span>
              </div>
              {(outputsByOutcome[oc.id] || []).map((op) => {
                const opIdx = fw.outputs.findIndex(o => o.id === op.id);
                return (
                  <div key={op.id} className="framework-node" data-level="output">
                    <span className="framework-node__id">{op.id}</span>
                    <span className="framework-node__level">output</span>
                    <span className="framework-node__label">{op.label}</span>
                    <span>
                      <button className="icon-btn" title="Edit" onClick={() => startEdit('output', opIdx)}>✎</button>
                      <button className="icon-btn" title="Delete" onClick={() => remove('output', opIdx)}>×</button>
                    </span>
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {editing && (
        <Modal
          title={`${editing.index == null ? 'Add' : 'Edit'} ${editing.level}`}
          onClose={() => setEditing(null)}
          onSave={commitEdit}
          saveLabel="Save"
          width={520}
        >
          <ModalField label="ID" hint="Short opaque identifier (e.g. OP1.1)">
            <input className="src-input" value={editing.draft.id}
                   onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, id: e.target.value } }))} />
          </ModalField>
          <ModalField label="Label">
            <input className="src-input" value={editing.draft.label}
                   onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, label: e.target.value } }))} />
          </ModalField>
          {editing.level === 'output' && (
            <ModalField label="Parent outcome">
              <select className="src-input" value={editing.draft.parent || ''}
                      onChange={e => setEditing(s => ({ ...s, draft: { ...s.draft, parent: e.target.value } }))}>
                <option value="">(pick one)</option>
                {(fw.outcomes || []).map(oc => <option key={oc.id} value={oc.id}>{oc.id} — {oc.label}</option>)}
              </select>
            </ModalField>
          )}
        </Modal>
      )}
    </div>
  );
}
```

The `React.Fragment` usage requires importing React; if the file uses `import React from 'react'`, it's covered. If not (the file currently uses `import { useState, useEffect } from 'react'`), add `Fragment` to the import:

```jsx
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Then replace `<React.Fragment key={oc.id}>` with `<Fragment key={oc.id}>`.

- [ ] **Step 3: Render the FrameworkCard alongside the other cards in the page layout**

Find where `<IndicatorsCard />` is rendered in the page's main JSX. Add `<FrameworkCard />` near it — placing it ABOVE IndicatorsCard makes sense semantically (framework first, then indicators that fit into it).

- [ ] **Step 4: Vite OK**

```bash
curl -s -o /tmp/c.js "http://localhost:51730/src/pages/Composition.jsx?t=$(date +%s)" -w "HTTP %{http_code} bytes=%{size_download}\n"
curl -s -o /tmp/s.css "http://localhost:51730/src/styles.css?t=$(date +%s)" -w "HTTP %{http_code}\n"
```

Expected: both HTTP 200.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Composition.jsx frontend/src/styles.css
git commit -m "feat(ui): FrameworkCard for editing the results framework"
```

---

### Task 12: AI indicator suggester awareness

**Files:**
- Modify: any existing AI suggester that produces indicators (likely `src/reports/ai_chart_suggester.py` for charts — verify if there's a separate indicator suggester). Search:

```bash
grep -rn "indicator\|framework" src/reports/ai_*.py | head -10
```

If there's no dedicated indicator suggester, this task is a smaller scope — just update the AI chart suggester's system prompt to mention `framework_ref` exists.

- [ ] **Step 1: Inspect**

```bash
grep -n "indicator\|SYSTEM_PROMPT" src/reports/ai_chart_suggester.py | head -10
```

- [ ] **Step 2: Append to the prompt that touches indicator config**

If `src/reports/ai_chart_suggester.py` doesn't produce indicator configs, find the indicator-suggesting code (perhaps in `web/main.py`'s `_build_suggest_prompts(kind="indicator")`). Append to that prompt:

```
When the user has a results framework configured (framework: block in config.yml),
each indicator MAY include a framework_ref field pointing to a goal/outcome/output id.
The exact id values are listed in the FRAMEWORK NODES block of the user prompt (if present).
Only include framework_ref when the suggestion clearly aligns with one of the listed nodes.
```

If the user prompt isn't currently passing framework nodes, ADD a small block to it:

```python
# Inside _build_suggest_prompts(kind="indicator", ...) — append before returning:
from src.utils.framework import enumerate_nodes
nodes = enumerate_nodes(_cfg) if _cfg else []
fw_block = ""
if nodes:
    lines = [f"  {n['id']} ({n['level']}): {n['breadcrumb']}" for n in nodes]
    fw_block = "\n\nFRAMEWORK NODES (use framework_ref to link the indicator to one):\n" + "\n".join(lines)
user_prompt = user_prompt + fw_block
```

(Adapt the variable names to match what's already in `_build_suggest_prompts`.)

- [ ] **Step 3: Full suite + commit**

```bash
pytest -v
git add web/main.py src/reports/ai_chart_suggester.py
git commit -m "docs(framework): AI indicator suggester knows about framework_ref"
```

---

### Task 13: End-to-end smoke test (framework round-trip)

**Files:**
- Create: `tests/test_framework_e2e.py`

- [ ] **Step 1: Write the test**

```python
"""End-to-end: build a report with a framework configured, assert the
logframe text appears in the rendered docx."""
import os, subprocess, sys, zipfile
from pathlib import Path

import pandas as pd
import pytest
import yaml


@pytest.fixture
def tmp_framework_workspace(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    (ws / "data" / "processed").mkdir(parents=True)
    (ws / "templates").mkdir()
    (ws / "reports").mkdir()

    pd.DataFrame({"Age": [10, 11, 12, 13]}).to_csv(
        ws / "data" / "processed" / "fwsmoke_data_20260101_120000.csv", index=False)

    cfg = {
        "api":  {"platform": "kobo", "url": "x", "token": "x"},
        "form": {"alias": "fwsmoke", "uid": "x"},
        "questions": [
            {"kobo_key": "Age", "label": "Age", "type": "integer",
             "category": "quantitative", "group": "", "export_label": "Age"},
        ],
        "filters": [],
        "charts": [{"name": "h", "title": "Age", "type": "histogram", "questions": ["Age"]}],
        "indicators": [
            {"name": "total_respondents", "stat": "count", "question": "Age", "framework_ref": "OP1.1"},
        ],
        "framework": {
            "goal":     {"id": "GOAL", "label": "Improve survey coverage"},
            "outcomes": [{"id": "OC1", "label": "Reach all target villages", "parent": "GOAL"}],
            "outputs":  [{"id": "OP1.1", "label": "Conduct village survey", "parent": "OC1"}],
        },
        "report": {
            "template":   str(ws / "templates" / "t.docx"),
            "output_dir": str(ws / "reports"),
            "title": "Framework smoke", "period": "Q1 2026",
        },
        "export": {"format": "csv", "output_dir": str(ws / "data" / "processed")},
    }
    (ws / "config.yml").write_text(yaml.dump(cfg, allow_unicode=True))
    monkeypatch.chdir(ws)
    yield ws


def _docx_text(path):
    with zipfile.ZipFile(path) as z:
        return z.read("word/document.xml").decode("utf-8", errors="replace")


def _run_cli(*args):
    project_root = Path(__file__).resolve().parent.parent
    env = {"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(project_root)}
    return subprocess.run(
        [sys.executable, str(project_root / "src" / "data" / "make.py"), *args],
        env=env, capture_output=True, text=True,
    )


def test_build_report_renders_logframe(tmp_framework_workspace):
    r = _run_cli("generate-template", "--out", str(tmp_framework_workspace / "templates" / "t.docx"))
    assert r.returncode == 0, f"generate-template failed:\n{r.stderr}"
    r = _run_cli("build-report")
    assert r.returncode == 0, f"build-report failed:\n{r.stderr}"
    docs = list((tmp_framework_workspace / "reports").glob("fwsmoke_report_*.docx"))
    assert len(docs) == 1, f"expected one docx, got {[d.name for d in docs]}"
    text = _docx_text(docs[0])
    assert "Improve survey coverage" in text
    assert "Reach all target villages" in text
    assert "Conduct village survey" in text
    # The indicator's value should be embedded in the output row
    assert "total_respondents" in text
```

- [ ] **Step 2: Run — expect pass**

```bash
pytest tests/test_framework_e2e.py -v -s
```

- [ ] **Step 3: Full suite — expect 74 passed (73 + 1)**

```bash
pytest -v
```

- [ ] **Step 4: Commit**

```bash
git add tests/test_framework_e2e.py
git commit -m "test(framework): end-to-end smoke test for logframe rendering"
```

**Checkpoint:** B.3.c complete. Full UI + API + E2E test.

---

## Sub-phase B.3.d: Docs + final

### Task 14: README + CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: README — append a new section**

After the "Multi-period workflow" section (or wherever Phase B.2 docs landed), add:

```markdown
### Results framework (logframe)

Structure your indicators in a Goal → Outcomes → Outputs hierarchy. The framework is editable in the Composition tab and renders as a `{{ logframe }}` section in generated reports.

**Config**:

```yaml
framework:
  goal:
    id:    GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - id: OC1
      label: "80% of children under 5 fully vaccinated"
      parent: GOAL
  outputs:
    - id: OP1.1
      label: "10,000 vaccination doses administered"
      parent: OC1

indicators:
  - name: vaccinations_administered
    framework_ref: OP1.1
    stat: sum
    question: Number of doses
```

**Template usage**:

```
{% if logframe.has_framework %}
Results Framework
{% for row in logframe.rows %}
{{ '  ' * row.indent }}{{ row.label }}{% if row.indicators %}: {% for ind in row.indicators %}{{ ind.name }}={{ ind.value }}{% if not loop.last %}, {% endif %}{% endfor %}{% endif %}
{% endfor %}
{% endif %}
```

**Validation**: indicators whose `framework_ref` doesn't match any node appear as warnings in the **Validate** tab (`orphan_framework_ref` finding).

**Backward compatibility**: configs without a `framework:` block behave exactly as today.
```

- [ ] **Step 2: CLAUDE.md — append `framework:` block to the annotated config example**

Find the annotated `config.yml` example. Insert (above `export:`):

```yaml
# Optional — results framework (logframe). When absent, no framework rendering.
framework:
  goal:
    id:    GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - id: OC1
      label: "80% of children under 5 fully vaccinated"
      parent: GOAL
  outputs:
    - id: OP1.1
      label: "10,000 vaccination doses administered"
      parent: OC1
```

Add a note to the indicators section that `framework_ref: <node_id>` is now a supported field.

- [ ] **Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: results framework in README + CLAUDE.md"
```

---

### Task 15: Final cross-cutting review

(Handled by the controller via a final-review subagent dispatch — no code changes.)

---

## Self-review checklist

After all tasks land:

- [ ] `pytest -v` passes (expected: ~74 tests; was 56 before this plan).
- [ ] Configs without a `framework:` block behave EXACTLY as today (regression-test: `test_build_report_smoke.py` passes unchanged).
- [ ] `/api/framework` GET returns `{goal: null, outcomes: [], outputs: []}` when no framework block exists.
- [ ] Frontend: Composition tab shows the FrameworkCard; can add a goal, outcome, output and save.
- [ ] Frontend: IndicatorModal has a "Framework link" dropdown; selecting a node persists `framework_ref` in the config.
- [ ] Frontend: Validate tab surfaces orphan framework_refs as warnings.
- [ ] `build-report` with a framework configured produces a docx that contains the logframe section.

## Deferred to follow-up plans

| Concern | Where |
|---|---|
| Activity level (4th tier) | future B.3 polish |
| Word-table rendering (proper docx table instead of indented text) | future B.3 polish |
| Auto-suggest framework from indicator names (AI) | future B.3 polish |
| Per-indicator targets driven by the framework | future B.3 polish |
| PII redaction step in the data pipeline | **B.4** |
