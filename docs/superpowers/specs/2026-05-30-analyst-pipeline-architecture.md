# Architecture & Roadmap — Question-Driven Analyst Pipeline

**Date:** 2026-05-30
**Status:** Design / roadmap (precedes per-feature specs and implementation plans)
**Scope:** End-to-end redesign of the databridge-cli data pipeline so the app behaves like an automated *data-analyst specialist*: ingest → flatten → profile/clean → ask questions → get views, charts, indicators, and reports — automated end to end, using an LLM only where intelligence genuinely helps.

---

## 1. Vision

For each project the app should: load data, transform it into clean linked tables, understand it (profiling/EDA), and then let a user **ask questions in natural language** and receive analysis — views, charts, indicators, summaries, and ultimately reports. Everything is automated; the LLM is used for *judgment* (what to measure, how to show it, what it means), never for arithmetic. **All computation stays local; the LLM only proposes recipes and phrases findings.**

---

## 2. Current state (why this redesign)

A multi-lens audit (senior-dev, UX, M&E) plus an end-to-end pipeline assessment found a **strong deterministic engine** but **~40% automation** and **no cohesive analyst workflow**. Key findings that drive this design:

- **Sub-repeats are broken.** The flattener (`src/data/transform.py:169-216`) handles main + one level of repeat, linking every repeat row to the **root `_id`** only. Nested repeats (a repeat inside a repeat) pass through a *list* in `_resolve_nested`, which can only walk dicts, so sub-repeat tables come back **empty**, and there is no link from a sub-repeat row to its immediate parent row.
- **Intelligence is schema-blind.** No LLM site ever inspects real data — cardinality, null rates, skew, correlations. Suggesters reason from column labels alone, so the system "writes up findings it never discovered."
- **No metric proposer.** Charts/views/summaries have suggesters; indicators do not. Every indicator is hand-typed.
- **Suggestions don't flow.** Every AI suggestion needs a manual paste/Save; `build-report` never invokes a suggester; an empty project yields an empty report.
- **No pipeline object.** ~11 human-triggered commands with no end-to-end run, no sequencer, no staleness detection. `config.yml` is the only connective tissue.
- **PII is bypassed where data lands.** `apply_pii` runs only at report-render time; the `download`/export path writes raw names/phones/GPS/un-consented rows to CSV/DB/Supabase. *(Flagged independently by all three audit lenses — the single highest-confidence finding.)*
- **Two divergent LLM integrations** (`web/main.py` bypasses `lf_client`), and **no self-validation** of LLM output, **no numeric grounding** of narrative.

---

## 3. Layered architecture

The pipeline is organized as layers, each with one job and a clean interface to the next. **Lower layers are stable (change only when the form changes); upper layers are analysis-specific (change when the questions change).**

```
┌─────────────────────────────────────────────────────────────────┐
│ 0. CONFIG + INGEST   user sets params · fetch schema · download    │
├─────────────────────────────────────────────────────────────────┤
│ 1. BASE TABLES       auto-flattened, one per repeat level,         │
│    (lossless)        every row linked to immediate parent + root   │
├─────────────────────────────────────────────────────────────────┤
│ 2. PROFILE + CLEAN   per-table types · safe unique names ·         │
│    (deterministic)   EDA stats (cardinality, nulls, skew, corr) ·  │
│                      LLM-suggested cleaning, HUMAN-approved         │
├─────────────────────────────────────────────────────────────────┤
│ 3. PII GATE          detect → HUMAN confirm (fail-closed) →         │
│                      redact/consent-gate before any value leaves    │
├─────────────────────────────────────────────────────────────────┤
│ 4. QUESTION ENGINE   NL question → LLM proposes recipe (view +     │
│    (LLM proposes,    columns + chart/indicator/summary) → validate  │
│     engine computes) → compute locally → ground caption in numbers  │
├─────────────────────────────────────────────────────────────────┤
│ 5. SAVED RECIPES     named, reusable views + their charts/metrics   │
│                      (reproducible across periods)                  │
├─────────────────────────────────────────────────────────────────┤
│ 6. REPORT            assemble saved answered-questions into .docx    │
├─────────────────────────────────────────────────────────────────┤
│ ORCHESTRATOR (cross-cutting): sequence stages, detect "data changed │
│ → re-profile → re-run saved questions → rebuild report"             │
└─────────────────────────────────────────────────────────────────┘
```

### Vocabulary (to avoid the overloaded word "views")
- **Base tables** — auto-generated, lossless, one per repeat level. Not configured; they fall out of the form structure. *(This is "point 1".)*
- **Derived views** — analysis-specific tables (join/filter/group/aggregate) built **on top of** base tables. There may be many or none; they encode analysis choices. Today's `views:` config block. *(Created by the question engine in this design.)*
- **Profile** — computed EDA statistics per base table/column (deterministic, no LLM).

---

## 4. Layer details

### Layer 1 — Base tables (foundation; repairs sub-repeats)
- Recursively flatten the submission JSON into **one flat table per repeat level**, traversing *through lists* (the current bug).
- Each row carries a foreign key to its **immediate parent row** *and* a path back to the **root submission**, e.g.:
  ```
  households   _id
    members    _parent_id → households._id
    illnesses  _parent_row → members.(row), _root_id → households._id
  ```
- Types set from schema category; column names **slugified + de-duplicated** at this layer (fixes the `export_label` collision seam at its source, instead of failing two stages later).
- **No LLM.** Deterministic and lossless.

### Layer 2 — Profile + clean (the load-bearing prerequisite)
- **Profile (deterministic, no LLM):** per column — type, cardinality, null rate, value range, skew, top values (low-cardinality only), cross-column correlations, time density. Reuses logic already in `validate.py`/`summaries.py`, extracted into a reusable module.
- **Types/rename:** deterministic. LLM optional *only* to flag likely mis-typing or drift (a text field that's really a date), never to compute.
- **Clean:** LLM *suggests* row/column exclusions from the profile ("Age has 12 values >120 — exclude?"); a **human approves**. Cleaning decisions are never silent.
- The profile is the metadata the question engine feeds to the LLM. **Quality of the whole analyst experience is capped by this layer** — it must be solid before Layer 4 is trustworthy.

### Layer 3 — PII gate (fail-closed, before any value leaves)
- Detect candidate PII columns (deterministic name/pattern heuristic first; LLM may assist on the **catalog**, never on raw values).
- **Human confirms** the PII set. **Fail-closed:** if a configured consent/redact column is missing, abort — never pass through unredacted (fixes the current fail-open behavior).
- Redaction + consent-gating apply **in every export path** (download/CSV/DB/Supabase), not only at report render. *(This is the PII fix all three audits flagged.)*
- PII is resolved **before** any value-level profile (top-values/samples) is sent to the LLM, so a sample value can never leak a name.

### Layer 4 — Question engine (the primary interface)
The conversational core. A natural-language question triggers the analysis:

1. **Catalog first, profile on demand.** Send the LLM a compact catalog (table, column, type, role, cardinality). The LLM selects relevant tables/columns; pull the **fuller profile only for those** and refine. (Keeps token cost and PII surface small.)
2. **LLM proposes a recipe**, not data: which base/derived tables + columns, the join/filter/group, a **name** for the resulting view and its columns, and **the best way to answer** — 1–3 charts *or* a scalar indicator *or* a small table *or* a one-line finding (the LLM picks the modality; not everything is a chart).
3. **Validate before computing:** columns exist, join keys valid, chart type fits the data shape (we have the profile). On failure, repair (re-ask with the error) rather than failing at render time. *(Fixes the "no self-validation" gap.)*
4. **Engine computes** the view + renders charts/metrics **locally** (existing chart engine + indicator engine).
5. **Ground the caption in the computed numbers:** optionally send the *result* back for a one-line interpretation. Numbers come from local compute; the LLM only phrases them — it cannot hallucinate figures. *(Fixes "narrative blind to chart values".)*
6. **Clarify when vague:** the LLM may ask one clarifying question or offer 2 interpretations instead of silently guessing.
7. Users can **request additional charts** or refine ("make it a line chart", "split by region") — iterative.

### Layer 5 — Saved recipes (reproducibility)
- Each answered question persists as a **named, reusable recipe** (view + chosen charts/indicators/summaries) in config.
- Recipes are **re-runnable across periods** — the same question gives a consistent answer next quarter, which is what makes reports repeatable.
- Derived views are **computed once and materialized** alongside base tables (today they are recomputed on every render).

### Layer 6 — Report
- A report is a **curated set of answered questions**: each saved question becomes a section (view + chart(s)/metric + grounded caption).
- Removes the current hard-fail when no charts are configured: a project with saved questions can produce a report unattended.
- The deterministic backbone (indicators, stats, logframe, provenance footer) remains.

### Orchestrator (cross-cutting backbone)
- A single pipeline object + an end-to-end run (CLI `run-all` + `/api/run/all`) that sequences the layers with **precondition checks** and **staleness detection**: new data → re-profile → re-run saved questions → rebuild report.
- Fixes the current concurrency bug (single global `_proc`) and the "no pipeline object" gap.

---

## 4b. Delivery priority — web first

Every layer is delivered **web-first**: the FastAPI endpoint + React UI is the lead surface, and CLI parity is secondary/optional. The target users (M&E / humanitarian field staff) work through the web UI, not the terminal. The CLI remains the execution engine but no longer leads. Concretely: the **question engine** lands as a **web chat panel** (`/api/*` + React), and the **orchestrator's** end-to-end run is primarily `/api/run/all`, with any `run-all` CLI command following only if needed.

## 5. LLM usage policy (applies to every layer)

- **LLM proposes recipes and phrases findings. The engine computes.** No arithmetic, aggregation, or row-level data ever depends on the model.
- **Send the profile, never raw rows.** Even metadata is aggregated; PII column *values* are never sent.
- **Always validate model output** against the real catalog before acting on it.
- **One LLM integration.** Unify the `web/main.py` inline prompts onto `lf_client` (tracing, versioning, cache, seed fallback). End chart-catalog drift.
- **Graceful degradation preserved.** Everything still works with no AI keys (deterministic paths) and no Langfuse keys (bundled seeds).

---

## 6. Build sequence (foundation up)

Each item below becomes its own spec → plan → implementation cycle. Order is dependency-driven: the question engine is only as good as the foundation under it.

> **Status (2026-05-31):** items 1–6 are done; see [`../plans/STATUS.md`](../plans/STATUS.md) for the authoritative what's-done / what's-left. Layer 2 "clean" and the M&E/DQ extensions in §7 are the remaining work.

1. ✅ **Base tables (Layer 1)** — recursive multi-level flattening with immediate-parent + root linkage; slugified/de-duplicated names. *Prerequisite for everything.*
2. ✅ **Profile module (Layer 2 — profile half)** — reusable EDA/profiling; deterministic. *(The "clean" half — type coercion/normalization — is still open; see STATUS.)*
3. ✅ **PII gate (Layer 3)** — fail-closed consent/redaction applied in every export path; detection + human confirm.
4. ✅ **Question engine (Layer 4) + saved recipes (Layer 5)** — NL question → validated recipe → local compute → grounded caption; persist recipes.
5. ✅ **Report-from-saved-questions (Layer 6)** — `run-all --auto-charts` removes the no-charts hard-fail (#13).
6. ✅ **Orchestrator** — `run-all` sequencer + build-report staleness (#11) + single-flight concurrency fix (#12). *(Download staleness + scheduling deliberately deferred — see STATUS.)*

---

## 7. Relationship to in-flight work (sequencing the existing specs)

- **M&E methodology core** — **largely shipped (2026-05-31):** disaggregation (#14/#15), per-indicator + node-level achievement (#16–#18), and data-quality stats + report section (#19–#21). **Still open:** indicator metadata/PIRS, period roles/milestones, direction-aware achievement (greater-is-better vs lower-is-better). See [`../plans/STATUS.md`](../plans/STATUS.md).
- **PII spec** — promoted into **item 3** above (it's the same work, now placed correctly in the layer model and justified by a third independent audit).
- **Deferred** (later specs, unchanged): AI-narrator disaggregation awareness + AI-draft safeguards, cross-period beneficiary dedup, sampling provenance, DQA-in-reports, and all web-UI editing controls.

---

## 8. Risks & open questions

- **Foundation quality gates everything.** A weak profile → confidently wrong views. Layers 1–2 must be solid and well-tested before Layer 4 is exposed to users.
- **Metadata size** with many repeat levels / hundreds of columns — the catalog-first, profile-on-demand pattern mitigates this; needs validation on a real large form.
- **Recipe validation coverage** — how thoroughly can we check a chart-type-vs-data-shape mismatch before render? Define the validation rules per chart type.
- **Backward compatibility** — existing `views:`/`indicators:`/`charts:` config and the 138-test suite must keep working; the question engine *adds* a creation path, it doesn't remove the declarative one.
- **Question-engine UX details** — resolved to web-first (a web chat panel; see §4b). Remaining UI specifics (panel placement, conversation history, how saved recipes surface) to be settled in the Layer-4 spec.
