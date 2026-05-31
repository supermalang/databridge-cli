# Layer 4 — Question Engine Slice 1 ("Ask") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask a natural-language question and get 1–3 locally-rendered chart answers with captions grounded in the actual numbers, savable into the report.

**Architecture:** A new `src/reports/ask_engine.py` orchestrates: build a data-aware catalog from the Layer 2 profile → LLM proposes chart recipes (`lf_client` + new seed prompts) → validate against chart-type role requirements → render locally (reuse the chart engine) → ground captions in computed values → return; `save_recipe` appends to `config.charts`. Thin web endpoints + an "Ask" tab.

**Tech Stack:** Python 3, pandas, pytest, FastAPI, React/Vite, Langfuse-managed prompts (`lf_client`).

**Spec:** `docs/superpowers/specs/2026-05-31-layer4-ask-engine-slice1-design.md`. On `main`: Layers 1–3 merged; suite 194 passing.

---

## Reused interfaces (verified on main)

- `src/data/profile.py`: `profile_dataset(cfg, main_df, repeat_tables) -> {name: TableProfile}` (TableProfile = `{name, rows, columns:[{name, role, distinct, missing_pct, ...}], correlations, duplicates}`).
- `src/reports/builder.py`: `_pick_df(questions, main_df, repeat_tables, source=None) -> DataFrame` (module-level).
- `src/data/transform.py`: `apply_local_scope(df, repeat_tables, source=None, filter_expr=None, sample_n=None, random_sample=True)`.
- `src/reports/charts.py`: `generate_chart(chart_cfg, df, out_dir=CHART_DIR) -> Optional[Path]` (catches its own render errors, returns None), `CHART_DIR`.
- `src/utils/lf_client.py`: `get_prompt(name, variables, label="production") -> messages`; `chat(messages, *, model, provider, api_key, max_tokens, trace_name, base_url=None, json_mode=False) -> str`.
- `src/utils/config.py`: `load_config`, `write_config`. `web/main.py` has `load_config`, `load_processed_data`, `CONFIG_PATH` at module level (Layers 1–3).

## Core chart types + role requirements (CHART_REQS)

| type | rule |
|---|---|
| bar, horizontal_bar, pie, donut | ≥1 categorical |
| line, area | ≥1 date |
| histogram | ≥1 quantitative |
| scatter | ≥2 quantitative |
| box_plot | ≥1 categorical AND ≥1 quantitative |
| grouped_bar, stacked_bar, heatmap | ≥2 categorical |

Roles come from the profile (`categorical`/`quantitative`/`qualitative`/`date`/`geographical`/`undefined`). A recipe of a non-core type, or whose columns don't satisfy the rule, is dropped with a reason.

## File structure
- **Create:** `src/reports/ask_engine.py` — `build_catalog`, `validate_recipe`, `propose_charts`, `render_recipe`, `ground_captions`, `ask`, `save_recipe`, `CHART_REQS`.
- **Modify:** `src/utils/seed_prompts.py` — `_ASK_CHARTS`, `_ASK_CAPTION` + register in `SEED_PROMPTS`.
- **Modify:** `web/main.py` — `POST /api/ask`, `POST /api/ask/save`.
- **Create:** `frontend/src/pages/Ask.jsx`; **Modify:** `frontend/src/App.jsx`.
- **Create:** `tests/test_ask_engine.py`, `tests/test_ask_api.py`.
- **Modify:** `CLAUDE.md`.

---

## Task 1: Seed prompts `ask_charts` + `ask_caption`

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ask_engine.py
from src.utils import lf_client


def test_ask_charts_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_charts", {
        "question": "How many people by region?",
        "catalog": "{}",
        "chart_types": "bar: >=1 categorical",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "How many people by region?" in blob   # {{question}} substituted


def test_ask_caption_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_caption", {"charts_block": "chart_a — Region: N=5"})
    blob = " ".join(m["content"] for m in msgs)
    assert "chart_a" in blob
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: FAIL — `get_prompt("ask_charts", …)` falls back to seeds and raises/returns nothing because the seed is absent (KeyError or empty).

- [ ] **Step 3: Add the seeds**

In `src/utils/seed_prompts.py`, add these two message lists near the other `_*` templates:

```python
_ASK_CHARTS: ChatMessages = [
    {"role": "system", "content": (
        "You are a data analyst. Given a catalog of available tables and columns "
        "(with their roles and data shape) and a user's question, propose 1 to 3 chart "
        "specifications that best answer the question. "
        "Use ONLY table and column names that appear in the catalog. "
        "Choose chart types ONLY from the provided list and respect each type's column "
        "requirements. Always respond with valid JSON only — no markdown fences, no commentary."
    )},
    {"role": "user", "content": (
        "User question: {{question}}\n\n"
        "Available data (catalog):\n{{catalog}}\n\n"
        "Chart types you may use (with column requirements):\n{{chart_types}}\n\n"
        "Propose 1 to 3 charts. For each chart provide: a short snake_case \"name\", a human "
        "\"title\", a \"type\" from the list, and a \"questions\" list of column names in the "
        "order the chart type expects. Optionally add \"source\" (a table name from the catalog; "
        "omit for the main table), \"group_by\" (a column), and \"filter\" (a pandas query "
        "string over column names).\n"
        'Return ONLY JSON: {"charts": [{"name": "...", "title": "...", "type": "...", '
        '"questions": ["..."], "source": "...", "group_by": "...", "filter": "..."}]}'
    )},
]

_ASK_CAPTION: ChatMessages = [
    {"role": "system", "content": (
        "You write one-line factual chart captions for a data report. For each chart you are "
        "given its title and the ACTUAL computed values it shows. Write a single factual "
        "sentence per chart describing what the data shows, using ONLY the numbers provided. "
        "Do not invent figures. Respond with valid JSON only."
    )},
    {"role": "user", "content": (
        "Charts and their computed values:\n{{charts_block}}\n\n"
        'Return ONLY JSON mapping each chart name to a one-sentence caption: '
        '{"captions": {"<name>": "..."}}'
    )},
]
```

Then register both in the `SEED_PROMPTS` dict (find the existing `SEED_PROMPTS = {` mapping at the bottom of the file and add):

```python
    "ask_charts": _ASK_CHARTS,
    "ask_caption": _ASK_CAPTION,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/utils/seed_prompts.py tests/test_ask_engine.py
git commit -m "feat(prompts): add ask_charts + ask_caption seed prompts"
```

---

## Task 2: `build_catalog`

**Files:**
- Create: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
from src.reports.ask_engine import build_catalog


def _profile_fixture():
    return {
        "main": {
            "name": "main", "rows": 3,
            "columns": [
                {"name": "_id", "role": "linkage", "distinct": 3, "missing_pct": 0.0},
                {"name": "Region", "role": "categorical", "distinct": 2, "missing_pct": 0.0,
                 "high_cardinality": False, "top_values": [{"value": "N", "count": 2}, {"value": "S", "count": 1}]},
                {"name": "Age", "role": "quantitative", "distinct": 3, "missing_pct": 0.0,
                 "min": 10.0, "max": 30.0, "mean": 20.0, "median": 20.0},
                {"name": "Story", "role": "qualitative", "distinct": 3, "missing_pct": 0.0,
                 "high_cardinality": True},
            ],
            "correlations": [], "duplicates": None,
        }
    }


def test_build_catalog_condenses_and_excludes_linkage():
    cat = build_catalog(_profile_fixture())
    main = next(t for t in cat["tables"] if t["name"] == "main")
    names = {c["name"]: c for c in main["columns"]}
    assert "_id" not in names                       # linkage excluded
    assert names["Region"]["role"] == "categorical"
    assert names["Region"]["top_values"] == ["N", "S"]   # condensed to values
    assert names["Age"]["min"] == 10.0 and names["Age"]["max"] == 30.0
    assert "top_values" not in names["Story"]       # high-cardinality: no values
    assert main["rows"] == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_build_catalog_condenses_and_excludes_linkage -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'src.reports.ask_engine'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/reports/ask_engine.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add build_catalog (condense profile into data-aware catalog)"
```

---

## Task 3: `validate_recipe` + `CHART_REQS`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
from src.reports.ask_engine import validate_recipe


def test_validate_recipe_accepts_valid_bar():
    profile = _profile_fixture()
    ok, reason = validate_recipe({"type": "bar", "questions": ["Region"]}, profile)
    assert ok and reason == ""


def test_validate_recipe_rejects_missing_column():
    profile = _profile_fixture()
    ok, reason = validate_recipe({"type": "bar", "questions": ["Nope"]}, profile)
    assert not ok and "Nope" in reason


def test_validate_recipe_rejects_scatter_without_two_quant():
    profile = _profile_fixture()
    ok, reason = validate_recipe({"type": "scatter", "questions": ["Age", "Region"]}, profile)
    assert not ok and "quantitative" in reason


def test_validate_recipe_rejects_unknown_type():
    profile = _profile_fixture()
    ok, reason = validate_recipe({"type": "radar", "questions": ["Region"]}, profile)
    assert not ok and "type" in reason


def test_validate_recipe_unknown_source():
    profile = _profile_fixture()
    ok, reason = validate_recipe({"type": "bar", "questions": ["X"], "source": "ghost"}, profile)
    assert not ok and "source" in reason
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_validate_recipe_accepts_valid_bar -v`
Expected: FAIL — `ImportError: cannot import name 'validate_recipe'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/reports/ask_engine.py
# type -> (check(n_cat, n_quant, n_date) -> bool, human requirement)
CHART_REQS = {
    "bar":            (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "horizontal_bar": (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "pie":            (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "donut":          (lambda c, q, d: c >= 1, "≥1 categorical column"),
    "line":           (lambda c, q, d: d >= 1, "≥1 date column"),
    "area":           (lambda c, q, d: d >= 1, "≥1 date column"),
    "histogram":      (lambda c, q, d: q >= 1, "≥1 quantitative column"),
    "scatter":        (lambda c, q, d: q >= 2, "≥2 quantitative columns"),
    "box_plot":       (lambda c, q, d: c >= 1 and q >= 1, "1 categorical + 1 quantitative"),
    "grouped_bar":    (lambda c, q, d: c >= 2, "≥2 categorical columns"),
    "stacked_bar":    (lambda c, q, d: c >= 2, "≥2 categorical columns"),
    "heatmap":        (lambda c, q, d: c >= 2, "≥2 categorical columns"),
}


def validate_recipe(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    """Validate a proposed chart recipe against the profile. Returns (ok, reason)."""
    ctype = recipe.get("type")
    if ctype not in CHART_REQS:
        return False, f"unsupported chart type '{ctype}'"
    source = recipe.get("source") or "main"
    tp = profile.get(source)
    if tp is None:
        return False, f"unknown source table '{source}'"
    roles = {c["name"]: c.get("role") for c in tp.get("columns", [])}
    cols = list(recipe.get("questions") or [])
    if recipe.get("group_by"):
        cols.append(recipe["group_by"])
    if not cols:
        return False, "no columns specified"
    for c in cols:
        if c not in roles:
            return False, f"column '{c}' not found in '{source}'"
    col_roles = [roles[c] for c in cols]
    n_cat = col_roles.count("categorical")
    n_quant = col_roles.count("quantitative")
    n_date = col_roles.count("date")
    check, requirement = CHART_REQS[ctype]
    if not check(n_cat, n_quant, n_date):
        return False, f"'{ctype}' needs {requirement}"
    return True, ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (8 passed)

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add validate_recipe + CHART_REQS role requirements"
```

---

## Task 4: `propose_charts`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
from src.reports import ask_engine


def test_propose_charts_parses_llm_json(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [{"role": "user", "content": "x"}])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"charts": [{"name": "by_region", "type": "bar", "questions": ["Region"]}]}')
    ai_cfg = {"provider": "openai", "api_key": "sk-x", "model": "gpt-4o"}
    out = ask_engine.propose_charts("q", {"tables": []}, ai_cfg)
    assert out == [{"name": "by_region", "type": "bar", "questions": ["Region"]}]


def test_propose_charts_malformed_returns_empty(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat", lambda *a, **k: "not json at all")
    out = ask_engine.propose_charts("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert out == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_propose_charts_parses_llm_json -v`
Expected: FAIL — `AttributeError: module 'src.reports.ask_engine' has no attribute 'lf_client'` / no `propose_charts`.

- [ ] **Step 3: Write minimal implementation**

Add the import near the top of `src/reports/ask_engine.py` (after the stdlib imports):
```python
from src.utils import lf_client
```
Then add the chart-type catalog constant and the function:
```python
_CHART_TYPES_BLOCK = "\n".join(f"- {t}: {req}" for t, (_chk, req) in CHART_REQS.items())


def _parse_charts(raw: str) -> List[Dict]:
    """Parse {"charts": [...]} from an LLM response, tolerating fences/prose."""
    import re
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        if not m:
            return []
        try:
            data = json.loads(m.group(0))
        except (ValueError, TypeError):
            return []
    charts = data.get("charts") if isinstance(data, dict) else None
    return charts if isinstance(charts, list) else []


def propose_charts(question: str, catalog: Dict, ai_cfg: Dict) -> List[Dict]:
    """Ask the LLM for 1–3 chart recipes for the question. Returns [] on any failure."""
    provider = (ai_cfg.get("provider") or "openai").lower()
    variables = {
        "question": question,
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "chart_types": _CHART_TYPES_BLOCK,
    }
    try:
        messages = lf_client.get_prompt("ask_charts", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_charts",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: propose_charts failed: {e}")
        return []
    return _parse_charts(raw)[:3]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (10 passed)

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add propose_charts (LLM recipe proposer, fail-soft)"
```

---

## Task 5: `render_recipe` + result summary

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
from src.reports.ask_engine import render_recipe


def test_render_recipe_produces_png_and_summary():
    df = pd.DataFrame({"Region": ["N", "N", "S", "E", "E", "E"]})
    recipe = {"name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]}
    result = render_recipe(recipe, df, {})
    assert result is not None
    png, summary = result
    assert png.exists() and png.suffix == ".png"
    assert "Region" in summary and "E" in summary   # summary mentions the column + a top value


def test_render_recipe_returns_none_on_bad_column():
    df = pd.DataFrame({"Region": ["N", "S"]})
    result = render_recipe({"name": "x", "type": "bar", "questions": ["Ghost"]}, df, {})
    assert result is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_render_recipe_produces_png_and_summary -v`
Expected: FAIL — `ImportError: cannot import name 'render_recipe'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/reports/ask_engine.py
def _result_summary(recipe: Dict, chart_df: pd.DataFrame) -> str:
    """Compact text of the values a chart actually shows, for caption grounding."""
    cols = list(recipe.get("questions") or [])
    if recipe.get("group_by") and recipe["group_by"] not in cols:
        cols.append(recipe["group_by"])
    parts = []
    for c in cols[:2]:
        if c not in chart_df.columns:
            continue
        s = chart_df[c]
        num = pd.to_numeric(s, errors="coerce")
        if num.notna().sum() >= max(1, len(s) // 2):
            v = num.dropna()
            if len(v):
                parts.append(f"{c}: min={v.min():.1f}, mean={v.mean():.1f}, max={v.max():.1f}")
        else:
            vc = s.dropna().value_counts().head(5)
            parts.append(f"{c}: " + ", ".join(f"{k}={int(n)}" for k, n in vc.items()))
    return "; ".join(parts) or "(no values)"


def render_recipe(recipe: Dict, df: pd.DataFrame,
                  repeat_tables: Dict[str, pd.DataFrame]) -> Optional[Tuple[Path, str]]:
    """Resolve the chart DataFrame and render a PNG. Returns (png_path, result_summary)
    or None if the columns are missing or rendering fails."""
    from src.reports.builder import _pick_df
    from src.data.transform import apply_local_scope
    from src.reports.charts import generate_chart

    questions = list(recipe.get("questions") or [])
    gb = recipe.get("group_by")
    resolved_questions = questions + ([gb] if gb and gb not in questions else [])
    source = recipe.get("source")
    try:
        chart_df = _pick_df(resolved_questions, df, repeat_tables or {}, source=source)
        missing = [q for q in resolved_questions if q not in chart_df.columns]
        if missing:
            return None
        filter_expr = recipe.get("filter")
        if filter_expr:
            chart_df = apply_local_scope(chart_df, {}, filter_expr=filter_expr)
        summary = _result_summary(recipe, chart_df)
        resolved = {**recipe, "questions": resolved_questions}
        png = generate_chart(resolved, chart_df)
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: render_recipe failed for '{recipe.get('name')}': {e}")
        return None
    if png is None or not Path(png).exists():
        return None
    return Path(png), summary
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (12 passed)

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add render_recipe (local chart render + result summary)"
```

---

## Task 6: `ground_captions`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
def test_ground_captions_uses_llm(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [{"role": "user", "content": "x"}])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"captions": {"by_region": "Region E leads with 3."}}')
    items = [{"name": "by_region", "title": "By region", "summary": "Region: E=3, N=2, S=1"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["by_region"] == "Region E leads with 3."


def test_ground_captions_falls_back_to_title_on_failure(monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("no ai")
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat", _boom)
    items = [{"name": "c1", "title": "Fallback Title", "summary": "x"}]
    caps = ask_engine.ground_captions(items, {"provider": "openai", "api_key": "sk-x"})
    assert caps["c1"] == "Fallback Title"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ground_captions_uses_llm -v`
Expected: FAIL — `AttributeError: ... has no attribute 'ground_captions'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/reports/ask_engine.py
def ground_captions(items: List[Dict], ai_cfg: Dict) -> Dict[str, str]:
    """One batched LLM call to caption each rendered chart from its computed values.
    items: [{"name", "title", "summary"}]. Falls back to the title per chart on failure."""
    fallback = {it["name"]: it.get("title") or it["name"] for it in items}
    if not items:
        return {}
    provider = (ai_cfg.get("provider") or "openai").lower()
    charts_block = "\n".join(f'{it["name"]} — {it.get("title", "")}: {it.get("summary", "")}' for it in items)
    try:
        messages = lf_client.get_prompt("ask_caption", {"charts_block": charts_block})
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=600,
            trace_name="ask_caption",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
        )
        data = json.loads(raw)
        caps = data.get("captions", {}) if isinstance(data, dict) else {}
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: ground_captions failed: {e}")
        caps = {}
    return {it["name"]: (caps.get(it["name"]) or fallback[it["name"]]) for it in items}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (14 passed)

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add ground_captions (batched, grounded, title fallback)"
```

---

## Task 7: `ask` orchestrator + `save_recipe`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_ask_engine.py
def test_ask_end_to_end(monkeypatch):
    # propose returns one valid bar recipe; captions grounded; image base64
    monkeypatch.setattr(ask_engine, "propose_charts",
                        lambda q, cat, ai: [{"name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]}])
    monkeypatch.setattr(ask_engine, "ground_captions",
                        lambda items, ai: {it["name"]: "Region E leads." for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": [
        {"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3, 4], "Region": ["N", "E", "E", "E"]})
    out = ask_engine.ask("by region?", cfg, df, {})
    assert len(out["proposals"]) == 1
    p = out["proposals"][0]
    assert p["image"].startswith("data:image/png;base64,")
    assert p["caption"] == "Region E leads."
    assert out["skipped"] == []


def test_ask_no_ai_returns_message():
    cfg = {"ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"}}  # unresolved
    out = ask_engine.ask("q", cfg, pd.DataFrame({"_id": [1]}), {})
    assert out["proposals"] == [] and "AI" in out["message"]


def test_save_recipe_appends_to_config():
    cfg = {"charts": [{"name": "existing"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg)
    assert name == "by_region"
    assert [c["name"] for c in cfg["charts"]] == ["existing", "by_region"]


def test_save_recipe_dedupes_name():
    cfg = {"charts": [{"name": "by_region"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg)
    assert name == "by_region_2"
    assert [c["name"] for c in cfg["charts"]] == ["by_region", "by_region_2"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_end_to_end -v`
Expected: FAIL — `AttributeError: ... has no attribute 'ask'`

- [ ] **Step 3: Write minimal implementation**

```python
# add to src/reports/ask_engine.py
def _ai_ready(ai_cfg: Dict) -> bool:
    key = str(ai_cfg.get("api_key", ""))
    return bool(ai_cfg.get("provider")) and bool(key) and not key.startswith("env:")


def _b64_png(path: Path) -> str:
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:image/png;base64,{data}"


def ask(question: str, cfg: Dict, df: pd.DataFrame,
        repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Full ask loop. Returns {"proposals": [...], "skipped": [...], "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposals": [], "skipped": [],
                "message": "Configure an AI provider in Sources to ask questions."}

    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile)

    recipes = propose_charts(question, catalog, ai_cfg)
    if not recipes:
        return {"proposals": [], "skipped": [],
                "message": "Couldn't turn that into a chart — try rephrasing."}

    valid, skipped = [], []
    for r in recipes:
        title = r.get("title") or r.get("name") or r.get("type", "chart")
        ok, reason = validate_recipe(r, profile)
        if not ok:
            skipped.append({"title": title, "reason": reason})
            continue
        rendered = render_recipe(r, df, repeat_tables or {})
        if rendered is None:
            skipped.append({"title": title, "reason": "could not render this chart"})
            continue
        png, summary = rendered
        valid.append({"recipe": r, "png": png, "summary": summary, "title": title})

    captions = ground_captions(
        [{"name": v["recipe"].get("name", v["title"]), "title": v["title"], "summary": v["summary"]} for v in valid],
        ai_cfg,
    )
    proposals = [{
        "recipe": v["recipe"],
        "image": _b64_png(v["png"]),
        "caption": captions.get(v["recipe"].get("name", v["title"]), v["title"]),
    } for v in valid]
    return {"proposals": proposals, "skipped": skipped, "message": None}


def save_recipe(recipe: Dict, cfg: Dict) -> str:
    """Append a chart recipe to cfg['charts'], de-duplicating the name. Mutates cfg;
    the caller persists via write_config. Returns the final saved name."""
    charts = cfg.setdefault("charts", [])
    existing = {c.get("name") for c in charts}
    name = recipe.get("name") or "chart"
    if name in existing:
        i = 2
        while f"{name}_{i}" in existing:
            i += 1
        name = f"{name}_{i}"
    saved = {**recipe, "name": name}
    charts.append(saved)
    return name
```

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v`
Expected: PASS (18 passed)

- [ ] **Step 5: Run the full suite, then commit**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass (was 194 + new ask_engine tests). Report the count.

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add ask orchestrator + save_recipe"
```

---

## Task 8: `POST /api/ask` + `POST /api/ask/save`

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_ask_api.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_ask_api.py
import pandas as pd
from fastapi.testclient import TestClient
import web.main as wm


def test_ask_endpoint_returns_proposals(monkeypatch):
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))
    monkeypatch.setattr(wm.ask_engine, "ask",
                        lambda q, c, d, r: {"proposals": [{"recipe": {"name": "x"}, "image": "data:image/png;base64,AAA", "caption": "cap"}],
                                            "skipped": [], "message": None})
    client = TestClient(wm.app)
    resp = client.post("/api/ask", json={"question": "by region?"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["proposals"][0]["caption"] == "cap"


def test_ask_endpoint_no_data(monkeypatch):
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: {})
    def _raise(*a, **k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.post("/api/ask", json={"question": "q"}).json()
    assert body["proposals"] == [] and "Download" in body["message"]


def test_ask_save_appends(monkeypatch):
    saved = {}
    cfg = {"charts": []}
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update({"charts": c["charts"]}))
    client = TestClient(wm.app)
    resp = client.post("/api/ask/save", json={"recipe": {"name": "by_region", "type": "bar", "questions": ["Region"]}})
    assert resp.status_code == 200 and resp.json()["name"] == "by_region"
    assert saved["charts"][0]["name"] == "by_region"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_api.py -v`
Expected: FAIL — 404 (routes missing) / `wm.ask_engine` attribute error.

- [ ] **Step 3: Add the endpoints**

In `web/main.py`, add module-level imports (alongside the existing `from src.utils.config import load_config` and `write_config`):
```python
from src.reports import ask_engine
from src.utils.config import write_config
```
(If `write_config` is already imported at module level, don't duplicate it; if it's only imported inline elsewhere, add the module-level import so the test's monkeypatch on `wm.write_config` works.)

Add the routes near the other `/api/*` POST routes:
```python
@app.post("/api/ask")
async def api_ask(payload: dict = Body(...)):
    """Answer a natural-language question with 1–3 locally-rendered, grounded charts."""
    question = (payload or {}).get("question", "").strip()
    if not question:
        return {"proposals": [], "skipped": [], "message": "Type a question to ask."}
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"proposals": [], "skipped": [], "message": "No data yet — run Download first."}
    return ask_engine.ask(question, cfg, df, repeats)


@app.post("/api/ask/save")
async def api_ask_save(payload: dict = Body(...)):
    """Append a proposed chart recipe to config.charts."""
    recipe = (payload or {}).get("recipe")
    if not isinstance(recipe, dict):
        return {"ok": False, "error": "missing recipe"}
    cfg = load_config(CONFIG_PATH)
    name = ask_engine.save_recipe(recipe, cfg)
    write_config(cfg, CONFIG_PATH)
    return {"ok": True, "name": name}
```
Confirm `Body` is imported from `fastapi` at the top of `web/main.py` (it's used by other POST endpoints; if not present, add `from fastapi import Body` or use the existing request-parsing pattern in the file).

- [ ] **Step 4: Run test to verify it passes**

Run: `PYTHONPATH=. python -m pytest tests/test_ask_api.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full suite, then commit**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass.

```bash
git add web/main.py tests/test_ask_api.py
git commit -m "feat(api): add POST /api/ask and /api/ask/save"
```

---

## Task 9: "Ask" tab (frontend, web-first)

**Files:**
- Create: `frontend/src/pages/Ask.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create `frontend/src/pages/Ask.jsx`**

```jsx
import { useState } from 'react';
import PageHeader from './PageHeader.jsx';

export default function Ask() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);   // { proposals, skipped, message }
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState({});        // recipe.name -> true

  async function submit(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true); setError(null); setResult(null); setSaved({});
    try {
      const r = await fetch('/api/ask', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setError(data.detail || `Request failed (${r.status})`); return; }
      setResult(data);
    } catch (err) {
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  }

  async function save(recipe) {
    try {
      const r = await fetch('/api/ask/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) setSaved(s => ({ ...s, [recipe.name]: true }));
    } catch { /* noop */ }
  }

  return (
    <div style={{ padding: '0 0 40px' }}>
      <PageHeader
        eyebrow="Ask"
        title="Ask your"
        accent="data."
        sub="Ask a question in plain language — get charts computed from your data, with captions grounded in the actual numbers."
      />
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, padding: '0 8px 16px' }}>
        <input
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. How many submissions by region?"
          style={{ flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--line, #e5e7eb)' }}
        />
        <button type="submit" disabled={loading} className="btn-primary"
                style={{ padding: '10px 18px', borderRadius: 8 }}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <div style={{ padding: 24, color: 'var(--danger, #b91c1c)' }}>{error}</div>
      )}
      {result?.message && (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--ink-3)' }}>{result.message}</div>
      )}
      {result?.skipped?.length > 0 && (
        <div style={{ padding: '0 8px 12px', color: 'var(--ink-3)', fontSize: 12.5 }}>
          Skipped {result.skipped.length} suggestion(s): {result.skipped.map(s => `${s.title} (${s.reason})`).join('; ')}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '0 8px' }}>
        {result?.proposals?.map((p, i) => (
          <div key={p.recipe?.name || i}
               style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: 12, width: 380, maxWidth: '100%' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.recipe?.title || p.recipe?.name}</div>
            <img src={p.image} alt={p.recipe?.title || 'chart'} style={{ width: '100%', borderRadius: 6 }} />
            <div style={{ color: 'var(--ink-3)', fontSize: 13, margin: '8px 0' }}>{p.caption}</div>
            <button onClick={() => save(p.recipe)} disabled={saved[p.recipe?.name]}
                    style={{ padding: '6px 12px', borderRadius: 6 }}>
              {saved[p.recipe?.name] ? 'Saved ✓' : 'Save to report'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

If `PageHeader.jsx`'s props differ from `eyebrow/title/accent/sub`, adapt to match (check `Validate.jsx`/`Profile.jsx` usage) and report. If there's no `btn-primary` class, the inline styles still render a usable button — leave it.

- [ ] **Step 2: Register the tab in `frontend/src/App.jsx`**

Add the import after the other page imports:
```jsx
import Ask from './pages/Ask.jsx';
```
Add an entry to the `TABS` array immediately AFTER the `dashboard` entry (prominent, before the numbered steps), so it reads:
```jsx
  { id: 'dashboard',   label: 'Dashboard',                         component: Dashboard },
  { id: 'ask',         label: 'Ask',                               component: Ask },
```

- [ ] **Step 3: Verify the frontend builds**

Run:
```bash
cd /workspaces/databridge-cli/frontend && (test -d node_modules || npm install) && npm run build
```
Expected: Vite build completes with no errors.

- [ ] **Step 4: Confirm backend suite still green**

Run: `cd /workspaces/databridge-cli && PYTHONPATH=. python -m pytest tests/ -q`
Expected: all pass (no backend change in this task).

- [ ] **Step 5: Commit**

```bash
cd /workspaces/databridge-cli
git add frontend/src/pages/Ask.jsx frontend/src/App.jsx
git commit -m "feat(ui): add Ask tab (question -> rendered charts + save)"
```

---

## Task 10: Document the Ask engine

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a subsection to CLAUDE.md**

After the `### PII gate (src/utils/pii.py)` subsection (Layer 3), insert:

```markdown
### Ask question-engine (src/reports/ask_engine.py)
`ask(question, cfg, df, repeat_tables)` answers a natural-language question with 1–3
locally-rendered charts:
1. `build_catalog` condenses the Layer 2 profile into a data-aware catalog (roles,
   cardinality, low-cardinality top-values, numeric ranges; linkage columns excluded).
2. `propose_charts` asks the LLM (`ask_charts` prompt) for chart recipes (chart-config dicts).
3. `validate_recipe` checks columns + chart-type role requirements (`CHART_REQS`); bad
   recipes are dropped with a reason.
4. `render_recipe` renders each valid recipe locally via the existing chart engine.
5. `ground_captions` (`ask_caption` prompt) writes one-line captions from the charts'
   ACTUAL computed values (falls back to the title if AI is off).
`save_recipe` appends a chosen recipe to `config.charts`. Exposed at `POST /api/ask`
and `POST /api/ask/save`; surfaced in the **Ask** tab. Needs an AI provider configured
and downloaded data.
```

Also add `ask_charts` and `ask_caption` to the "Prompt names and consuming files" table in the Prompt-management section (consuming file: `src/reports/ask_engine.py`; output: JSON `{"charts":[...]}` and `{"captions":{...}}` respectively).

- [ ] **Step 2: Verify**

Run: `PYTHONPATH=. python -m pytest tests/ -q`
Expected: full suite green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document the Ask question-engine and its prompts"
```

---

## Self-review notes

- **Spec coverage:** catalog (T2) ✓; propose (T1 prompt + T4) ✓; validate w/ core chart set + roles (T3) ✓; render locally (T5) ✓; grounded captions (T1 prompt + T6) ✓; ask orchestrator + skipped/proposals shape + base64 (T7) ✓; save → config.charts (T7 + T8) ✓; web endpoints (T8) ✓; Ask tab after Dashboard (T9) ✓; preconditions no-AI/no-data (T7 ask + T8 endpoint) ✓; fail-soft (T4/T5/T6 try/except) ✓; docs + prompt table (T10) ✓. Deferred items (views, indicators/summaries, refinement, two-step catalog) correctly absent.
- **Type/name consistency:** `build_catalog(profile)→{tables:[...]}`, `validate_recipe(recipe, profile)→(ok,reason)`, `propose_charts(question, catalog, ai_cfg)→[recipe]`, `render_recipe(recipe, df, repeats)→(Path,str)|None`, `ground_captions(items, ai_cfg)→{name:caption}`, `ask(question, cfg, df, repeats)→{proposals,skipped,message}`, `save_recipe(recipe, cfg)→name`. `lf_client` referenced as `ask_engine.lf_client` (module import) so tests monkeypatch it. Recipe = chart-config dict consumed by the existing chart engine.
- **No placeholders:** every code/command step is complete. Frontend verified via Vite build (no JS test harness).
