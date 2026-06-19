# Roadmap — databridge-cli

> Consolidated planning. Each task carries: implementation · acceptance criteria · how to
> verify · config/schema impact.
> Items here are intentionally *not* enabled in the UI yet — many render as disabled "soon"
> affordances so users know they're coming.
>
> Legend: `- [ ]` todo · `- [x]` done.
> "Done" gate: see the **Definition of Done** below — back-end tests via
> `PYTHONPATH=. MPLBACKEND=Agg python -m pytest`; UI tasks via the Playwright visual harness
> (`cd frontend && npm run test:e2e`) with human-approved baselines at mobile/tablet/desktop.

---

## Definition of Ready

A card is startable only when all of the following hold:

- Acceptance criteria are concrete and testable (no vague outcomes)
- Unit tests, E2E, and UAT fields are filled with specific targets (no blank or placeholder
  text); E2E and UAT may be `N/A (reason)` for non-UI/CLI cards (UAT moves in lockstep with E2E)
- All affected files are identified
- All blocking dependencies are resolved
- Scope is limited to one deliverable
- Work is on a derived branch (`feature/ fix/ chore/`) off `develop`

## Definition of Done

- Unit tests pass (pytest green; Vitest green for frontend-only cards)
- E2E Playwright spec passes, including human-approved visual baselines at **all three
  viewports** — mobile (390×844), tablet (820×1180), desktop (1440×900) — via `toHaveScreenshot`
- Impeccable audit/critique clean (no outstanding UX or accessibility findings)
- UAT signed off by a human reviewer following the card's UAT steps — required for **UI-facing
  cards** (those with a real E2E); non-UI/CLI cards mark `UAT: N/A` and rely on the Verify
  command + unit tests + the verifier + PR review as the human gate
- All changes committed and merged to the integration branch

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Output / export formats](#output--export-formats) | 3 | 0 / 3 |
| [Project management & top ribbon (UX)](#project-management--top-ribbon-ux) | 9 | 0 / 9 |
| [M&E capabilities](#me-capabilities) | 5 | 0 / 5 |
| [Express Template Fill](#express-template-fill) | 18 | 17 / 18 |
| [Visual / E2E harness](#visual--e2e-harness) | 1 | 1 / 1 |

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

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — create a project with a distinctive color and emoji, switch to it, and assert the switcher avatar and menu row both show the icon/color in a baseline screenshot. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project switcher by keyboard, navigate to a project row with ArrowDown, activate with Enter, and assert the project switches; assert Escape closes the dropdown without switching. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — archive a project, open the project list, and take a baseline screenshot confirming the archived row is visually de-emphasized; click the Unarchive affordance and confirm the project returns to active state. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — edit a project's name without saving, click Back, and assert a confirmation prompt appears; dismiss it and confirm the form remains with the unsaved change intact. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open a project's Members panel and take a baseline screenshot confirming all rows show a human-readable identifier and the current user's row has a "you" tag. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the create-project form, clear the name field, and attempt to submit; assert the inline error appears and the form is not submitted; enter a valid name and assert the error clears. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the Profile page and take a baseline screenshot confirming the email field is disabled and helper text is visible beneath it. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project form, inspect color swatches with an accessibility audit, and assert no color-name-only violations; select a swatch and assert `aria-pressed` state changes are reflected. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — switch between two projects and assert a loading indicator is visible during the transition; take a baseline screenshot of the final settled state. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

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

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

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

  **UAT:** N/A (no UI surface — verified via unit tests, the verifier, and PR review).

---

## Express Template Fill

> An **optional fast-path** alongside the default 5-step pipeline (download → Questions →
> Composition → template → build-report). The user uploads a finished Word template with
> placeholders in `[ ]`, `[[ ]]`, or `{{ }}`; one batched LLM call infers a config-shaped spec
> per placeholder from the data-aware catalog; specs are validated locally (reusing Ask-engine
> rules), reviewed/approved by the user, persisted into `config.yml`, and the template is
> resolved into a normal docxtpl template — after which the **existing `build-report` runs
> unchanged**. The 5-step pipeline stays the default; this is additive and discoverable via a
> banner/button. Full design: [docs/superpowers/specs/2026-06-18-express-template-fill-design.md](superpowers/specs/2026-06-18-express-template-fill-design.md).
>
> Cards are dependency-ordered: XTF-2 depends on XTF-1; XTF-3 depends on XTF-1+XTF-2; XTF-4
> depends on XTF-1–XTF-3; XTF-5 depends on XTF-1–XTF-4.

---

- [x] **XTF-1 — Placeholder extraction from .docx (`extract_placeholders`)**

  Parse all three delimiters out of an uploaded `.docx` into structured `Token`s. Pure
  function, no AI, no network. Foundation for the rest of the express path.

  **Files:** `src/reports/template_inference.py` (new — `extract_placeholders`, `Token`) ·
  `tests/test_template_inference.py` (new)

  **Config/schema impact:** None — read-only over an uploaded `.docx`.

  **Acceptance criteria**
  - Walks body paragraphs, table cells, headers, and footers; reconstructs full paragraph text
    by concatenating runs so tokens split across runs are still matched
  - Matches `[[ … ]]`, then `[ … ]`, then `{{ … }}` in that precedence (a `[[x]]` token is
    matched once as `[[x]]`, never double-matched as `[x]`)
  - Each `Token` records `raw`, `inner` (trimmed inner text), `delimiter`, and a `location`
    (paragraph + run-span reference sufficient to rewrite the token later)
  - A `{{ }}` token whose `inner` matches a known literal placeholder (`report_title`, `period`,
    `n_submissions`, `generated_at`, `summary_text`, `observations`, `recommendations`,
    `chart_*`, `ind_*` incl. `_table`/`_breakdown`, `summary_*`, `table_*`, `data_quality*`,
    `logframe*`, `provenance.footer`) is marked `kind: literal` and left untouched
  - All non-literal tokens are returned for downstream inference

  **Unit tests:** `tests/test_template_inference.py` — build `.docx` fixtures programmatically
  with `python-docx`. Cases: each delimiter matched individually; precedence (`[[Total]]` is one
  token, not `[Total]`); a token whose characters span multiple runs is matched as one token;
  tokens located in a table cell, a header, and a footer are all extracted; a `{{ chart_sales }}`
  / `{{ report_title }}` literal is returned with `kind: literal` and unchanged `raw`; a
  `{{ unknown thing }}` non-literal is returned as an NL token; `location` round-trips (the
  recorded run-span identifies the same runs).

  **E2E:** N/A (no UI surface — pure parsing function)

  **UAT:**
  1. Create a `.docx` containing one placeholder of each delimiter in the body, one in a table
     cell, one in a header, and one in a footer. Call `extract_placeholders` and confirm all
     five are returned.
  2. Hand-type a placeholder so Word splits it across runs (e.g. autocorrect/formatting), and
     confirm it is still returned as a single token.
  3. Include `{{ report_title }}` and confirm it comes back marked `literal` with its `raw`
     text unmodified.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k extract`

---

- [x] **XTF-2 — Batched inference + local validation (`infer_specs`, `annotate_proposals`)**

  One batched LLM call turns NL placeholders + the data catalog into config-shaped `Proposal`s,
  then deterministic local validation flags anything unsupported. Depends on **XTF-1**.

  **Files:** `src/reports/template_inference.py` (`infer_specs`, `annotate_proposals`) ·
  `src/utils/seed_prompts.py` (add `template_inference` seed with `output_schema`) ·
  `CLAUDE.md` + `docs/reference/prompts.md` (document the new `template_inference` prompt site) ·
  `tests/test_template_inference.py`

  **Config/schema impact:** None to `config.yml` schema. Adds one new prompt site
  (`template_inference`) to `SEED_PROMPTS`.

  **Acceptance criteria**
  - The new `template_inference` prompt site is documented in `CLAUDE.md` (prompt count/list)
    and the `docs/reference/prompts.md` prompt↔file↔contract table
  - `infer_specs(nl_tokens, catalog, ai_cfg)` makes a single batched call via
    `lf_client.get_prompt("template_inference", vars)` + `lf_client.chat(trace_name=
    "template_inference", json_mode=True)`, where `catalog` is `ask_engine.build_catalog`
  - Returns one `Proposal` per token: `{token_index, kind ∈ chart|indicator|summary|table|
    narrative|metadata, spec (config-shaped dict), name (canonical slug), confidence 0..1,
    reason}`
  - `template_inference` seed exists in `seed_prompts.py` with a JSON `output_schema` so it works
    offline via the bundled seed
  - `annotate_proposals(proposals, profile)` reuses `validate_recipe` / `CHART_REQS` /
    `INDICATOR_STATS` from `ask_engine.py` to set `status: ok` or `status: needs_attention`
    with a human-readable reason
  - `needs_attention` is set when confidence is low, validation fails, or a referenced column is
    absent from the downloaded data
  - Canonical `name`s are deduped (suffix on collision)
  - narrative kinds map to a fixed slot (`summary_text`/`observations`/`recommendations`) when
    the text clearly matches, else a `summaries` entry with `stat: ai` + `prompt` = placeholder
    text; metadata maps to `report.title`/`report.period`/etc.

  **Unit tests:** `tests/test_template_inference.py` — mock the LLM call like the existing
  suggester tests (`tests/` AI-suggester pattern). Cases: `annotate_proposals` flags a proposal
  with confidence below threshold as `needs_attention`; flags a proposal whose `spec` references
  a column absent from the profile; flags a bad type/column combo (scatter spec with only one
  quantitative column) via `validate_recipe`/`CHART_REQS`; passes a valid bar/indicator/summary
  proposal as `status: ok`; two proposals resolving to the same slug get suffixed distinct
  `name`s; a narrative token matching "recommendations" maps to the `recommendations` slot while
  a free-form narrative maps to a `summaries` entry with `stat: ai`; `infer_specs` issues exactly
  one `lf_client.chat` call for N tokens (assert call count == 1).

  **E2E:** N/A (no UI surface — back-end inference/validation)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k "infer or annotate"`

---

- [x] **XTF-3 — Apply: persist config + resolve template (`apply_inference`)**

  Write approved specs into `config.yml` without clobbering, and rewrite each token's run span to
  a single clean `{{ canonical }}` run so docxtpl renders it (critical for charts). Depends on
  **XTF-1** and **XTF-2**.

  **Files:** `src/reports/template_inference.py` (`apply_inference`) ·
  `tests/test_template_inference.py`

  **Config/schema impact:** None — appends to existing `charts`/`indicators`/`summaries`/`report`
  sections using the established config shapes via `write_config`.

  **Acceptance criteria**
  - `apply_inference(approved, cfg, template_path) -> (cfg, resolved_template_path)`
  - Appends/merges each approved spec into the correct config section
    (`chart_<slug>`/`ind_<slug>`/`summary_<slug>`/`table_<slug>`, narrative slots, `report.*`)
  - Never clobbers existing user-authored entries; dedupes by name (suffix on collision)
  - Each token's run span is replaced by a single clean `{{ canonical }}` run, with the other
    runs in the span cleared — so every chart placeholder is exactly one unbroken XML run
  - Resolved `.docx` is saved as the project template; the original upload is preserved alongside
    it; the resolved path is returned
  - Output template is consumable by the unchanged `build-report` (no build-report changes)

  **Unit tests:** `tests/test_template_inference.py` — Cases: `apply_inference` writes a chart
  proposal into `config["charts"]` and an indicator into `config["indicators"]` with the expected
  shapes; pre-seed config with a user-authored `chart_existing` and assert it survives apply
  (no clobber) while the new entry is appended; two approved specs with the same base slug are
  written under distinct suffixed names; open the resolved `.docx` with `python-docx` and assert
  the chart placeholder occupies exactly one run (run count == 1 for that paragraph's placeholder)
  with text `{{ chart_<slug> }}`; assert the original uploaded `.docx` still exists after apply.

  **E2E:** N/A (no UI surface — config + docx resolution)

  **UAT:** N/A (no UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k apply`

---

- [x] **XTF-4 — CLI commands (`infer-template`, `apply-template`)**

  Two-phase CLI so review can happen between inference and apply, with a JSON proposal artifact
  and an optional `--build` chain. Depends on **XTF-1**, **XTF-2**, **XTF-3**.

  **Files:** `src/data/make.py` (`infer-template`, `apply-template` Click commands) ·
  `web/main.py` (`ALLOWED_COMMANDS` + allowed flags) · `tests/test_template_inference.py`

  **Config/schema impact:** None. Two new whitelisted commands in `ALLOWED_COMMANDS`.

  **Acceptance criteria**
  - `infer-template --template <file> [--out reports/.template_inference.json]` runs
    `extract_placeholders` → `infer_specs` → `annotate_proposals`, writes the proposal list to
    the `--out` JSON, and prints a summary table (placeholder → kind / name / status)
  - `infer-template` errors clearly when no AI provider/key is configured, and when no data has
    been downloaded (local validation needs real columns)
  - `apply-template [--from reports/.template_inference.json] [--build]` reads the (possibly
    user-edited) proposals, drops any still flagged/unapproved, runs `apply_inference` (writes
    config + resolved template); with `--build` it chains into `build-report`
  - Both commands added to `ALLOWED_COMMANDS` in `web/main.py` with only their allowed flags
  - Zero placeholders found → a friendly no-op message, non-error exit

  **Unit tests:** `tests/test_template_inference.py` — invoke commands via Click's
  `CliRunner` with the LLM mocked. Cases: `infer-template` writes the `--out` JSON with one
  entry per non-literal token and exits 0; `infer-template` with no AI config exits non-zero with
  a message naming the AI provider requirement; `infer-template` with no downloaded data exits
  with the "run Download first" message; `apply-template --from <json>` writes config + resolved
  template and drops a `needs_attention` proposal that was not approved; `apply-template --build`
  invokes the `build-report` path (assert the chained call via `ctx.invoke`/mock); a template
  with zero placeholders prints the no-op message and exits 0; assert both command names are in
  `ALLOWED_COMMANDS`.

  **E2E:** N/A (no UI surface — CLI commands; the UI flow is covered by XTF-5)

  **UAT:** N/A (CLI, no web-UI surface — verified via the Verify command, unit tests, the verifier, and PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k "cli or command"`

---

- [x] **XTF-5 — Web review/approve panel + discoverability**

  The user-facing card: a Templates-tab review/approve panel over the proposals, the two API
  endpoints, and a discoverability banner/button. Depends on **XTF-1**, **XTF-2**, **XTF-3**,
  **XTF-4**.

  **Files:** `web/main.py` (`POST /api/template/infer`, `POST /api/template/apply`;
  `ALLOWED_COMMANDS`) · `frontend/src/pages/Templates.jsx` (review/approve panel) ·
  `frontend/src/pages/Dashboard.jsx` (discoverability banner/button) ·
  `tests/test_template_api.py` (new) · `frontend/tests/e2e/express-template-fill.spec.ts` (new
  Playwright spec)

  **Config/schema impact:** None — endpoints proxy the `template_inference` module + existing
  run endpoint.

  **Acceptance criteria**
  - `POST /api/template/infer` (multipart upload or existing-template ref) loads the latest
    session and runs parse → infer → annotate, returning `{proposals, message?}`
  - Precondition payloads are friendly: no AI provider/key →
    "Configure an AI provider to use Express fill."; no downloaded data →
    "No data yet — run Download first."
  - `POST /api/template/apply` `{proposals}` runs `apply_inference` and returns
    `{ok, template, n_written}`; the client then calls the existing `build-report` run endpoint
  - Templates tab shows a review table: placeholder → proposed kind / canonical name / spec, with
    `needs_attention` rows highlighted and showing the reason; each row is editable
    (kind/spec/name) or droppable
  - **Apply & build** is disabled while any row is `needs_attention` (unless the user drops the
    flagged ones); loading/empty/error states mirror `Validate.jsx` / `Ask.jsx`
  - A discoverability banner/button on Dashboard + Templates ("In a hurry? Upload a template and
    let AI fill it →") opens the express flow; the 5-step pipeline remains the default and
    unchanged
  - Impeccable audit/critique clean on the new panel (no UX/accessibility findings)

  **Unit tests:** `tests/test_template_api.py` — `/api/template/infer` returns the no-AI message
  payload when no provider is configured; returns the "run Download first" payload when no data
  exists; returns `{proposals: [...]}` (LLM mocked) when AI + data are present; resolves an
  existing-template ref (not just a multipart upload) to the correct stored template;
  `/api/template/apply` with approved proposals writes config and returns
  `{ok, template, n_written}` with the resolved template path. (Plus a Vitest component test for
  the Templates panel: a `needs_attention` row disables **Apply & build** until edited or
  dropped.)

  **E2E:** Playwright spec `frontend/tests/e2e/express-template-fill.spec.ts` + visual (impeccable
  audit/critique + `toHaveScreenshot`) — click the discoverability banner → upload a template →
  infer → assert the review panel shows the placeholder → kind/name mapping with a flagged row
  highlighted → edit/resolve the flagged row → assert **Apply & build** enables → click it →
  assert the report downloads. Capture a `toHaveScreenshot` baseline of the review panel
  (flagged + resolved states) at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. From the Dashboard, click the "In a hurry?" banner. Confirm the express flow opens and the
     5-step pipeline is still the default elsewhere.
  2. Upload a template and run infer. Confirm the review panel lists each placeholder with its
     proposed kind/name and that low-confidence/invalid rows are highlighted with a reason.
  3. Edit or drop the flagged row, confirm **Apply & build** enables, click it, and confirm a
     report is produced. Then run infer with no AI provider and confirm the friendly
     "Configure an AI provider" message appears instead of a crash.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py` ·
  Playwright: `npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-6 — Fix: persist the uploaded template across infer → apply**

  Bug found in review: `POST /api/template/infer` writes the uploaded `.docx` to a throwaway
  temp file and never persists it; the panel then calls `POST /api/template/apply` with only the
  client `file.name`, which `apply` resolves by basename against `TEMPLATES_DIR` — where a
  freshly-uploaded file was never stored. So apply hits a non-existent path and can't resolve the
  template. The network-mocked XTF-5 tests missed it (both endpoints / `apply_inference` mocked).
  Independent of XTF-7.

  **Files:** `web/main.py` (`api_template_infer` persists the upload + returns a stable ref;
  `api_template_apply` resolves that ref) · `frontend/src/pages/Templates.jsx` (carry the
  infer-returned ref into apply instead of `file.name`) · `tests/test_template_api.py` (real,
  un-mocked infer→apply integration test) · `frontend/tests/e2e/express-template-fill.spec.ts`
  (update the infer route-mock to return the ref so the flow contract stays valid)

  **Config/schema impact:** None. Uploaded templates are persisted under `TEMPLATES_DIR` (or a
  per-session dir) — same storage the normal template upload uses.

  **Acceptance criteria**
  - `api_template_infer` persists the uploaded `.docx` to a stable location and returns a
    resolvable `template` ref in its response (alongside `proposals`)
  - The panel carries that returned ref into `api_template_apply` (no longer the bare client
    `file.name`)
  - `api_template_apply` resolves the persisted file and runs `apply_inference` against it; if the
    ref cannot be resolved it returns a clear error (no traceback / no silent wrong-path)
  - A real **un-mocked** integration test exercises infer→apply end to end (only the LLM seam
    mocked, NOT `apply_inference`/`extract_placeholders`): the resolved template exists and config
    is written
  - The `express-template-fill.spec.ts` E2E is extended so its infer route-mock returns the ref
    and the full upload → Infer → approve → Apply&build flow reaches success (not an apply error)

  **Unit tests:** `tests/test_template_api.py::test_infer_apply_roundtrip_real` — a real
  infer→apply integration test: POST a multipart `.docx` to `/api/template/infer` (LLM/`infer_specs`
  mocked, but `extract_placeholders` and the persistence path real), capture the returned
  `template` ref, POST it with approved proposals to `/api/template/apply` calling the REAL
  `apply_inference`, and assert the resolved `.docx` exists on disk + config gained the chart
  section + response `{ok, template, n_written}`. Plus a negative case: apply with an unresolvable
  ref returns a clear error, not a 500 traceback.

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual — drive the full
  upload → Infer → approve → **Apply&build** flow with the infer route-mock returning the persisted
  template ref; assert apply succeeds (`express-success` shows the resolved name) rather than
  erroring. `toHaveScreenshot` baseline of the success state at all three viewports (mobile
  390×844, tablet 820×1180, desktop 1440×900). impeccable audit/critique clean on the changed flow.

  **UAT:**
  1. Templates → Express fill. Click "Choose .docx" and pick a template that has NOT been
     previously uploaded/saved. Confirm its name appears.
  2. Click Infer; wait for the proposal rows; click **Apply & build**.
  3. Expected: the success banner shows the resolved template name and a build-report run starts —
     no "Apply failed" / path error; the report appears under the Reports tab.
  4. Tamper the apply ref (devtools) to a name that does not exist server-side and confirm a clear
     inline error, not a 500/traceback.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py -k "upload or apply or infer"`

---

- [x] **XTF-7 — Gate the Express "Infer" button on AI-tested status (parity with other AI buttons)**

  The Express **Infer** button is enabled as soon as a file is chosen (`disabled={!file || loading}`)
  — unlike every other interactive AI control, which stays disabled until the AI connection is
  configured **and** verified via `/api/ai/test` (`useAiStatus().aiReady` + `AI_LOCK_TIP`). Bring
  Infer to parity so users get the same "Test the AI connection first" affordance instead of
  clicking into a backend error message. Independent of XTF-6.

  **Files:** `frontend/src/pages/Templates.jsx` (`useAiStatus`; `disabled={!aiReady || !file || loading}`;
  `AI_LOCK_TIP` tooltip when locked) · `frontend/tests/e2e/express-template-fill.spec.ts` (assert
  the gate via mocked `/api/ai/status`)

  **Config/schema impact:** None — reuses the existing `/api/ai/status` + `aiStatus` context.

  **Acceptance criteria**
  - With AI not configured/verified (`/api/ai/status` → `aiReady:false`), the Infer button is
    disabled and exposes the `AI_LOCK_TIP` ("Test the AI connection first …") tooltip, even when a
    file is chosen
  - With `aiReady:true`, Infer enables once a file is chosen (current behavior preserved)
  - The discoverability banner still opens the flow regardless (it triggers no AI call); only Infer
    is gated
  - Matches the lock/tooltip pattern used by the Composition suggester buttons

  **Unit tests:** N/A (frontend-only gating; Vitest is not installed — the gate is asserted by the
  Playwright E2E below, consistent with XTF-5's Apply&build gating coverage).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual — mock
  `/api/ai/status` → `{aiReady:false}` and assert Infer is `disabled` with the lock tooltip; then
  `{aiReady:true}` and assert it enables after choosing a file. Capture a `toHaveScreenshot`
  baseline of the locked state at all three viewports (mobile 390×844, tablet 820×1180, desktop
  1440×900). impeccable audit/critique clean on the changed control.

  **UAT:**
  1. With no AI provider configured (or configured but not tested), open Templates → Express fill.
     Confirm the **Infer** button is disabled and hovering shows "Test the AI connection first".
  2. Configure + test the AI connection (Extract → AI configuration). Return to Express fill,
     choose a `.docx`, and confirm **Infer** is now enabled.
  3. Confirm the "In a hurry?" banner still opens the Express flow even when AI is untested.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-8 — Fix: Express apply persists the resolved template to durable storage + a relative `report.template`**

  Bug found in review: `api_template_apply` (web/main.py ~2562) sets
  `cfg["report"]["template"]` to the **absolute** resolved path and never `put_project_file`s the
  resolved `.docx`. Web runs hydrate `templates/` from Minio into an isolated tempdir
  (`hydrate_run_dir`, `web/storage/workspace.py` ~145), so build-report can't find the file — and
  `sanitize_run_config` (~121) pins `export`/`report` output dirs but not `report.template`, so the
  absolute host-mirror path is read stale ("cached"). Fix: apply writes the resolved `.docx` under
  `TEMPLATES_DIR`, sets `report.template` to a **relative** `templates/<name>.resolved.docx`, and
  pushes it to durable storage via `storage_workspace.put_project_file(org_id, project_id,
  "templates", path)` — mirroring `set_active_template` (~2078). `delete_template` (~2054) clears /
  repoints `report.template` when the deleted file is the active one. Priority card; XTF-13 depends
  on it. Independent of XTF-9–XTF-12. Depends on **XTF-1–XTF-7** (shipped).

  **Files:** `web/main.py` (`api_template_apply` ~2532, `delete_template` ~2054) ·
  `web/storage/workspace.py` (`sanitize_run_config` — pin `report.template` to its relative form) ·
  `tests/test_template_api.py`

  **Config/schema impact:** None to the schema. `report.template` is now stored as a relative
  `templates/<name>` ref (the shape `set_active_template` already writes), not an absolute path.

  **Acceptance criteria**
  - After `/api/template/apply`, `cfg["report"]["template"]` is a **relative** path of the form
    `templates/<name>.resolved.docx` (no absolute path, no `..`)
  - The resolved `.docx` exists under `TEMPLATES_DIR` **and** has been pushed to durable storage via
    `put_project_file(... "templates" ...)` (so a subsequent run's `hydrate_run_dir` pulls it)
  - `sanitize_run_config` leaves the relative `report.template` intact (does not blank or absolutize
    it) so the hydrated tempdir resolves the same file build-report loads
  - `delete_template` on the file currently referenced by `report.template` clears or repoints the
    ref (no dangling absolute/relative path left in config)
  - The `/api/template/apply` response still returns `{ok, template, n_written}`; `template` is the
    relative ref

  **Unit tests:** `tests/test_template_api.py` — (1) `test_apply_persists_relative_template`: with
  `apply_inference` real (only the LLM/`infer_specs` seam mocked), POST approved proposals to
  `/api/template/apply` and assert `report.template` in the written config is relative
  (`templates/…`, not absolute) AND the resolved file was pushed to storage (assert via a fake/spy
  storage backend that `put_project_file` was called with category `"templates"` and the resolved
  filename). (2) `test_sanitize_run_config_keeps_relative_template`: `sanitize_run_config` on a cfg
  with `report.template: templates/x.resolved.docx` returns the same relative value. (3)
  `test_delete_active_template_clears_ref`: set `report.template` to a template, `DELETE
  /api/templates/<name>`, assert `report.template` is cleared/repointed (not dangling).

  **E2E:** N/A (back-end persistence/path fix — no UI surface of its own; the express UI flow is
  covered by XTF-5/XTF-6; human gate is the un-mocked integration test + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py -k "apply or sanitize or delete"`

---

- [x] **XTF-9 — Gate the "In a hurry?" Express banner on questions + data**

  The `ExpressBanner` (frontend/src/pages/Templates.jsx ~14) always renders enabled, but inference
  can't validate proposals without real columns — `/api/template/infer` returns the
  `EXPRESS_NO_DATA_MESSAGE` precondition when no data is downloaded. Disable the banner with a hint
  until `has_questions` **and** `has_data` are both true, reusing the readiness flags from
  `GET /api/state` (web/main.py ~1790–1821, already returning `has_questions`/`has_data`). Depends on
  **XTF-1–XTF-7** (shipped). Independent of XTF-8.

  **Files:** `frontend/src/pages/Templates.jsx` (`ExpressBanner` — fetch/consume `/api/state`
  readiness, disabled state + hint) · `frontend/src/pages/Dashboard.jsx` (the Dashboard surface of
  the banner, if it renders one) · `frontend/tests/e2e/express-template-fill.spec.ts`

  **Config/schema impact:** None — reuses the existing `/api/state` readiness flags.

  **Acceptance criteria**
  - When `/api/state` reports `has_questions:false` OR `has_data:false`, the Express banner is
    disabled (not actionable) and shows a hint explaining what's needed first (e.g. "Download data
    and configure questions before using Express fill")
  - When both flags are `true`, the banner is enabled and opens the Express flow exactly as today
  - The banner's `data-testid="express-banner"` is preserved; disabled state is exposed
    accessibly (`disabled` / `aria-disabled` + the hint reachable to assistive tech)
  - Impeccable audit/critique clean on the gated banner (disabled affordance reads as intentionally
    unavailable, not broken)

  **Unit tests:** N/A (frontend-only gating; Vitest is not installed — the gate is asserted by the
  Playwright E2E below, consistent with XTF-7's gating coverage).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — mock `/api/state` → `{has_questions:false, has_data:false}`
  and assert the banner is disabled with the hint visible and does not open the flow on click; then
  mock `{has_questions:true, has_data:true}` and assert the banner is enabled and opens the Express
  flow. Capture a `toHaveScreenshot` baseline of the gated (disabled+hint) state at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. In a project with no downloaded data, open Templates. Confirm the "In a hurry?" banner is
     visibly disabled and shows a hint telling you to download data / configure questions first, and
     clicking it does nothing.
  2. Configure questions and run Download. Return to Templates and confirm the banner is now enabled.
  3. Click the enabled banner and confirm the Express flow opens.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-10 — Replace the run badge with a fixed "report building…" alert + stop/cancel**

  Today an active run shows a small `run-indicator` button in the top nav (App.jsx ~323–329) that
  only toggles the terminal — there is no way to cancel a run from the UI even though
  `POST /api/stop/{run_id}` (web/main.py ~1773) and `useCommand`'s `stop` (with `runIdRef` from the
  SSE `run_id`, frontend/src/hooks/useCommand.js ~95) already exist. `lib/run.js`'s `RunContext` and
  App's `RunProvider` (App.jsx ~366) currently expose only `{run, running, activeCmd}` — `stop` is
  dropped. Replace the badge with a fixed, prominent alert shown whenever a run is active, carrying a
  stop/cancel control wired to the stop endpoint. Applies to express **and** normal runs. Depends on
  **XTF-1–XTF-7** (shipped). Independent of XTF-8/9.

  **Files:** `frontend/src/App.jsx` (destructure `stop` from `useCommand`; render the fixed alert in
  place of `run-indicator`; pass `stop` through `RunProvider`) · `frontend/src/lib/run.js`
  (add `stop` to the `RunContext` default + provider contract) · `frontend/src/hooks/useCommand.js`
  (already returns `stop` — no behavior change expected) · `frontend/src/styles.css` (alert styles) ·
  `frontend/tests/e2e/express-template-fill.spec.ts` (or a small new spec for the alert)

  **Config/schema impact:** None — reuses `POST /api/stop/{run_id}`.

  **Acceptance criteria**
  - Whenever `running` is true, a fixed alert (e.g. a top-of-app banner) is shown reading the active
    command (e.g. "Building report…"); the old `run-indicator` nav badge is removed
  - The alert has a visible Stop/Cancel control; clicking it calls `useCommand.stop()`, which POSTs
    to `/api/stop/{run_id}` (falling back to `/api/stop` when no `run_id` yet)
  - `stop` is exposed through `RunContext`/`RunProvider` so any run trigger (express Apply&build and
    the normal Build report) is cancellable from the same alert
  - When the run ends (success or error) the alert disappears
  - The alert is accessible (`role="status"` or `role="alert"` as appropriate; the stop button is a
    real `<button>` with an accessible label)
  - Impeccable audit/critique clean on the alert + stop control

  **Unit tests:** N/A (frontend-only; Vitest is not installed — covered by the Playwright E2E below).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend, or a new
  `frontend/tests/e2e/run-alert.spec.ts`) + visual (impeccable audit/critique + `toHaveScreenshot`) —
  mock `/api/run/build-report` to stream a long-lived SSE `running` status (including a `run_id`),
  trigger a build, and assert the fixed alert + Stop button are visible (and the old nav badge is
  gone); click Stop and assert `POST /api/stop/{run_id}` is called with that id; then emit a terminal
  status and assert the alert disappears. Capture a `toHaveScreenshot` baseline of the active-run
  alert at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build (Reports → Build report, or Express Apply&build). Confirm a prominent fixed alert
     appears reading that a report is building, with a Stop/Cancel button (no small nav badge).
  2. Click Stop and confirm the run is cancelled (terminal shows it stopped) and the alert clears.
  3. Start another build and let it finish normally; confirm the alert disappears on completion.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-11 — Terminal: show ~5s during a build then auto-collapse; auto-expand on error**

  Today `onStatus` (App.jsx ~146–166) opens the terminal on `running`, and on `success` collapses it
  after a fixed 1400 ms; on `error` it forces it open. Change the build behavior so the terminal
  opens when a build run starts, stays visible for a short delay (default ~5s), then auto-collapses to
  its minimized bar **while the run continues** — and if the run ENDS IN ERROR, auto-expands again so
  the failure log is visible. Applies to express **and** normal builds. The delay MUST be testable
  without a real 5s wait (e.g. a module-level constant overridable via a test hook / Playwright fake
  timers — note this in the implementation). Depends on **XTF-1–XTF-7** (shipped). Independent of
  XTF-8/9/10.

  **Files:** `frontend/src/App.jsx` (`onStatus` open/collapse timing; replace the 1400 ms success
  collapse with the open→~5s→collapse-on-running behavior + auto-expand on error; expose the delay as
  an overridable constant) · `frontend/src/components/BottomTerminal.jsx` (collapse-to-bar /
  expand affordance hooks if needed) · `frontend/tests/e2e/express-template-fill.spec.ts` (or a new
  terminal spec)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - On a build run starting, the terminal opens; after the configured delay (default ~5s) it
    auto-collapses to the minimized bar **even though the run is still running**
  - If the run subsequently ends in **error**, the terminal auto-expands to show the failure
  - On a clean **success**, the terminal stays collapsed (it already collapsed during the run); no
    second flicker
  - The delay is driven by an overridable constant so tests can set it to a few ms — no real 5s wait
    in the E2E
  - Manual toggling (the nav terminal button / clicking the bar) still works and is not overridden by
    the auto-timing while the user has it open

  **Unit tests:** N/A (frontend-only timing; Vitest is not installed — covered by the Playwright E2E
  below using a short test-config delay / fake timers).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend, or a new
  `frontend/tests/e2e/terminal-collapse.spec.ts`) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — with the auto-collapse delay set to a few ms (test hook), drive a mocked
  long-running build: assert the terminal is open right after `running`, then assert it has collapsed
  to the bar (`[data-open="false"]`) after the delay while the run is still streaming; then emit an
  `error` status and assert the terminal auto-expands (`[data-open="true"]`). Capture a
  `toHaveScreenshot` baseline of both the collapsed-during-run state and the auto-expanded error state
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build. Confirm the terminal opens and shows the run starting.
  2. Wait ~5 seconds and confirm it collapses to the slim bottom bar while the build keeps running.
  3. Trigger a build that fails (e.g. no charts configured) and confirm the terminal auto-expands so
     you can read the error.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-12 — Reports page: "Delete all reports" + bulk-delete endpoint**

  `Reports.jsx` deletes reports one at a time (`deleteReport`, ~82) against
  `DELETE /api/reports/{filename}` (web/main.py ~1845, editor-gated). There is no bulk delete. Add a
  bulk `DELETE /api/reports` endpoint (same editor/admin RBAC as the single delete) and a "Delete all
  reports" button on the Reports page with a confirm dialog. Depends on **XTF-1–XTF-7** (shipped).
  Independent of XTF-8–XTF-11.

  **Files:** `web/main.py` (new `DELETE /api/reports` bulk handler near ~1845, `_require(request,
  "editor")`) · `frontend/src/pages/Reports.jsx` (a "Delete all" button + confirm, reusing the
  existing `confirm` dialog pattern at ~82–84; hidden/disabled for viewers via the existing `canEdit`
  gate) · `tests/test_reports_api.py` (new) · `frontend/tests/e2e/reports-delete-all.spec.ts` (new,
  or extend an existing reports spec)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `DELETE /api/reports` deletes **all** `.docx` files in `REPORTS_DIR` and returns a count (e.g.
    `{ok: true, deleted: N}`); deleting an empty reports dir is a non-error no-op (`deleted: 0`)
  - The endpoint enforces editor/admin RBAC via `_require(request, "editor")` (a viewer gets 403),
    matching the single-file delete
  - Reports page shows a "Delete all reports" button that is hidden/disabled for viewers (existing
    `canEdit` gate) and prompts a confirm before deleting
  - After confirming, the report list empties and the empty-state copy shows
  - Impeccable audit/critique clean on the new control (destructive styling + clear confirm copy)

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_delete_all_reports_removes_files`: seed
  `REPORTS_DIR` with two `.docx` files, `DELETE /api/reports` as editor, assert 200 with
  `deleted:2` and the dir is empty afterward. (2) `test_delete_all_reports_empty_noop`: with no
  reports, assert 200 with `deleted:0` and no error. (3) `test_delete_all_reports_rbac`: a viewer
  caller gets 403 and files are untouched.

  **E2E:** `frontend/tests/e2e/reports-delete-all.spec.ts` (new) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — mock `/api/reports` to list two reports, mock `DELETE /api/reports` to
  succeed; click "Delete all reports", confirm in the dialog, and assert the list empties and the
  empty-state appears; assert the bulk `DELETE /api/reports` was called once. Capture a
  `toHaveScreenshot` baseline of the populated list with the "Delete all" button and of the confirm
  dialog at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Build two or more reports so the Reports list is populated. Confirm a "Delete all reports"
     button is visible (as an editor/admin).
  2. Click it, confirm the warning dialog, and confirm all reports disappear and the empty-state
     message shows.
  3. As a viewer, confirm the "Delete all reports" control is hidden or disabled.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py` ·
  `cd frontend && npx playwright test reports-delete-all.spec.ts`

---

- [x] **XTF-13 — Build options for Express & regular build: split-by (main-table columns) + sample preview (`--split-sample`)**

  Expose two build options on both build surfaces: a **split-by** selector populated with
  **main-table `export_label`s only** (not repeat-group columns) and a "build all (default) vs first
  N groups" sample-preview option mapping to `--split-sample N`, with discoverability copy so users
  know they can preview before a full split build. Both must reach (a) the Express Apply&build chain
  (Templates.jsx `applyAndBuild` ~87 → `/api/template/apply` then `run('build-report')` ~103) and
  (b) the regular build trigger (`Reports.jsx` ~115 `onClick: () => run('build-report')`). **Two
  gaps to fix:** `--split-sample` is NOT in `ALLOWED_COMMANDS["build-report"]` (web/main.py ~474 —
  currently `["--sample","--split-by","--session","--period","--compare"]`) and `useCommand.run`
  (frontend/src/hooks/useCommand.js ~26–33) does not forward a `split_sample` opt, so both must be
  added (CLI flag `--split-sample` already exists in `src/data/make.py` ~323 and `RunPayload` needs a
  `split_sample` field, web/main.py ~480). **Depends on XTF-8** (clean relative template resolution
  is required for the Express build to actually run) and **XTF-1–XTF-7** (shipped). The express and
  regular surfaces are similar enough (both call `run('build-report')` / `/api/run/build-report`) to
  ship as one deliverable behind a shared "build options" control; not split.

  **Files:** `web/main.py` (`ALLOWED_COMMANDS["build-report"]` add `--split-sample`; `RunPayload`
  add `split_sample`; map it into the build-report arg list) · `frontend/src/hooks/useCommand.js`
  (forward `opts.split_sample` into the request body) · `frontend/src/pages/Templates.jsx`
  (`ExpressFlow` — split-by + sample-preview control; pass to apply chain's `run('build-report',
  opts)`) · `frontend/src/pages/Reports.jsx` (build-options control on the regular Build trigger ~115)
  · a small shared options component if warranted · `tests/test_run_api.py` (new, or extend
  `tests/test_template_api.py`) · `frontend/tests/e2e/express-template-fill.spec.ts`

  **Config/schema impact:** None to `config.yml`. Adds `--split-sample` to the build-report
  whitelist and a `split_sample` field on `RunPayload` (already a CLI flag).

  **Acceptance criteria**
  - The split-by selector is populated **only** with main-table `export_label`s (questions whose
    `group` is the main table — repeat-group columns are excluded), sourced from the questions/config
    or an existing catalog endpoint
  - A sample-preview control offers "Build all groups (default)" vs "First N groups", mapping the
    chosen N to `--split-sample N`; discoverability copy explains it previews before a full build
  - `ALLOWED_COMMANDS["build-report"]` includes `--split-sample`; `RunPayload.split_sample` is
    accepted and forwarded into the build-report command line
  - `useCommand.run('build-report', {split_by, split_sample})` includes both in the POST body
  - The Express Apply&build chain passes the selected `split_by`/`split_sample` into its
    `run('build-report', …)` call; the regular Build trigger does the same
  - Selecting no split-by / "build all" produces the current behavior (no `--split-by`/no
    `--split-sample`)
  - Impeccable audit/critique clean on the new options control

  **Unit tests:** `tests/test_run_api.py` (or extend `tests/test_template_api.py`) — (1) assert
  `"--split-sample"` is in `ALLOWED_COMMANDS["build-report"]`. (2) `test_build_report_split_sample_forwarded`:
  POST `/api/run/build-report` with `{split_by: "Site", split_sample: 2}` (run seam mocked) and
  assert the constructed command carries `--split-by Site` and `--split-sample 2`. (3) assert a
  request omitting both yields neither flag.

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — open the build-options control (express and/or regular),
  assert the split-by list contains only main-table labels (mock the catalog/config with one
  main-table and one repeat-group column; assert the repeat-group one is absent), select a split-by
  and "First 2 groups", trigger the build, and assert the `/api/run/build-report` request body carries
  `split_by` and `split_sample: 2`. Capture a `toHaveScreenshot` baseline of the build-options control
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. With downloaded data, open the build options (Express Apply&build and/or Reports → Build).
     Confirm the split-by dropdown lists only main-table columns (no repeat-group fields).
  2. Pick a split-by column and choose "First 2 groups", then build. Confirm only two split reports
     are produced (preview), and the copy made clear this was a preview.
  3. Repeat with "Build all groups" and confirm a report is produced for every group.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_run_api.py -k "split"` ·
  `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-14 — Reposition the run alert in-page (below the title, content width) + icon Stop**

  Refinement of XTF-10. The run alert currently renders as a fixed bar pinned above the top
  nav (App.jsx ~265, outside the page). Move it to flow **inside the page content** — below the
  top nav and the page title/header, immediately before the page's main container — constrained
  to the main-container width with top + bottom margin (not a full-bleed fixed bar). Replace the
  text "Stop" button with a compact **icon button** (X / stop icon) carrying an accessible label.
  All other XTF-10 behavior (shown while `running`, reads the active command, View-logs link,
  `stop` via `/api/stop/{run_id}`, clears on terminal status, `role="status"`) is preserved.
  Depends on **XTF-10** (shipped). Independent of XTF-11/12/13.

  **Files:** `frontend/src/App.jsx` (render the alert inside the content column — below the
  nav/page header, before the active pane — instead of the fixed top bar) ·
  `frontend/src/styles.css` (in-flow `.run-alert` layout: content-width, vertical margins; icon
  stop button) · `frontend/tests/e2e/run-alert.spec.ts` (update placement + icon-stop assertions
  and refresh the baseline)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - While `running`, the alert renders **in the page content flow** (below the top nav + page
    title, before the main container), at the content/main-container width with visible top and
    bottom margin — NOT a fixed full-width bar pinned to the viewport top
  - The Stop control is an **icon button** (e.g. X or a stop glyph), not a text button, with an
    accessible label (`aria-label`) and visible focus ring; it still calls `useCommand.stop()`
    (→ `POST /api/stop/{run_id}`, fallback `/api/stop`)
  - All preserved XTF-10 behavior still holds: `data-testid="run-alert"` + `run-stop`; shows the
    active command; View-logs toggles the terminal; alert clears on a terminal status;
    `role="status"`
  - Impeccable audit/critique clean on the repositioned alert + icon button

  **Unit tests:** N/A (frontend-only placement/markup change; Vitest not installed — asserted by
  the Playwright E2E below, consistent with XTF-9/10).

  **E2E:** `frontend/tests/e2e/run-alert.spec.ts` (update) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — drive the mocked running build; assert `run-alert` is present in the
  page content (e.g. it is NOT the viewport-pinned fixed bar — assert it scrolls with / sits
  within the content column, and appears after the page header) and that `run-stop` is an icon
  button (no visible "Stop" text; has an `aria-label`) that still POSTs `/api/stop/{run_id}`;
  alert clears on terminal status. Refresh the `run-alert.png` baseline to the new in-page layout
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Start a build. Confirm the alert now appears inside the page (below the title, above the
     main content), spanning the content width with margin above and below — not a bar stuck to
     the very top of the window.
  2. Confirm the Stop control is a small icon (X/stop) with a tooltip/label; click it and confirm
     the run cancels and the alert clears.
  3. Confirm View-logs still toggles the terminal and the alert still names the active command.

  **Verify:** `cd frontend && npx playwright test run-alert.spec.ts`

---

- [x] **XTF-15 — Remove the redundant rail "Build report" Quick Action on the Reports page**

  Follow-up from XTF-13/14 review. The Reports page now shows TWO "Build report" buttons: the
  Quick Actions rail action (`Reports.jsx` ~127, `run('build-report')` with no options) and the
  XTF-13 BuildOptions control's `build-run` button (split-by + sample). The BuildOptions entry
  supersedes the rail one ("Build all groups (default)" == the rail's no-option build), and two
  identically-labelled buttons on one page is a UX smell (it also caused the ambiguous-locator
  regression repaired in XTF-14). Remove the rail "Build report" Quick Action; keep the other
  rail actions (e.g. Compare periods). Depends on **XTF-13** (BuildOptions) + **XTF-1–14**
  (shipped).

  **Files:** `frontend/src/pages/Reports.jsx` (drop the "Build report" entry from the
  `QuickActionsCard` actions ~127) · `frontend/tests/e2e/build-options.spec.ts` (assert a single
  build control) · `frontend/tests/e2e/reports-delete-all.spec.ts` + `run-alert.spec.ts` +
  `terminal-collapse.spec.ts` (refresh the Reports-page baselines the rail change affects)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The Reports page has exactly ONE "Build report" control — the BuildOptions `build-run`
    button; the Quick Actions rail no longer contains a "Build report" action
  - The remaining Quick Actions (e.g. Compare periods) are unchanged and still work
  - Building from the BuildOptions control is unaffected (still calls `run('build-report', opts)`)
  - Impeccable audit/critique clean on the updated Reports header/rail (no orphaned spacing)

  **Unit tests:** N/A (frontend-only markup removal; Vitest not installed — asserted by the
  Playwright E2E below, consistent with prior UI cards).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — on the Reports page, assert `getByRole('button', {name:/build report/i})`
  resolves to EXACTLY ONE element (the `build-run` control) and the Quick Actions rail does not
  contain a "Build report" action. Refresh the affected Reports-page baselines (the
  `reports-delete-all.png` and the run-state baselines that screenshot the Reports rail —
  `run-alert.png`, `terminal-collapse` — change because the rail loses a button) at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human re-approves them.

  **UAT:**
  1. Open Deliver → Reports. Confirm there is a single "Build a report" entry (the Build options
     panel) and the Quick Actions rail no longer has a separate "Build report" button.
  2. Confirm the other Quick Actions (Compare periods) are still present and work.
  3. Build from the Build options panel and confirm a report is produced as before.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts reports-delete-all.spec.ts`

---

- [x] **XTF-16 — build-report clears the reports output dir so each build is the current set**

  Bug from review: `build-report` only `mkdir`s the reports `output_dir` (`src/reports/builder.py`
  ~233) and never removes prior outputs, so reports ACCUMULATE across runs. Two symptoms: (a) a
  "first N groups" (`--split-sample`) preview correctly builds only N new files but the dir still
  holds every report from earlier full builds, so the list / Download-all-ZIP shows "everything";
  (b) those leftover files carry an older `_YYYYMMDD` filename suffix (the build date they were
  made, `builder.py` ~236 uses `datetime.today()`) while their pull-to-mirror mtime reads as today
  — so an old report looks freshly generated. Fix: at the start of a build run, clear the prior
  `*.docx` report outputs in `output_dir` so the resulting set reflects ONLY the current build
  (works for default, split-by, and `--split-sample`). Per-run web isolation already pushes the
  fresh set to storage. Backend. Independent of XTF-17/18. Depends on XTF-13 (split options).

  **Files:** `src/reports/builder.py` (clear `output_dir` `*.docx` before the split loop / first
  `_render`) · `tests/test_build_report_smoke.py` (or a new `tests/test_build_report_outputs.py`)

  **Config/schema impact:** None. Reports are regenerable outputs; a build replaces them.

  **Acceptance criteria**
  - At the start of a build, existing `*.docx` in the reports `output_dir` are removed before the
    new report(s) are written (the build's result is exactly the current run's outputs)
  - A split build with `--split-sample 2` over a column with >2 values yields EXACTLY 2 report
    files in `output_dir` (no leftovers from a prior full build)
  - A full split build after a "first 2" build replaces the 2 with the full set (no stale 2 left)
  - A non-split build yields exactly one report; re-running replaces it (no accumulation)
  - Charts dir (`data/processed/charts`) handling is unchanged; only the reports `output_dir`
    `*.docx` are cleared

  **Unit tests:** `tests/test_build_report_outputs.py` (new) — (1) seed `output_dir` with two
  stale `*.docx`, run `ReportBuilder.build()` (single report), assert the stale files are gone and
  only the new report remains. (2) build with `split_by` over 3 values + `split_sample=2` → assert
  exactly 2 `*.docx` exist. (3) then build with `split_sample=None` (all 3) → assert exactly 3 and
  the prior 2 don't linger as a 4th/5th. Use a tmp `output_dir` + a small fixture df.

  **E2E:** N/A (back-end build behavior — no UI surface of its own; the Reports list/ZIP just
  reflects the dir. Human gate is the unit tests + PR review).

  **UAT:** N/A (back-end fix; verified via the unit tests, the verifier, and PR review — UAT moves
  in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_build_report_outputs.py`

---

- [x] **XTF-17 — Searchable split-by dropdown in the build options**

  The split-by control (`frontend/src/components/BuildOptions.jsx`) is a plain `<select>`. For
  forms with many main-table columns it's hard to scan. Make it a **searchable/filterable**
  dropdown (type to filter the options) while keeping the same value contract (selecting a column
  sets `split_by`; clearing → no split). Applies wherever BuildOptions renders (express + regular).
  Depends on XTF-13 (BuildOptions). Independent of XTF-16/18.

  **Files:** `frontend/src/components/BuildOptions.jsx` (searchable combobox for split-by;
  keep `data-testid="build-split-by"` resolving to the control + preserve the main-table-only
  option set) · `frontend/src/styles.css` (combobox styles) ·
  `frontend/tests/e2e/build-options.spec.ts` (typeahead filter assertions)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The split-by control lets the user type to filter the column options (combobox), not just a
    bare native select
  - The option set is still MAIN-table `export_label`s only (repeat-group excluded), unchanged
    from XTF-13; selecting one sets `split_by`; a clear/"No split" choice removes it
  - Keyboard accessible (focus, type-to-filter, arrow/enter select, escape close) with an
    accessible label; `data-testid="build-split-by"` still resolves to the control
  - The downstream build contract is unchanged (chosen split_by/split_sample still forwarded)
  - Impeccable audit/critique clean on the combobox

  **Unit tests:** N/A (frontend-only control; Vitest not installed — asserted by the Playwright
  E2E below, consistent with prior UI cards).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — with a mocked questions catalog containing several main-table columns +
  one repeat-group column, open the split-by combobox, type a filter substring and assert the list
  narrows to matching main-table columns (and the repeat-group column never appears); pick one and
  assert `split_by` is set on the build request; assert the "No split" option clears it. Capture a
  `toHaveScreenshot` baseline of the open combobox at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900).

  **UAT:**
  1. Open the Build options (express or Reports) on a form with many columns. Click the split-by
     control and type part of a column name — confirm the list filters to matches.
  2. Confirm only main-table columns appear (no repeat-group fields), pick one, and build — confirm
     the report splits by it.
  3. Choose "No split" and confirm a single combined report builds.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

---

- [ ] **XTF-18 — Fix: express-path terminal does not auto-collapse after ~5s**

  Bug from review: XTF-11's auto-collapse (terminal opens on a build run, collapses after
  `window.__TERM_COLLAPSE_MS ?? 5000`, `App.jsx` `onStatus` ~184-199) works for the regular build
  but NOT when the build is launched from the Express **Apply & build** flow (`Templates.jsx`
  `applyAndBuild` → `await fetch('/api/template/apply')` then `run('build-report', opts)`). The
  terminal opens and stays open past the delay. Root-cause via the test reproduction (likely the
  apply step or the express run path interferes with the collapse timer / user-override flag), then
  fix so the express build collapses on the SAME ~5s timing as the regular build (and still
  auto-expands on error). Depends on XTF-11 (collapse logic). Independent of XTF-16/17.

  **Files:** `frontend/src/App.jsx` (onStatus/collapse timing) and/or `frontend/src/pages/Templates.jsx`
  (`applyAndBuild` — ensure it doesn't suppress/skip the auto-collapse) · `frontend/tests/e2e/terminal-collapse.spec.ts`
  (add an express-flow case)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Launching a build via the Express **Apply & build** flow opens the terminal and auto-collapses
    it to the bar after the configured delay (default ~5s), while the run keeps streaming — same as
    the regular build
  - On an express build that ends in error, the terminal still auto-expands
  - Manual toggling during an express build still works (a user-opened terminal is not auto-collapsed)
  - The regular-build collapse behavior (XTF-11) is unchanged

  **Unit tests:** N/A (frontend-only timing; Vitest not installed — asserted by the Playwright E2E
  below with the overridable test delay).

  **E2E:** `frontend/tests/e2e/terminal-collapse.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — with `window.__TERM_COLLAPSE_MS` set small, drive the
  EXPRESS Apply&build flow (mock `/api/template/apply` → ok, then the build SSE `running`), assert
  the terminal opens then collapses to the bar after the delay while still running, and auto-expands
  on an error frame. Refresh any affected baseline at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900).

  **UAT:**
  1. From the Express flow, Apply & build a report. Confirm the terminal opens, then ~5s later
     collapses to the bottom bar while the build continues.
  2. Trigger an express build that fails and confirm the terminal auto-expands to show the error.
  3. Manually open the terminal during an express build and confirm it stays open (not auto-collapsed).

  **Verify:** `cd frontend && npx playwright test terminal-collapse.spec.ts`

---

## Visual / E2E harness

> The Definition of Done requires Playwright `toHaveScreenshot` baselines at mobile/tablet/desktop
> for every UI card, but the harness to produce them did not exist. This stands it up once so all
> UI cards (XTF-5, UX-*) can satisfy that gate.

---

- [x] **VIS-1 — Playwright visual harness (mobile/tablet/desktop)**

  Install and configure Playwright with three viewport projects, a deterministic smoke spec with
  committed baselines, a CI job, and the governance updates that make the three-viewport rule
  enforceable. Foundation for every UI card's visual check; no product feature.

  **Files:** `frontend/package.json` (devDep + `test:e2e*` scripts) ·
  `frontend/playwright.config.ts` (3 viewport projects) ·
  `frontend/tests/e2e/harness-smoke.spec.ts` (+ committed `*-snapshots/*.png` baselines) ·
  `.github/workflows/visual.yml` · `.gitignore` · `docs/ROADMAP.md` (DoD + UI-card sweep) ·
  `.claude/skills/roadmap/SKILL.md` · `.claude/agents/*.md` (5 roadmap agents) · `CLAUDE.md`

  **Config/schema impact:** None — tooling only. No app config or schema change.

  **Acceptance criteria**
  - `@playwright/test` is a frontend devDependency; `npm run test:e2e` / `test:e2e:update` /
    `test:e2e:report` scripts exist
  - `playwright.config.ts` defines three Chromium projects — mobile (390×844), tablet (820×1180),
    desktop (1440×900) — so each `toHaveScreenshot` yields one baseline per viewport (filename
    carries the project name; the three never collide)
  - A smoke spec renders a deterministic fixture and asserts `toHaveScreenshot`; one baseline per
    viewport is committed and the suite passes deterministically on a clean re-run
  - A trivial visual change to the fixture makes the suite FAIL (diffing actually works)
  - CI workflow runs the visual suite on PRs touching `frontend/**`, installing Chromium with OS
    deps and uploading the HTML report on failure
  - Governance updated in lockstep: the global Definition of Done requires approved baselines at
    all three viewports; the card-template E2E guidance (`SKILL.md`) and the five roadmap agents
    specify the three-viewport requirement; `CLAUDE.md` documents the harness + commands
  - Transient Playwright output (`playwright-report/`, `test-results/`, `blob-report/`) is
    gitignored while baseline PNGs remain tracked

  **Unit tests:** N/A (harness/tooling card — no Python/JS unit under test; the deliverable's own
  test is the Playwright smoke spec below).

  **E2E:** `frontend/tests/e2e/harness-smoke.spec.ts` — a deterministic `page.setContent` fixture
  asserted via `toHaveScreenshot` under all three viewport projects, with the three baselines
  committed (`harness-smoke.spec.ts-snapshots/sample-panel-{mobile,tablet,desktop}-linux.png`).
  Impeccable audit/critique is N/A for the throwaway fixture (no product UI). Verify: a clean
  `npm run test:e2e` is green; flipping a fixture style reds the suite.

  **UAT:**
  1. Run `cd frontend && npm run test:e2e`. Confirm 3 tests pass (one per viewport) against the
     committed baselines.
  2. Confirm three baseline PNGs exist under
     `frontend/tests/e2e/harness-smoke.spec.ts-snapshots/` (mobile/tablet/desktop).
  3. Make a trivial change to the fixture (e.g. button color), run `npm run test:e2e`, and confirm
     the suite FAILS with a visual diff; revert and confirm it passes again.

  **Verify:** `cd frontend && npm run test:e2e`

---

## Backlog — parked (out of scope for now)

> Captured so they aren't lost; not scheduled. Promote into a domain section above when picked up.

- **Skip the download when the remote is unchanged** — `run-all` already skips a stale
  build-report; skipping the *download* itself when the Kobo/Ona remote hasn't changed is a
  later slice (would need a remote content fingerprint).
- **True multi-user read isolation** — concurrent users with different active projects share
  the one `BASE_DIR` read-mirror (best-effort, last-writer-wins). Durable Minio/DB data is
  always correct; per-user read isolation is out of scope (see `CLAUDE.md` → run concurrency).
