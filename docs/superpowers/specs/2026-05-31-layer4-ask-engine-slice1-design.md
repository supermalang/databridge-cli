# Layer 4 — Question Engine, Slice 1 ("Ask") Design

**Date:** 2026-05-31
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** Layer 4 of [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md). The conversational core that turns the app into a data-analyst specialist. Stands on Layer 1 (base tables), Layer 2 (profiling), Layer 3 (PII gate). Web-first.

---

## 1. Goal

Let a user ask a natural-language question and get **real, computed, grounded** answers: the LLM proposes chart recipes from a **data-aware** catalog, the engine **validates** and **renders them locally**, captions are **grounded in the actual plotted numbers**, and the user **saves** the ones they want into the report.

This is the evolution of the existing schema-blind `ai_chart_suggester` into a data-aware, validated, **executing**, grounded loop with a web chat surface.

---

## 2. Scope

**Slice 1 (this spec) — "Ask":** question → catalog → propose 1–3 chart recipes → validate → render locally → ground captions → return; save chosen recipe to `config.charts`. Web "Ask" tab.

**Deferred to later slices:** named reusable derived views; indicator/summary output modalities; multi-turn refinement/clarification dialogue; two-step catalog-on-demand for very large forms.

**Slice 1 decisions (locked):** charts only; 1–3 proposals; save → `config.charts`; single-shot condensed profile; captions grounded in computed numbers; invalid recipes dropped-with-reason; "Ask" tab placed prominently after Dashboard; chart images returned base64 inline; proposer restricted to a core chart-type set (§6) for reliable validation.

---

## 3. Architecture (Approach A — new `src/reports/ask_engine.py`)

A new module orchestrates the loop; the web layer stays thin (endpoint → engine → JSON). `ai_chart_suggester.py` is left as-is (its CLI config-emitter role is distinct from this interactive execute/ground loop). Two new seed prompts in `seed_prompts.py`: `ask_charts` (proposer) and `ask_caption` (grounding), resolved via `lf_client` like every other prompt site.

### Files
- **Create:** `src/reports/ask_engine.py` — the orchestrator + helpers.
- **Modify:** `src/utils/seed_prompts.py` — add `ask_charts`, `ask_caption` seeds.
- **Modify:** `web/main.py` — `POST /api/ask`, `POST /api/ask/save`.
- **Create:** `frontend/src/pages/Ask.jsx`; **Modify:** `frontend/src/App.jsx` (register "Ask" tab).
- **Create:** `tests/test_ask_engine.py`, `tests/test_ask_api.py`.
- **Modify:** `CLAUDE.md` (document the engine + prompts).

---

## 4. The loop — `ask(question, cfg, df, repeats) -> dict`

1. **Catalog** — `build_catalog(cfg, df, repeats) -> dict`: call Layer 2 `profile_dataset`, condense to a compact, token-friendly, data-aware catalog. Per table: `[{name, role, distinct, missing_pct, top_values(low-cardinality only), min/max(quantitative)}]`. Privacy-safe by construction (Layer 2 only emits top-values for low-cardinality columns, so free-text/PII values are never surfaced).
2. **Propose** — `propose_charts(question, catalog, cfg) -> List[dict]`: build variables `{question, catalog (JSON), chart_types (the core-set catalog with per-type column requirements)}`, `lf_client.get_prompt("ask_charts", vars)`, `lf_client.chat(..., trace_name="ask_charts", json_mode=True)`, parse `{"charts": [ ≤3 recipes ]}`. Each recipe is a **chart-config dict the builder already understands**: `{name, title, type, questions:[...], source?, filter?, group_by?, options?}`.
3. **Validate** — `validate_recipe(recipe, profile) -> (ok: bool, reason: str)`: (a) every column in `questions`/`group_by` exists in the recipe's source table (default `main`); (b) the chart `type` is in the core set and its required column roles are satisfied (§6). On failure return `(False, reason)`.
4. **Execute** — `render_recipe(recipe, df, repeats, cfg) -> Path|None`: reuse `builder._pick_df`, `transform.apply_local_scope`, `transform.join_repeat_to_main`, and `charts.generate_chart` to resolve the chart DataFrame and render a PNG into `CHART_DIR`. Returns `None` on render failure (→ skipped).
5. **Ground** — `ground_captions(rendered, cfg) -> Dict[name, caption]`: build a compact **result summary** per chart from its resolved/aggregated data (top categories+counts, or numeric min/mean/max), one **batched** `lf_client.get_prompt("ask_caption", …)` + `chat` → a one-line caption per chart. Fallback to the chart title when AI is unavailable or the call fails (captions therefore never invent figures).
6. **Return** — `{"proposals": [{recipe, image (base64 data-URI), caption}], "skipped": [{title, reason}], "message": str|None}`.

`save_recipe(recipe, cfg) -> str`: append the recipe to `cfg["charts"]` (de-duplicate `name`), `write_config`; returns the saved name.

---

## 5. Web surface (web-first)

- **`POST /api/ask {question}`** → loads the latest session (`load_processed_data`), runs `ask(...)`, returns the result dict. Preconditions return a friendly payload (HTTP 200): no AI provider/key configured → `{"proposals": [], "skipped": [], "message": "Configure an AI provider in Sources to ask questions."}`; no downloaded data (`FileNotFoundError`) → `{… "message": "No data yet — run Download first."}`.
- **`POST /api/ask/save {recipe}`** → `save_recipe` → `{"ok": true, "name": "<saved>"}`.
- **"Ask" tab** (`frontend/src/pages/Ask.jsx`): a prompt input + submit; renders each proposal as a card (chart image, grounded caption, **Save to report** button) plus a "skipped N suggestion(s)" note; loading/empty/error states mirror the `Validate.jsx`/`Profile.jsx` pattern. Registered in `App.jsx` as a prominent tab right after Dashboard.

---

## 6. Core chart-type set + role requirements (for validation)

The proposer is instructed to choose only from this set; `validate_recipe` enforces the role requirements (roles come from the profile):

| type | requires |
|---|---|
| `bar`, `horizontal_bar`, `pie`, `donut` | ≥1 categorical |
| `line`, `area` | 1 date + (optional) 1 quantitative |
| `histogram` | 1 quantitative |
| `scatter` | 2 quantitative |
| `box_plot` | 1 categorical + 1 quantitative |
| `grouped_bar`, `stacked_bar`, `heatmap` | 2 categorical |

A recipe naming a type outside this set, or whose `questions` don't satisfy the requirement, is dropped with a reason.

---

## 7. Error handling

Fail-soft, matching the codebase. AI not configured → preconditions message (no call). Proposer returns malformed JSON → parse yields `[]` → `message` "couldn't generate suggestions, try rephrasing". A single recipe failing validation or render → moved to `skipped` with a reason; other proposals still returned. Grounding failure → per-chart fallback to title. Nothing raises to the user.

---

## 8. Testing (TDD)

- `tests/test_ask_engine.py`:
  - `build_catalog`: condenses a `profile_dataset` fixture into the compact shape (roles, cardinality, low-card top-values present, high-card values absent).
  - `validate_recipe`: valid + invalid per representative chart types (scatter needs 2 quantitative; bar needs a categorical; missing column → reason).
  - `propose_charts`: monkeypatch `lf_client.get_prompt`/`chat` to return canned `{"charts":[…]}`; assert parsed recipes; malformed JSON → `[]`.
  - `render_recipe`: a real recipe + small df → asserts a PNG file is produced (uses the real chart engine); a bad recipe → `None`.
  - `ground_captions`: monkeypatch `lf_client` → caption per chart; AI-off → title fallback.
- `tests/test_ask_api.py`: `/api/ask` happy path (monkeypatch the engine or `lf_client` + provide a tmp session) returns the proposals/skipped shape; no-AI and no-data messages; `/api/ask/save` appends to `config.charts`.
- Frontend `Ask.jsx` verified by a clean Vite production build (no JS unit harness).
- Full suite green (currently 194).

---

## 9. Risks & open questions

- **Latency/cost:** two LLM calls per question (propose + batched ground). Acceptable for an interactive, user-initiated action; documented.
- **Recipe hit-rate:** dropping invalid recipes (no repair retry in Slice 1) may occasionally yield <3 charts; surfaced via the "skipped" note. Repair-retry is a later refinement.
- **Image transport:** base64 inline keeps Slice 1 simple but inflates the JSON for large charts; a served-file route can replace it later if needed.
- **Reuse coupling:** `render_recipe` reuses `builder._pick_df` (a module-level helper). If chart resolution logic needs to diverge, extract a shared `resolve_chart_df` helper in a later cleanup — not now.
- **`source` validation:** recipes may reference a repeat/base table by name; validation checks columns against that table's profile (default `main`).
