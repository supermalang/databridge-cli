# Layer 4 — Question Engine, Slice 2 (Indicator Answers) Design

**Date:** 2026-05-31
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** Layer 4, Slice 2 of [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md). Extends Slice 1 ("Ask", `src/reports/ask_engine.py`) with a second answer modality. Builds on Layers 1–3.

---

## 1. Goal

Let the Ask engine answer a question with a **scalar indicator** (a formatted number) when that's the best fit — "how many people were reached?" → **12,471** — not only a chart. The LLM decides, per item, whether a chart or a number best answers the question, and may mix them (a headline number plus a supporting chart).

---

## 2. Scope

**Slice 2 (this spec):** add the **indicator** answer modality to the Ask loop. A single unified proposer returns `kind`-tagged items (chart or indicator); the engine validates, computes (chart → render; indicator → `compute_indicators`), captions, and returns unified proposals; saving routes to `config.charts` or `config.indicators` by kind.

**Decisions (locked):** charts + indicators (summaries deferred); named reusable derived views deferred; one unified proposer call with a `kind` tag (retire `ask_charts` in favor of `ask_propose`); indicators get a grounded one-line caption.

**Out of scope (later slices):** narrative **summary** modality; named reusable **derived views**; multi-turn **refinement/clarification**.

---

## 3. Architecture (Approach A — unified proposer with `kind`)

One LLM proposer call returns a mixed list of items, each tagged `kind: "chart" | "indicator"`, so the model decides modality holistically. The chart path from Slice 1 is preserved unchanged in behavior; the indicator path is added alongside.

### Reused engine
`src/reports/indicators.py`: `compute_indicators(indicators, df, repeat_tables=None, per_period=None) -> {ind_<name>: formatted_value}`. An indicator recipe is `{name, stat, question?, format?, filter?, source?, filter_value?}`. Supported stats: `count, count_distinct, sum, mean, median, min, max, percent, most_common, grouped_agg`.

---

## 4. Components (`src/reports/ask_engine.py`)

- **New seed prompt `ask_propose`** (in `seed_prompts.py`) — supersedes `ask_charts` as the proposer. Returns `{"items": [{"kind": "chart"|"indicator", "name", "title", ...}]}`:
  - chart item: the Slice-1 chart fields (`type`, `questions`, `source?`, `group_by?`, `filter?`).
  - indicator item: `stat`, `question` (omit for `count`), `filter?`, `filter_value?` (for `percent`), `format?`, `source?`.
  The prompt lists the indicator stats and chart types with their requirements. `ask_charts` is removed from `SEED_PROMPTS`.
- **`propose_items(question, catalog, ai_cfg) -> List[Dict]`** — supersedes `propose_charts`; parses `{"items": [...]}` (≤3), each item defaulting `kind="chart"` when absent (tolerant). `[]` on any failure.
- **`INDICATOR_REQS` + indicator branch in `validate_recipe(recipe, profile)`** — dispatch on `recipe.get("kind", "chart")`:
  - chart → existing `CHART_REQS` logic.
  - indicator → `stat` must be supported; for stats needing a column (`sum/mean/median/min/max/percent/most_common/count_distinct`) the `question` must exist in the source table; numeric stats (`sum/mean/median/min/max`) require role `quantitative`; `percent` requires `filter_value`; `count` needs no column. Invalid → `(False, reason)`.
- **`compute_indicator(recipe, df, repeats) -> Optional[str]`** — runs `compute_indicators([recipe], df, repeats)`, returns the formatted value string `ind_<name>` (or `None`/`"N/A"` handling on failure).
- **`ground_captions`** — unchanged contract. Indicators are captioned too: their `summary` field is the computed value, so the caption is a one-line grounded phrasing of the number.
- **`ask(question, cfg, df, repeat_tables)`** — branch per `kind`:
  - chart → `validate_recipe` → `render_recipe` → `{kind:"chart", recipe, image, caption}`.
  - indicator → `validate_recipe` → `compute_indicator` → `{kind:"indicator", recipe, value, caption}`.
  - invalid/uncomputable → `skipped` with reason. `message` unchanged. Names disambiguated within the batch (Slice-1 behavior, applied across all kinds).
- **`save_recipe(recipe, cfg, kind="chart") -> str`** — append to `config.charts` (chart) or `config.indicators` (indicator); dedup name as before.

---

## 5. Web surface (`web/main.py`)
- `POST /api/ask` — returns the unified `proposals` (each with `kind`), plus `skipped`/`message` (unchanged structure).
- `POST /api/ask/save {recipe, kind}` — routes to the correct config section via `save_recipe(recipe, cfg, kind)`; persists with `write_config`. Defaults `kind="chart"` when omitted (back-compat with Slice-1 callers).

## 6. Frontend (`frontend/src/pages/Ask.jsx`)
Render each proposal by `kind`: chart items as today (image card); **indicator items as a big-number card** (large `value`, `title`, grounded `caption`, "Save to report"). The save call sends `{recipe, kind}`.

---

## 7. Error handling
Fail-soft, matching Slice 1. Proposer failure → `[]` + message. A bad/uncomputable indicator → `skipped` with reason; other items still returned. `compute_indicators` already degrades to `"N/A"` internally on per-indicator errors; the engine treats a `None`/`"N/A"` result as skipped with reason. Captioning failure → title/value fallback.

## 8. Testing (TDD)
- `tests/test_ask_engine.py` (extend):
  - `validate_recipe` indicator branch: valid `count`/`sum`/`percent`; reject numeric stat on a categorical column; reject `percent` without `filter_value`; reject unknown stat; reject missing column.
  - `compute_indicator`: a real `count`/`sum` over a small df returns the formatted value; bad recipe → `None`.
  - `propose_items`: monkeypatched `lf_client` returning `{"items":[{kind:chart…},{kind:indicator…}]}` → parsed with kinds; malformed → `[]`.
  - `ask` mixed end-to-end (monkeypatch propose + ground): one chart (base64 image) + one indicator (value) in `proposals`, each with its `kind`.
  - `save_recipe` routes by kind: chart → `config.charts`, indicator → `config.indicators`; dedup holds.
  - `ask_propose` prompt resolves offline; `ask_charts` removed from `SEED_PROMPTS` (update the seed-count tests accordingly).
- `tests/test_ask_api.py`: `/api/ask/save` with `kind:"indicator"` appends to `config.indicators`.
- Frontend verified by a clean Vite build.
- Full suite green (currently 216).

---

## 9. Risks & open questions
- **Prompt migration:** retiring `ask_charts` and adding `ask_propose` changes the seed set; the seed-count tests (`test_seed_prompts.py`, `test_lf_client.py`) must be updated. A stale `ask_charts` in a user's Langfuse project is harmless (simply unused).
- **Indicator validation vs `compute_indicators` semantics:** the validator front-loads the common failures (bad stat/column/role), but `compute_indicators` remains the source of truth — an edge it rejects (e.g. all-null numeric) still degrades to skipped, not a crash.
- **Modality balance:** the LLM might over-favor one kind; the prompt should encourage choosing the *best* fit (a number for "how many", a chart for distributions/trends). Tunable in the prompt, not code.
- **`save_recipe` signature change** (adds `kind`): the only callers are the Ask save endpoint (updated here) and tests; default `kind="chart"` preserves back-compat.
