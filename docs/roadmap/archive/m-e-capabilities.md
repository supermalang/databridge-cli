# M&E capabilities — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **ME-7 — Chart `form:` selector for multi-form (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  Follow-up from ME-4 (multi-form data layer + INDICATOR `form:` selector shipped; the analogous CHART
  selector was scoped out). Let a chart render against a specific form alias's DataFrame (`form:
  baseline` vs `form: endline`) so pre/post charts are possible.

  **Files:** `src/reports/charts.py` · `src/reports/builder.py` (route ME-4's `per_form` DataFrames into
  chart rendering when a chart sets `form:`) · `tests/test_charts_multiform.py` (new)

  **Config/schema impact:** None — reuses ME-4's `api.forms` + per-alias DataFrames; optional `form:`
  on a chart (absent -> current default-df behavior).

  **Acceptance criteria**
  - A chart with `form: <alias>` renders from that alias's DataFrame (not the default)
  - A chart without `form:` renders from the default DataFrame exactly as today (no regression)
  - An unknown alias fails with a clear error (not a silent wrong-data chart)

  **Unit tests:** `tests/test_charts_multiform.py` — per-form DataFrames (baseline mean != endline mean);
  assert `form: baseline` aggregates baseline, `form: endline` aggregates endline; no-`form:` uses
  default; unknown alias raises.

  **E2E:** N/A (no UI surface — chart rendering is backend; verified via unit tests + PR review).

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_charts_multiform.py`

---

- [x] **ME-6 — Surface below-threshold indicators in the Validate panel (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-27

  Follow-up from ME-2 (which computes `ind_<name>_status` RAG + a `flagged_indicators` context but
  does not surface them in the Validate panel). Add a validate-side detector so indicators below
  their warning/critical threshold appear as Validate findings.

  **Files:** `src/data/validate.py` (a `find_below_threshold_indicators` detector mirroring
  `find_orphan_framework_refs`) · `web/main.py` (data-quality/validate findings endpoint) ·
  `frontend/src/pages/Validate.jsx` · `tests/test_validate_thresholds.py` (new) ·
  `frontend/tests/e2e/validate-thresholds.spec.ts` (new)

  **Config/schema impact:** None — reuses ME-2's per-indicator `warning`/`critical` thresholds.

  **Acceptance criteria**
  - An indicator whose `pct_achievement` is below its warning/critical threshold produces a Validate
    finding with the correct RAG severity
  - The finding names the indicator + its target/actual/% + status
  - No finding at/above warning, or for indicators without thresholds
  - The findings render in the Validate panel UI alongside existing data-quality findings

  **Unit tests:** `tests/test_validate_thresholds.py` — detector flags a below-warning + below-critical
  indicator with the right severity; no flag at/above warning or when thresholds unset; finding carries
  indicator/target/actual/% fields.

  **E2E:** `frontend/tests/e2e/validate-thresholds.spec.ts` (new) + visual — with a stubbed
  below-threshold indicator, open Validate and assert the threshold finding renders with its RAG
  severity; `toHaveScreenshot` baseline at three viewports; a human approves.

  **UAT:**
  1. Configure an indicator that misses its target + a warning/critical threshold; open Validate.
  2. Confirm a red/amber finding flags it with its %-of-target.
  3. Raise the actual above warning; confirm the finding disappears.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_validate_thresholds.py` ·
  `cd frontend && npx playwright test validate-thresholds.spec.ts`

---

- [x] **ME-5 — Sampling weights**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

  No support for survey weights — all aggregates assume equal weighting. (`--sample N` is for
  testing only, not statistical sampling.)

  **Files:** `src/reports/indicators.py` · `src/reports/charts.py`

  **Config/schema impact:** New `weight_column` option on charts + indicators.

  **Acceptance criteria**
  - When `weight_column` is set, aggregate with `numpy.average(weights=…)` instead of simple means
  - No data-pipeline change — weighted computation only
  - Unweighted behavior unchanged when the option is absent

  **Unit tests:** `tests/test_weighted_aggregation.py` — create a small DataFrame with a `weight` column and assert that an indicator with `weight_column: weight` produces a weighted mean differing from the unweighted mean; assert that the same indicator without `weight_column` produces the unweighted mean; assert a chart with `weight_column` set passes the weights to the aggregation function.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

- [x] **ME-4 — Multi-form / longitudinal linkage**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

  The platform connects to exactly one form. Many frameworks need baseline ↔ endline (matched
  on beneficiary ID), monitoring ↔ registration, activity ↔ outcome. Largest change here.

  **Files:** `api:` config · `src/data/extract.py` · `src/data/make.py` · indicators/charts

  **Config/schema impact:** `api:` lists multiple aliased forms.

  **Acceptance criteria**
  - `fetch-questions` + `download` produce named DataFrames per form alias
  - Indicators can reference `form: baseline` vs `form: endline` (the analogous **chart** `form:`
    selector is split to a follow-up — ME-4 delivers the multi-form data layer + indicator selector;
    the card's own Unit-tests scoped charts out)
  - Enables pre/post and difference-in-differences

  **Unit tests:** `tests/test_extract_multiform.py` — mock the Kobo API to return two forms with distinct UIDs; assert `fetch-questions` produces separate question lists keyed by alias; assert `download` writes separate DataFrames for `baseline` and `endline`; assert an indicator referencing `form: baseline` reads from the correct DataFrame.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

- [x] **ME-3 — Indicator metadata catalog**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

  Indicators carry computation params + `direction`, but not `unit`, `source`, `frequency`,
  or `responsible`, so the donor-style indicator reference annex can't be auto-generated.

  **Files:** `src/reports/indicators.py` · `src/reports/template_generator.py`

  **Config/schema impact:** New indicator fields (`unit`, `source`, `frequency`, `responsible`).

  **Acceptance criteria**
  - Indicators accept the metadata fields (all optional)
  - `generate-template` emits an indicator reference annex from them

  **Unit tests:** `tests/test_indicators_metadata.py` — assert that an indicator config with `unit`, `source`, `frequency`, and `responsible` fields passes validation without error; assert `generate-template` produces a template section containing those four fields for each indicator; assert indicators without metadata fields still render without error.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

- [x] **ME-2 — Variance / traffic-light dashboards**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

  `pct_achievement` is computed per indicator and per framework node, but nothing flags
  indicators below threshold or renders a red/amber/green progress table.

  **Files:** `src/reports/indicators.py` · template + `src/reports/builder.py`

  **Config/schema impact:** Per-indicator threshold fields.

  **Acceptance criteria**
  - Indicators accept warning/critical thresholds
  - A traffic-light progress table renders (Indicator | Baseline | Target | Actual | %)
  - Below-threshold indicators are flagged in the report + Validate panel

  **Unit tests:** `tests/test_indicators_thresholds.py` — assert that an indicator with `warning: 70` and `critical: 50` is flagged as warning when `pct_achievement` is 65 and critical when it is 45; assert the traffic-light table rows contain the correct RAG status; assert no flagging occurs when `pct_achievement` exceeds the warning threshold.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

- [x] **ME-1 — Equity / inclusion lens**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

  Indicators support `disaggregate_by`, but there's no automatic cross-group comparison that
  *surfaces* inequities (gaps, convergence, exclusion) — let alone significance.

  **Files:** `src/reports/indicators.py` · chart engine · `sample.config.yml`

  **Config/schema impact:** New optional `equity_dimensions` config section.

  **Acceptance criteria**
  - `equity_dimensions:` lists cross-cutting variables (gender, age_group, location)
  - `build-report` auto-generates one disaggregation block (stacked/grouped bar) per
    indicator × dimension
  - One config line → a full disaggregation section in the report

  **Unit tests:** `tests/test_indicators_equity.py` — assert that when `equity_dimensions` lists two variables, `build-report` logic produces two disaggregation chart specs per indicator; assert the disaggregation chart type is stacked or grouped bar; assert no chart specs are produced when `equity_dimensions` is absent.

  **E2E:** N/A (no UI surface)

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

