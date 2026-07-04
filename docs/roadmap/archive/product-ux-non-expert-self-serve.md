# Product UX — non-expert self-serve — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **PUX-14 — Chart editor: surface the live preview above the fold on mobile (P3)**

  **Created:** 2026-07-01 · **Started:** 2026-07-03 · **Completed:** 2026-07-03

  **Type:** Feature

  **Depends on:** PUX-11 (must be done)

  Follow-up from PUX-11's `/impeccable critique` (finding 4 of 4). On the 390px stacked
  layout, the live preview sits below all 4 form fields (Name/Title/Type/Columns/Options) — a
  user must scroll past the whole form to see the result of an edit they just made,
  undercutting the "live" framing on the one viewport where scroll friction matters most.

  **Files:** `frontend/src/pages/Composition.jsx` (`ChartModal`)

  **Config/schema impact:** None — frontend-only, no new config field.

  **Acceptance criteria**
  - On mobile (< 768px), the user can see or reach the live preview without scrolling past all
    4 form fields — either the pane is reordered higher in the stack, or a compact status
    indicator (e.g. "Preview ready" / "Rendering…") near the top scrolls the pane into view on
    tap
  - The reordering/indicator does not regress the desktop/tablet two-column layout
  - All existing PUX-11/XTF-27/a11y-5 tests remain green

  **Unit tests:** N/A (layout-only change; covered by E2E).

  **E2E:** `frontend/tests/e2e/chart-editor.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot` at all three viewports — mobile 390×844, tablet 820×1180,
  desktop 1440×900) —
  - At mobile width, assert the preview pane (or its status indicator) is within the initial
    viewport without scrolling, or that tapping the indicator scrolls it into view
  - `toHaveScreenshot('chart-editor-modal-mobile-preview-position.png')` at mobile width,
    human-approved (the reordered/above-the-fold mobile layout)
  - Regression guard for the "must not regress desktop/tablet" AC:
    `toHaveScreenshot('chart-editor-modal-tablet-preview-position.png')` at tablet width and
    `toHaveScreenshot('chart-editor-modal-desktop-preview-position.png')` at desktop width,
    each asserting the two-column layout is unchanged, human-approved

  **UAT:**
  1. On a phone-width browser window, open the chart editor — confirm you can see or reach the
     preview without scrolling past the whole form

  **Verify:** `cd frontend && npm run test:e2e -- --grep "chart.*editor|editor.*chart"` ·
  `cd frontend && npm run test:e2e` (full suite green)

---

- [x] **PUX-13 — Chart editor: link preview errors back to the offending field (P2)**

  **Created:** 2026-07-01 · **Started:** 2026-07-03 · **Completed:** 2026-07-03

  **Type:** Feature

  **Depends on:** PUX-11 (must be done)

  Follow-up from PUX-11's `/impeccable critique` (finding 3 of 4). When `/api/charts/preview`
  fails, the message is generic backend text in the preview pane; the user must mentally diff
  their Name/Title/Type/Columns/Options against the failure to guess what to fix — a "Memory
  Bridge" cognitive load violation. `CHART_REQS` already encodes each chart type's column
  requirement client-side, so a type/column-count mismatch is detectable without waiting for
  the backend round-trip.

  **Files:** `frontend/src/pages/Composition.jsx` (`ChartModal`)

  **Config/schema impact:** None — frontend-only, no new config field.

  **Acceptance criteria**
  - When a preview error is a chart-type/column-count mismatch already knowable from
    `CHART_REQS` (e.g. a `histogram` needs 1 numeric column, none selected), the Columns
    `ModalField` row is visually flagged (reusing the existing rose-border pattern used for
    filter errors) in addition to the generic pane message
  - When the error is NOT attributable to a known client-side rule (e.g. a genuine backend/data
    error), only the generic pane message shows — no field is falsely flagged
  - All existing PUX-11/XTF-27/a11y-5 tests remain green

  **Unit tests:** N/A (pure UI wiring — the `CHART_REQS`-to-field mapping is a small lookup
  with no isolable logic beyond what E2E already exercises directly).

  **E2E:** `frontend/tests/e2e/chart-editor.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) —
  - Select a chart type requiring a numeric column, pick a text column, wait for the preview
    error; assert the Columns field carries the error-flagged style
  - Trigger a non-`CHART_REQS` error (e.g. stub a 500 with an unrelated message); assert no
    field is flagged
  - `toHaveScreenshot('chart-editor-modal-field-error.png')` at all three viewports,
    human-approved

  **UAT:**
  1. Pick a chart type that needs a numeric column, choose a text column instead — confirm the
     Columns field itself is visually flagged as the likely cause, not just a generic error

  **Verify:** `cd frontend && npm run test:e2e -- --grep "chart.*editor|editor.*chart"` ·
  `cd frontend && npm run test:e2e` (full suite green)

---

- [x] **PUX-12 — Chart editor preview: keep last image visible during re-fetch (P2)**

  **Created:** 2026-07-01 · **Started:** 2026-07-02 · **Completed:** 2026-07-02

  **Type:** Feature

  **Depends on:** PUX-11 (must be done — this extends `useChartPreview` and `ChartModal`,
  which PUX-11 introduces)

  Follow-up from PUX-11's `/impeccable critique` (Design Health Score 28/40 — Good, none
  blocking; this is finding 1 of 4, split into its own card per DoR scope review).
  `useChartPreview` fully unmounts the last successful image and replaces it with a loading
  skeleton on every debounced re-fetch — including small, low-risk edits (e.g. typing a title
  character by character once the 600ms window lapses). For anxious non-expert users (this
  product's core audience per PRODUCT.md), a previously-correct chart vanishing on every edit
  reads as "did I break something?" rather than "it's updating."

  **Files:** `frontend/src/hooks/useChartPreview.js` · `frontend/src/pages/Composition.jsx`
  (`ChartModal`) · `frontend/src/hooks/useChartPreview.test.js`

  **Config/schema impact:** None — frontend-only, no new config field.

  **Acceptance criteria**
  - A debounced re-fetch keeps the last successful preview image visible (e.g. dimmed, or with
    a small corner spinner) instead of unmounting it
  - Only the very first load with no prior image shows the full blanking skeleton
  - A re-fetch that ends in an error does not clobber the last-good image with nothing — falls
    back to the existing error state, but the transition doesn't flash a blank pane first
  - All existing PUX-11/XTF-27/a11y-5 tests remain green

  **Unit tests:** `frontend/src/hooks/useChartPreview.test.js` (extend) —
  - `test_previous_image_persists_during_refetch`: after a successful preview, trigger a new
    debounced fetch; assert `image` from the prior state is still returned (not nulled) while
    `loading` is true, until the new response resolves
  - `test_first_load_shows_full_skeleton`: with no prior image, assert `image` is `null` and
    `loading` is `true` during the initial fetch (no persisted-image case to fall back to)

  **E2E:** `frontend/tests/e2e/chart-editor.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) —
  - Change a field twice in quick succession; assert the previously-rendered preview `<img>`
    remains in the DOM (not replaced by the skeleton testid) between requests
  - `toHaveScreenshot('chart-editor-modal-refetch.png')` capturing the dimmed/in-progress state
    at all three viewports, human-approved

  **UAT:**
  1. Open the chart editor, wait for the preview to render, then change the Title — confirm the
     existing chart image stays visible (dimmed or with a small spinner) rather than
     disappearing into a blank skeleton

  **Verify:** `node --test frontend/src/hooks/useChartPreview.test.js` ·
  `cd frontend && npm run test:e2e -- --grep "chart.*editor|editor.*chart"` ·
  `cd frontend && npm run test:e2e` (full suite green)

---

- [x] **PUX-11 — Inline live preview in the chart editor modal (P1)**

  **Created:** 2026-06-28 · **Completed:** 2026-07-01

  Today the chart editor (`ChartModal`) and the chart preview are two separate modals —
  users configure blind, then close and open a second modal to see the result. Merge them:
  the chart editor modal gains a live preview pane (right column on desktop, below fields on
  mobile) that calls `/api/charts/preview` with the current form state, debounced ~600 ms,
  and re-renders the chart image as the user types. The existing standalone preview modal
  is removed; all chart interaction goes through the unified editor.

  **Files:** `frontend/src/pages/Composition.jsx` · `frontend/tests/e2e/composition.spec.ts`
  (or a new `chart-editor.spec.ts`)

  **Config/schema impact:** None — frontend-only; uses existing `/api/charts/preview` endpoint.

  **Acceptance criteria**
  - Opening the chart editor (add or edit) shows the chart preview pane alongside the form fields
  - The preview re-fetches and updates within ~600 ms of any field change (title, type, questions,
    color, top_n, etc.) without the user clicking a separate button
  - While the preview is loading a skeleton/spinner is shown; on error a legible inline message
    is shown (not a blank pane)
  - The standalone "Preview" button / separate preview modal is removed from the Composition tab
  - Two-column layout at tablet (820 px) and desktop (1440 px) widths; stacked (single column)
    at mobile (390 px) width
  - All existing Composition tab tests remain green

  **Unit tests:** `frontend/src/hooks/useChartPreview.test.js` — the debounce + preview-state
  logic (loading/error/success) is extracted into a `useChartPreview` hook so it's unit-testable
  independent of Playwright:
  - Rapid successive field changes within 600 ms fire exactly one `/api/charts/preview` request
    (debounce collapses bursts, doesn't fire once per keystroke)
  - Loading state is `true` from request start until the response resolves
  - A non-2xx response sets an error state (not loading, not a stale success state)

  **E2E:** `frontend/tests/e2e/composition.spec.ts` (or `chart-editor.spec.ts`) —
  - Open chart editor; assert preview pane is visible
  - Change the chart title; assert the preview image src changes (new request fired)
  - Stub `/api/charts/preview` to return 500; assert inline error message is shown
  - `toHaveScreenshot('chart-editor-modal.png')` at all three viewports (mobile / tablet / desktop)

  **UAT:**
  1. Open Composition tab → click Edit on any chart
  2. Confirm the preview renders inside the modal without clicking a separate button
  3. Change the title — confirm the preview updates automatically within ~600 ms
  4. Confirm layout is stacked (single column) at mobile width (390×844), and two-column at
     tablet width (820×1180) and desktop width (1440×900)

  **Verify:** `cd frontend && npm run test:e2e -- --grep "chart.*editor|editor.*chart"` ·
  `cd frontend && npm run test:e2e` (full suite green)

---

- [x] **PUX-10 — Auto-save the connection before Fetch/Download (no stale-config runs) (P2)**

  **Created:** 2026-06-27 · **Completed:** 2026-06-27

  Follow-up to PUX-7. **Test connection** probes the *in-form* values (URL/token/Form UID are
  sent in the request body), but **Fetch questions** / **Download data** run the CLI against the
  *saved* config (`run('fetch-questions')` / `run('download')` → `POST /api/run/<cmd>`, which
  hydrates the saved project config). So a user who tests a connection and — without clicking
  Save — clicks Fetch runs against the old/empty saved config and it fails confusingly (the
  buttons are enabled by the successful test, but the tested values were never persisted). Fix:
  make Fetch/Download **auto-save first** — when the config has unsaved changes (`dirty`,
  `frontend/src/pages/Sources.jsx` ~92), persist it (the existing `saveAll` →
  `POST /api/config`) and only then issue the run; if the save fails, **abort the run** and
  surface the error. Matches *Make the safe path the default* — the user can't forget to save.

  **Files:** `frontend/src/pages/Sources.jsx` (have `saveAll` ~108 report success/failure; pass
  `dirty` + a save fn into `ConnectionCard` ~250; wrap `fetchQuestions`/`downloadData` ~306–307
  to `await` a save-if-dirty before `run(...)`, aborting on save failure) ·
  `frontend/tests/e2e/connection-autosave.spec.ts` (new) ·
  `frontend/src/locales/{en,fr}.json` (only if a new user-facing string is added)

  **Config/schema impact:** None — uses the existing `POST /api/config` save path.

  **Acceptance criteria**
  - Clicking **Fetch questions** or **Download data** while the config is `dirty` first issues a
    `POST /api/config` (save) and only then the `POST /api/run/<cmd>` — the save completes before
    the run starts, so the run uses the just-saved config
  - When there are **no** unsaved changes, the buttons run immediately with no redundant save
  - If the auto-save **fails** (validation / permission / network), the run is **not** started and
    the error is surfaced to the user (no silent no-op, no run against stale config)
  - After a successful auto-save the form is no longer `dirty` (same end state as a manual Save);
    the manual Save button behaviour is unchanged
  - No regression to PUX-7 gating (a confirmed connection is still required to enable the buttons)
  - Any new user-facing string exists in both `en.json` and `fr.json`; `check:i18n` passes

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the save-before-run ordering and the
  abort-on-save-failure are asserted by the Playwright E2E below, per the PUX/i18n precedent).

  **E2E:** `frontend/tests/e2e/connection-autosave.spec.ts` (new) — network-mocked (same harness as
  connection-gating): load a saved connection config, change the Form UID (dirty), run **Test
  connection** (mock `ok+fields` → confirmed) so Fetch enables; click **Fetch questions** and assert
  the request order is `POST /api/config` **then** `POST /api/run/fetch-questions` (the run is not
  sent before the save resolves). Second case: mock `POST /api/config` → 4xx and assert clicking
  Fetch does **not** call `/api/run/*` and shows an error. (No `toHaveScreenshot` baseline needed —
  behavioural change, not visual.)

  **UAT:**
  1. Enter/adjust your connection details and click **Test connection** (success). Without clicking
     Save, click **Fetch questions**. Confirm it works (it saved automatically first).
  2. Confirm the Save button then shows no unsaved changes.
  3. Force a save failure (e.g. an invalid config) and click Fetch — confirm you get a clear error
     and the fetch does **not** run.

  **Verify:** `cd frontend && npx playwright test connection-autosave.spec.ts && npm run check:i18n`

---

- [x] **PUX-9 — Copy-placeholder buttons for charts / indicators / summaries / tables on the Analyze tab (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  On Analyze → "Charts & indicators" (`frontend/src/pages/Composition.jsx`, `ANALYZE_SECTIONS`),
  every chart / indicator / summary / table the user defines maps to a docxtpl placeholder they
  must place in their Word template **by hand**: `{{ chart_<name> }}`, `{{ ind_<name> }}` (+
  `{{ ind_<name>_breakdown }}` / `{{ ind_<name>_table }}` when `disaggregate_by` is set),
  `{{ summary_<name> }}`, `{{ table_<name> }}` — where `<name>` is the item's `name` field verbatim
  (`src/reports/builder.py` ~342/395, `src/reports/indicators.py` ~110–119,
  `src/reports/summaries.py` ~53). Hand-typing these is error-prone — a single typo silently yields
  an empty placeholder in the report. Add a per-row **copy-placeholder** button that copies the
  exact `{{ … }}` token to the clipboard with visible confirmation, reusing the existing clipboard
  pattern (`frontend/src/pages/Sources.jsx` ~577/653 — `navigator.clipboard.writeText` + the
  copy-icon button). **UI only — no change to how placeholders are generated or rendered.**

  **Caveat to surface (not hide):** chart + table placeholders embed binary images, so per the
  CLAUDE.md single-run rule they only work inside a template produced by `generate-template`; the
  copy button is for reference / advanced use and the recommended path for charts + tables stays
  `generate-template`. Indicator + summary tokens are plain text and paste safely anywhere.

  **Files:** `frontend/src/pages/Composition.jsx` (a small reusable copy-placeholder control in each
  row's actions — ChartsCard ~964–975, IndicatorsCard ~1238–1245, TablesCard ~1285–1296,
  SummariesCard ~1335–1346; derive the token from the item's `name`; for an indicator with
  `disaggregate_by`, also offer the `_table` (and/or `_breakdown`) variant) ·
  `frontend/src/locales/{en,fr}.json` (copy label/tooltip + "copied" confirmation + the chart/table
  caveat note — EN/FR parity) · `frontend/src/styles.css` (only if the control needs styling beyond
  the existing icon buttons) · `frontend/tests/e2e/copy-placeholder.spec.ts` (new)

  **Config/schema impact:** None — UI presentation only; the placeholder tokens are unchanged.

  **Acceptance criteria**
  - Each **chart** row exposes a copy button that copies its exact placeholder `{{ chart_<name> }}`
    (name = the chart's `name`) to the clipboard
  - Each **indicator** row copies `{{ ind_<name> }}`; for an indicator with `disaggregate_by` set
    the user can additionally copy the `{{ ind_<name>_table }}` variant (and/or `_breakdown`)
  - Each **summary** row copies `{{ summary_<name> }}`; each **table** row copies `{{ table_<name> }}`
  - The copied string includes the `{{ }}` delimiters with a single inner space (matching the
    generated-template format) so it pastes ready to use
  - Copying gives **visible confirmation** (a toast or a transient checkmark on the button) —
    improving on the current silent copy pattern
  - A brief inline note / tooltip explains that chart + table placeholders must live in a
    `generate-template`-produced template (binary image data), while indicator + summary tokens
    paste anywhere
  - The copy control is keyboard-operable with an accessible name (e.g. "Copy placeholder for
    <item name>"), per the A11Y-4 icon-button convention; no raw translation key leaks
  - New strings exist in both `en.json` and `fr.json` (key-aligned; `check:i18n` passes)
  - Impeccable audit/critique clean

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the clipboard write, exact token
  correctness, and i18n parity are asserted by the Playwright E2E below + `check:i18n`, per the
  i18n/PUX precedent).

  **E2E:** `frontend/tests/e2e/copy-placeholder.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — grant clipboard permissions; seed/add a chart named e.g. "sites", an
  indicator "completion" (one without and one with `disaggregate_by`), a summary "overview", and a
  table; click each row's copy button and assert `navigator.clipboard.readText()` returns the exact
  token (`{{ chart_sites }}`, `{{ ind_completion }}`, `{{ ind_completion_table }}` for the
  disaggregated one, `{{ summary_overview }}`, `{{ table_<name> }}`); assert the confirmation
  feedback appears; run a Playwright axe audit and assert each copy button has a non-empty accessible
  name. Capture `toHaveScreenshot` baselines of a row with the copy button (and its confirmation
  state) at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves.

  **UAT:**
  1. On Analyze → Charts & indicators, add a chart and click its copy button. Paste into a text
     editor and confirm you get exactly `{{ chart_<name> }}`.
  2. Do the same for an indicator, a summary, and (under Advanced) a table; confirm each token matches
     its name. For an indicator with a disaggregation, confirm you can also copy the `_table` variant.
  3. Confirm a visible "copied" confirmation appears each time.
  4. Confirm the note about chart/table placeholders needing a generated template is visible.
  5. Switch the interface to French and confirm the copy tooltip + confirmation are translated.

  **Verify:** `cd frontend && npx playwright test copy-placeholder.spec.ts && npm run check:i18n`

---

- [x] **PUX-8 — Primary navigation labels adopt the PUX-1 plain-language stage names (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  PUX-1 reworded the Home stage cards to plain language for non-experts
  (`home.stages.transform.label` = "Clean & check" / "Nettoyer et vérifier";
  `home.stages.model.label` = "Combine data" / "Combiner les données"), but the horizontal top-nav
  still uses the old data-engineering jargon keys `nav.transform` ("Transform" / "Transformer") and
  `nav.model` ("Model" / "Modéliser") (`frontend/src/App.jsx` STAGES ~77–100, rendered ~628 via
  `t(s.labelKey)`). So the nav contradicts the very cards a non-expert just read on Home. Bring the
  primary tab labels into line with the plain-language stage names in **both** languages. **Copy /
  label only — no id, route, or behaviour change** (stage ids `transform`/`model`/`present` and the
  `data-tab` ids are unchanged). To prevent future drift, prefer sourcing each nav label from the
  same string as its Home stage card where one exists (single source of truth). Frontend-only;
  follows the *Match system ↔ real world* / plain-language principle (PUX). Independent of I18N-5
  (that one fixes the **sub**-tabs), though both touch the nav.

  **Files:** `frontend/src/locales/en.json` + `frontend/src/locales/fr.json` (`nav.transform` and
  `nav.model` values updated to the plain-language wording, EN/FR parity) · `frontend/src/App.jsx`
  (STAGES `labelKey` / render ~77–100/628 — optionally point the nav label at the shared
  `home.stages.*.label` key so it cannot drift from the Home card) ·
  `frontend/tests/e2e/nav-labels.spec.ts` (new)

  **Config/schema impact:** None — relabel only; stage ids / routes unchanged.

  **Acceptance criteria**
  - The primary top-nav tab currently reading "Transform" reads the same plain-language name as the
    Home "Clean & check" stage card (FR: "Nettoyer et vérifier") — no "Transform" / "Transformer"
    jargon remains as the visible nav label
  - The primary top-nav tab currently reading "Model" reads the same plain-language name as the Home
    "Combine data" stage card (FR: "Combiner les données") — no "Model" / "Modéliser" remains
  - The remaining primary tabs (Home, Extract, Analyze, Deliver) are visually unchanged
  - The nav labels match their corresponding Home stage-card labels in **both** English and French
    (a single source of truth is acceptable and preferred)
  - **No behaviour change:** stage ids, routes/navigation targets, and `data-tab` ids are
    byte-for-byte unchanged — only the visible label text differs
  - en/fr stay key-aligned with no empty values; `check:i18n` passes

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the relabeled nav and unchanged
  navigation are asserted by the Playwright E2E below + `check:i18n`, per the i18n/PUX precedent).

  **E2E:** `frontend/tests/e2e/nav-labels.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — with language=en, assert the third and fourth primary tabs render the
  plain-language names (matching the Home cards) and do NOT contain "Transform" / "Model"; with
  language=fr, assert they render the French plain-language names and do NOT contain "Transformer" /
  "Modéliser"; click each renamed tab and assert navigation lands on the same stage as before (route
  / first sub-tab unchanged). Capture `toHaveScreenshot` baselines of the primary nav in English and
  in French at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human
  approves them.

  **UAT:**
  1. In English, read the Home stage cards, then look at the top navigation. Confirm the nav tab
     names match the card names — in particular that no tab says "Transform" or "Model".
  2. Switch the interface to French and confirm the nav shows the French plain-language names that
     match the cards (no "Transformer" / "Modéliser").
  3. Click each renamed tab and confirm it opens the same stage it always did (only the words
     changed).

  **Verify:** `cd frontend && npx playwright test nav-labels.spec.ts && npm run check:i18n`

---

- [x] **PUX-7 — Gate Fetch/Download on a confirmed connection; flip the sample-data affordance (P2)**

  **Created:** 2026-06-26 · **Completed:** 2026-06-26

  On Extract → Connection, **Fetch questions** and **Download data** are always clickable
  (disabled only on `running || !canEdit`, `frontend/src/pages/Sources.jsx` ~497/502), so a
  non-expert can run them before a working connection exists and hit a confusing runtime failure
  (fails *Make the safe path the default*). The **Test connection** button already validates the
  live `api.url`/`token`(+`form.uid`) and stores the result in `lastCheck`
  (`frontend/src/pages/Sources.jsx` ~132–159; backend `POST /api/sources/test` returns
  `{ok, fields, status, message}` and counts the form schema's fields when a Form UID is present).
  Wire the destructive/expensive actions to that signal: keep **Fetch questions** / **Download
  data** disabled until the connection is confirmed working, and make **Try with sample data** the
  enabled path until then — then swap the two once a real connection is confirmed. **Frontend-only
  — no backend change** (the test endpoint already returns the field count); no change to what any
  button does when enabled. Independent of PERF-3 and the A11Y/OUT/ME cards.

  **Definition of "connection confirmed working":** the most recent Test connection in the current
  session returned `ok === true` **and** a Form UID was provided whose schema loaded (the response
  `fields` count is a positive number). Token-valid-but-no/invalid-Form-UID does **not** count,
  because both Fetch and Download need the form.

  **Files:** `frontend/src/pages/Sources.jsx` (ConnectionCard: derive a `connectionConfirmed`
  boolean from `lastCheck` (`ok && fields > 0`); gate the Fetch ~497 / Download ~502 / Try-sample
  ~520 `disabled` props on it; clear `lastCheck` when any connection field — platform, API URL,
  API token, Form UID — is edited (~383–472) so a confirmed status goes stale on edit; add the
  disabled-reason tooltips/helper text) · `frontend/src/locales/en.json` +
  `frontend/src/locales/fr.json` (new `sources.*` strings for the disabled reasons — EN/FR parity
  is enforced) · `frontend/src/styles.css` (only if the disabled affordance needs styling beyond
  the existing disabled state) · `frontend/tests/e2e/connection-gating.spec.ts` (new)

  **Config/schema impact:** None — frontend presentation/state only; no `config.yml`, DB, or
  endpoint change.

  **Acceptance criteria**
  - On the Connection tab with **no** confirmed-working connection in the current session (no
    successful test yet, or the last test errored / returned no positive field count): **Fetch
    questions** and **Download data** are disabled, and **Try with sample data** is enabled
    (all still subject to the existing `!canEdit` / `running` / `loadingSample` rules — viewers
    stay disabled throughout)
  - When the connection is **confirmed working** (`/api/sources/test` returned `ok` **and** a
    positive `fields` count for the supplied Form UID): **Fetch questions** and **Download data**
    are enabled (subject to `running`/`canEdit`), and **Try with sample data** is disabled
  - A successful **token-only** test (no Form UID, so `fields` is null/0) does **not** enable
    Fetch/Download — they stay disabled because the form has not been confirmed
  - Editing any connection field (platform, API URL, API token, or Form UID) **clears** the
    confirmed status: Fetch/Download re-disable and Try-with-sample re-enables until Test
    connection is re-run successfully
  - Each disabled action button conveys **why** it is disabled by a means other than styling alone
    (e.g. a `title`/tooltip such as "Test the connection first" on Fetch/Download, and a
    sample-disabled reason once a real connection exists); the new strings exist in both `en.json`
    and `fr.json`
  - **No behaviour change when enabled:** Fetch/Download/sample call the same handlers/endpoints as
    today; no backend change

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the disabled/enabled
  gating, the token-only non-enable case, and the edit-invalidation are asserted by the Playwright
  E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** `frontend/tests/e2e/connection-gating.spec.ts` (new) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — as an editor on the Connection tab, mocking `POST /api/sources/test`:
  (1) on initial load assert Fetch questions + Download data are disabled and Try with sample data
  is enabled; (2) mock the test to resolve `{ok:true, fields:42}`, click Test connection, and
  assert Fetch/Download become enabled and Try-with-sample becomes disabled; (3) mock the test to
  resolve `{ok:true, fields:null}` (token-only) and assert Fetch/Download stay disabled; (4) after
  a confirmed-working state, edit the API token field and assert Fetch/Download re-disable and
  Try-with-sample re-enables. Run a Playwright axe audit on both the gated and confirmed states and
  assert no new violations. Capture `toHaveScreenshot` baselines of the disabled (pre-connection)
  state and the confirmed-working state at all three viewports (mobile 390×844, tablet 820×1180,
  desktop 1440×900); a human approves them.

  **UAT:**
  1. Open Extract → Connection on a project with no working credentials. Confirm **Fetch
     questions** and **Download data** are greyed out and **Try with sample data** is clickable,
     and that hovering the disabled buttons explains they need a tested connection.
  2. Enter a valid URL, token, and Form UID and click **Test connection**. On success, confirm
     Fetch questions + Download data become clickable and Try with sample data greys out.
  3. Run **Test connection** with a valid token but no/invalid Form UID. Confirm Fetch/Download
     stay disabled.
  4. After a successful test, change the API token. Confirm Fetch/Download grey out again and Try
     with sample data re-enables until you re-test.
  5. Switch the interface to French and confirm the disabled-reason tooltips are translated.

  **Verify:** `cd frontend && npx playwright test connection-gating.spec.ts`

---

- [x] **PUX-6 — Harden Home first-run readiness fetch (error + project-switch) (P2)**

  **Created:** 2026-06-21 · **Completed:** 2026-06-22

  Follow-up from PUX-2. The `/api/state` readiness effect in `frontend/src/App.jsx` (~296-310)
  has two robustness gaps. (1) `homeReady` is not reset to `null` when `activeProjectId` changes,
  so switching projects briefly shows the previous project's Home state (first-run vs full view)
  until the new fetch resolves — defeating the anti-flash guarantee the code comments claim.
  (2) The fetch does not check `response.ok`, so a non-OK response whose JSON body lacks
  `has_questions` (a 500 `{"detail":...}`, or the 401 now that `/api/state` is auth-gated) coerces
  to `ready=false` and shows a returning user the first-run "Connect your form" empty state on a
  transient error.

  **Files:** `frontend/src/App.jsx` (the `homeReady` `useEffect` ~296-310) ·
  `frontend/tests/e2e/pux-2.spec.ts` (extend)

  **Config/schema impact:** None — reuses the existing `/api/state` readiness flags.

  **Acceptance criteria**
  - On `activeProjectId` change, `homeReady` resets to `null` (cards held) before the new
    `/api/state` resolves, so neither Home state from the previous project flashes during a switch
  - The `/api/state` fetch checks `response.ok`; a non-OK response (4xx/5xx) does **not** set
    `ready=false` — readiness stays `null` (cards held), so a returning user is never shown the
    first-run empty state on a transient/auth error
  - A malformed / parse-error response is likewise treated as unknown (held), not `ready=false`
  - No regression on the happy path: a 200 with `{has_questions, has_data}` resolves first-run vs
    returning exactly as today

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the reset-on-switch and
  error-handling behavior are asserted by the Playwright E2E below, consistent with XTF-9's
  readiness-gating coverage).

  **E2E:** `frontend/tests/e2e/pux-2.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — (a) mock `/api/state` → `500` (and separately `401`) and assert Home shows
  neither the first-run CTA nor the five-card view (cards held), not the first-run state; (b)
  simulate switching from a ready project to a not-ready one and assert the full five-card view
  does not flash before the new readiness resolves. No new baseline needed if the held state
  matches the existing pre-readiness render; otherwise capture at all three viewports (mobile
  390×844, tablet 820×1180, desktop 1440×900) with human approval.

  **UAT:**
  1. With a returning project (form + data), force `/api/state` to fail (server down / offline) and
     reload Home. Confirm you are NOT shown the first-run "Connect your form" empty state.
  2. Switch from a project that has data to a brand-new one. Confirm the full five-card view does
     not briefly flash before the first-run state appears.
  3. Switch repeatedly between two ready projects and confirm no flicker or wrong state.

  **Verify:** `cd frontend && npx playwright test pux-2.spec.ts`

---

- [x] **PUX-5 — Reduce setup-before-value friction (demo / sample path) (P2)**

  **Created:** 2026-06-20 · **Completed:** 2026-06-22

  Today an API token **and** an AI key are required before any value appears — a steep wall for a
  non-expert evaluating the tool (fails *Make the safe path the default*; compounds *Help &
  documentation*). Provide a no-credentials "try it / sample dataset" path (or, at minimum, a
  clearly guided token-acquisition help) so a new user can reach a finished report without first
  having credentials; the normal connect flow stays unchanged. This card touches a Python web
  endpoint (to serve the sample dataset / drive the demo path), so it carries a real pytest
  target in addition to the E2E.

  **Files:** `frontend/src/pages/Sources.jsx` (a "Try with sample data" affordance / guided
  token-acquisition help alongside the existing connect flow) · `web/main.py` (a new endpoint that
  loads/serves the bundled sample dataset into the active project's workspace so downstream stages
  have data without credentials) · supporting bundled sample-data asset (see Config/schema impact)
  · `tests/test_sample_dataset_api.py` (new pytest target)

  **Config/schema impact:** Adds a **bundled sample-dataset asset** (a small fixture
  submissions/questions set shipped with the app) and a new web endpoint that materializes it into
  the active project's workspace; no change to the `config.yml` schema itself (the sample populates
  the existing `questions`/data shapes).

  **Acceptance criteria**
  - The Sources page offers a no-credentials "Try with sample data" path (or an equivalently clear
    guided affordance) that does NOT require a Kobo/Ona token or an AI key to start
  - Invoking it loads the bundled sample dataset into the active project so the downstream stages
    (Questions/Composition/Reports) have real columns + rows to work with
  - From the sample-data state, a non-expert can reach a **finished report** without ever entering
    a credential (the build path runs against the sample data)
  - The normal connect flow (entering a real token / AI key) is unchanged and still works
  - The new web endpoint is RBAC-consistent with the other mutating endpoints (editor-gated, per
    the existing `_require(request, "editor")` pattern) and scoped to the caller's active project
  - Impeccable audit/critique clean on the new affordance

  **Unit tests:** `tests/test_sample_dataset_api.py` (new) — (1) `test_load_sample_dataset_populates_workspace`:
  POST the new sample-dataset endpoint as an editor and assert it materializes the bundled sample
  questions + submissions into the active project's workspace (data present, no token/AI key
  required). (2) `test_load_sample_dataset_rbac`: a viewer caller gets 403 and nothing is written.
  (3) `test_load_sample_dataset_idempotent`: invoking it twice leaves a single coherent sample set
  (no duplication / no error).

  **E2E:** `frontend/tests/e2e/sample-data-path.spec.ts` (new) + visual (impeccable audit/critique
  + `toHaveScreenshot`) — with NO credentials configured, click "Try with sample data" on Sources
  (mock the sample-dataset endpoint to succeed), assert the app advances into a data-present state
  (Questions/Composition now show sample columns), and that the connect flow's normal token/AI
  inputs are still present and unchanged; assert the affordance is keyboard-operable. Capture a
  `toHaveScreenshot` baseline of the Sources sample-data affordance and the resulting data-present
  state at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human
  approves them.

  **UAT:**
  1. As a brand-new user with NO Kobo token and NO AI key, open the Sources/Extract page. Confirm
     there is an obvious "Try with sample data" option that does not ask for any credentials.
  2. Click it and confirm the app loads example data, so the Questions and Composition stages now
     show real-looking columns and rows.
  3. Continue through to building a report and confirm you can produce a finished report end-to-end
     without ever entering a token or AI key.
  4. Confirm the normal "connect your real form" flow (token + AI key fields) is still present and
     usable for when you're ready.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_sample_dataset_api.py` ·
  `cd frontend && npx playwright test sample-data-path.spec.ts`

---

- [x] **PUX-4 — In-app contextual help per stage (P2)**

  **Created:** 2026-06-20 · **Completed:** 2026-06-22

  Help currently lives only in repo docs (`docs/reference/*`); non-expert field staff won't leave
  the app to read them (this is the **Help & documentation** heuristic, scored 2/4). Each stage /
  tab should expose concise contextual help in-app, reachable without leaving the current context,
  and link to the relevant docs/reference page for the curious.

  **Files:** `frontend/src/pages/Home.jsx` · `frontend/src/pages/Sources.jsx` ·
  `frontend/src/pages/Questions.jsx` · `frontend/src/pages/Composition.jsx` ·
  `frontend/src/pages/Reports.jsx` · `frontend/src/pages/Templates.jsx` (the six page
  components — add inline hints + a help affordance per stage) ·
  `frontend/src/components/StageHelp.jsx` (new shared help component) ·
  `frontend/src/styles.css` (help affordance / popover styling)

  **Config/schema impact:** None — additive UI help; static copy + links to existing
  `docs/reference/*` pages.

  **Acceptance criteria**
  - Each of the six stage pages exposes a concise contextual-help affordance (e.g. a "?" /
    "Help" control) that reveals stage-specific guidance **without navigating away** from the
    current page (inline panel / popover, not a hard link-out)
  - Each page's help also includes a link to the relevant `docs/reference/*` page for deeper
    reading (opening it does not lose the user's place — e.g. new tab or returnable)
  - Concise inline hints accompany the help affordance so a user gets oriented without even
    opening the full help
  - The help affordance is a real keyboard-operable `<button>` with an accessible name, visible
    focus ring, and (for a popover) `aria-expanded` / proper disclosure semantics; help content is
    reachable by assistive tech
  - The help is implemented via a shared `StageHelp` component so the six pages stay consistent
  - Impeccable audit/critique clean on the help affordance + revealed content

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the help affordance, in-context
  reveal, and docs link are asserted by the Playwright E2E below, consistent with XTF-7's coverage
  approach).

  **E2E:** `frontend/tests/e2e/stage-help.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — on each stage page, locate the help affordance via
  `getByRole('button', {name:/help/i})`, activate it, and assert stage-specific help content
  appears in-context (the page URL/active pane is unchanged) with `aria-expanded` flipping to
  `true`; assert a link to the matching `docs/reference/*` page is present in the revealed help.
  Capture `toHaveScreenshot` baselines of an opened help panel on at least two representative
  stages at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human
  approves them.

  **UAT:**
  1. On each stage (Home, Sources/Extract, Questions, Composition, Reports, Templates), find and
     click the in-app help control. Confirm helpful, stage-specific guidance appears right there
     without leaving the page you're on.
  2. Confirm a short inline hint is also visible on the stage so you get oriented without even
     opening the help.
  3. Click the "learn more" / docs link in the help and confirm it opens the matching reference
     page without losing your place in the app.

  **Verify:** `cd frontend && npx playwright test stage-help.spec.ts`

---

- [x] **PUX-3 — Reduce Composition cognitive load via progressive disclosure (P1)**

  **Created:** 2026-06-20 · **Completed:** 2026-06-22

  The Composition surface (`frontend/src/pages/Composition.jsx`) presents several construct types at
  once — charts, indicators, tables, summaries — a wall of options at exactly
  the step non-experts most need scaffolding (fails *Make the safe path the default*). Lead with a
  recommended starter path and collapse the advanced constructs behind progressive disclosure; no
  construct is removed.

  **Files:** `frontend/src/pages/Composition.jsx` (recommended starter path + progressive-
  disclosure / "Advanced" affordance grouping the advanced constructs) ·
  `frontend/src/styles.css` (disclosure / "Advanced" section styling if needed) · the existing
  Ask entry point and `--auto-charts` starter-chart affordance (reused, not re-implemented)

  **Config/schema impact:** None — UI grouping/disclosure only; all construct types and their
  config shapes are unchanged.

  **Acceptance criteria**
  - On first view, Composition leads with a recommended starter path: the Ask entry point plus a
    small auto-generated starter chart set (leveraging the existing `--auto-charts` capability) —
    presented as the suggested way to begin
  - The less-common constructs already on the Composition surface (**tables** and **summaries**) are
    collapsed behind a progressive-disclosure / "Advanced" affordance rather than shown expanded by
    default; **charts + indicators** remain the primary, always-visible constructs
  - No construct type is removed: expanding the "Advanced" affordance reveals tables and summaries
    with their full existing functionality intact
  - The disclosure control is keyboard-operable (real `<button>` with `aria-expanded`, accessible
    name, visible focus ring) and its expanded/collapsed state is exposed to assistive tech
  - Charts/indicators/summaries/tables remain editable as today (no behavior regression on the
    primary constructs)
  - Impeccable audit/critique clean on the restructured surface

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the starter path, disclosure
  state, and that no construct is removed are asserted by the Playwright E2E below, consistent
  with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/composition-progressive.spec.ts` (new) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — load Composition and assert the recommended starter path
  (Ask + starter charts affordance) is visible and that the advanced constructs (tables, summaries)
  are NOT expanded by default (their `aria-expanded` is `false` / their content is hidden); click
  the "Advanced" disclosure and assert tables + summaries become visible and editable; assert the
  disclosure toggles `aria-expanded`. Capture `toHaveScreenshot` baselines of the collapsed
  (starter) state and the expanded (Advanced) state at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. As a non-expert, open Composition for a project with downloaded data. Confirm the page leads
     with a clear, low-effort starting point (ask a question / a few starter charts) rather than a
     wall of construct types.
  2. Confirm advanced things (tables, summaries) are tucked behind an "Advanced" control
     and are not in your face by default.
  3. Click "Advanced" and confirm tables and summaries appear and still work exactly as before
     (nothing was taken away).

  **Verify:** `cd frontend && npx playwright test composition-progressive.spec.ts`

---

- [x] **PUX-2 — First-run / empty-state onboarding with a single recommended next action (P1)**

  **Created:** 2026-06-20 · **Completed:** 2026-06-21

  On first load the Home screen presents five equal-weight stage cards with no "start here"
  guidance (`frontend/src/pages/Home.jsx` `home-cards` ~75–100) — a confused first-timer has no
  recommended path (fails *Make the safe path the default* + *Help & documentation*, 2/4). Give a
  first-run / empty state that names the **single** recommended next action and de-emphasizes the
  rest until their prerequisites are met; returning users (who already have a connected form /
  downloaded data) see the normal five-card view unchanged.

  **Files:** `frontend/src/pages/Home.jsx` (first-run/empty-state branch + de-emphasis of
  not-yet-actionable cards) · `frontend/src/App.jsx` (any onboarding/readiness state — reuse the
  existing `/api/state` `has_questions`/`has_data` readiness flags already consumed elsewhere) ·
  `frontend/src/styles.css` (de-emphasis / call-to-action styling if needed)

  **Config/schema impact:** None — reuses the existing `/api/state` readiness flags
  (`has_questions`, `has_data`); no new state persisted.

  **Acceptance criteria**
  - When the project has no connected form / no downloaded data (per `/api/state` readiness), Home
    shows a first-run state with ONE primary recommended next action ("Connect your form →") that
    navigates to the Extract → Connection sub-page
  - In that first-run state the remaining stage cards are visibly de-emphasized (dimmed /
    secondary) and the recommended action is the clear focal point — exactly one primary CTA
  - Once prerequisites are met (form connected / data present), Home shows the normal full
    five-card view with no first-run overlay (returning-user path unchanged)
  - The de-emphasized cards remain reachable (not removed / not disabled to the point of being
    inaccessible) — guide, don't gate; the primary CTA is a real `<button>`/link with an
    accessible name and visible focus ring
  - Impeccable audit/critique clean on the first-run state

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the first-run branch and CTA are
  asserted by the Playwright E2E below, consistent with XTF-9's readiness-gating coverage).

  **E2E:** `frontend/tests/e2e/pux-2.spec.ts` (new) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — mock `/api/state` → `{has_questions:false,
  has_data:false}` and assert Home shows the single "Connect your form →" primary CTA, that the
  other stage cards carry the de-emphasized class, and that clicking the CTA navigates to Extract →
  Connection; then mock `{has_questions:true, has_data:true}` and assert the normal five equal
  cards render with no first-run overlay. Capture `toHaveScreenshot` baselines of both the
  first-run state and the returning-user state at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. Open a brand-new project (nothing connected, no data) and land on Home. Confirm there is one
     obvious, prominent next step ("Connect your form") and the other stages are clearly dimmed /
     secondary so you know where to start.
  2. Click the recommended action and confirm it takes you straight to connecting a form.
  3. Connect a form and download some data, then return to Home. Confirm the dimming is gone and
     all five stages are presented normally.

  **Verify:** `cd frontend && npx playwright test pux-2.spec.ts`

---

- [x] **PUX-1 — Plain-language relabeling of data-engineering vocabulary (P1)**

  **Created:** 2026-06-20 · **Completed:** 2026-06-22

  The Home workflow stages and several field labels use analyst / data-engineering terms the
  target non-expert users don't understand (fails *Match system ↔ real world*, 2/4). Examples:
  Home stage 03 **"Model"** is described as *"Build derived views — virtual tables of joins and
  aggregates, computed once and reused downstream"* (`frontend/src/pages/Home.jsx` `STAGE_CARDS`
  ~18–23); stage 02 is **"Transform"**; field-level terms include `export_label` (currently
  surfaced as "Report column name") and `kobo_key`. This card is **copy/label only — no behavior
  change**: rename/reword the user-facing stage names + descriptions and the most jargon-heavy
  field labels to outcome-oriented plain language, adding a one-line inline definition wherever a
  domain term is genuinely unavoidable. This is the priority card.

  **Files:** `frontend/src/pages/Home.jsx` (`STAGE_CARDS` labels + `desc` strings ~5–36) ·
  `frontend/src/pages/Composition.jsx` (jargon labels, e.g. "views" / "derived views" copy) ·
  `frontend/src/pages/Questions.jsx` (per-column labels — `export_label` / `kobo_key` user-facing
  copy + a one-line inline definition) · any shared label/string constants those pages import

  **Config/schema impact:** None — relabel only; the underlying config keys (`export_label`,
  `kobo_key`, `views`, stage ids) are unchanged, only their human-facing text.

  **Acceptance criteria**
  - The Home stage card currently labelled **"Model"** no longer uses the word "Model" or the
    phrase "virtual tables of joins and aggregates" in its visible label/description; it reads in
    outcome-oriented plain language (e.g. a "Combine / link your data" framing) understandable to
    a non-expert
  - The Home stage card currently labelled **"Transform"** is reworded to plain-language,
    outcome-oriented copy (no bare "Transform" jargon as the only label)
  - The field currently labelled for `export_label` reads as a plain-language report-friendly
    name with a one-line inline hint explaining it in user terms; the raw token `kobo_key` is
    never shown to the user without a one-line plain-language explanation alongside it
  - Wherever a domain term is genuinely unavoidable, a single-line inline definition accompanies
    it (no undefined jargon left standing on the audited surfaces)
  - **No behavior change**: stage ids, navigation targets, config keys, and saved values are
    byte-for-byte unchanged — only displayed text differs (the existing E2E flows still pass with
    updated expected copy)

  **Unit tests:** N/A (frontend-only copy change; Vitest is not installed — the relabeled strings
  and unchanged behavior are asserted by the Playwright E2E below, consistent with XTF-7's
  coverage approach).

  **E2E:** `frontend/tests/e2e/plain-language.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — load Home and assert the third stage card does NOT contain the text
  "Model" / "virtual tables" / "joins and aggregates" and DOES contain the new plain-language
  copy; navigate into that stage and assert the destination is unchanged (same sub-page loads);
  on Questions, assert the export-label field shows the new plain-language label + inline hint and
  that any `kobo_key` display is accompanied by an explanatory line. Capture `toHaveScreenshot`
  baselines of the relabeled Home cards and the relabeled Questions row at all three viewports
  (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. As a first-time M&E officer with no data-engineering background, open Home and read the five
     stage cards top to bottom. Confirm you can explain, in your own words, what each stage does —
     in particular that the third card no longer mentions "Model", "virtual tables", or "joins and
     aggregates".
  2. Click into that third stage and confirm it lands on the same page it always did (nothing
     moved — only the words changed).
  3. Open Questions and find the column that sets the report column name. Confirm its label and the
     one-line hint beside it tell you, in plain words, what it controls — and that any raw field
     code (`kobo_key`) is explained rather than shown bare.

  **Verify:** `cd frontend && npx playwright test plain-language.spec.ts`

---

