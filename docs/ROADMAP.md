# Roadmap — databridge-cli

> Consolidated planning. Each task carries: implementation · acceptance criteria · how to
> verify · config/schema impact.
> Items here are intentionally *not* enabled in the UI yet — many render as disabled "soon"
> affordances so users know they're coming.
>
> Legend: `- [ ]` todo · `- [x]` done.
> "Done" gate: implementation + its tests passing —
> `PYTHONPATH=. MPLBACKEND=Agg python -m pytest`. UI-only tasks verify visually in the dev
> server (`./scripts/dev.sh`).

---

## Definition of Ready

A card is startable only when all of the following hold:

- Acceptance criteria are concrete and testable (no vague outcomes)
- Unit tests, E2E, and UAT fields are filled with specific targets (no blank or placeholder text)
- All affected files are identified
- All blocking dependencies are resolved
- Scope is limited to one deliverable
- Work is on a derived branch (`feature/ fix/ chore/`) off `develop`

## Definition of Done

- Unit tests pass (pytest green; Vitest green for frontend-only cards)
- E2E Playwright spec passes, including visual baseline (`toHaveScreenshot`)
- Impeccable audit/critique clean (no outstanding UX or accessibility findings)
- UAT signed off by a human reviewer following the card's UAT steps
- All changes committed and merged to the integration branch

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Output / export formats](#output--export-formats) | 3 | 0 / 3 |
| [Project management & top ribbon (UX)](#project-management--top-ribbon-ux) | 9 | 0 / 9 |
| [M&E capabilities](#me-capabilities) | 5 | 0 / 5 |

> **Shipped foundations** (delivered, not tracked here): results framework / logframe
> (`framework:`, `{{ logframe }}`), indicator baseline+target with `pct_achievement`, the
> data-quality framework (`{{ data_quality }}`, completeness / outlier / duplicate rates),
> multi-period tracking (`periods:`), per-project Postgres + Minio storage, and per-project
> RBAC. See `CLAUDE.md`.

---

## Output / export formats

> The **Deliver → Output** tab ships **CSV** and **XLSX** data-file exports today
> (`export.format`). The targets below are designed in the config schema and have
> CLI/back-end support, but are gated off in the UI until verified end-to-end per project.
> To re-enable a format: drop its `soon: true` flag in `FORMATS`
> ([frontend/src/pages/Sources.jsx](../frontend/src/pages/Sources.jsx)) and confirm the
> matching `_export_*` path in [src/data/transform.py](../src/data/transform.py).

---

- [ ] **OUT-1 — JSON export (records array)**

  Surface JSON in the format chip-tabs and verify the `_export_file` JSON branch end-to-end.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_file`)

  **Config/schema impact:** None — `export.format: json` already accepted.

  **Acceptance criteria**
  - JSON chip selectable in Deliver → Output (no `soon` badge)
  - `download` writes a records-array `.json` to `export.output_dir`
  - Round-trips with PII redaction applied (same gate as CSV/XLSX)

  **Unit tests:** `tests/test_export_json.py` — assert `_export_file` writes a valid JSON records array; assert output contains only redacted fields when PII config is active; assert file is created at `export.output_dir`; assert round-trip value equality against source DataFrame.

  **E2E:** N/A (no UI surface)

  **UAT:**
  1. Set `export.format: json` in `config.yml`, run `download --sample 20`. Open the output file and confirm it is a valid JSON array of objects with one entry per submission.
  2. With a PII config active, confirm the output file omits or redacts the designated PII columns.
  3. In the Deliver → Output tab, confirm the JSON chip is selectable with no "soon" badge.

  **Verify:** set `export.format: json`, run `download --sample 20`, open the output file.

---

- [ ] **OUT-2 — MySQL remote table export**

  Enable the MySQL target (credentials in `export.database`) once verified against a live DB.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None — `export.database` schema exists; `sqlalchemy` + driver are
  optional imports inside `_export_sql`.

  **Acceptance criteria**
  - MySQL chip selectable; `export.database` fields shown
  - `download` creates/replaces `export.database.table` with redacted rows
  - Missing driver → clear, non-crashing error message

  **Unit tests:** `tests/test_export_sql.py` — mock a MySQL engine and assert `_export_sql` calls `DataFrame.to_sql` with the correct table name and `if_exists="replace"`; assert a missing `pymysql` driver raises a user-visible error rather than an uncaught `ImportError`; assert redacted rows are passed to the SQL layer.

  **E2E:** N/A (no UI surface)

  **UAT:**
  1. Set `export.database` to a scratch MySQL instance, run `download --sample 20`. Connect to MySQL and confirm the target table exists with the expected row count.
  2. Remove the `pymysql` driver and re-run. Confirm a clear error message is shown and the process exits cleanly.
  3. In the Deliver → Output tab, confirm the MySQL chip is selectable and the database credential fields appear.

  **Verify:** point `export.database` at a scratch MySQL, run `download --sample 20`, inspect
  the table.

---

- [ ] **OUT-3 — PostgreSQL remote table export**

  Same as OUT-2 for PostgreSQL.

  **Files:** `frontend/src/pages/Sources.jsx` (`FORMATS`) · `src/data/transform.py` (`_export_sql`)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - PostgreSQL chip selectable; `export.database` fields shown
  - `download` creates/replaces the target table with redacted rows
  - Reuses the `_export_sql` path (no Postgres-specific branch needed)

  **Unit tests:** `tests/test_export_sql.py` — mock a PostgreSQL engine and assert `_export_sql` writes to the correct table without a Postgres-specific code path; assert `if_exists="replace"` behaviour; assert redacted columns are not present in the written rows.

  **E2E:** N/A (no UI surface)

  **UAT:**
  1. Set `export.database` to a scratch PostgreSQL instance, run `download --sample 20`. Connect to Postgres and confirm the target table exists with the expected row count.
  2. Run a second `download --sample 20`. Confirm the table is replaced (not duplicated).
  3. In the Deliver → Output tab, confirm the PostgreSQL chip is selectable and the database credential fields appear.

  **Verify:** point `export.database` at a scratch Postgres, run `download --sample 20`,
  inspect the table.

---

## Project management & top ribbon (UX)

> Findings from a UX audit of the project switcher / create-edit form / profile / members
> flow (shipped in #63). Grouped by impact.

### High

---

- [ ] **UX-1 — Show project color & icon**

  The create/edit form collects a color + emoji icon, but they're rendered nowhere — the
  switcher avatar still shows `name.slice(0,2)` and menu rows are text-only.

  **Files:** [frontend/src/App.jsx](../frontend/src/App.jsx) · project-menu rows · project list

  **Config/schema impact:** None — fields already persisted.

  **Acceptance criteria**
  - Icon/color shown in the switcher avatar, project-menu rows, and project list
  - Or: drop the pickers if the icon/color aren't wanted

  **Unit tests:** Vitest component test — render the project switcher with a project that has a color and emoji set; assert the avatar element displays the emoji rather than the two-letter fallback; assert the avatar background matches the project color.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — create a project with a distinctive color and emoji, switch to it, and assert the switcher avatar and menu row both show the icon/color in a baseline screenshot.

  **UAT:**
  1. Create a new project, set a color swatch and emoji icon in the form, and save. Open the project switcher and confirm the avatar displays the emoji on the chosen background color.
  2. Open the project menu and confirm the row for that project also shows the icon/color.
  3. If the pickers are removed instead, confirm no color/icon UI elements remain in the form.

---

- [ ] **UX-2 — Keyboard-accessible project switcher**

  Menu rows are `<div onClick>` with no `role`/`tabIndex`/key handlers; the trigger lacks
  `aria-expanded`/`aria-haspopup`; dropdowns don't close on `Escape`.

  **Files:** `frontend/src/App.jsx` · the project switcher dropdown

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Rows are buttons (or `role="menuitem"` + Enter/Space activation)
  - Trigger exposes `aria-expanded`/`aria-haspopup`; `role="menu"` + Escape-to-close
  - Matches the existing `Modal` focus/Escape behavior

  **Unit tests:** Vitest component test — render the switcher, simulate keyboard Tab into the trigger; assert `aria-expanded` toggles on Enter; simulate Escape and assert the dropdown closes; simulate ArrowDown and assert focus moves to the first menu item.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project switcher by keyboard, navigate to a project row with ArrowDown, activate with Enter, and assert the project switches; assert Escape closes the dropdown without switching.

  **UAT:**
  1. Tab to the project switcher trigger using only the keyboard. Press Enter and confirm the dropdown opens.
  2. Press ArrowDown to navigate to a project row, then press Enter to switch. Confirm the active project changes.
  3. Open the dropdown, then press Escape. Confirm the dropdown closes and focus returns to the trigger.

### Medium

---

- [ ] **UX-3 — Archived rows look clickable but do nothing**

  Archived project rows reuse active-row styling (hover highlight) but have no row `onClick` —
  only the gear works.

  **Files:** the project switcher / project list

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Archived rows have an explicit Unarchive affordance / row action
  - Visually de-emphasized so they don't read as switchable

  **Unit tests:** Vitest component test — render a project list containing an archived project; assert the archived row does not carry the active-row hover class; assert an "Unarchive" button or affordance is present in the row; assert clicking the row body does not trigger a project switch.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — archive a project, open the project list, and take a baseline screenshot confirming the archived row is visually de-emphasized; click the Unarchive affordance and confirm the project returns to active state.

  **UAT:**
  1. Archive a project via its settings. Open the project switcher and confirm the archived row appears visually distinct (dimmed or labelled) from active projects.
  2. Hover over the archived row and confirm no pointer-cursor or active-row highlight appears.
  3. Click the Unarchive affordance and confirm the project becomes active again.

---

- [ ] **UX-4 — Unsaved-changes guard on the project form**

  [frontend/src/pages/ProjectForm.jsx](../frontend/src/pages/ProjectForm.jsx) has no dirty
  tracking; editing Details then hitting ← Back discards silently.

  **Files:** `frontend/src/pages/ProjectForm.jsx`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Wired into the existing `dirtyRef`/`DirtyProvider` guard used for project switching
  - Back/navigate-away with unsaved edits prompts to confirm

  **Unit tests:** Vitest component test — render `ProjectForm`, change the project name field, then simulate clicking Back; assert the dirty-guard confirmation dialog appears; confirm that accepting the dialog navigates away and rejecting keeps the form open with the edited value.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — edit a project's name without saving, click Back, and assert a confirmation prompt appears; dismiss it and confirm the form remains with the unsaved change intact.

  **UAT:**
  1. Open an existing project's edit form, change the name, then click the Back button. Confirm a confirmation dialog appears warning of unsaved changes.
  2. Click "Discard" in the dialog and confirm navigation proceeds, leaving the project name unchanged.
  3. Repeat, but click "Cancel" in the dialog. Confirm you remain on the form with the edited name intact.

---

- [ ] **UX-5 — Member rows fall back to a raw UUID**

  [frontend/src/components/ProjectMembersPanel.jsx](../frontend/src/components/ProjectMembersPanel.jsx)
  renders `m.email || m.name || m.user_id`, so members without email/name show a UUID.

  **Files:** `frontend/src/components/ProjectMembersPanel.jsx` + the members endpoint

  **Config/schema impact:** None — populate email/name server-side.

  **Acceptance criteria**
  - Members show email/name, never a UUID
  - A "you" tag marks the current user

  **Unit tests:** Vitest component test — render `ProjectMembersPanel` with a member record that has no email or name (only `user_id`); assert no UUID string is rendered; render with a member that matches the current user and assert a "you" badge is present.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open a project's Members panel and take a baseline screenshot confirming all rows show a human-readable identifier and the current user's row has a "you" tag.

  **UAT:**
  1. Open the Members panel for a project. Confirm every member row shows an email address or display name, with no UUID visible.
  2. Confirm your own membership row is labelled with a "you" tag.
  3. As an admin, invite a user whose name is not yet populated server-side and confirm their row still shows a readable identifier (email at minimum).

### Low / polish

---

- [ ] **UX-6 — Inline validation for required name (ProjectForm)**

  Currently a toast only. Add an inline error + disable submit until valid.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

  **Acceptance criteria**
  - An inline error message appears beneath the name field when it is empty
  - The submit button is disabled until the name field contains at least one character

  **Unit tests:** Vitest component test — render `ProjectForm` with an empty name field; assert the submit button has the `disabled` attribute; assert an inline error message is visible; type a character and assert the button becomes enabled and the error disappears.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the create-project form, clear the name field, and attempt to submit; assert the inline error appears and the form is not submitted; enter a valid name and assert the error clears.

  **UAT:**
  1. Open the create-project form and leave the name field empty. Confirm the Submit button is disabled and an inline error is visible beneath the name field.
  2. Type a single character in the name field. Confirm the Submit button becomes enabled and the inline error disappears.
  3. Submit the form with a valid name and confirm it succeeds with no toast error.

---

- [ ] **UX-7 — Explain read-only email (ProfileForm)**

  Add "Managed by your sign-in provider" helper text so the disabled field doesn't look broken.

  **Files:** ProfileForm · **Impact:** None.

  **Acceptance criteria**
  - Helper text "Managed by your sign-in provider" (or equivalent) appears beneath the disabled email field
  - The field remains non-editable

  **Unit tests:** Vitest component test — render `ProfileForm`; assert the email input has the `disabled` attribute; assert helper text containing "sign-in provider" (or the chosen copy) is present in the rendered output.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the Profile page and take a baseline screenshot confirming the email field is disabled and helper text is visible beneath it.

  **UAT:**
  1. Open your Profile page. Confirm the email field is not editable (greyed out or disabled).
  2. Confirm helper text explaining the field is managed externally appears beneath the email input.
  3. Attempt to click into the email field and confirm no cursor or editing is possible.

---

- [ ] **UX-8 — Accessible labels on color swatches / icon buttons**

  They convey meaning by color/emoji alone; add `aria-label` + `aria-pressed` on the selected one.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

  **Acceptance criteria**
  - Each color swatch has a descriptive `aria-label` (e.g. `aria-label="Red"`)
  - The currently selected swatch has `aria-pressed="true"`; all others have `aria-pressed="false"`
  - Icon buttons follow the same pattern

  **Unit tests:** Vitest component test — render the color swatch group; assert each swatch element has a non-empty `aria-label`; select a swatch and assert it gains `aria-pressed="true"` while the previously selected one loses it.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project form, inspect color swatches with an accessibility audit, and assert no color-name-only violations; select a swatch and assert `aria-pressed` state changes are reflected.

  **UAT:**
  1. Open the create/edit project form and use a screen reader (or browser accessibility inspector) to navigate the color swatches. Confirm each swatch announces its color name.
  2. Select a swatch and confirm the screen reader announces it as "pressed" or "selected."
  3. Repeat for the emoji/icon picker buttons.

---

- [ ] **UX-9 — Global "switching…" feedback**

  A brief unified indicator while a project switch hydrates (minor now that `pull_workspace`
  is parallelized).

  **Files:** `frontend/src/App.jsx` · **Impact:** None.

  **Acceptance criteria**
  - A visible loading indicator (spinner, progress bar, or overlay) appears during project switching
  - The indicator disappears once the workspace is ready
  - No double-hydration or flicker when switching rapidly

  **Unit tests:** Vitest component test — mock `pull_workspace` to return a delayed promise; trigger a project switch and assert a loading indicator is rendered; resolve the promise and assert the indicator is gone.

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — switch between two projects and assert a loading indicator is visible during the transition; take a baseline screenshot of the final settled state.

  **UAT:**
  1. Switch to a project that has a large workspace (several data files). Confirm a loading indicator appears immediately after clicking the project row.
  2. Confirm the indicator disappears once the dashboard is ready and no content is missing.
  3. Switch projects rapidly in succession and confirm no visual glitch or double-hydration occurs.

---

## M&E capabilities

> Still-open gaps from the 2026-04-07 M&E audit. The audit's top findings have **shipped** —
> see *Shipped foundations* above. The full original audit + scorecard is archived at
> [docs/archive/2026-04-07-me-audit.md](archive/2026-04-07-me-audit.md). What remains:

---

- [ ] **ME-1 — Equity / inclusion lens**

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

  **UAT:**
  1. Add `equity_dimensions: [gender, location]` to `config.yml` and run `build-report`. Open the generated report and confirm one disaggregation section exists per indicator × dimension combination.
  2. Remove `equity_dimensions` and re-run. Confirm no disaggregation sections appear.
  3. Use a dimension column that has three distinct values and confirm the stacked/grouped bar chart shows three segments.

---

- [ ] **ME-2 — Variance / traffic-light dashboards**

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

  **UAT:**
  1. Set `warning: 70` and `critical: 50` on an indicator with a known `pct_achievement` below 50. Run `build-report` and confirm the traffic-light table marks that indicator red.
  2. Open the Validate panel and confirm below-threshold indicators are listed as flagged.
  3. Set the actual value above the warning threshold and re-run. Confirm the indicator shows green.

---

- [ ] **ME-3 — Indicator metadata catalog**

  Indicators carry computation params + `direction`, but not `unit`, `source`, `frequency`,
  or `responsible`, so the donor-style indicator reference annex can't be auto-generated.

  **Files:** `src/reports/indicators.py` · `src/reports/template_generator.py`

  **Config/schema impact:** New indicator fields (`unit`, `source`, `frequency`, `responsible`).

  **Acceptance criteria**
  - Indicators accept the metadata fields (all optional)
  - `generate-template` emits an indicator reference annex from them

  **Unit tests:** `tests/test_indicators_metadata.py` — assert that an indicator config with `unit`, `source`, `frequency`, and `responsible` fields passes validation without error; assert `generate-template` produces a template section containing those four fields for each indicator; assert indicators without metadata fields still render without error.

  **E2E:** N/A (no UI surface)

  **UAT:**
  1. Add `unit: "%"`, `source: "Household survey"`, `frequency: "annual"`, and `responsible: "M&E team"` to one indicator in `config.yml`. Run `generate-template` and confirm a reference annex section appears in the generated template with those values.
  2. Run `build-report` and confirm the annex is populated in the output report.
  3. Leave the metadata fields absent on a second indicator and confirm the report renders without error or empty placeholder artifacts.

---

- [ ] **ME-4 — Multi-form / longitudinal linkage**

  The platform connects to exactly one form. Many frameworks need baseline ↔ endline (matched
  on beneficiary ID), monitoring ↔ registration, activity ↔ outcome. Largest change here.

  **Files:** `api:` config · `src/data/extract.py` · `src/data/make.py` · indicators/charts

  **Config/schema impact:** `api:` lists multiple aliased forms.

  **Acceptance criteria**
  - `fetch-questions` + `download` produce named DataFrames per form alias
  - Indicators/charts can reference `form: baseline` vs `form: endline`
  - Enables pre/post and difference-in-differences

  **Unit tests:** `tests/test_extract_multiform.py` — mock the Kobo API to return two forms with distinct UIDs; assert `fetch-questions` produces separate question lists keyed by alias; assert `download` writes separate DataFrames for `baseline` and `endline`; assert an indicator referencing `form: baseline` reads from the correct DataFrame.

  **E2E:** N/A (no UI surface)

  **UAT:**
  1. Configure `api:` with two aliased forms (baseline and endline). Run `fetch-questions` and confirm two separate question sets appear in `config.yml`.
  2. Run `download` and confirm two named data files are written, one per alias.
  3. Define an indicator with `form: endline` and run `build-report`. Confirm the indicator value is drawn from the endline data, not the baseline.

---

- [ ] **ME-5 — Sampling weights**

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

  **UAT:**
  1. Add `weight_column: survey_weight` to an indicator and run `build-report`. Confirm the reported value differs from the unweighted value when survey weights are non-uniform.
  2. Remove `weight_column` and re-run. Confirm the value reverts to the simple mean.
  3. Add `weight_column` to a bar chart config and run `build-report`. Confirm the chart bars reflect weighted counts.

---

## Backlog — parked (out of scope for now)

> Captured so they aren't lost; not scheduled. Promote into a domain section above when picked up.

- **Skip the download when the remote is unchanged** — `run-all` already skips a stale
  build-report; skipping the *download* itself when the Kobo/Ona remote hasn't changed is a
  later slice (would need a remote content fingerprint).
- **True multi-user read isolation** — concurrent users with different active projects share
  the one `BASE_DIR` read-mirror (best-effort, last-writer-wins). Durable Minio/DB data is
  always correct; per-user read isolation is out of scope (see `CLAUDE.md` → run concurrency).
