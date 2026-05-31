# Layer 4 — Ask Slice 2 (Indicator Answers) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Ask engine answer a question with a scalar indicator (a formatted number) as well as a chart — the LLM decides per item which fits.

**Architecture:** Evolve the Slice-1 chart-only Ask engine into a mixed-modality one. A single unified `ask_propose` prompt returns `kind`-tagged items (`chart` | `indicator`); `validate_recipe` dispatches by kind; charts render (Slice-1 path, unchanged), indicators compute via `compute_indicators`; `ask` returns unified proposals; `save_recipe` routes to `config.charts` / `config.indicators`.

**Tech Stack:** Python 3, pandas, pytest, FastAPI, React/Vite, Langfuse-managed prompts (`lf_client`).

**Spec:** `docs/superpowers/specs/2026-05-31-layer4-ask-slice2-indicators-design.md`. On `main`: Layers 1–4 Slice 1 merged; suite 216 passing.

---

## Reused interfaces (verified on main)
- `src/reports/indicators.py`: `compute_indicators(indicators, df, repeat_tables=None, per_period=None) -> {ind_<name>: formatted_value}`. Indicator recipe: `{name, stat, question?, format?, filter?, source?, filter_value?}`. Stats: count, count_distinct, sum, mean, median, min, max, percent, most_common, grouped_agg.
- Current `src/reports/ask_engine.py` (Slice 1): `build_catalog`, `CHART_REQS`, `validate_recipe` (chart-only), `_CHART_TYPES_BLOCK`, `_parse_charts`, `propose_charts`, `render_recipe`, `ground_captions`, `_ai_ready`, `_b64_png`, `ask`, `save_recipe`.
- `web/main.py`: `AskPayload`/`AskSavePayload` (Pydantic), `POST /api/ask`/`/api/ask/save`, module-level `ask_engine`, `write_config`.
- `frontend/src/pages/Ask.jsx`: renders `result.proposals[].{recipe,image,caption}`; `save(recipe)` posts `{recipe}`.

## Indicator stats offered in Slice 2
`count, count_distinct, sum, mean, median, min, max, percent, most_common` (grouped_agg is **excluded** — too complex for the proposer this slice).

---

## File structure
- **Modify:** `src/utils/seed_prompts.py` — replace `_ASK_CHARTS`/`"ask_charts"` with `_ASK_PROPOSE`/`"ask_propose"`.
- **Modify:** `src/reports/ask_engine.py` — `propose_items` (renames `propose_charts`), `INDICATOR_STATS` + indicator branch in `validate_recipe`, `compute_indicator`, mixed `ask`, `save_recipe(kind=)`.
- **Modify:** `web/main.py` — `AskSavePayload.kind`; save handler routes by kind.
- **Modify:** `frontend/src/pages/Ask.jsx` — render by `kind`; save sends `{recipe, kind}`.
- **Modify:** tests `tests/test_ask_engine.py`, `tests/test_ask_api.py`, `tests/test_seed_prompts.py`; **Modify:** `CLAUDE.md`.

---

## Task 1: Swap `ask_charts` → unified `ask_propose` prompt

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Test: `tests/test_ask_engine.py`, `tests/test_seed_prompts.py`

- [ ] **Step 1: Update the existing prompt-resolution test** in `tests/test_ask_engine.py`. Replace `test_ask_charts_prompt_resolves_offline` with:

```python
def test_ask_propose_prompt_resolves_offline():
    msgs = lf_client.get_prompt("ask_propose", {
        "question": "How many people by region?",
        "catalog": "{}",
        "chart_types": "bar: >=1 categorical",
        "indicator_stats": "count: rows",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "How many people by region?" in blob
```

- [ ] **Step 2: Run it** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_propose_prompt_resolves_offline -v` — expect FAIL (no `ask_propose` seed).

- [ ] **Step 3: Edit `src/utils/seed_prompts.py`.** Replace the `_ASK_CHARTS` definition with `_ASK_PROPOSE`:

```python
_ASK_PROPOSE: ChatMessages = [
    {"role": "system", "content": (
        "You are a data analyst. Given a catalog of available tables and columns "
        "(with roles and data shape) and a user's question, propose 1 to 3 ANSWERS that "
        "best fit. Each answer is either a CHART or a single-number INDICATOR. "
        "Use an indicator (a number) for 'how many / total / average / percentage' "
        "questions; use a chart for distributions, comparisons, breakdowns, and trends. "
        "Use ONLY table and column names that appear in the catalog. For charts, choose a "
        "type from the chart list and respect its column requirements. For indicators, "
        "choose a stat from the indicator list. Respond with valid JSON only — no fences, "
        "no commentary."
    )},
    {"role": "user", "content": (
        "User question: {{question}}\n\n"
        "Available data (catalog):\n{{catalog}}\n\n"
        "Chart types (with column requirements):\n{{chart_types}}\n\n"
        "Indicator stats:\n{{indicator_stats}}\n\n"
        "Propose 1 to 3 items. Every item has: \"kind\" (\"chart\" or \"indicator\"), a "
        "snake_case \"name\", a human \"title\", and optionally \"source\" (a table name "
        "from the catalog; omit for the main table).\n"
        "- chart items also: \"type\" (from the chart list) and \"questions\" (column names "
        "in the order the type expects); optionally \"group_by\" and \"filter\" (a pandas "
        "query string).\n"
        "- indicator items also: \"stat\" (from the indicator list) and \"question\" (a "
        "column; omit only for \"count\"); optionally \"filter\", and \"filter_value\" "
        "(required when stat is \"percent\").\n"
        'Return ONLY JSON: {"items": [{"kind": "...", "name": "...", "title": "...", "...": "..."}]}'
    )},
]
```

Then in the `SEED_PROMPTS` dict, replace the line `"ask_charts": _ASK_CHARTS,` with:
```python
    "ask_propose": _ASK_PROPOSE,
```
(`ask_caption` stays.)

- [ ] **Step 4: Update the seed-name test** in `tests/test_seed_prompts.py`: in `EXPECTED_NAMES`, replace `"ask_charts"` with `"ask_propose"`. (The total count stays the same, so `tests/test_lf_client.py` counts are unchanged.)

- [ ] **Step 5: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_propose_prompt_resolves_offline tests/test_seed_prompts.py tests/test_lf_client.py -q` — expect all pass.

- [ ] **Step 6: Commit**

```bash
git add src/utils/seed_prompts.py tests/test_ask_engine.py tests/test_seed_prompts.py
git commit -m "feat(ask): replace ask_charts with unified ask_propose prompt"
```

---

## Task 2: `propose_items` (mixed-modality proposer)

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Update the two existing proposer tests** in `tests/test_ask_engine.py`. Replace `test_propose_charts_parses_llm_json` and `test_propose_charts_malformed_returns_empty` with:

```python
def test_propose_items_parses_mixed(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [{"role": "user", "content": "x"}])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"items": [{"kind": "chart", "name": "by_region", "type": "bar", "questions": ["Region"]}, {"kind": "indicator", "name": "n", "stat": "count"}]}')
    out = ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert [i["kind"] for i in out] == ["chart", "indicator"]


def test_propose_items_defaults_kind_chart(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat",
                        lambda *a, **k: '{"items": [{"name": "x", "type": "bar", "questions": ["Region"]}]}')
    out = ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"})
    assert out[0]["kind"] == "chart"


def test_propose_items_malformed_returns_empty(monkeypatch):
    monkeypatch.setattr(ask_engine.lf_client, "get_prompt", lambda *a, **k: [])
    monkeypatch.setattr(ask_engine.lf_client, "chat", lambda *a, **k: "not json at all")
    assert ask_engine.propose_items("q", {"tables": []}, {"provider": "openai", "api_key": "sk-x"}) == []
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_propose_items_parses_mixed -v` — expect FAIL (no `propose_items`).

- [ ] **Step 3: Edit `src/reports/ask_engine.py`.**
  (a) Add the indicator-stats catalog constant after `_CHART_TYPES_BLOCK` (line ~92):
  ```python
  INDICATOR_STATS = {"count", "count_distinct", "sum", "mean", "median",
                     "min", "max", "percent", "most_common"}
  _NUMERIC_STATS = {"sum", "mean", "median", "min", "max"}
  _INDICATOR_STATS_BLOCK = (
      "- count: number of rows (no column)\n"
      "- count_distinct: unique values of a column\n"
      "- most_common: most frequent value of a column\n"
      "- sum / mean / median / min / max: a quantitative column\n"
      "- percent: share of rows where a column equals filter_value (needs filter_value)"
  )
  ```
  (b) Rename `_parse_charts` to `_parse_items` and change the key it reads from `"charts"` to `"items"`:
  ```python
  def _parse_items(raw: str) -> List[Dict]:
      """Parse {"items": [...]} from an LLM response, tolerating fences/prose."""
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
      items = data.get("items") if isinstance(data, dict) else None
      return items if isinstance(items, list) else []
  ```
  (c) Replace `propose_charts` with `propose_items`:
  ```python
  def propose_items(question: str, catalog: Dict, ai_cfg: Dict) -> List[Dict]:
      """Ask the LLM for 1–3 answer items (charts or indicators). Each item is tagged
      with a "kind" (defaulting to "chart"). Returns [] on any failure."""
      provider = (ai_cfg.get("provider") or "openai").lower()
      variables = {
          "question": question,
          "catalog": json.dumps(catalog, ensure_ascii=False),
          "chart_types": _CHART_TYPES_BLOCK,
          "indicator_stats": _INDICATOR_STATS_BLOCK,
      }
      try:
          messages = lf_client.get_prompt("ask_propose", variables)
          raw = lf_client.chat(
              messages,
              model=ai_cfg.get("model", "gpt-4o"),
              provider=provider,
              api_key=ai_cfg.get("api_key", ""),
              max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
              trace_name="ask_propose",
              base_url=ai_cfg.get("base_url"),
              json_mode=(provider != "anthropic"),
          )
      except Exception as e:  # noqa: BLE001
          log.warning(f"ask: propose_items failed: {e}")
          return []
      items = _parse_items(raw)[:3]
      for it in items:
          it.setdefault("kind", "chart")
      return items
  ```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` — expect all pass (the 3 new proposer tests + unchanged others).

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): propose_items unified mixed-modality proposer"
```

---

## Task 3: Indicator validation in `validate_recipe`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Append indicator-validation tests** to `tests/test_ask_engine.py` (the `_profile_fixture()` helper already exists):

```python
def test_validate_indicator_count_ok():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "count"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_sum_needs_quantitative():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Region"}, _profile_fixture())
    assert not ok and "quantitative" in reason


def test_validate_indicator_sum_ok_on_quant():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Age"}, _profile_fixture())
    assert ok and reason == ""


def test_validate_indicator_percent_needs_filter_value():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "percent", "question": "Region"}, _profile_fixture())
    assert not ok and "filter_value" in reason


def test_validate_indicator_unknown_stat():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "wat", "question": "Age"}, _profile_fixture())
    assert not ok and "stat" in reason


def test_validate_indicator_missing_column():
    ok, reason = validate_recipe({"kind": "indicator", "stat": "sum", "question": "Ghost"}, _profile_fixture())
    assert not ok and "Ghost" in reason


def test_validate_chart_still_works_without_kind():
    ok, reason = validate_recipe({"type": "bar", "questions": ["Region"]}, _profile_fixture())
    assert ok and reason == ""
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_validate_indicator_count_ok -v` — expect FAIL (no indicator branch yet → `count` has no `type` → "unsupported chart type 'None'").

- [ ] **Step 3: Edit `validate_recipe` in `src/reports/ask_engine.py`** to dispatch by kind. Rename the current chart body to `_validate_chart` and add `_validate_indicator`; `validate_recipe` becomes the dispatcher:

```python
def validate_recipe(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    """Validate a proposed recipe (chart or indicator) against the profile. (ok, reason)."""
    if recipe.get("kind", "chart") == "indicator":
        return _validate_indicator(recipe, profile)
    return _validate_chart(recipe, profile)


def _validate_chart(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
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
    check, requirement = CHART_REQS[ctype]
    if not check(col_roles.count("categorical"), col_roles.count("quantitative"), col_roles.count("date")):
        return False, f"'{ctype}' needs {requirement}"
    return True, ""


def _validate_indicator(recipe: Dict, profile: Dict[str, Dict]) -> Tuple[bool, str]:
    stat = recipe.get("stat")
    if stat not in INDICATOR_STATS:
        return False, f"unsupported indicator stat '{stat}'"
    source = recipe.get("source") or "main"
    tp = profile.get(source)
    if tp is None:
        return False, f"unknown source table '{source}'"
    roles = {c["name"]: c.get("role") for c in tp.get("columns", [])}
    if stat == "count":
        return True, ""
    q = recipe.get("question")
    if not q:
        return False, f"indicator stat '{stat}' needs a question column"
    if q not in roles:
        return False, f"column '{q}' not found in '{source}'"
    if stat in _NUMERIC_STATS and roles[q] != "quantitative":
        return False, f"'{stat}' needs a quantitative column"
    if stat == "percent" and not recipe.get("filter_value"):
        return False, "'percent' needs a filter_value"
    return True, ""
```

(`INDICATOR_STATS` / `_NUMERIC_STATS` were added in Task 2. Keep `CHART_REQS` where it is; `_validate_chart` reuses it.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` — expect all pass (new indicator tests + the existing chart-validation tests via the dispatcher).

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): validate indicator recipes (kind dispatch + INDICATOR_STATS)"
```

---

## Task 4: `compute_indicator`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Append tests** to `tests/test_ask_engine.py`:

```python
from src.reports.ask_engine import compute_indicator


def test_compute_indicator_count():
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    val = compute_indicator({"name": "n", "stat": "count"}, df, {})
    assert val == "3"


def test_compute_indicator_sum():
    df = pd.DataFrame({"Age": [10, 20, 30]})
    val = compute_indicator({"name": "total_age", "stat": "sum", "question": "Age"}, df, {})
    assert val == "60"


def test_compute_indicator_bad_returns_none():
    df = pd.DataFrame({"Region": ["N"]})
    assert compute_indicator({"name": "x", "stat": "sum", "question": "Ghost"}, df, {}) is None
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_compute_indicator_count -v` — expect FAIL (ImportError).

- [ ] **Step 3: Add `compute_indicator` to `src/reports/ask_engine.py`** (after `render_recipe`):

```python
def compute_indicator(recipe: Dict, df: pd.DataFrame,
                      repeat_tables: Dict[str, pd.DataFrame]) -> Optional[str]:
    """Compute a single indicator's formatted value via the indicator engine.
    Returns the value string, or None on failure / N/A."""
    from src.reports.indicators import compute_indicators
    name = recipe.get("name") or "indicator"
    ind = {k: v for k, v in recipe.items() if k != "kind"}
    ind["name"] = name
    try:
        result = compute_indicators([ind], df, repeat_tables or {})
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: compute_indicator failed for '{name}': {e}")
        return None
    val = result.get(f"ind_{name}")
    if val is None or val == "N/A":
        return None
    return val
```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` — expect all pass.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add compute_indicator (single indicator value via indicator engine)"
```

---

## Task 5: Mixed-modality `ask` + `save_recipe(kind)`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Replace the `ask` end-to-end test and add indicator/save tests.** In `tests/test_ask_engine.py`, replace `test_ask_end_to_end` with the mixed version below, and update the existing `test_save_recipe_*` tests to the kind-aware signature:

```python
def test_ask_mixed_chart_and_indicator(monkeypatch):
    monkeypatch.setattr(ask_engine, "propose_items", lambda q, cat, ai: [
        {"kind": "chart", "name": "by_region", "title": "By region", "type": "bar", "questions": ["Region"]},
        {"kind": "indicator", "name": "n_rows", "title": "Total", "stat": "count"},
    ])
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: f"cap-{it['name']}" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "Region", "category": "categorical"}]}
    df = pd.DataFrame({"_id": [1, 2, 3], "Region": ["N", "E", "E"]})
    out = ask_engine.ask("q", cfg, df, {})
    kinds = sorted(p["kind"] for p in out["proposals"])
    assert kinds == ["chart", "indicator"]
    chart = next(p for p in out["proposals"] if p["kind"] == "chart")
    ind = next(p for p in out["proposals"] if p["kind"] == "indicator")
    assert chart["image"].startswith("data:image/png;base64,")
    assert ind["value"] == "3"
    assert ind["caption"] == "cap-n_rows"


def test_save_recipe_chart_to_charts():
    cfg = {}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar", "questions": ["Region"]}, cfg, "chart")
    assert name == "by_region" and [c["name"] for c in cfg["charts"]] == ["by_region"]


def test_save_recipe_indicator_to_indicators():
    cfg = {}
    name = ask_engine.save_recipe({"name": "n_rows", "stat": "count", "kind": "indicator"}, cfg, "indicator")
    assert name == "n_rows"
    assert [i["name"] for i in cfg["indicators"]] == ["n_rows"]
    assert "kind" not in cfg["indicators"][0]   # kind stripped from saved recipe


def test_save_recipe_dedupes_name():
    cfg = {"charts": [{"name": "by_region"}]}
    name = ask_engine.save_recipe({"name": "by_region", "type": "bar"}, cfg, "chart")
    assert name == "by_region_2"
```

(Delete the old `test_ask_end_to_end`, `test_save_recipe_appends_to_config`, and `test_save_recipe_dedupes_name` that used the 2-arg `save_recipe`; the `test_ask_no_ai_returns_message` and `test_ask_disambiguates_duplicate_recipe_names` tests stay — but the latter monkeypatches `propose_charts`; update it to monkeypatch `propose_items` and have items carry `"kind": "chart"`.)

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_mixed_chart_and_indicator -v` — expect FAIL (ask still calls `propose_charts`, chart-only).

- [ ] **Step 3: Rewrite the `ask` body and `save_recipe`** in `src/reports/ask_engine.py`. Replace the existing `ask` function with:

```python
def ask(question: str, cfg: Dict, df: pd.DataFrame,
        repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Full ask loop (charts + indicators). Returns
    {"proposals": [...], "skipped": [...], "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposals": [], "skipped": [],
                "message": "Configure an AI provider in Sources to ask questions."}

    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile)

    items = propose_items(question, catalog, ai_cfg)
    if not items:
        return {"proposals": [], "skipped": [],
                "message": "Couldn't turn that into an answer — try rephrasing."}

    valid, skipped = [], []
    for r in items:
        kind = r.get("kind", "chart")
        title = r.get("title") or r.get("name") or (r.get("type") if kind == "chart" else r.get("stat")) or kind
        ok, reason = validate_recipe(r, profile)
        if not ok:
            skipped.append({"title": title, "reason": reason})
            continue
        if kind == "indicator":
            value = compute_indicator(r, df, repeat_tables or {})
            if value is None:
                skipped.append({"title": title, "reason": "could not compute this indicator"})
                continue
            valid.append({"kind": "indicator", "recipe": r, "value": value, "summary": value, "title": title})
        else:
            rendered = render_recipe(r, df, repeat_tables or {})
            if rendered is None:
                skipped.append({"title": title, "reason": "could not render this chart"})
                continue
            png, summary = rendered
            valid.append({"kind": "chart", "recipe": r, "png": png, "summary": summary, "title": title})

    # Disambiguate duplicate names within this batch (captions map 1:1; UI keys unique).
    seen_names = set()
    for v in valid:
        base = v["recipe"].get("name") or v["title"] or v["kind"]
        name = base
        i = 2
        while name in seen_names:
            name = f"{base}_{i}"
            i += 1
        seen_names.add(name)
        v["recipe"] = {**v["recipe"], "name": name}

    captions = ground_captions(
        [{"name": v["recipe"]["name"], "title": v["title"], "summary": v["summary"]} for v in valid],
        ai_cfg,
    )
    proposals = []
    for v in valid:
        name = v["recipe"]["name"]
        base = {"kind": v["kind"], "recipe": v["recipe"], "caption": captions.get(name, v["title"])}
        if v["kind"] == "indicator":
            base["value"] = v["value"]
        else:
            base["image"] = _b64_png(v["png"])
        proposals.append(base)
    return {"proposals": proposals, "skipped": skipped, "message": None}
```

Replace `save_recipe` with the kind-aware version:

```python
def save_recipe(recipe: Dict, cfg: Dict, kind: str = "chart") -> str:
    """Append a recipe to cfg['charts'] (kind='chart') or cfg['indicators']
    (kind='indicator'), de-duplicating the name and stripping the 'kind' field.
    Mutates cfg; the caller persists via write_config. Returns the final name."""
    section = "indicators" if kind == "indicator" else "charts"
    items = cfg.setdefault(section, [])
    existing = {c.get("name") for c in items}
    name = recipe.get("name") or kind
    if name in existing:
        i = 2
        while f"{name}_{i}" in existing:
            i += 1
        name = f"{name}_{i}"
    saved = {k: v for k, v in recipe.items() if k != "kind"}
    saved["name"] = name
    items.append(saved)
    return name
```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` — expect all pass. Then full suite `PYTHONPATH=. python -m pytest tests/ -q` — report the count and confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): mixed chart+indicator ask loop; save_recipe routes by kind"
```

---

## Task 6: Web — save routes by kind

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_ask_api.py`

- [ ] **Step 1: Append a test** to `tests/test_ask_api.py`:

```python
def test_ask_save_indicator_appends_to_indicators(monkeypatch):
    saved = {}
    cfg = {}
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "write_config", lambda c, p: saved.update(c))
    client = TestClient(wm.app)
    resp = client.post("/api/ask/save",
                       json={"recipe": {"name": "n_rows", "stat": "count"}, "kind": "indicator"})
    assert resp.status_code == 200 and resp.json()["name"] == "n_rows"
    assert saved["indicators"][0]["name"] == "n_rows"
```

- [ ] **Step 2: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_api.py::test_ask_save_indicator_appends_to_indicators -v` — expect FAIL (kind ignored; recipe saved to charts).

- [ ] **Step 3: Edit `web/main.py`.** Add `kind` to `AskSavePayload` and pass it through:

```python
class AskSavePayload(BaseModel):
    recipe: dict
    kind: str = "chart"
```
In `api_ask_save`, change the save call to:
```python
    name = ask_engine.save_recipe(recipe, cfg, payload.kind)
```
(Leave the rest of the handler unchanged.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_api.py -v` — expect all pass (the existing chart-save test still passes: `kind` defaults to `"chart"`).

- [ ] **Step 5: Run full suite, commit**

Run: `PYTHONPATH=. python -m pytest tests/ -q` — expect green.

```bash
git add web/main.py tests/test_ask_api.py
git commit -m "feat(api): /api/ask/save routes recipe to charts or indicators by kind"
```

---

## Task 7: Ask tab — render indicators

**Files:**
- Modify: `frontend/src/pages/Ask.jsx`

- [ ] **Step 1: Update the proposal render + save** in `frontend/src/pages/Ask.jsx`.

Change the `save` function to send `kind`:
```jsx
  async function save(recipe, kind) {
    try {
      const r = await fetch('/api/ask/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, kind }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) setSaved(s => ({ ...s, [recipe.name]: true }));
    } catch { /* noop */ }
  }
```

Replace the proposal `.map(...)` block with a kind-aware render:
```jsx
        {result?.proposals?.map((p, i) => (
          <div key={p.recipe?.name || i}
               style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: 12, width: 380, maxWidth: '100%' }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{p.recipe?.title || p.recipe?.name}</div>
            {p.kind === 'indicator' ? (
              <div style={{ fontSize: 34, fontWeight: 700, padding: '12px 0' }}>{p.value}</div>
            ) : (
              <img src={p.image} alt={p.recipe?.title || 'chart'} style={{ width: '100%', borderRadius: 6 }} />
            )}
            <div style={{ color: 'var(--ink-3)', fontSize: 13, margin: '8px 0' }}>{p.caption}</div>
            <button onClick={() => save(p.recipe, p.kind)} disabled={saved[p.recipe?.name]}
                    style={{ padding: '6px 12px', borderRadius: 6 }}>
              {saved[p.recipe?.name] ? 'Saved ✓' : 'Save to report'}
            </button>
          </div>
        ))}
```

- [ ] **Step 2: Build**

Run:
```bash
cd /workspaces/databridge-cli/frontend && (test -d node_modules || npm install) && npm run build
```
Expected: clean build, no errors.

- [ ] **Step 3: Backend suite still green**

Run: `cd /workspaces/databridge-cli && PYTHONPATH=. python -m pytest tests/ -q` — expect green.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/databridge-cli
git add frontend/src/pages/Ask.jsx
git commit -m "feat(ui): render indicator answers as big-number cards in Ask tab"
```

---

## Task 8: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Ask engine subsection and prompt table** in `CLAUDE.md`.

In the `### Ask question-engine (src/reports/ask_engine.py)` subsection, update the description to reflect mixed modalities: the proposer (`ask_propose`) returns `kind`-tagged items (chart or indicator); indicators are computed via `compute_indicators` and saved to `config.indicators`; charts to `config.charts`. Replace the line that referenced `ask_charts`/`propose_charts` with the `ask_propose`/`propose_items` flow.

In the "Prompt names and consuming files" table, replace the `ask_charts` row with:

| Prompt name | Consuming file | Output contract |
|---|---|---|
| `ask_propose` | `src/reports/ask_engine.py` | JSON: `{"items": [{"kind": "chart"|"indicator", ...}]}` |

(Leave the `ask_caption` row as-is.)

- [ ] **Step 2: Verify** — `PYTHONPATH=. python -m pytest tests/ -q` — expect green.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document mixed-modality Ask (ask_propose, indicator answers)"
```

---

## Self-review notes

- **Spec coverage:** unified `ask_propose` (T1) ✓; `propose_items` kind-tagged (T2) ✓; indicator validation `INDICATOR_STATS` + kind dispatch (T3) ✓; `compute_indicator` (T4) ✓; mixed `ask` + `save_recipe(kind)` (T5) ✓; web save-by-kind (T6) ✓; indicator big-number cards (T7) ✓; docs + prompt table (T8) ✓. Chart path preserved (validate dispatcher defaults kind=chart; render path unchanged). Deferred (summaries, named views, refinement) correctly absent.
- **Type/name consistency:** `propose_items`→`{kind,...}`; `validate_recipe` dispatches to `_validate_chart`/`_validate_indicator`; `compute_indicator(recipe, df, repeats)→str|None`; `ask` proposals carry `kind` + (`image`|`value`) + `caption`; `save_recipe(recipe, cfg, kind="chart")`; `AskSavePayload.kind="chart"`. `INDICATOR_STATS`/`_NUMERIC_STATS` defined in T2, used in T3. `_parse_items` reads `"items"`.
- **Slice-1 test migration (called out explicitly so it isn't mistaken for weakening):** `test_ask_charts_prompt_resolves_offline`→`ask_propose` (T1); `test_propose_charts_*`→`test_propose_items_*` (T2); `test_ask_end_to_end`→`test_ask_mixed_chart_and_indicator` + `save_recipe` tests to 3-arg + `test_ask_disambiguates_duplicate_recipe_names` monkeypatches `propose_items` (T5). These reflect the genuine API evolution, not relaxed assertions.
- **No placeholders:** every code/command step is complete. Frontend verified via Vite build.
