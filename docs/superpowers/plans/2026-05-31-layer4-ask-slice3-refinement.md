# Layer 4 — Ask Slice 3 (Multi-turn Refinement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user refine an Ask answer in plain language ("make it a line chart", "split by sex", "just give me the number"), getting the revised answer in place.

**Architecture:** Extract the per-item "validate → execute → entry-or-skip" logic of `ask()` into a shared `_execute_item`, used by both `ask()` and a new `refine_item`. `refine_item` runs the current recipe + a NL instruction through a new `ask_refine` prompt → revised recipe (may switch kind) → `_execute_item` → grounded caption → one proposal. A `POST /api/ask/refine` endpoint and a per-card refine UI (replace-in-place) expose it.

**Tech Stack:** Python 3, pandas, pytest, FastAPI, React/Vite, Langfuse-managed prompts (`lf_client`).

**Spec:** `docs/superpowers/specs/2026-05-31-layer4-ask-slice3-refinement-design.md`. On `main`: Layers 1–4 Slices 1–2 + structured outputs + CLI hardening merged; suite 277 passing.

---

## Reused / current interfaces (verified on main)
- `lf_client.get_prompt(name, vars) -> (messages, config)`; `lf_client.chat(..., output_schema=None)` (post-#4 tuple-return).
- `seed_prompts.SEED_PROMPTS` entries are `{"messages": ChatMessages, "config": {...}}` (10 entries; `ask_propose`/`ask_caption` have `config: {}`).
- `ask_engine`: `build_catalog`, `validate_recipe` (kind dispatch), `propose_items`, `render_recipe`, `compute_indicator`, `ground_captions(items, ai_cfg)`, `_ai_ready`, `_b64_png`, `_CHART_TYPES_BLOCK`, `_INDICATOR_STATS_BLOCK`, `ask`, `save_recipe`. The current `ask()` per-item loop (lines ~293–316) computes `title`, validates, and on indicator computes value+summary / on chart renders — this is what Task 1 extracts.
- `web/main.py`: `AskPayload`/`AskSavePayload` (Pydantic), `POST /api/ask`/`/api/ask/save`, module-level `ask_engine`, `load_config`, `load_processed_data`, `CONFIG_PATH`.
- `frontend/src/pages/Ask.jsx`: renders `result.proposals[].{kind, recipe, image|value, caption}`; `save(recipe, kind)`.

## File structure
- **Modify:** `src/utils/seed_prompts.py` — add `_ASK_REFINE` + `"ask_refine"` entry.
- **Modify:** `src/reports/ask_engine.py` — add `_execute_item`; refactor `ask()` to use it; add `_propose_refinement` + `refine_item`.
- **Modify:** `web/main.py` — `AskRefinePayload` + `POST /api/ask/refine`.
- **Modify:** `frontend/src/pages/Ask.jsx` — per-card refine row (replace-in-place).
- **Modify:** tests `tests/test_ask_engine.py`, `tests/test_ask_api.py`, `tests/test_seed_prompts.py`, `tests/test_lf_client.py`; `CLAUDE.md`.

---

## Task 1: `ask_refine` seed prompt

**Files:**
- Modify: `src/utils/seed_prompts.py`
- Test: `tests/test_ask_engine.py`, `tests/test_seed_prompts.py`, `tests/test_lf_client.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_ask_engine.py`):

```python
def test_ask_refine_prompt_resolves_offline():
    msgs, _cfg = lf_client.get_prompt("ask_refine", {
        "current_kind": "chart",
        "current_recipe": "{}",
        "instruction": "make it a line chart",
        "catalog": "{}",
        "chart_types": "line: >=1 date",
        "indicator_stats": "count: rows",
    })
    assert isinstance(msgs, list) and msgs
    blob = " ".join(m["content"] for m in msgs)
    assert "make it a line chart" in blob
```

- [ ] **Step 2: Run it** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_refine_prompt_resolves_offline -v` — expect FAIL (no `ask_refine` seed).

- [ ] **Step 3: Add the seed** in `src/utils/seed_prompts.py` (near `_ASK_PROPOSE`/`_ASK_CAPTION`):

```python
_ASK_REFINE: ChatMessages = [
    {"role": "system", "content": (
        "You revise a SINGLE data-answer recipe (a chart or a one-number indicator) based "
        "on a user's refinement instruction. You are given the current recipe, the data "
        "catalog, and the instruction. Return the REVISED recipe. You MAY change the kind "
        "(chart↔indicator), the chart type, the columns, group_by, filter, the stat, etc. "
        "Use ONLY table and column names that appear in the catalog. Keep the recipe's "
        "\"name\" unless the instruction clearly asks for a different metric. Respect chart "
        "column requirements / indicator stat rules. Respond with valid JSON only — no "
        "fences, no commentary."
    )},
    {"role": "user", "content": (
        "Current recipe (kind={{current_kind}}):\n{{current_recipe}}\n\n"
        "User instruction: {{instruction}}\n\n"
        "Available data (catalog):\n{{catalog}}\n\n"
        "Chart types (with column requirements):\n{{chart_types}}\n\n"
        "Indicator stats:\n{{indicator_stats}}\n\n"
        "Return ONLY JSON with the single revised item: "
        '{"item": {"kind": "chart"|"indicator", "name": "...", "title": "...", "...": "..."}}'
    )},
]
```

Register it in `SEED_PROMPTS` (new shape — no output schema):
```python
    "ask_refine": {"messages": _ASK_REFINE, "config": {}},
```

- [ ] **Step 4: Update the seed-count tests.**
  - `tests/test_seed_prompts.py`: add `"ask_refine"` to the expected-names set; update any "N prompts present" count (was 10 → now **11**).
  - `tests/test_lf_client.py`: the `push_seed_prompts` count assertions go up by 1 — read the current numbers and bump both (create-if-missing = total seeds − 1 pre-existing narrator; force = total seeds). Adopt the real current values + 1.

- [ ] **Step 5: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_ask_refine_prompt_resolves_offline tests/test_seed_prompts.py tests/test_lf_client.py -q` — expect all pass.

- [ ] **Step 6: Commit**
```bash
git add src/utils/seed_prompts.py tests/test_ask_engine.py tests/test_seed_prompts.py tests/test_lf_client.py
git commit -m "feat(ask): add ask_refine seed prompt"
```

---

## Task 2: Extract `_execute_item`; refactor `ask()` to use it

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_ask_engine.py`):

```python
from src.reports.ask_engine import _execute_item


def test_execute_item_chart_returns_entry():
    profile = _profile_fixture()
    df = pd.DataFrame({"Region": ["N", "E", "E"]})
    out = _execute_item({"kind": "chart", "name": "c", "title": "C", "type": "bar", "questions": ["Region"]}, profile, df, {})
    assert "skip" not in out and out["kind"] == "chart" and "png" in out


def test_execute_item_indicator_returns_entry():
    profile = _profile_fixture()
    df = pd.DataFrame({"_id": [1, 2, 3]})
    out = _execute_item({"kind": "indicator", "name": "n", "title": "N", "stat": "count"}, profile, df, {})
    assert "skip" not in out and out["kind"] == "indicator" and out["value"] == "3"


def test_execute_item_invalid_returns_skip():
    profile = _profile_fixture()
    out = _execute_item({"kind": "chart", "name": "c", "type": "bar", "questions": ["Ghost"]}, profile, pd.DataFrame({"Region": ["N"]}), {})
    assert "skip" in out and "Ghost" in out["skip"]
```

- [ ] **Step 2: Run it** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_execute_item_chart_returns_entry -v` — expect FAIL (no `_execute_item`).

- [ ] **Step 3: Add `_execute_item`** in `src/reports/ask_engine.py` (place it just before `ask`):

```python
def _execute_item(recipe: Dict, profile: Dict[str, Dict], df: pd.DataFrame,
                  repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Validate + execute one recipe (chart or indicator). Returns a valid entry
    {"kind","recipe","png"|"value","summary","title"} or {"skip": reason, "title": title}."""
    kind = recipe.get("kind", "chart")
    title = (recipe.get("title") or recipe.get("name")
             or (recipe.get("type") if kind == "chart" else recipe.get("stat")) or kind)
    ok, reason = validate_recipe(recipe, profile)
    if not ok:
        return {"skip": reason, "title": title}
    if kind == "indicator":
        value = compute_indicator(recipe, df, repeat_tables or {})
        if value is None:
            return {"skip": "could not compute this indicator", "title": title}
        stat = recipe.get("stat", "")
        qcol = recipe.get("question")
        summary = f"{value} ({stat}{' of ' + qcol if qcol else ''})"
        return {"kind": "indicator", "recipe": recipe, "value": value, "summary": summary, "title": title}
    rendered = render_recipe(recipe, df, repeat_tables or {})
    if rendered is None:
        return {"skip": "could not render this chart", "title": title}
    png, summary = rendered
    return {"kind": "chart", "recipe": recipe, "png": png, "summary": summary, "title": title}
```

- [ ] **Step 4: Refactor `ask()`** to use it. Replace the per-item loop body (the `for r in items:` block from `kind = r.get(...)` through the two `valid.append(...)` branches, lines ~294–316) with:

```python
    valid, skipped = [], []
    for r in items:
        out = _execute_item(r, profile, df, repeat_tables or {})
        if "skip" in out:
            skipped.append({"title": out["title"], "reason": out["skip"]})
        else:
            valid.append(out)
```

Leave everything below (the disambiguation loop, `ground_captions`, the proposal-assembly with `_b64_png`, the final return) UNCHANGED.

- [ ] **Step 5: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` then full suite `PYTHONPATH=. python -m pytest tests/ -q`. Expect ALL pass: the new `_execute_item` tests AND every existing `ask()`/mixed test (the refactor must be behavior-preserving). Report the count.

- [ ] **Step 6: Commit**
```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "refactor(ask): extract shared _execute_item; ask() uses it"
```

---

## Task 3: `refine_item` + `_propose_refinement`

**Files:**
- Modify: `src/reports/ask_engine.py`
- Test: `tests/test_ask_engine.py`

- [ ] **Step 1: Write the failing tests** (append to `tests/test_ask_engine.py`):

```python
def test_refine_item_chart_to_line(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "chart", "name": "trend", "title": "Trend", "type": "line", "questions": ["When"]})
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: "cap" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"},
           "questions": [{"export_label": "When", "category": "date"}]}
    df = pd.DataFrame({"_id": [1, 2], "When": ["2026-01-01", "2026-02-01"]})
    out = ask_engine.refine_item({"kind": "chart", "name": "trend", "type": "bar", "questions": ["When"]},
                                 "chart", "make it a line chart", cfg, df, {})
    assert out["proposal"]["kind"] == "chart"
    assert out["proposal"]["recipe"]["type"] == "line"
    assert out["proposal"]["image"].startswith("data:image/png;base64,")
    assert out["skipped"] is None


def test_refine_item_kind_switch_to_indicator(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "indicator", "name": "n", "title": "N", "stat": "count"})
    monkeypatch.setattr(ask_engine, "ground_captions", lambda items, ai: {it["name"]: "cap" for it in items})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    df = pd.DataFrame({"_id": [1, 2, 3]})
    out = ask_engine.refine_item({"kind": "chart", "name": "x", "type": "bar", "questions": ["Region"]},
                                 "chart", "just give me the number", cfg, df, {})
    assert out["proposal"]["kind"] == "indicator" and out["proposal"]["value"] == "3"


def test_refine_item_invalid_returns_skipped(monkeypatch):
    monkeypatch.setattr(ask_engine, "_propose_refinement",
                        lambda recipe, kind, instr, cat, ai: {"kind": "chart", "name": "x", "type": "bar", "questions": ["Ghost"]})
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    out = ask_engine.refine_item({"kind": "chart", "name": "x", "type": "bar", "questions": ["Region"]},
                                 "chart", "bad", cfg, pd.DataFrame({"Region": ["N"]}), {})
    assert out["proposal"] is None and out["skipped"]["reason"]


def test_refine_item_no_ai_message():
    cfg = {"ai": {"provider": "openai", "api_key": "env:OPENAI_API_KEY"}}
    out = ask_engine.refine_item({"kind": "chart"}, "chart", "x", cfg, pd.DataFrame({"_id": [1]}), {})
    assert out["proposal"] is None and "AI" in out["message"]
```

- [ ] **Step 2: Run it** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py::test_refine_item_chart_to_line -v` — expect FAIL (no `refine_item`).

- [ ] **Step 3: Add `_propose_refinement` + `refine_item`** in `src/reports/ask_engine.py` (after `refine`-related helpers / near `ask`):

```python
def _propose_refinement(recipe: Dict, kind: str, instruction: str,
                        catalog: Dict, ai_cfg: Dict) -> Optional[Dict]:
    """Ask the LLM for a revised single recipe. Returns the item dict or None on failure."""
    provider = (ai_cfg.get("provider") or "openai").lower()
    variables = {
        "current_kind": kind,
        "current_recipe": json.dumps({k: v for k, v in recipe.items() if k != "kind"}, ensure_ascii=False),
        "instruction": instruction,
        "catalog": json.dumps(catalog, ensure_ascii=False),
        "chart_types": _CHART_TYPES_BLOCK,
        "indicator_stats": _INDICATOR_STATS_BLOCK,
    }
    try:
        messages, _config = lf_client.get_prompt("ask_refine", variables)
        raw = lf_client.chat(
            messages,
            model=ai_cfg.get("model", "gpt-4o"),
            provider=provider,
            api_key=ai_cfg.get("api_key", ""),
            max_tokens=max(int(ai_cfg.get("max_tokens", 1500)), 2000),
            trace_name="ask_refine",
            base_url=ai_cfg.get("base_url"),
            json_mode=(provider != "anthropic"),
            output_schema=_config.get("output_schema"),
        )
    except Exception as e:  # noqa: BLE001
        log.warning(f"ask: _propose_refinement failed: {e}")
        return None
    items = _parse_items(raw)  # tolerant; but ask_refine returns {"item": ...} — handle both
    if items:
        return items[0]
    # fall back to the single-item {"item": {...}} shape
    import re
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        m = re.search(r"\{.*\}", raw or "", re.DOTALL)
        data = json.loads(m.group(0)) if m else None
    if isinstance(data, dict) and isinstance(data.get("item"), dict):
        return data["item"]
    return None


def refine_item(recipe: Dict, kind: str, instruction: str, cfg: Dict,
                df: pd.DataFrame, repeat_tables: Dict[str, pd.DataFrame]) -> Dict:
    """Refine one existing answer with a NL instruction. Returns
    {"proposal": {...}|None, "skipped": {title,reason}|None, "message": str|None}."""
    ai_cfg = cfg.get("ai") or {}
    if not _ai_ready(ai_cfg):
        return {"proposal": None, "skipped": None,
                "message": "Configure an AI provider in Sources to ask questions."}
    from src.data.profile import profile_dataset
    profile = profile_dataset(cfg, df, repeat_tables or {})
    catalog = build_catalog(profile)
    revised = _propose_refinement(recipe, kind, instruction, catalog, ai_cfg)
    if not revised:
        return {"proposal": None, "skipped": None,
                "message": "Couldn't apply that refinement — try rephrasing."}
    revised.setdefault("kind", kind)
    out = _execute_item(revised, profile, df, repeat_tables or {})
    if "skip" in out:
        return {"proposal": None, "skipped": {"title": out["title"], "reason": out["skip"]}, "message": None}
    name = out["recipe"].get("name") or out["title"]
    caps = ground_captions([{"name": name, "title": out["title"], "summary": out["summary"]}], ai_cfg)
    proposal = {"kind": out["kind"], "recipe": out["recipe"], "caption": caps.get(name, out["title"])}
    if out["kind"] == "indicator":
        proposal["value"] = out["value"]
    else:
        try:
            proposal["image"] = _b64_png(out["png"])
        except Exception as e:  # noqa: BLE001
            log.warning(f"ask: refine image read failed: {e}")
            return {"proposal": None, "skipped": {"title": out["title"], "reason": "chart image unavailable"}, "message": None}
    return {"proposal": proposal, "skipped": None, "message": None}
```

(Note: `_parse_items` is reused; the extra `{"item": ...}` fallback handles the refine prompt's single-item shape robustly.)

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_engine.py -v` then full suite. Expect all pass. Report the count.

- [ ] **Step 5: Commit**
```bash
git add src/reports/ask_engine.py tests/test_ask_engine.py
git commit -m "feat(ask): add refine_item + _propose_refinement (multi-turn refinement)"
```

---

## Task 4: `POST /api/ask/refine`

**Files:**
- Modify: `web/main.py`
- Test: `tests/test_ask_api.py`

- [ ] **Step 1: Write the failing test** (append to `tests/test_ask_api.py`):

```python
def test_ask_refine_endpoint(monkeypatch):
    cfg = {"ai": {"provider": "openai", "api_key": "sk-x"}, "questions": []}
    df = pd.DataFrame({"_id": [1, 2, 3]})
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: cfg)
    monkeypatch.setattr(wm, "load_processed_data", lambda *a, **k: (df, {}))
    monkeypatch.setattr(wm.ask_engine, "refine_item",
                        lambda recipe, kind, instr, c, d, r: {"proposal": {"kind": "chart", "recipe": {"name": "x"}, "image": "data:image/png;base64,AAA", "caption": "cap"}, "skipped": None, "message": None})
    client = TestClient(wm.app)
    resp = client.post("/api/ask/refine", json={"recipe": {"name": "x", "type": "bar"}, "kind": "chart", "instruction": "make it a line chart"})
    assert resp.status_code == 200
    assert resp.json()["proposal"]["caption"] == "cap"


def test_ask_refine_endpoint_no_data(monkeypatch):
    monkeypatch.setattr(wm, "load_config", lambda *a, **k: {})
    def _raise(*a, **k):
        raise FileNotFoundError("no data")
    monkeypatch.setattr(wm, "load_processed_data", _raise)
    client = TestClient(wm.app)
    body = client.post("/api/ask/refine", json={"recipe": {}, "kind": "chart", "instruction": "x"}).json()
    assert body["proposal"] is None and "Download" in body["message"]
```

- [ ] **Step 2: Run it** — `PYTHONPATH=. python -m pytest tests/test_ask_api.py::test_ask_refine_endpoint -v` — expect FAIL (404).

- [ ] **Step 3: Add the endpoint** in `web/main.py` (near `api_ask`/`api_ask_save`). Add the payload model alongside the other Ask models:

```python
class AskRefinePayload(BaseModel):
    recipe: dict
    kind: str = "chart"
    instruction: str
```

```python
@app.post("/api/ask/refine")
async def api_ask_refine(payload: AskRefinePayload):
    """Refine an existing Ask answer with a natural-language instruction."""
    instruction = (payload.instruction or "").strip()
    if not instruction:
        return {"proposal": None, "skipped": None, "message": "Type a refinement instruction."}
    cfg = load_config(CONFIG_PATH)
    try:
        df, repeats = load_processed_data(cfg)
    except FileNotFoundError:
        return {"proposal": None, "skipped": None, "message": "No data yet — run Download first."}
    return ask_engine.refine_item(payload.recipe, payload.kind, instruction, cfg, df, repeats)
```

- [ ] **Step 4: Run** — `PYTHONPATH=. python -m pytest tests/test_ask_api.py -v` then full suite. Expect all pass. Report count.

- [ ] **Step 5: Commit**
```bash
git add web/main.py tests/test_ask_api.py
git commit -m "feat(api): add POST /api/ask/refine"
```

---

## Task 5: Per-card refine UI (replace-in-place)

**Files:**
- Modify: `frontend/src/pages/Ask.jsx`

- [ ] **Step 1: Edit `frontend/src/pages/Ask.jsx`.** Add per-card refine state + handler and a refine row in each card.

After the `save` function (line ~39), add a `refine` handler that replaces the proposal in place:
```jsx
  const [refineInputs, setRefineInputs] = useState({});   // index -> instruction text
  const [refining, setRefining] = useState({});           // index -> bool

  async function refine(i, recipe, kind) {
    const instruction = (refineInputs[i] || '').trim();
    if (!instruction) return;
    setRefining(r => ({ ...r, [i]: true }));
    try {
      const r = await fetch('/api/ask/refine', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe, kind, instruction }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.proposal) {
        setResult(prev => {
          const proposals = prev.proposals.slice();
          proposals[i] = data.proposal;
          return { ...prev, proposals };
        });
        setRefineInputs(s => ({ ...s, [i]: '' }));
      } else {
        // surface skip/message inline without losing the current card
        setResult(prev => {
          const proposals = prev.proposals.slice();
          proposals[i] = { ...proposals[i], refineNote: data.skipped ? `${data.skipped.reason}` : (data.message || 'No change') };
          return { ...prev, proposals };
        });
      }
    } catch { /* noop */ } finally {
      setRefining(r => ({ ...r, [i]: false }));
    }
  }
```

In the proposal card (inside the `.map((p, i) => ...)`), AFTER the Save button, add the refine row:
```jsx
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                value={refineInputs[i] || ''}
                onChange={e => setRefineInputs(s => ({ ...s, [i]: e.target.value }))}
                placeholder="Refine — e.g. make it a line chart, split by sex"
                style={{ flex: 1, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--line, #e5e7eb)', fontSize: 12.5 }}
              />
              <button onClick={() => refine(i, p.recipe, p.kind)} disabled={refining[i]}
                      style={{ padding: '6px 10px', borderRadius: 6, fontSize: 12.5 }}>
                {refining[i] ? '…' : 'Refine'}
              </button>
            </div>
            {p.refineNote && (
              <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 4 }}>{p.refineNote}</div>
            )}
```

(Keep the existing title/image/value/caption/Save markup. Note: refining replaces `proposals[i]`, so `saved[p.recipe?.name]` naturally resets for the new recipe name — a refined card can be saved fresh.)

- [ ] **Step 2: Build** — `cd /workspaces/databridge-cli/frontend && (test -d node_modules || npm install) && npm run build` — expect clean, no errors.

- [ ] **Step 3: Backend suite still green** — `cd /workspaces/databridge-cli && PYTHONPATH=. python -m pytest tests/ -q` (no backend change this task).

- [ ] **Step 4: Commit**
```bash
cd /workspaces/databridge-cli
git add frontend/src/pages/Ask.jsx
git commit -m "feat(ui): per-card refine row in Ask tab (replace-in-place, multi-turn)"
```

---

## Task 6: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Ask engine subsection** in `CLAUDE.md`. Add a sentence to the `### Ask question-engine (src/reports/ask_engine.py)` subsection describing refinement: a saved/proposed answer can be refined in plain language via `refine_item` (`ask_refine` prompt) → `POST /api/ask/refine`; refinement re-validates/executes the revised recipe (may switch chart↔indicator) and the Ask tab replaces the card in place. Mention `_execute_item` is the shared validate→execute helper used by both `ask` and `refine_item`.

- [ ] **Step 2: Prompt table** — add a row to "Prompt names and consuming files":

| `ask_refine` | `src/reports/ask_engine.py` | JSON: `{"item": {"kind": ...}}` |

- [ ] **Step 3: Verify + commit** — `PYTHONPATH=. python -m pytest tests/ -q` (green), then:
```bash
git add CLAUDE.md
git commit -m "docs: document Ask multi-turn refinement (ask_refine, /api/ask/refine)"
```

---

## Self-review notes
- **Spec coverage:** `ask_refine` prompt (T1) ✓; `_execute_item` extraction + `ask()` refactor (T2) ✓; `refine_item` + `_propose_refinement`, kind-switch, skip/message (T3) ✓; `POST /api/ask/refine` (T4) ✓; per-card replace-in-place UI (T5) ✓; docs + prompt table (T6) ✓. Stateless-per-card is inherent (refine takes recipe+instruction; UI refines the card's current recipe). Deferred items (named views, threaded history) absent.
- **Type/name consistency:** `_execute_item(recipe, profile, df, repeats) -> entry|{"skip","title"}`; `refine_item(recipe, kind, instruction, cfg, df, repeats) -> {proposal,skipped,message}`; `_propose_refinement(recipe, kind, instruction, catalog, ai_cfg) -> Dict|None`; `AskRefinePayload(recipe, kind, instruction)`; proposal shape `{kind, recipe, image|value, caption}` matches `ask()`'s. `ground_captions` accepts a 1-item list (existing contract).
- **Refactor safety:** T2 keeps `ask()` behavior identical (disambiguation/caption/proposal assembly unchanged); the existing Slice 1–2 `ask`/mixed tests are the guard.
- **No placeholders:** every code/command step complete. Frontend verified via Vite build.
