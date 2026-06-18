# Express Template Fill Design

**Date:** 2026-06-18
**Status:** Design (approved) — precedes the roadmap cards / implementation plan
**Roadmap:** New optional fast-path alongside the existing 5-step pipeline. Builds directly on Layer 2 profiling (`src/data/profile.py`), the Ask engine's catalog + validation (`src/reports/ask_engine.py`), the report builder (`src/reports/builder.py`), and the docxtpl template layer.

---

## 1. Goal

Let a user **skip Questions, Composition, and template generation** and start from a finished Word template they wrote freely. Placeholders written in `[ ]`, `[[ ]]`, or `{{ }}` are read out of the `.docx`; an LLM infers what each one means (chart / indicator / summary / table / narrative / metadata) from the data-aware catalog; each inferred spec is **validated locally** against the real data; the user **reviews and fixes** flagged placeholders; on approval the specs are written into `config.yml` and the template is **resolved** into a normal docxtpl template. From there the **existing `build-report` runs unchanged**.

The default experience is untouched: the 5-step pipeline remains the default and the only path enabled out of the box. Express Template Fill is **additive and opt-in**, discoverable via a banner/button — never in the way.

---

## 2. Scope

**In scope:** parse all three delimiters from an uploaded `.docx` (body, tables, headers, footers; tokens may span runs); one batched LLM inference call over all placeholders + the data catalog; local validation reusing Ask-engine rules; a review/approve step that flags low-confidence / invalid / missing-column placeholders; persist approved specs into config; produce a resolved template; CLI (`infer-template`, `apply-template`) + web surface; discoverability banner/button.

Inferred placeholder kinds: **charts, indicators, summaries, tables, narrative text, report metadata.**

**Out of scope / deferred:** auto-wiring inferred indicators to baselines/targets/`framework_ref` (inferred indicators stay simple); multi-turn refinement of the inference; inferring `views`/repeat-group joins; changing `build-report` itself.

**Locked decisions:**
- Inferred specs are **persisted to config** with an explicit **review/approve** step (not ephemeral).
- All three delimiters are **interchangeable**; kind is inferred from the text inside. Exception: a `{{ }}` token whose inner text is already a **known literal** placeholder is passed through untouched.
- Low-confidence / unresolvable placeholders are **flagged in review for the user to resolve**; nothing renders until resolved.
- Approach **A**: a single batched propose call, then **deterministic local validation** — the model is never trusted on whether the data supports a recipe.
- Both paths coexist; the **5-step pipeline is the default**.

---

## 3. Architecture (Approach A — new `src/reports/template_inference.py`)

A new module orchestrates parse → infer → validate → apply; downstream of "apply" is entirely existing code (`build-report`). The web layer stays thin (endpoint → module → JSON). One new seed prompt (`template_inference`) is added to `seed_prompts.py` and resolved via `lf_client` like every other prompt site, so it works offline via the bundled seed.

### Files
- **Create:** `src/reports/template_inference.py` — the orchestrator + helpers.
- **Modify:** `src/utils/seed_prompts.py` — add the `template_inference` seed (JSON output with `output_schema`).
- **Modify:** `src/data/make.py` — add `infer-template` and `apply-template` Click commands.
- **Modify:** `web/main.py` — `POST /api/template/infer`, `POST /api/template/apply`; add both commands to `ALLOWED_COMMANDS`.
- **Modify:** `frontend/src/pages/Templates.jsx` — review/approve panel; **Modify:** `frontend/src/pages/Dashboard.jsx` (or App shell) — discoverability banner/button.
- **Create:** `tests/test_template_inference.py`, `tests/test_template_api.py`, and a Playwright E2E spec.
- **Modify:** `CLAUDE.md` — document the express path + the new prompt site.

---

## 4. The pipeline

### 4.1 `extract_placeholders(docx_path) -> List[Token]`
Open with `python-docx`. Walk **body paragraphs, table cells, headers, and footers**. For each paragraph reconstruct the full text by concatenating its runs (so tokens split across runs — which hand-typed placeholders almost always are — are still matched), then regex for `[[ … ]]` → `[ … ]` → `{{ … }}` in that **precedence** (so `[[x]]` is not double-matched as `[x]`). Each `Token` records: `raw`, `inner` (trimmed text), `delimiter`, and `location` (a reference sufficient to rewrite it later, including the run span).

**`{{ }}` literal passthrough:** if `inner` matches a known literal placeholder — `report_title`, `period`, `n_submissions`, `generated_at`, `summary_text`, `observations`, `recommendations`, `chart_*`, `ind_*` (incl. `_table`/`_breakdown`), `summary_*`, `table_*`, `data_quality*`, `logframe*`, `provenance.footer` — the token is marked `kind: literal` and left **untouched** (today's behavior preserved). Everything else is natural-language to infer.

### 4.2 `infer_specs(nl_tokens, catalog, ai_cfg) -> List[Proposal]`
One batched call. Build variables `{placeholders: [inner text…], catalog (JSON), kinds + per-kind spec shapes + per-chart-type column requirements}`, `lf_client.get_prompt("template_inference", vars)`, `lf_client.chat(..., trace_name="template_inference", json_mode=True)`. The catalog is the Ask engine's `build_catalog` (data-aware, privacy-safe by construction). Per token the LLM returns a `Proposal`:
```
{token_index, kind: chart|indicator|summary|table|narrative|metadata,
 spec: {<config-shaped dict>}, name: <canonical slug>, confidence: 0..1, reason: str}
```
The `spec` is in the **existing config shape** the builder already understands (chart: `{name,title,type,questions,…}`; indicator: `{name,stat,question,…}`; summary: `{name,stat,questions,…}`; table: `{name,title,questions,…}`).

### 4.3 `annotate_proposals(proposals, profile) -> List[Proposal]`
Local, deterministic validation reusing `validate_recipe` / `CHART_REQS` / `INDICATOR_STATS` from `ask_engine.py`:
- every column referenced exists in the proposal's source table;
- the chart/indicator/summary type's required column roles are satisfied (e.g. scatter needs ≥2 quantitative);
- canonical `name`s are deduped (suffix on collision).

Sets `status: ok` or `status: needs_attention` with a human reason. `needs_attention` triggers when confidence is low, validation fails, or a referenced column is absent from the downloaded data. **Mapping per kind:**
- chart / indicator / summary / table → append to that config section (`chart_<slug>`, `ind_<slug>`, …).
- narrative → a fixed slot (`summary_text` / `observations` / `recommendations`) when the text clearly matches; otherwise a `summaries` entry with `stat: ai` and `prompt` = the placeholder text.
- metadata → `report.title` / `report.period` / etc., resolved to the canonical `{{ }}`.

### 4.4 `apply_inference(approved, cfg, template_path) -> (cfg, resolved_template_path)`
- **Config:** append/merge approved specs into the relevant `config.yml` sections — **never clobber** existing entries; dedupe by name. `write_config`.
- **Resolve template:** replace each token's run span with a **single clean `{{ canonical }}` run** (the other runs in the span are cleared). This is **critical for charts**, which must be one unbroken XML run for docxtpl. The resolved `.docx` is saved as the project template; the **original upload is preserved** alongside it. Returns the resolved path.

After apply, the existing `build-report` runs with no changes.

---

## 5. CLI surface (two-phase, so review can happen)

- **`infer-template --template <file> [--out reports/.template_inference.json]`** — `extract_placeholders` → `infer_specs` (needs AI + downloaded data) → `annotate_proposals`; write the proposal list to the `--out` JSON for review/editing. Prints a summary table (placeholder → kind/name/status).
- **`apply-template [--from reports/.template_inference.json] [--build]`** — read the (possibly user-edited) proposals, drop any still flagged/unapproved, `apply_inference` → write config + resolved template. With `--build`, chain into `build-report`.

Both added to `ALLOWED_COMMANDS` in `web/main.py` with their allowed flags.

---

## 6. Web surface

- **`POST /api/template/infer`** (multipart upload or existing-template ref) → loads the latest session, runs parse → infer → annotate, returns `{proposals, message?}`. Preconditions return a friendly payload: no AI provider/key → message "Configure an AI provider to use Express fill."; no downloaded data → message "No data yet — run Download first." Unlike no-op AI features, inference **requires** an AI provider (it is the feature's core) and says so plainly.
- **`POST /api/template/apply`** `{proposals (approved/edited)}` → `apply_inference` → `{ok, template, n_written}`. The client then calls the existing run endpoint for `build-report`.
- **Templates tab review panel:** a table of placeholder → proposed kind / canonical name / spec, with `needs_attention` rows highlighted and showing the reason. Each row is editable (change kind/spec/name) or droppable. An **Apply & build** action is disabled until no row is `needs_attention` (or the user explicitly drops the flagged ones). Loading/empty/error states mirror `Validate.jsx` / `Ask.jsx`.
- **Discoverability:** a banner/button (Dashboard + Templates tab) — *"In a hurry? Upload a template and let AI fill it →"* — opens the Express flow. The 5-step pipeline remains the default and is unchanged.

---

## 7. Error handling & edge cases

- **No downloaded data** → hard error (local validation needs real columns). The flow requires extract first.
- **No AI provider/key** → hard error with a clear message (cannot degrade to seeds meaningfully).
- **Zero placeholders found** → friendly no-op message.
- **Duplicate canonical names** → suffixed.
- **Unresolvable `{{ }}` literal** (looks literal but unknown) → flagged `needs_attention`.
- **Token spanning multiple runs** → handled on both read (full-paragraph regex) and write (single-run replacement).
- **Existing config present** → express path **appends**, never overwrites; user-authored entries survive.

---

## 8. Testing

**Unit (`tests/test_template_inference.py`):**
- `extract_placeholders`: each delimiter; precedence (`[[x]]` not matched as `[x]`); tokens split across runs; tokens in tables / headers / footers; `{{ }}` literal passthrough vs NL.
- `annotate_proposals`: flags low confidence, missing column, and bad type/column combos (e.g. scatter with one quantitative); dedupes names.
- `apply_inference`: writes the correct config sections, merges without clobbering, and produces **single-run** chart placeholders in the resolved docx (assert run count for the chart placeholder).
- Fixtures built programmatically with `python-docx`; the LLM call mocked like the existing suggester tests.

**API (`tests/test_template_api.py`):** `/api/template/infer` precondition payloads (no AI, no data); `/api/template/apply` writes config + returns the resolved template.

**E2E (Playwright):** discoverability banner → upload template → infer → review panel shows mapping + flags → edit a flagged row → Apply & build → report downloads. Plus a `toHaveScreenshot` baseline of the review panel (per the visual-check rule for UI tasks).

---

## 9. Reuse map (what already exists)

| Need | Existing code |
|---|---|
| Read `{{ }}` from a docx | `web/main.py` `preview_template` (`get_undeclared_template_variables`) |
| Data-aware catalog | `ask_engine.build_catalog` |
| Recipe validation | `ask_engine.validate_recipe`, `CHART_REQS`, `INDICATOR_STATS` |
| Per-column profile | `src/data/profile.py` `profile_dataset` |
| Render report from config | `src/reports/builder.py` `build-report` (unchanged) |
| Prompt resolution (cache → Langfuse → seed) | `src/utils/lf_client.py`, `seed_prompts.py` |
| Config read/write + `env:` resolution | `src/utils/config.py` |

The novel work is: multi-delimiter parsing robust to run-splitting, the batched inference prompt, the kind→config mapping, and the single-run template resolution.
