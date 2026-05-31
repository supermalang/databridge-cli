# Implementation Status — Analyst Pipeline & M&E

**Last updated:** 2026-05-31
**Purpose:** Single resume point — what's done, what's left, and the decisions still needed. Architecture & build sequence live in [`../specs/2026-05-30-analyst-pipeline-architecture.md`](../specs/2026-05-30-analyst-pipeline-architecture.md); per-slice specs/plans are in `../specs/` and `./`.

`main` is green at **377 tests**.

---

## ✅ Done

### Foundation (build-sequence items 1–4) — landed earlier
- **Layer 1 — Base tables** (`src/data/flatten.py`): recursive multi-level flatten; linkage cols `_root_id` / `_parent_index` / `_parent_row_id` / `_row_id` / `_row_index`. `GET /api/base-tables`.
- **Layer 2 — Profile** (`src/data/profile.py`): deterministic per-column EDA — `null_stats`, `iqr_bounds`, `numeric_outliers`, `correlations`, duplicate-id info. Single source of truth for missingness/outliers. `GET /api/profile`.
- **Layer 3 — PII gate** (`src/utils/pii.py`): fail-closed `enforce_pii` at export + lenient `apply_pii` render net; `download --no-redact` escape hatch.
- **Layer 4 — Ask engine** (`src/reports/ask_engine.py`): NL question → catalog → LLM recipe → validate → local compute → grounded caption; chart/indicator kinds; refine; `save_recipe`. `POST /api/ask`, `/api/ask/save`, `/api/ask/refine`. Prompts: `ask_propose`/`ask_caption`/`ask_refine`. Structured-output schemas on prompts; CLI `--config`/`--strict` hardening.

### This session — Orchestrator (build-sequence item 6) + report-from-saved-questions (item 5)
- **#11 — Build-report staleness**: `run-all` skips rebuild when data content + config unchanged (content fingerprints in `reports/.run_all_state.json`, `src/data/run_state.py`); `--force` overrides.
- **#12 — Single-flight runs**: concurrent `POST /api/run/{command}` → HTTP 409; fixes the `_proc` race + shared-state corruption; `GET /api/status` reports `running`.
- **#13 — Auto-charts** (`run-all --auto-charts`): deterministic starter charts from questions when none configured (`src/reports/default_charts.py`); persisted to config; reachable from CLI + web (Dashboard checkbox). Removes the no-charts hard-fail.

### This session — M&E methodology core
- **#14 / #15 — Disaggregated indicators**: `disaggregate_by` (string/list) → per-group `ind_<name>_breakdown` (list) + `ind_<name>_table` (text), reusing the stat engine. Engine + `/api/indicators/preview` `breakdown` + IndicatorModal field + card breakdown preview.
- **#16 — Per-indicator logframe achievement**: each logframe row's indicators carry `baseline`/`target`/`pct_achievement`.
- **#17 — Node-level achievement**: `primary: true` indicator drives a node's `node_value`/`node_target`/`node_pct_achievement` (no multi-indicator aggregation — first primary wins). IndicatorModal Primary checkbox.
- **#18 — Auto-template rendering**: generated template's Results Framework shows node achievement %, per-indicator target/%, and `{{ ind_<name>_table }}` breakdowns.

### This session — Data quality
- **#19 — `completeness` stat**: % present (non-blank) via `profile.null_stats`.
- **#20 — `outlier_rate` + `duplicate_rate` stats**: % beyond 3×IQR (via `profile.numeric_outliers`, numeric-only) and % redundant duplicates. All three are regular indicators (disaggregable, framework-linkable, in the Ask allowlist + IndicatorModal dropdown; pair with `format: percent`).
- **#21 — Data Quality report section**: `build_data_quality` (`src/reports/data_quality.py`) → `{{ data_quality }}` (per-column completeness/outlier/duplicate for the curated question set), rendered in the auto-template. Mirrors `logframe`.

### Later session (2026-05-31) — DQ web surface, direction, per-repeat-table
- **#22 — Web surface for the DQ overview**: read-only `GET /api/data-quality` + a threshold-colored, sortable panel atop the **Validate** tab (`frontend/src/components/DataQualityPanel.jsx`). `data_quality.py` split into a numeric core (`compute_data_quality`, floats/None) + the string formatter (`build_data_quality`, report contract preserved).
- **#23 — Direction-aware achievement**: optional `direction: increase|decrease` on indicators. `increase` (default) keeps `value/target` (backward compatible); `decrease` uses `target/value` (lower-is-better), `value==0`→"N/A". Localized to `src/reports/indicators.py`; logframe inherits the corrected string.
- **#24 — Per-repeat-table DQ**: `compute_data_quality`/`build_data_quality` gained an additive `tables: [{name, rows}]` key (main stays in `rows`); rendered as per-table sub-sections in both the auto-template and the web panel. Linkage-only repeat tables omitted.

---

## ⏸ Settled decisions (don't re-litigate — see memory)
- **Download staleness**: kept download always-on (count checks miss *edited* submissions). Revisit only if re-downloads become a real pain point.
- **Scheduling** (recurring `run-all`): out of scope for the orchestrator.
- **Node achievement = primary indicator** (no averaging/sum roll-up across multiple indicators).
- **Equity auto-disaggregation** (global `equity_dimensions`): leaning skip — overlaps the explicit per-indicator `disaggregate_by`.

---

## 🔲 Left — needs an owner decision before building

### Data quality (remaining)
- **Table-level metrics** — % fully-complete rows, per-table duplicate rate. *Decision: a summary row in `{{ data_quality }}`, or a separate structure?*
- **Inter-enumerator variance** — *needs you to name the enumerator column + which fields to check.*

### Other frontiers (each its own spec → plan → build)
- **Layer 2 cleaning** — type coercion / normalization before profiling & charts (the "clean" half of Layer 2; only "profile" is built). *Decision: which cleaning rules, declarative config vs auto?*
- **Baseline-anchored achievement** *(parked from #23 — recommend)* — the academically-standard `(value−baseline)/(target−baseline)` formula is direction-agnostic and more correct when a baseline exists, but it would silently change numbers for existing `increase` indicators that set a baseline. Belongs with the PIRS item below. *Decision: adopt as the default achievement formula, or keep it opt-in alongside `direction`?*
- **Indicator metadata catalog / PIRS** — `unit`, `direction` (now consumed by achievement), `frequency`, `responsible_party` + an auto-generated indicator reference sheet, and a UI to set `baseline`/`target`/`direction` (currently YAML-only). *Needs your M&E reporting standard for the field set.*
- **Named-view UI builder** — make `views:` first-class in the Composition tab.
- **Ask tab polish** — conversation history, how saved recipes surface (per architecture §4b open questions).
- **AI-narrator disaggregation awareness**, cross-period beneficiary dedup, sampling provenance (deferred per architecture §7).

---

## Carried small follow-ups (low value alone)
- `useCommand` now forwards `period` + `auto_charts` (done in #15). No open hook gaps.
- The frontend indicator-stat dropdown has legacy labels (`mode`/`top`/`pct`) that differ from backend names (`most_common`/`percent`) — pre-existing, out of scope; new stats use exact backend names.

---

## How to resume
1. Pick an item from **🔲 Left**. If it's under "needs an owner decision", answer the *Decision* prompt first.
2. Run the usual cycle: spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → subagent-driven TDD → review → PR → squash-merge → `pull --ff-only`.
3. My standing recommendation for a one-word "continue": **Indicator metadata catalog / PIRS** — it now has the most pull (folds in the parked baseline-anchored achievement decision and a UI for the YAML-only `baseline`/`target`/`direction` fields). Otherwise **Layer 2 cleaning** is the next untouched architecture layer.
