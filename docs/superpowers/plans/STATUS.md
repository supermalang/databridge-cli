# Implementation Status — DataBridge (kobo-reporter)

**Last updated:** 2026-06-07
**Purpose:** Single resume point — what's shipped, what's left, and the decisions still open. Per-slice specs/plans live in [`../specs/`](../specs/) and [`./`](./); the analyst-pipeline architecture is in [`../specs/2026-05-30-analyst-pipeline-architecture.md`](../specs/2026-05-30-analyst-pipeline-architecture.md).

`main` is green at **526 tests**.

---

## ✅ Done

### Analyst pipeline (Layers 1–4)
- **Layer 1 — Base tables** (`src/data/flatten.py`): recursive multi-level flatten; linkage cols `_root_id` / `_parent_index` / `_parent_row_id` / `_row_id` / `_row_index`. `GET /api/base-tables`.
- **Layer 2 — Profile** (`src/data/profile.py`): deterministic per-column EDA — `null_stats`, `iqr_bounds`, `numeric_outliers`, `correlations`, duplicate-id info. Single source of truth for missingness/outliers. `GET /api/profile`. *(The "clean" half of Layer 2 is still unbuilt — see Left.)*
- **Layer 3 — PII gate** (`src/utils/pii.py`): fail-closed `enforce_pii` at export + lenient `apply_pii` render net; `download --no-redact` escape hatch.
- **Layer 4 — Ask engine** (`src/reports/ask_engine.py`): NL question → catalog → LLM recipe → validate → local compute → grounded caption; chart/indicator kinds; refine; `save_recipe`. `POST /api/ask`, `/api/ask/save`, `/api/ask/refine`. Prompts `ask_propose`/`ask_caption`/`ask_refine`.

### M&E methodology core
- **Disaggregated indicators**: `disaggregate_by` (string/list) → per-group `ind_<name>_breakdown` (list) + `ind_<name>_table` (text), reusing the stat engine. Engine + `/api/indicators/preview` `breakdown` + IndicatorModal field + card breakdown preview.
- **Per-indicator logframe achievement**: each logframe row's indicators carry `baseline`/`target`/`pct_achievement`.
- **Node-level achievement**: `primary: true` indicator drives a node's `node_value`/`node_target`/`node_pct_achievement` (first primary wins — no multi-indicator roll-up). IndicatorModal Primary checkbox.
- **Direction-aware achievement**: optional `direction: increase|decrease`. `increase` (default) keeps `value/target` (backward compatible); `decrease` uses `target/value`; `value==0` → "N/A". Localized to `src/reports/indicators.py`; logframe inherits the corrected string.
- **Auto-template rendering**: generated template's Results Framework shows node achievement %, per-indicator target/%, and `{{ ind_<name>_table }}` breakdowns.

### Data quality
- **`completeness` stat**: % present (non-blank) via `profile.null_stats`.
- **`outlier_rate` + `duplicate_rate` stats**: % beyond 3×IQR (numeric-only) and % redundant duplicates. All three are regular indicators (disaggregable, framework-linkable, in the Ask allowlist + IndicatorModal dropdown; pair with `format: percent`).
- **Numeric core / formatter split** (`src/reports/data_quality.py`): `compute_data_quality` (floats/None) + `build_data_quality` (string `{{ data_quality }}` contract). Per-repeat-table coverage via an additive `tables: [{name, rows}]` key (linkage-only tables omitted); rendered in the auto-template.
- **Web surface**: `GET /api/data-quality`; the DQ metrics are now folded into the **Profile** tab (base-table accordion tree), not a standalone Validate panel.

### Web UI reorganization (2026-06-01)
- Unified page shell + shared `PageHeader` across all pages; workflow nav reorg (no ordering numbers); keep-alive tabs (lazy mount, retained state, hourly/data-change cache refresh).
- **Sources** split into Connection vs Output/AI sub-tabs; **Load** stage ordered Questions → Profile → Validate; base tables rendered as hierarchical accordion trees.
- **Hidden columns** excluded everywhere (profile, validate, views, data-quality); hidden rows locked in Questions.
- **Analyze** reordered Ask-first with per-section AI "Suggest" and a dedicated Tables section; AI "Auto-hide clutter" + "Flag PII" metadata-only review buttons in Questions.

### Platform / multi-tenancy (2026-06-02 → 06-04)
- **Postgres project model** (`web/db/`): app state (users ↔ orgs ↔ projects) in Postgres via SQLAlchemy 2.0; each project's config is a membership-scoped `jsonb` column (source of truth, mirrored to `config.yml` for the CLI). Alembic migrations run on FastAPI startup; tests use SQLite (`DATABRIDGE_SKIP_MIGRATIONS=1`).
- **Object storage** (`web/storage/`): `Storage` interface with S3/Minio + local-fs backends, lazy env-driven factory, per-project key helper. Project files (sessions, reports, templates) stored durably per project; local dirs are a materialized mirror of the active project (`pull` on activate, `push` after a successful run). `data/raw` + `charts` not synced.
- **Per-job workspace isolation**: each `/api/run/{command}` runs in its own temp dir (`hydrate_run_dir` pulls config + `RUN_INPUTS`; outputs pushed + config synced on success).
- **Per-project run concurrency** (`web/runs.py`): in-memory `RunRegistry` replaced the global single-flight — one run per project (second → 409), different projects concurrent up to `MAX_CONCURRENT_RUNS` (over cap → 429); `run_id` in the first SSE event; `GET /api/status`, `POST /api/stop/{run_id}`.
- **Auth + RBAC**: Zitadel OIDC login gate; per-project `ProjectMembership` (viewer<editor<admin<superadmin) with owner + global superadmin override; mutating endpoints gated by `require_role`; invitations (pending → membership on login) with Zitadel user-create/email; superadmins bootstrapped from `SUPERADMIN_EMAILS`. Frontend `PermsProvider`/`usePerms` disables (not hides) gated controls; `ProjectMembersModal`.
- **Dev container**: compose-based with Postgres + Minio; Python deps installed in-container.

### Production deployment & CI (2026-06-05)
- Production Docker/Compose stack, Traefik reverse proxy, HTTPS cookies, single-instance.
- GitHub Actions: run the test suite + build the production image; publish to Docker Hub on version tags.

### UX & AI-connection hardening (2026-06-05 → 06-06)
- AI features gated behind a **verified** AI connection (real connection test, persisted in DB, auto-relock on failure); interactive AI buttons locked until verified.
- EDA (profile/validate/data-quality) excludes hidden **and** PII columns; potential-PII matched on word boundaries, not substrings.
- Project-switch guard against unsaved page edits; question-list virtualization (`content-visibility`); a11y + validation/guidance audit fixes.
- **Questions: Fetch-from-form button** runs `fetch-questions` in-tab via a shared `RunProvider`/`useRun` context.

### Ask engine polish (2026-06-06 → 06-07)
- **Ask examples**: data-aware starter questions (`src/reports/ai_ask_examples.py`, `ask_examples` prompt; AI with schema + deterministic fallback).
- Refresh Charts/Tables after applying an Ask answer; modal focus-loss fix; AI buttons re-lock on failed test; duplicate-label flow fix.

---

## ⏸ Settled decisions (don't re-litigate — see memory)
- **Auth provider**: Zitadel kept over Auth0 (Google + email/pw; custom domain later).
- **Download staleness**: download stays always-on (count checks miss *edited* submissions). Revisit only if re-downloads become a real pain point.
- **Scheduling** (recurring `run-all`): out of scope for the orchestrator.
- **Node achievement = primary indicator** (no averaging/sum across multiple indicators).
- **Equity auto-disaggregation** (global `equity_dimensions`): skip — overlaps explicit per-indicator `disaggregate_by`.
- **Multi-user reads**: concurrent users with different active projects share one `BASE_DIR` read-mirror (best-effort, last-writer-wins); durable Minio/DB data is always correct. True read isolation is out of scope.

---

## 🔲 Left — needs an owner decision before building

### M&E frameworks (extends the Results Framework / logframe already built)
- **Indicator metadata catalog / PIRS** *(highest fit — recommended next)* — `unit`, `direction` (now consumed by achievement), `frequency`, `responsible_party` + an auto-generated indicator reference sheet, and a UI to set `baseline`/`target`/`direction` (currently YAML-only). Folds in the parked **baseline-anchored achievement** decision below. This is the PMF/PIRS framework from the 2026-06-07 brainstorm; it builds directly on the existing indicator model. *Needs your M&E reporting standard for the field set.*
- **Additional M&E frameworks** *(brainstorm 2026-06-07)* — beyond PIRS, in fit order:
  - *Full 5-level logframe* — add **Activity** (and optionally **Input**) levels under each Output in `FrameworkCard`/`framework:` config; smallest change, completes the classic hierarchy (currently Goal→Outcome→Output only).
  - *Logframe matrix columns* — per-node **Means of Verification** + **Assumptions/Risks** (the two canonical 4-column-logframe fields not yet modeled).
  - *Theory of Change* — causal-pathway model with **assumptions/preconditions** between levels; flexible graph rather than a strict tree (bigger lift).
  - *SDG / external-framework alignment* — tag an indicator to an **SDG target/indicator** (or donor framework code); likely reuses `framework_ref`.
  - *OECD-DAC evaluation criteria* (Relevance/Coherence/Effectiveness/Efficiency/Impact/Sustainability) — report-structuring device; maps to summaries, not the framework tree.
  - *Outcome Mapping* (progress markers: expect/like/love to see) — behavior-change focused; niche.
  *Decision: which to adopt + in what order. Recommended first step: full 5-level logframe (cheap completeness win), bundled with or right after PIRS.*
- **Baseline-anchored achievement** *(parked, recommend)* — the academically-standard `(value−baseline)/(target−baseline)` is direction-agnostic and more correct when a baseline exists, but would silently change numbers for existing `increase` indicators with a baseline. *Decision: default formula, or opt-in alongside `direction`? Resolve as part of PIRS.*

### Data quality (remaining)
- **Table-level metrics** — % fully-complete rows, per-table duplicate rate. *Decision: a summary row in `{{ data_quality }}`, or a separate structure?*
- **Inter-enumerator variance** — *needs you to name the enumerator column + which fields to check.*

### Other frontiers (each its own spec → plan → build)
- **Layer 2 cleaning** — type coercion / normalization before profiling & charts (the unbuilt "clean" half of Layer 2). *Decision: which cleaning rules, declarative config vs auto?*
- **Named-view UI builder** — make `views:` fully first-class in the Composition/Load tab.
- **Ask tab polish** — conversation history + how saved recipes surface (per architecture §4b). *(Starter questions + apply-refresh shipped; history still open.)*
- **AI-narrator disaggregation awareness**, cross-period beneficiary dedup, sampling provenance (deferred per architecture §7).

---

## How to resume
1. Pick an item from **🔲 Left**. If it's under "needs an owner decision", answer the *Decision* prompt first.
2. Run the usual cycle: spec (`docs/superpowers/specs/`) → plan (`docs/superpowers/plans/`) → subagent-driven TDD → review → PR → squash-merge → `pull --ff-only`.
3. Standing recommendation for a one-word "continue": **Indicator metadata catalog / PIRS** — most pull (folds in baseline-anchored achievement + a UI for the YAML-only `baseline`/`target`/`direction` fields, and anchors the broader M&E-frameworks track). Otherwise **Layer 2 cleaning** is the next untouched architecture layer.
