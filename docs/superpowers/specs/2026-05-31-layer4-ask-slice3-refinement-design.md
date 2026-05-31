# Layer 4 — Question Engine, Slice 3 (Multi-turn Refinement) Design

**Date:** 2026-05-31
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** Layer 4, Slice 3 of [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md). Extends Slices 1–2 (`src/reports/ask_engine.py`) with conversational refinement of an answer.

---

## 1. Goal

After the Ask engine returns an answer, let the user refine it in plain language — *"make it a line chart"*, *"split by sex"*, *"only Q2 2026"*, *"just give me the number"* — and get the revised answer in place. Refinement is **"ask, applied to an existing recipe"**: each proposal carries its current recipe; refining produces a new recipe that is re-validated, re-executed, and re-captioned.

---

## 2. Scope

**Slice 3 (this spec):** a `refine_item` engine path + `ask_refine` prompt + `POST /api/ask/refine` + per-card refine UI. Refinement may **switch kind** (chart↔indicator). State is **stateless per-card**: the card's current recipe is the only state; chaining works by refining the already-refined recipe.

**Decisions (locked):** kind-switching allowed; stateless per-card (no conversation-history object); `_execute_item` extracted and shared by `ask()` + `refine_item`; refined result **replaces the card in place**.

**Out of scope (deferred):** named reusable derived views; threaded conversation history; cross-card/batch refinement.

---

## 3. Architecture (Approach A — shared `_execute_item`)

The per-item work `ask()` already does — validate → kind-dispatch execute → produce a valid-entry-or-skip — is extracted into a shared helper so a *refined* item behaves identically to an *asked* item. `ask()` is refactored to use it (behavior unchanged; guarded by the existing Slice 1–2 tests). `refine_item` uses it once.

### Components (`src/reports/ask_engine.py`)
- **`_execute_item(recipe, profile, df, repeat_tables) -> Dict`** — returns either a valid entry `{"kind", "recipe", "png"|"value", "summary", "title"}` or `{"skip": "<reason>", "title": "<title>"}`. Logic (lifted from `ask()`'s loop body): `kind = recipe.get("kind","chart")`; `validate_recipe` → skip on failure; `indicator` → `compute_indicator` (None → skip); else `render_recipe` (None → skip). No captioning here (callers caption: `ask()` batches, `refine_item` does one).
- **`ask()`** — refactored: its per-item loop calls `_execute_item`; the disambiguation + batched `ground_captions` + proposal assembly are unchanged. Same return contract.
- **`refine_item(recipe, kind, instruction, cfg, df, repeat_tables) -> Dict`**:
  1. AI gate (`_ai_ready`) → `{"proposal": None, "skipped": None, "message": "Configure an AI provider…"}` if not ready.
  2. `profile = profile_dataset(...)`; `catalog = build_catalog(profile)`.
  3. Call `ask_refine` via `lf_client` (current recipe JSON + `kind` + instruction + catalog + chart-types + indicator-stats) → parse `{"item": {...}}` → revised recipe; default its `kind` to the original `kind` if absent. Empty/parse failure → `{"proposal": None, "skipped": None, "message": "Couldn't apply that refinement — try rephrasing."}`.
  4. `outcome = _execute_item(revised, profile, df, repeats)`. If skip → `{"proposal": None, "skipped": {"title","reason"}, "message": None}`.
  5. Caption the single valid entry via `ground_captions([entry])`; build the proposal `{kind, recipe, image|value, caption}`.
  6. Return `{"proposal": {...}, "skipped": None, "message": None}`.
- **New seed prompt `ask_refine`** in `seed_prompts.py` (registered `{"messages": _ASK_REFINE, "config": {}}` per the post-#4 structure). Inputs: `{{current_kind}}`, `{{current_recipe}}` (JSON), `{{instruction}}`, `{{catalog}}`, `{{chart_types}}`, `{{indicator_stats}}`. Output: `{"item": {"kind","name","title", ...}}` — the model may keep or switch kind. Parsed ad-hoc (no output schema needed).

### Web (`web/main.py`)
- **`POST /api/ask/refine`** with `AskRefinePayload(recipe: dict, kind: str = "chart", instruction: str)` → loads cfg + latest session (FileNotFoundError → no-data message) → `ask_engine.refine_item(recipe, kind, instruction, cfg, df, repeats)`.

### Frontend (`frontend/src/pages/Ask.jsx`)
- Each proposal card gains a **refine row**: a small text input (placeholder *"Refine — e.g. make it a line chart, split by sex"*) + a "Refine" button, with a per-card "refining…" state.
- On submit → `POST /api/ask/refine` with `{recipe: p.recipe, kind: p.kind, instruction}`. On `{proposal}` → **replace `proposals[i]` in place** with the refined proposal and clear that card's input (ready for the next turn). On `{skipped}`/`{message}` → show a small inline note on the card; keep the existing result. The Save button continues to use the card's current `recipe`+`kind`.

---

## 4. Error handling
Fail-soft, matching Slices 1–2. The `ask_refine` LLM call and parse are guarded (parse failure → message). `_execute_item` never raises (delegates to the already-guarded `validate_recipe`/`render_recipe`/`compute_indicator`). A refinement that produces an invalid/unrenderable recipe returns a `skipped` reason, leaving the card's prior result intact in the UI.

## 5. Testing (TDD)
- `tests/test_ask_engine.py`:
  - `ask_refine` resolves offline (tuple-return per post-#4 `get_prompt`).
  - `_execute_item`: valid chart → entry with `png`; valid indicator → entry with `value`; invalid recipe → `{"skip": reason}`.
  - `ask()` regression: still produces the same mixed proposals after the refactor (existing Slice 1–2 tests stay green).
  - `refine_item` (monkeypatched `lf_client`): chart → revised line chart (kind preserved); chart → indicator (kind switch) returns a `value` proposal; invalid revision → `skipped`; no-AI → message.
- `tests/test_ask_api.py`: `POST /api/ask/refine` returns a refined proposal (monkeypatch `refine_item` or `lf_client` + a tmp session); no-data path returns a message.
- Frontend verified by a clean Vite build.
- Full suite green (currently 277).

## 6. Risks & open questions
- **Refactor risk:** extracting `_execute_item` touches freshly-shipped `ask()`. Mitigated by the existing Slice 1–2 tests (the refactor must keep them green) + a dedicated `_execute_item` unit test.
- **Kind switch + name:** a refined item keeps its `name` by default so the card identity is stable; if the instruction implies a new metric the model may rename — harmless (the card replaces in place either way).
- **Two LLM calls per refine** (refine + caption) — acceptable for a user-initiated action; documented.
- **Stateless chaining fidelity:** because each refine operates on the card's current recipe, "make it a line chart" then "split by region" composes correctly without history. A refinement that contradicts the recipe is simply the model's best revision of it.
