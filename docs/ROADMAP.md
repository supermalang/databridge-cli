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
- Security review clean — OWASP Top 10 + this repo's absolute rules (RBAC membership scoping, fail-closed PII gate, `env:` secret resolution, the `ALLOWED_COMMANDS` SSE whitelist, no raw-SQL interpolation); no Critical/High findings, via the `security-audit` agent (or `/security-review`)
- **Security & dependency review clean** — the `security-audit` agent (OWASP Top 10 + project
  absolute rules: tenant isolation, PII fail-closed, `env:` secrets, command whitelist) returns
  `SECURITY: CLEAR` with no open Critical/High finding; `dep-audit` (SCA) has run with no
  unresolved high/critical CVE **when `requirements*.txt` / `frontend/package.json` changed**;
  and a `/code-review` of the diff has no unresolved blockers. Cards with genuinely no
  security/dependency surface mark this `N/A (reason)` (same pattern as E2E/UAT) — the verifier
  validates the claim against the diff
- All changes committed and merged to the integration branch

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Output / export formats](#output--export-formats) | 3 | 3 / 3 |
| [Project management & top ribbon (UX)](#project-management--top-ribbon-ux) | 9 | 9 / 9 |
| [Accessibility (WCAG 2.1 AA)](#accessibility-wcag-21-aa) | 8 | 7 / 8 |
| [Product UX — non-expert self-serve](#product-ux--non-expert-self-serve) | 9 | 6 / 9 |
| [M&E capabilities](#me-capabilities) | 7 | 5 / 7 |
| [Express Template Fill](#express-template-fill) | 24 | 24 / 24 |
| [Visual / E2E harness](#visual--e2e-harness) | 2 | 2 / 2 |
| [Internationalization (i18n)](#internationalization-i18n) | 5 | 2 / 5 |
| [Project output language](#project-output-language) | 3 | 0 / 3 |
| [Performance](#performance) | 3 | 2 / 3 |
| [Maintenance & hardening](#maintenance--hardening) | 3 | 0 / 3 |

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

- [x] **OUT-1 — JSON export (records array)**

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

- [x] **OUT-2 — MySQL remote table export**

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

- [x] **OUT-3 — PostgreSQL remote table export**

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

- [x] **UX-1 — Show project color & icon**

  The create/edit form collects a color + emoji icon, but they're rendered nowhere — the
  switcher avatar still shows `name.slice(0,2)` and menu rows are text-only.

  **Files:** [frontend/src/App.jsx](../frontend/src/App.jsx) · project-menu rows · project list

  **Config/schema impact:** None — fields already persisted.

  **Acceptance criteria**
  - Icon/color shown in the switcher avatar, project-menu rows, and project list
  - Or: drop the pickers if the icon/color aren't wanted

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — create a project with a distinctive color and emoji, switch to it, and assert the switcher avatar and menu row both show the icon/color in a baseline screenshot. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Create a new project, set a color swatch and emoji icon in the form, and save. Open the project switcher and confirm the avatar displays the emoji on the chosen background color.
  2. Open the project menu and confirm the row for that project also shows the icon/color.
  3. If the pickers are removed instead, confirm no color/icon UI elements remain in the form.

---

- [x] **UX-2 — Keyboard-accessible project switcher**

  Menu rows are `<div onClick>` with no `role`/`tabIndex`/key handlers; the trigger lacks
  `aria-expanded`/`aria-haspopup`; dropdowns don't close on `Escape`.

  **Files:** `frontend/src/App.jsx` · the project switcher dropdown

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Rows are buttons (or `role="menuitem"` + Enter/Space activation)
  - Trigger exposes `aria-expanded`/`aria-haspopup`; `role="menu"` + Escape-to-close
  - Matches the existing `Modal` focus/Escape behavior

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project switcher by keyboard, navigate to a project row with ArrowDown, activate with Enter, and assert the project switches; assert Escape closes the dropdown without switching. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Tab to the project switcher trigger using only the keyboard. Press Enter and confirm the dropdown opens.
  2. Press ArrowDown to navigate to a project row, then press Enter to switch. Confirm the active project changes.
  3. Open the dropdown, then press Escape. Confirm the dropdown closes and focus returns to the trigger.

### Medium

---

- [x] **UX-3 — Archived rows look clickable but do nothing**

  Archived project rows reuse active-row styling (hover highlight) but have no row `onClick` —
  only the gear works.

  **Files:** the project switcher / project list

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Archived rows have an explicit Unarchive affordance / row action
  - Visually de-emphasized so they don't read as switchable

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — archive a project, open the project list, and take a baseline screenshot confirming the archived row is visually de-emphasized; click the Unarchive affordance and confirm the project returns to active state. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Archive a project via its settings. Open the project switcher and confirm the archived row appears visually distinct (dimmed or labelled) from active projects.
  2. Hover over the archived row and confirm no pointer-cursor or active-row highlight appears.
  3. Click the Unarchive affordance and confirm the project becomes active again.

---

- [x] **UX-4 — Unsaved-changes guard on the project form**

  [frontend/src/pages/ProjectForm.jsx](../frontend/src/pages/ProjectForm.jsx) has no dirty
  tracking; editing Details then hitting ← Back discards silently.

  **Files:** `frontend/src/pages/ProjectForm.jsx`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Wired into the existing `dirtyRef`/`DirtyProvider` guard used for project switching
  - Back/navigate-away with unsaved edits prompts to confirm

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — edit a project's name without saving, click Back, and assert a confirmation prompt appears; dismiss it and confirm the form remains with the unsaved change intact. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Open an existing project's edit form, change the name, then click the Back button. Confirm a confirmation dialog appears warning of unsaved changes.
  2. Click "Discard" in the dialog and confirm navigation proceeds, leaving the project name unchanged.
  3. Repeat, but click "Cancel" in the dialog. Confirm you remain on the form with the edited name intact.

---

- [x] **UX-5 — Member rows fall back to a raw UUID**

  [frontend/src/components/ProjectMembersPanel.jsx](../frontend/src/components/ProjectMembersPanel.jsx)
  renders `m.email || m.name || m.user_id`, so members without email/name show a UUID.

  **Files:** `frontend/src/components/ProjectMembersPanel.jsx` + the members endpoint

  **Config/schema impact:** None — populate email/name server-side.

  **Acceptance criteria**
  - Members show email/name, never a UUID
  - A "you" tag marks the current user

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open a project's Members panel and take a baseline screenshot confirming all rows show a human-readable identifier and the current user's row has a "you" tag. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Open the Members panel for a project. Confirm every member row shows an email address or display name, with no UUID visible.
  2. Confirm your own membership row is labelled with a "you" tag.
  3. As an admin, invite a user whose name is not yet populated server-side and confirm their row still shows a readable identifier (email at minimum).

### Low / polish

---

- [x] **UX-6 — Inline validation for required name (ProjectForm)**

  Currently a toast only. Add an inline error + disable submit until valid.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

  **Acceptance criteria**
  - An inline error message appears beneath the name field when it is empty
  - The submit button is disabled until the name field contains at least one character

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the create-project form, clear the name field, and attempt to submit; assert the inline error appears and the form is not submitted; enter a valid name and assert the error clears. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Open the create-project form and leave the name field empty. Confirm the Submit button is disabled and an inline error is visible beneath the name field.
  2. Type a single character in the name field. Confirm the Submit button becomes enabled and the inline error disappears.
  3. Submit the form with a valid name and confirm it succeeds with no toast error.

---

- [x] **UX-7 — Explain read-only email (ProfileForm)**

  Add "Managed by your sign-in provider" helper text so the disabled field doesn't look broken.

  **Files:** ProfileForm · **Impact:** None.

  **Acceptance criteria**
  - Helper text "Managed by your sign-in provider" (or equivalent) appears beneath the disabled email field
  - The field remains non-editable

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the Profile page and take a baseline screenshot confirming the email field is disabled and helper text is visible beneath it. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Open your Profile page. Confirm the email field is not editable (greyed out or disabled).
  2. Confirm helper text explaining the field is managed externally appears beneath the email input.
  3. Attempt to click into the email field and confirm no cursor or editing is possible.

---

- [x] **UX-8 — Accessible labels on color swatches / icon buttons**

  They convey meaning by color/emoji alone; add `aria-label` + `aria-pressed` on the selected one.

  **Files:** `frontend/src/pages/ProjectForm.jsx` · **Impact:** None.

  **Acceptance criteria**
  - Each color swatch has a descriptive `aria-label` (e.g. `aria-label="Red"`)
  - The currently selected swatch has `aria-pressed="true"`; all others have `aria-pressed="false"`
  - Icon buttons follow the same pattern

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — open the project form, inspect color swatches with an accessibility audit, and assert no color-name-only violations; select a swatch and assert `aria-pressed` state changes are reflected. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Open the create/edit project form and use a screen reader (or browser accessibility inspector) to navigate the color swatches. Confirm each swatch announces its color name.
  2. Select a swatch and confirm the screen reader announces it as "pressed" or "selected."
  3. Repeat for the emoji/icon picker buttons.

---

- [x] **UX-9 — Global "switching…" feedback**

  A brief unified indicator while a project switch hydrates (minor now that `pull_workspace`
  is parallelized).

  **Files:** `frontend/src/App.jsx` · **Impact:** None.

  **Acceptance criteria**
  - A visible loading indicator (spinner, progress bar, or overlay) appears during project switching
  - The indicator disappears once the workspace is ready
  - No double-hydration or flicker when switching rapidly

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the component behavior is asserted by the Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** Playwright spec + visual (impeccable audit/critique + toHaveScreenshot) — switch between two projects and assert a loading indicator is visible during the transition; take a baseline screenshot of the final settled state. Baselines captured at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900).

  **UAT:**
  1. Switch to a project that has a large workspace (several data files). Confirm a loading indicator appears immediately after clicking the project row.
  2. Confirm the indicator disappears once the dashboard is ready and no content is missing.
  3. Switch projects rapidly in succession and confirm no visual glitch or double-hydration occurs.

---

## Accessibility (WCAG 2.1 AA)

> App-wide accessibility remediation derived from the **2026-06-20 impeccable audit** of the
> React frontend (`frontend/src`). The project's accessibility target is now documented in
> `PRODUCT.md` / `DESIGN.md` as **WCAG 2.1 AA + low-bandwidth/field**. These cards cover the
> rest of the surface; the project-switcher / project-form a11y fixes are tracked separately as
> **UX-2** and **UX-8** (do not duplicate them here). Every card here is UI-facing, so E2E + UAT
> are real (not `N/A`); each E2E adds an explicit Playwright accessibility-audit (axe) assertion
> alongside the three-viewport `toHaveScreenshot` baselines. Vitest is **not** installed in this
> repo (see XTF-7), so frontend-only a11y assertions are covered by the Playwright E2E rather
> than a Vitest target. Ordered by priority (A11Y-1 P0 first).

---

- [x] **A11Y-1 — Keyboard-operable non-button controls (P0)**

  Several primary controls are implemented as non-interactive elements that keyboard users
  cannot reach or activate (WCAG 2.1.1 Keyboard, 4.1.2 Name/Role/Value). The data-source
  **platform cards** are `<div onClick>` with no `role`/`tabIndex`/key handler
  (`frontend/src/pages/Sources.jsx` ~323), so a keyboard user cannot pick Kobo vs Ona. The
  **Home stage cards** use `<div role="button">` (`frontend/src/pages/Home.jsx` ~77–98) and
  should be real `<button>`s. P0 because it blocks the very first step of the pipeline for
  keyboard/AT users.

  **Files:** `frontend/src/pages/Sources.jsx` (platform/source cards ~323) ·
  `frontend/src/pages/Home.jsx` (stage cards ~77–98) ·
  `frontend/src/styles.css` (only if the existing `:focus-visible` ring needs to apply to the
  new `<button>` elements) · `frontend/tests/e2e/a11y.spec.ts` (new)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The Sources platform cards (Kobo / Ona) are real `<button>`s (or `<div>`s with
    `role="button"` + `tabIndex={0}` + an `onKeyDown` handling **both** Enter and Space) — the
    selection action that currently fires on click also fires on keyboard activation
  - The Home stage cards are real `<button>` elements (not `<div role="button">`); each is
    reachable in DOM/tab order and activatable by keyboard
  - Both controls are reachable by Tab in a logical order and show the existing teal
    `:focus-visible` ring when focused via keyboard
  - Activating a platform card by keyboard selects the same platform as a mouse click (no
    behavior regression); activating a Home stage card navigates to the same destination
  - No `<div onClick>` without keyboard support remains on these surfaces

  **Unit tests:** N/A (frontend-only; Vitest is not installed — keyboard reachability/activation
  and roles are asserted by the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/a11y.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — on the Sources tab, Tab to a platform card and assert it receives focus
  with the visible focus ring; press Enter and assert the platform is selected; press Space on
  the other card and assert it selects; on Home, Tab to a stage card and assert it is a
  `<button>` (`getByRole('button')`) that navigates on Enter. Run a Playwright axe accessibility
  audit on both surfaces and assert no `button-name` / `keyboard` / interactive-role violations.
  Capture `toHaveScreenshot` baselines of the focused platform card and the Home stage cards at
  all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. On the Sources tab, using only the keyboard, press Tab until a platform card (Kobo/Ona) is
     focused. Confirm a visible focus ring appears.
  2. Press Enter on one card and Space on the other. Confirm each selects its platform exactly as
     a mouse click would.
  3. On the Home page, Tab to a stage card and press Enter. Confirm it activates/navigates.
  4. With a screen reader on, confirm each card is announced as a button with its accessible name.

  **Verify:** `cd frontend && npx playwright test a11y.spec.ts`

---

- [x] **A11Y-2 — ARIA roles + roving keyboard nav on tab interfaces (P1)**

  The app's several tab strips render as plain `<button>`s with no tab-interface semantics
  (WCAG 4.1.2; ARIA Authoring Practices tabs pattern): the primary six-tab nav, the secondary
  sub-tab strip, the **ProjectForm** tabs (`frontend/src/pages/ProjectForm.jsx` ~86), and the
  **profile-form** tabs. None expose `role="tablist"/"tab"/"tabpanel"`, `aria-selected`,
  `aria-controls`, or roving arrow-key navigation, so AT users can't tell which tab is active or
  move between tabs with the arrow keys. DESIGN.md's sidecar tab-nav snippet shows the target
  ARIA shape.

  **Files:** `frontend/src/App.jsx` (primary six-tab nav + secondary sub-tab strip) ·
  `frontend/src/pages/ProjectForm.jsx` (form tabs ~86) · the profile-form tab strip ·
  a small shared tab-strip helper if warranted ·
  `frontend/src/styles.css` (only if focus/selected styling must follow the new roles) ·
  `frontend/tests/e2e/a11y.spec.ts` (extend)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Each tab group exposes a `role="tablist"` container; every tab has `role="tab"`,
    `aria-selected` (`true` on the active tab, `false` otherwise), and `aria-controls` pointing
    at its panel
  - Each tab panel has `role="tabpanel"` and an id referenced by its tab's `aria-controls`
  - Roving tabindex: only the active tab is in the Tab order (`tabindex=0`); Left/Right (and
    Home/End) arrow keys move selection between tabs and update `aria-selected` + focus
  - Applies to all four tab groups: primary six-tab nav, secondary sub-tab strip, ProjectForm
    tabs, profile-form tabs
  - Switching tabs by keyboard shows the same panel as a mouse click (no behavior regression)

  **Unit tests:** N/A (frontend-only; Vitest is not installed — ARIA roles and arrow-key roving
  are asserted by the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/a11y.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — for the primary tab nav and the ProjectForm tabs: assert the container
  has `role="tablist"` and tabs have `role="tab"` with `aria-selected` reflecting the active
  one; focus a tab, press ArrowRight and assert focus + `aria-selected` move to the next tab and
  the corresponding `role="tabpanel"` (via `aria-controls`) is shown; press Home/End and assert
  first/last tab activate. Run a Playwright axe audit on a tabbed view and assert no ARIA tab
  violations. Capture `toHaveScreenshot` baselines of a tablist with the second tab active at all
  three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. With a screen reader, navigate to the primary tab strip. Confirm it is announced as a tab
     list and the active tab is announced as "selected".
  2. Focus a tab and press the Right arrow. Confirm focus and selection move to the next tab and
     its panel is shown; press Home and End and confirm they jump to the first/last tab.
  3. Repeat for the ProjectForm tabs and the profile-form tabs and confirm the same behavior.

  **Verify:** `cd frontend && npx playwright test a11y.spec.ts`

---

- [x] **A11Y-3 — Programmatic labels on form controls (P1)**

  Several inputs are labeled only visually or by placeholder, so AT users get no accessible name
  (WCAG 3.3.2 Labels or Instructions, 4.1.2 Name/Role/Value): the YAML `<textarea>`
  (`frontend/src/pages/Sources.jsx` ~193), the invite email input
  (`frontend/src/components/ProjectMembersPanel.jsx` ~110), per-row export-label inputs
  (`frontend/src/pages/Questions.jsx` ~364), and other unlabeled inputs across
  Composition/Sources. Placeholders disappear on input and are not a substitute for a label.

  **Files:** `frontend/src/pages/Sources.jsx` (YAML textarea ~193 + any other unlabeled inputs) ·
  `frontend/src/components/ProjectMembersPanel.jsx` (invite email input ~110) ·
  `frontend/src/pages/Questions.jsx` (per-row export-label inputs ~364) ·
  `frontend/src/pages/Composition.jsx` (remaining unlabeled inputs) ·
  `frontend/tests/e2e/a11y.spec.ts` (extend)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Every `<input>`, `<select>`, and `<textarea>` on the audited surfaces has an associated
    `<label>` (via `htmlFor`/`id`) **or** an `aria-label`/`aria-labelledby`
  - No control relies on a `placeholder` as its only label (placeholders may remain as
    supplementary hint text, never as the accessible name)
  - Specifically labeled: the YAML textarea (Sources), the invite email input (Members panel),
    each per-row export-label input (Questions), and the remaining Composition/Sources inputs
  - Per-row inputs (export-label) have unique, row-disambiguated accessible names (e.g.
    referencing the question) so AT users can tell rows apart

  **Unit tests:** N/A (frontend-only; Vitest is not installed — accessible-name presence is
  asserted by the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/a11y.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — on Sources, Questions, Members panel, and Composition, resolve each
  audited control via `getByLabel(...)` / `getByRole('textbox', {name})` and assert it has a
  non-empty accessible name; run a Playwright axe audit on each surface and assert no `label` /
  `aria-input-field-name` violations. Capture `toHaveScreenshot` baselines of the labeled Sources
  YAML field and the Questions export-label rows at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. With a screen reader, Tab through the Sources YAML editor, the Questions export-label inputs,
     the invite email field, and Composition inputs. Confirm each control announces a descriptive
     name (not silence and not just its placeholder).
  2. Type into and then clear a field that previously relied on a placeholder; confirm the
     control still has a visible/announced label after the placeholder disappears.
  3. In Questions, confirm two different rows' export-label inputs announce distinguishable names.

  **Verify:** `cd frontend && npx playwright test a11y.spec.ts`

---

- [x] **A11Y-4 — Valid interactive semantics & icon-button names (P1/P2)**

  Two defects: (1) report download links nest interactive elements —
  `<a><button>…</button></a>` (`frontend/src/pages/Reports.jsx` ~187) — which is invalid HTML
  and unpredictable for AT (WCAG 4.1.1 Parsing / nested-interactive). (2) Icon-only buttons rely
  on `title` alone and have no accessible name (`frontend/src/pages/Validate.jsx` ~140–153, and
  similar icon buttons elsewhere) (WCAG 4.1.2). Fix by collapsing the download to a single
  styled `<a download>` and giving every icon-only button an `aria-label`.

  **Files:** `frontend/src/pages/Reports.jsx` (download link ~187 → single styled `<a download>`) ·
  `frontend/src/pages/Validate.jsx` (icon-only buttons ~140–153) · other icon-only buttons that
  rely on `title` alone (e.g. across Composition/Reports/Sources) ·
  `frontend/src/styles.css` (only if a link needs button-like styling) ·
  `frontend/tests/e2e/a11y.spec.ts` (extend)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The report download is a single `<a download href=…>` styled like a button — no `<button>`
    nested inside an `<a>` (and no other nested-interactive pairs on the audited surfaces)
  - The download link has an accessible name describing the action/target (e.g. "Download
    <report name>") and still downloads the file
  - Every icon-only button has an `aria-label` (the `title` may remain as a tooltip but is no
    longer the only accessible name); specifically the Validate icon buttons (~140–153)
  - A Playwright axe audit reports no `nested-interactive` and no `button-name` violations on the
    Reports and Validate surfaces

  **Unit tests:** N/A (frontend-only; Vitest is not installed — markup validity and accessible
  names are asserted by the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/a11y.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — on Reports, assert the download resolves as a link
  (`getByRole('link', {name})`) with no nested `<button>` (assert no `button` descendant inside
  the anchor); on Validate, resolve each icon button via `getByRole('button', {name})` and assert
  a non-empty accessible name. Run a Playwright axe audit on both surfaces and assert zero
  `nested-interactive` and `button-name` violations. Capture `toHaveScreenshot` baselines of the
  Reports download control and the Validate icon-button row at all three viewports (mobile
  390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. On the Reports tab, with a screen reader, navigate to a report's download control. Confirm it
     is announced as a single link with a descriptive name and that activating it downloads the
     `.docx` (no double-focus / no nested button).
  2. On the Validate tab, Tab to each icon-only button and confirm it announces a meaningful name
     (not "button" with no label).
  3. With the browser accessibility inspector, confirm no element reports nested interactive
     content on these pages.

  **Verify:** `cd frontend && npx playwright test a11y.spec.ts`

---

- [x] **A11Y-5 — Accessible form-validation messaging (P2)**

  Modal field errors in Composition (and other forms) are rendered visually but are not linked to
  their inputs, so screen readers don't announce them when a field is invalid (WCAG 3.3.1 Error
  Identification, 3.3.3 Error Suggestion, 4.1.2/4.1.3). Invalid fields need `aria-invalid` and an
  `aria-describedby` pointing at their error text.

  **Files:** `frontend/src/pages/Composition.jsx` (modal field-error wiring) · other forms with
  inline field errors (e.g. ProjectForm's inline name error from UX-6, and any Sources/Questions
  field errors) · a small shared field-error helper if warranted ·
  `frontend/tests/e2e/a11y.spec.ts` (extend)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - When a field is invalid, the input sets `aria-invalid="true"` and `aria-describedby`
    referencing the id of its error message element; when valid, `aria-invalid` is removed/`false`
    and the describedby link is cleared
  - Each error message element has a stable id and is programmatically associated with exactly its
    field (no shared/ambiguous ids across rows)
  - The error text is reachable by assistive tech (announced when focus is on the field, e.g. via
    `aria-describedby`; a live-region / `role="alert"` is acceptable where the error appears
    asynchronously)
  - Applies to the Composition modal field errors and the other forms listed above
  - A Playwright axe audit on the Composition modal in an invalid state reports no
    `aria-valid-attr` / `aria-describedby`-target violations

  **Unit tests:** N/A (frontend-only; Vitest is not installed — `aria-invalid`/`aria-describedby`
  wiring is asserted by the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/a11y.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — open the Composition modal, submit/trigger a validation error on a field,
  and assert the input has `aria-invalid="true"` and an `aria-describedby` whose target element
  contains the error text; correct the field and assert `aria-invalid` clears. Run a Playwright
  axe audit on the invalid-state modal and assert no relevant violations. Capture
  `toHaveScreenshot` baselines of the modal in its invalid (error-shown) state at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. Open a Composition modal (e.g. add/edit a chart) and submit it with a required field empty or
     invalid. Confirm an inline error appears.
  2. With a screen reader, move focus onto the invalid field. Confirm the error message is
     announced (the field is marked invalid and its description is read).
  3. Correct the field and confirm the invalid state and announced error clear.

  **Verify:** `cd frontend && npx playwright test a11y.spec.ts`

---

- [x] **A11Y-6 — Full-opacity focus ring on de-emphasized Home stage cards (P2)**

  Follow-up from PUX-2. In the first-run Home state the de-emphasized stage cards use
  `.home-card-wrap.is-dimmed{opacity:.55}`, and the intended focus restore
  `.home-card.is-dimmed:focus-visible{opacity:1}` (`frontend/src/styles.css` ~459-461) cannot
  take effect — opacity on the parent wrap establishes a group, so the focus ring on a dimmed
  card renders at 55% opacity (WCAG 2.4.7 Focus Visible). Keyboard users get a washed-out focus
  indicator on exactly the cards PUX-2 added. Note the `:hover` rule already raises the *wrap*
  opacity; focus needs the same treatment on the wrap.

  **Files:** `frontend/src/styles.css` (`.home-card-wrap.is-dimmed` focus/hover rules ~459-461 —
  remove the dead `.home-card.is-dimmed:focus-visible{opacity:1}` line and restore opacity on the
  wrap via `:focus-within`) · `frontend/tests/e2e/pux-2.spec.ts` (extend)

  **Config/schema impact:** None — CSS only.

  **Acceptance criteria**
  - When a dimmed Home stage card receives keyboard focus, the card **wrap** renders at full
    opacity (un-dims on `:focus-within`, mirroring the existing `:hover` rule) so the teal
    `:focus-visible` ring is shown at full strength
  - The dim (opacity .55) returns once focus leaves the card
  - No change to mouse/hover behavior, and no change to the returning-user (non-dimmed) cards
  - A Playwright axe audit on the first-run Home reports no new violations

  **Unit tests:** N/A (frontend-only; Vitest is not installed — focus opacity/ring is asserted by
  the Playwright E2E below, consistent with XTF-7's coverage approach).

  **E2E:** `frontend/tests/e2e/pux-2.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — in the first-run state, Tab to a dimmed stage card and assert the computed
  opacity of its `.home-card-wrap` is `1` (not `0.55`) while focused and that the focus outline is
  present; blur and assert the wrap returns to the dimmed opacity. Capture `toHaveScreenshot`
  baselines of a focused dimmed card at all three viewports (mobile 390×844, tablet 820×1180,
  desktop 1440×900); a human approves them.

  **UAT:**
  1. Open a brand-new project (first-run Home). Using only the keyboard, Tab to one of the dimmed
     stage cards. Confirm it brightens to full opacity and shows a clearly visible teal focus ring.
  2. Tab away and confirm the card dims back to its secondary state.
  3. Open a returning project (form + data) and confirm its Home cards are unaffected.

  **Verify:** `cd frontend && npx playwright test pux-2.spec.ts`

---

- [x] **A11Y-7 — Stabilize the flaky A11Y-4 Validate test (keep-alive findings-visibility race) (P2)**

  Carved out of VIS-2. The A11Y-4 "non-empty aria-label" Validate test
  (`frontend/tests/e2e/a11y-4.spec.ts`) is heavily flaky (~50–80% fail, reproducible even at
  `--workers=1`): after navigating Transform → Validate, the finding row + its action buttons render
  in the DOM (confirmed in the Playwright trace) but `.validate-finding` is not *visible* within the
  wait window, then appears later. The likely root cause is the keep-alive pane machinery
  (`frontend/src/App.jsx` pane epoch / `databridge:data-changed` remount + lazy pane mount) interacting
  with `Validate`'s mount-time auto-scan (`frontend/src/pages/Validate.jsx` `runValidation` on mount)
  and/or `GroupTree`'s once-initialized open-state (`frontend/src/components/GroupTree.jsx`) — the
  Validate pane can stay hidden / the findings node collapsed when the scan result and questions
  arrive in an unlucky order. Diagnose the true cause and fix it at the right layer (app source if it
  is a real keep-alive/GroupTree bug; a deterministic test-wait if it is purely a harness race).

  **Files:** `frontend/src/components/GroupTree.jsx` and/or `frontend/src/pages/Validate.jsx` and/or
  `frontend/src/App.jsx` (the actual fix, once root-caused) · `frontend/tests/e2e/a11y-4.spec.ts`
  (deterministic settle wait) · `frontend/tests/e2e/a11y-4.spec.ts-snapshots/` (regenerate if rendering changes)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The A11Y-4 Validate "non-empty aria-label" test passes deterministically on `--repeat-each=10` at
    all three viewports (mobile/tablet/desktop) — no intermittent failures
  - The root cause is identified and fixed at the correct layer; if it is an app bug (Validate findings
    can render hidden / collapsed depending on fetch ordering), the app is fixed so findings are
    reliably visible once a scan completes
  - The full `a11y-4.spec.ts` (both tests, all viewports) is green, including its `toHaveScreenshot`
    baselines (regenerated + human-approved if the fix changes rendering)
  - No regression to the A11Y-4 accessibility behavior already shipped (single download link + icon-button aria-labels)

  **Unit tests:** N/A (frontend-only; Vitest is not installed — asserted by the Playwright E2E,
  consistent with the A11Y-area convention).

  **E2E:** `frontend/tests/e2e/a11y-4.spec.ts` — green and stable on `--repeat-each=10` at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); regenerate the `toHaveScreenshot`
  baselines for human approval if the fix changes rendering.

  **UAT:**
  1. Run `cd frontend && npx playwright test a11y-4 --repeat-each=10` and confirm 0 failures.
  2. In the app, open Transform → Validate on a project with findings and confirm the findings (and
     their Flag-as-PII / Hide-column icon buttons) appear reliably on first load.
  3. Switch away and back to Validate and confirm the findings remain visible (no blank/collapsed state).

  **Verify:** `cd frontend && npx playwright test a11y-4 --repeat-each=10`

---

- [ ] **A11Y-8 — Deferred a11y polish: home-card subtext contrast + picker focus ring (P2)**

  Two small WCAG gaps deferred earlier. (a) `.home-card__sub` muted text is ~3.15:1 (`#858c98` on
  `#f5f7fa`) — fails WCAG 2.1 AA 1.4.3 (needs 4.5:1). (b) The ProjectForm color swatches / icon
  buttons (`.pf-swatch` / `.pf-icon`, from UX-8) have no explicit `:focus-visible` ring (rely on the
  UA default). CSS-only.

  **Files:** `frontend/src/styles.css` · `frontend/tests/e2e/a11y-8.spec.ts` (new)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `.home-card__sub` meets WCAG AA contrast (>= 4.5:1) against its background; an axe `color-contrast`
    audit on Home reports no violation on the stage-card subtext
  - The color swatches + icon buttons show the app's teal `:focus-visible` ring on keyboard focus;
    mouse behavior unchanged
  - No other Home/ProjectForm visual regression (baselines refreshed + human-approved if the darker
    subtext shifts them)

  **Unit tests:** N/A (frontend CSS; Vitest not installed — asserted by the Playwright E2E below).

  **E2E:** `frontend/tests/e2e/a11y-8.spec.ts` (new) + visual — axe `color-contrast` on Home asserts no
  `.home-card__sub` violation; on the ProjectForm pickers, keyboard-focus a swatch/icon and assert a
  visible outline (non-`none`, non-zero). `toHaveScreenshot` baselines at all three viewports (mobile
  390x844, tablet 820x1180, desktop 1440x900); a human approves them.

  **UAT:**
  1. On Home, confirm the stage-card descriptions are comfortably legible (darker than before).
  2. On the project form, Tab to a color swatch + an icon button; confirm a clear teal focus ring.
  3. Confirm Home + the project form otherwise look unchanged.

  **Verify:** `cd frontend && npx playwright test a11y-8.spec.ts`

---

## Product UX — non-expert self-serve

> Findings from the **2026-06-20 HCD / product critique** of the React frontend. `PRODUCT.md`
> defines the users as **M&E officers + field coordinators (mixed / low technical skill)** with
> the outcome **self-serve for non-experts**, under the design principles *Guide don't gate ·
> Plain language over jargon · Make the safe path the default · Credible over clever · Respect
> the field*. The critique scored the app **28/40** (Good, lower end); the two weakest Nielsen
> heuristics were **Match between system & real world (2/4)** and **Help & documentation (2/4)**.
> Core theme: the product is built like an analyst's instrument but is meant for non-expert field
> staff. Every card here is UI-facing, so E2E + UAT are real (not `N/A`). Vitest is **not**
> installed in this repo (see XTF-7), so frontend-only assertions are covered by the Playwright
> E2E rather than a Vitest target; cards touching a Python web endpoint add a real pytest target.
> Ordered by priority (PUX-1 P1, the chosen first priority, first).

---

- [x] **PUX-1 — Plain-language relabeling of data-engineering vocabulary (P1)**

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

- [x] **PUX-2 — First-run / empty-state onboarding with a single recommended next action (P1)**

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

- [x] **PUX-3 — Reduce Composition cognitive load via progressive disclosure (P1)**

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

- [x] **PUX-4 — In-app contextual help per stage (P2)**

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

- [x] **PUX-5 — Reduce setup-before-value friction (demo / sample path) (P2)**

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

- [x] **PUX-6 — Harden Home first-run readiness fetch (error + project-switch) (P2)**

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

- [ ] **PUX-7 — Gate Fetch/Download on a confirmed connection; flip the sample-data affordance (P2)**

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

- [ ] **PUX-8 — Primary navigation labels adopt the PUX-1 plain-language stage names (P2)**

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

- [ ] **PUX-9 — Copy-placeholder buttons for charts / indicators / summaries / tables on the Analyze tab (P2)**

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

## M&E capabilities

> Still-open gaps from the 2026-04-07 M&E audit. The audit's top findings have **shipped** —
> see *Shipped foundations* above. The full original audit + scorecard is archived at
> [docs/archive/2026-04-07-me-audit.md](archive/2026-04-07-me-audit.md). What remains:

---

- [x] **ME-1 — Equity / inclusion lens**

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

- [x] **ME-2 — Variance / traffic-light dashboards**

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

- [x] **ME-3 — Indicator metadata catalog**

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

- [x] **ME-4 — Multi-form / longitudinal linkage**

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

- [x] **ME-5 — Sampling weights**

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

- [ ] **ME-6 — Surface below-threshold indicators in the Validate panel (P2)**

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

- [ ] **ME-7 — Chart `form:` selector for multi-form (P2)**

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
>
> **Follow-up fix batch (XTF-19–XTF-23):** post-ship fixes to the Express fill flow and the
> report pipeline behind it, designed in
> [docs/superpowers/specs/2026-06-19-express-fill-fixes-design.md](superpowers/specs/2026-06-19-express-fill-fixes-design.md)
> (root causes, chosen approach, file paths, per-issue Tests). They are independent of each other
> and depend on XTF-1–XTF-18 (shipped).

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

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

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

- [x] **XTF-18 — Fix: express-path terminal does not auto-collapse after ~5s**

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

- [x] **XTF-19 — Storage push mirrors output categories (fixes split-preview leaving stale reports)**

  Bug from the follow-up batch (issue ① in the spec). `push_outputs`
  (`web/storage/workspace.py` ~64–72) is **merge-only**: a split preview that builds 2 reports into
  the run tempdir uploads those 2 but never deletes the ~24 prior report objects already in durable
  storage. `_persist_run_outputs` (`web/main.py` ~1683–1697) then `pull_workspace`s **everything**
  back into the local mirror, so the old reports reappear — durable storage acts as an un-pruned
  cache. `build-report`'s run inputs are `["processed","templates"]` (NOT `reports`), so the tempdir
  already holds exactly this run's outputs. Fix: add a per-command **output** category map and make
  the push **mirror-delete** (delete storage objects under a category's prefix that are absent from
  the tempdir set) **only for the command's declared output categories**; every other category stays
  merge-only. This MUST avoid the footgun where `download` (which hydrates neither `reports` nor
  `templates`) wipes them. Independent of XTF-20/21/22. Depends on **XTF-1–XTF-18** (shipped).

  **Files:** `web/storage/workspace.py` (new `RUN_OUTPUTS` map e.g.
  `{"build-report":["reports"], "run-all":["reports"], "generate-template":["templates"],
  "ai-generate-template":["templates"], "download":["processed"]}`; teach `push_outputs` to
  mirror-delete the declared output categories using `store.list(prefix)` + single-key
  `delete_project_file`/`store.delete`, leaving undeclared categories merge-only) · `web/main.py`
  (`_persist_run_outputs` accepts/forwards the run `command` so the push knows which categories to
  mirror; thread the command through from the run path that calls it) · `tests/test_workspace.py`

  **Config/schema impact:** None. Reports/templates/processed are regenerable run outputs; a run
  replaces its own declared categories.

  **Acceptance criteria**
  - A per-command `RUN_OUTPUTS` map declares the output categories each command produces
    (`build-report`/`run-all` → `reports`; `generate-template`/`ai-generate-template` → `templates`;
    `download` → `processed`); commands with no declared outputs prune nothing
  - For a command's declared output categories, the push deletes durable-storage objects under that
    category prefix that are NOT present in the local/tempdir set (mirror-delete), then uploads the
    current set
  - All categories NOT declared as outputs for that command stay **merge-only** (no deletes) — in
    particular `download` never touches `reports`/`templates` storage objects
  - After the push + a subsequent `pull_workspace`, the local mirror for a mirrored category equals
    exactly the tempdir's set (no resurrected stale files)
  - Only `store.list(prefix)` + single-key delete are used (no new S3 calls / no `delete_prefix`
    blanket wipe)

  **Unit tests:** `tests/test_workspace.py` (using the local/fake storage backend the existing
  workspace tests use) — (1) `test_push_mirrors_build_report_reports`: seed durable storage with 26
  stale `reports` objects, build a tempdir holding exactly 2 report `.docx`, run the push for command
  `build-report`, and assert durable storage AND a subsequent `pull_workspace` mirror end with
  exactly those 2. (2) `test_download_push_leaves_reports_and_templates`: with existing `reports`
  and `templates` objects in storage, run the push for command `download` (declares only
  `processed`) and assert the `reports`/`templates` objects are untouched (regression guard against
  the wipe footgun). (3) `test_generate_template_push_mirrors_only_templates`: a `generate-template`
  push mirrors `templates` to the tempdir set and leaves existing `reports` objects untouched.

  **E2E:** N/A (back-end storage behavior — no UI surface of its own; the Reports list just reflects
  durable storage. Human gate is the unit tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_workspace.py`

---

- [x] **XTF-20 — Reports listing shows storage build-time (with local-mtime fallback)**

  Bug from the follow-up batch (issue ② in the spec, read/listing half). `GET /api/reports`
  (`web/main.py` ~1826–1835) reports each file's **local mtime**, but `pull_workspace`'s S3
  `download_file` resets local mtime to pull-time — so every pulled report shows "today" regardless
  of when it was built. Fix: the listing surfaces each file's **storage object last-modified**
  (push/build time), falling back to local mtime in pure-local mode when there is no storage object
  (the filename's `_YYYYMMDD` is already correct and unchanged). Needs a storage last-modified
  accessor: the `Storage` base currently has no `last_modified`/stat method — add one to the
  abstraction and the local + S3 backends. Durable deletes are the separate XTF-23 deliverable; this
  card is read/listing only. Shares no blocking dependency with XTF-23. Independent of XTF-21/22.
  Depends on **XTF-1–XTF-18** (shipped).

  **Files:** `web/main.py` (`list_reports` ~1826 surfaces storage last-modified with a local-mtime
  fallback) · `web/storage/base.py` (add a `last_modified(key)` / stat accessor to the `Storage`
  abstraction) · `web/storage/*` backends (implement `last_modified` on the local + S3 backends) ·
  `tests/test_reports_api.py` (existing reports-API test file; extend it)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `GET /api/reports` returns, for each report, a `modified` timestamp sourced from the **storage
    object's last-modified** (push/build time), not the reset local mtime
  - When no storage object exists for a file (pure-local mode), the listing falls back to local
    mtime without erroring
  - A `Storage.last_modified(key)` (or equivalent stat) accessor exists on the abstraction and the
    local + S3 backends and returns the object's last-modified time

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_list_reports_uses_storage_modified`: with
  a fake/spy storage backend returning a known last-modified for a report key (distinct from the
  local file's reset mtime), assert the listing's `modified` reflects the STORAGE value, not the
  local mtime. (2) `test_list_reports_local_fallback`: a file with no storage object falls back to
  local mtime without error. (3) `test_storage_last_modified_implemented`: assert
  `Storage.last_modified(key)` is implemented on BOTH the local and S3 backends and returns the
  object's last-modified time.

  **E2E:** N/A (back-end API behavior, no UI surface of its own — consistent with XTF-8; the Reports
  tab consumes the value but the change is back-end. Human gate is the unit tests + the verifier + PR
  review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py`

---

- [x] **XTF-21 — Express split-by dropdown no longer clipped (CSS stacking)**

  Bug from the follow-up batch (issue ③ in the spec). In the Express review panel (shown after
  Infer), the "Split by" combobox menu is clipped/hidden behind sibling content when opened:
  `.express-review-panel { overflow: hidden }` (`frontend/src/styles.css` ~925) clips the
  absolutely-positioned `.build-combo__list` (`position:absolute; z-index:30`,
  `frontend/src/styles.css` ~1014–1020). Fix: let the menu escape its container — preferred remove
  `overflow: hidden` from `.express-review-panel` (it's there for border-radius cosmetics; verify
  nothing depends on it) and ensure the combo list stacks above sibling rows; fallback if rounded
  corners regress, keep overflow but raise `.build-combo` into its own stacking context / render the
  menu so it is not clipped. UI-facing. Depends on **XTF-17** (the searchable combo) +
  **XTF-1–XTF-18** (shipped). Independent of XTF-19/20/22.

  **Files:** `frontend/src/styles.css` (`.express-review-panel`, `.build-combo` /
  `.build-combo__list`) · possibly `frontend/src/components/BuildOptions.jsx` (only if a structural
  tweak is needed to lift the menu out of the clipping context) ·
  `frontend/tests/e2e/express-template-fill.spec.ts` (extend with the open-dropdown assertion +
  baselines)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - After Infer, opening the Express "Split by" combobox shows the full options listbox, not clipped
    by the review panel (the listbox extends beyond the panel's rounded-corner bounds when needed)
  - The open listbox stacks above the sibling rows/content of the review panel (correct z-order)
  - The `.express-review-panel` retains its rounded corners (border-radius unchanged) and clips no
    other content — verified by the desktop `toHaveScreenshot` baseline of the closed-panel state
  - Keyboard/typeahead behavior of the combobox (from XTF-17) is unchanged
  - Impeccable audit/critique clean on the open-dropdown state in the Express panel

  **Unit tests:** N/A (frontend-only CSS/stacking change; Vitest is not installed — the fix is
  asserted by the Playwright E2E below, consistent with XTF-5/XTF-7/XTF-17).

  **E2E:** `frontend/tests/e2e/express-template-fill.spec.ts` (extend) + visual (impeccable
  audit/critique + `toHaveScreenshot`) — drive the Express flow to the review panel (after Infer),
  open the "Split by" combobox, and assert the listbox is visible and **not clipped** by the panel
  (e.g. its bounding box extends past the panel's clip bound / it is fully visible above sibling
  rows). Capture a `toHaveScreenshot` baseline of the OPEN-dropdown state AND the closed-panel state
  (to prove rounded corners are retained) at all three viewports (mobile 390×844, tablet 820×1180,
  desktop 1440×900); a human approves the new baselines.

  **UAT:**
  1. Templates tab → "In a hurry?" Express fill. Upload a `.docx` with placeholders and click Infer.
     Expected: the review panel appears with per-placeholder rows.
  2. At desktop width (~1440px) click the "Split by" field. Expected: the dropdown opens and every
     option row is fully readable, with the bottom-most option rendered below the panel's lower edge
     (not sliced by the panel border).
  3. Type into the field to filter (XTF-17 typeahead). Expected: the list narrows and stays fully
     visible above the rows beneath it.
  4. Narrow the window to ~390px (mobile) and repeat step 2. Expected: the open list is still fully
     visible and not clipped; panel corners remain rounded.
  5. Close the dropdown. Expected: the panel returns to its rounded-corner state with no visual
     artifact.

  **Verify:** `cd frontend && npx playwright test express-template-fill.spec.ts`

---

- [x] **XTF-22 — Deterministic auto-modeling resolver for cross-table columns**

  Feature from the follow-up batch (issue ④ in the spec). Infer rejects placeholders whose column
  lives in a repeat-group base table because validation defaults `source` to `"main"`
  (`src/reports/ask_engine.py` ~79–116; `src/reports/template_inference.py` ~306–327) — even though
  the inference catalog already includes ALL tables and `builder._pick_df`
  (`src/reports/builder.py` ~34–71) already auto-selects the right table at build time. Add a
  deterministic pass `resolve_sources(proposals, profile)` (plain Python, no extra LLM tokens) that
  runs AFTER `infer_specs` and BEFORE `annotate_proposals`. For each data proposal, collect the
  referenced columns (`questions` + `group_by`) and map each to the profile table(s) containing it:
  all-in-`main` → leave as-is; all-in-one-non-main-table → stamp `source: <table>` (use the
  `_pick_df` most-columns-match heuristic when a column appears in several tables); spans a repeat
  table + `main` (join case) → synthesize a persisted view
  `{name, source:<repeat_table>, join_parent:[<main cols>]}` carrying `group_by`/`question`/`agg`
  only when the chart is inherently aggregated, and point the spec's `source` at the new view;
  stuck (column in no table, or genuine tie) → keep `needs_attention` with a reason naming the
  candidate tables. Synthesized views are persisted into `config.yml` `views:` on **apply**
  (`/api/template/apply`), NOT on infer; view names are deterministic + collision-safe (e.g.
  `auto_<repeat_leaf>__<joincols>`, de-duped against existing `views:`) so re-running Infer is
  idempotent. Validation already validates against the resolved `source` once stamped. Back-end
  (the express UI flow is already covered by XTF-5/6). Depends on **XTF-1–XTF-18** (shipped).
  Independent of XTF-19/20/21.

  **Files:** `src/reports/template_inference.py` (new `resolve_sources`, or a small new module it
  imports) · `web/main.py` (`/api/template/infer` runs `resolve_sources` between `infer_specs` and
  `annotate_proposals`; `/api/template/apply` persists any synthesized views into config `views:`) ·
  `tests/test_template_inference.py` (resolver unit cases) · `tests/test_template_api.py` (the
  apply-persists-view API case)

  **Config/schema impact:** None to the schema. Synthesized entries use the existing `views:` shape
  (`name`, `source`, `join_parent`, optional `group_by`/`question`/`agg`); on apply they are appended
  to `config["views"]` de-duped by name.

  **Acceptance criteria**
  - `resolve_sources(proposals, profile)` runs after `infer_specs` and before `annotate_proposals`
    and resolves each data proposal's `source` deterministically (no LLM call)
  - A proposal whose referenced columns all live in a single repeat-group table gets `source`
    stamped to that table and validates clean (no `needs_attention`)
  - A proposal referencing a repeat-group column + a `main` column yields a synthesized view
    `{source:<repeat_table>, join_parent:[<main col>]}` and the spec's `source` points at the view
  - Synthesized view names are deterministic and collision-safe (de-duped against existing `views:`),
    so re-running the resolver on the same proposals is idempotent (no duplicate view names)
  - A column present in NO table stays `needs_attention` with a reason that no table contains it; a
    genuine multi-table tie stays `needs_attention` with a reason naming both candidate tables
  - `/api/template/apply` persists any synthesized views into the config `views:` section (appended,
    de-duped); `/api/template/infer` returns proposals carrying the resolved `source` (+ any pending
    synthesized-view definitions)

  **Unit tests:** `tests/test_template_inference.py` — (1) `test_resolve_single_repeat_column`: a
  chart referencing one repeat-group column gets `source` stamped to that table and `annotate_proposals`
  returns `status: ok` (no `needs_attention`). (2) `test_resolve_join_synthesizes_view`: a chart
  referencing a repeat column + a main column yields a synthesized view with `source` = repeat table
  and `join_parent` = `[main col]`, and the spec sources the view. (3) `test_resolve_idempotent`:
  running the resolver twice produces no duplicate synthesized-view names. (4)
  `test_resolve_unknown_column_flagged`: a column in no table stays `needs_attention` with a reason
  saying no table contains it. (5) `test_resolve_tie_flagged`: a genuine multi-table tie stays
  `needs_attention` with both candidate tables named. Plus `tests/test_template_api.py` —
  `test_apply_persists_synthesized_view`: `/api/template/apply` with a proposal carrying a synthesized
  view writes that view into `config["views"]` (appended, de-duped).

  **E2E:** N/A (back-end inference logic — no UI surface of its own; the express UI flow is covered by
  XTF-5/XTF-6. Human gate is the unit/API tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py tests/test_template_api.py`

---

- [x] **XTF-23 — DELETE /api/reports (all + single) deletes durable storage objects**

  Bug from the follow-up batch (issue ② in the spec, durable-delete half). `DELETE /api/reports`
  (`web/main.py` ~1848) and `DELETE /api/reports/{filename}` (~1858) only `unlink` local files, so a
  delete is undone by the next run's `pull_workspace` (the durable storage object survives and is
  re-pulled). Fix: both handlers also delete the corresponding `reports` storage object(s) via
  `delete_project_file` (resolved for the caller's active org/project) so manual cleanup is durable.
  Shares the durable-delete primitive (`delete_project_file`) with XTF-19 but does **not** block on
  it — coordinate so whichever merges second rebases cleanly. Independent of XTF-20/21/22. Depends on
  **XTF-1–XTF-18** (shipped).

  **Files:** `web/main.py` (`delete_all_reports` ~1848 and `delete_report` ~1858 also
  `delete_project_file` the matching `reports` storage object(s), resolving the caller's org/project)
  · `tests/test_reports_api.py`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `DELETE /api/reports` removes both the local `.docx` files AND the corresponding `reports`
    storage objects (resolved for the caller's active org/project), so a subsequent `pull_workspace`
    restores nothing
  - `DELETE /api/reports/{filename}` removes the matching local file AND only that file's storage
    object (other report objects untouched)

  **Unit tests:** `tests/test_reports_api.py` — (1) `test_delete_all_reports_durable`: `DELETE
  /api/reports` removes both local files and storage objects — assert (via a spy storage backend)
  `delete_project_file` was called for each `reports` object and a follow-up `pull_workspace` restores
  nothing. (2) `test_delete_one_report_durable`: single-file DELETE removes only the matching storage
  object, leaving the others.

  **E2E:** N/A (back-end API, no UI surface — consistent with XTF-8; the Reports tab triggers the
  delete but the change is back-end. Human gate is the unit tests + the verifier + PR review).

  **UAT:** N/A (back-end fix; verified via the Verify command, unit tests, the verifier, and PR
  review — UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py`

---

- [x] **XTF-24 — Restrict split-by dropdown to select_one columns**

  The "Split by" combobox in `BuildOptions` (`frontend/src/components/BuildOptions.jsx`, the
  `splitCols` useMemo ~46–52) currently lists EVERY main-table column (any question with no
  `repeat_group` + an `export_label`), regardless of type — so notes, usernames, numbers, dates,
  multi-selects etc. all appear, and splitting on them produces garbage (one report per number / per
  free-text note). Restrict the option set further to **single-select columns only**: questions whose
  kobo `type` starts with `select_one` (covers `select_one` and `select_one_from_file`; EXCLUDES
  `select_multiple*`, `integer`/`decimal`/`range`, `text`/`note`, `gps`/`geo*`, `date*`, and
  undefined). The `type` field is present on every question reaching BuildOptions (both the Express
  review panel via `frontend/src/pages/Templates.jsx` and the normal Reports build via
  `frontend/src/pages/Reports.jsx` source `questions` from `/api/config`, which preserves `type`), so
  the single change to `splitCols` covers BOTH surfaces. **Frontend only** — the backend
  `build-report --split-by` keeps accepting any column (it already warns + falls back to a single
  report for an unusable split column); the dropdown is the guardrail. The "No split — one combined
  report" option stays first. Depends on **XTF-13** (BuildOptions) + **XTF-17** (searchable combo) +
  **XTF-1–XTF-23** (shipped). Independent of the other XTF cards.

  **Files:** `frontend/src/components/BuildOptions.jsx` (extend the `splitCols` filter ~46–52 to also
  require `q.type` startsWith `select_one`) · `frontend/tests/e2e/build-options.spec.ts` (extend — the
  existing spec already builds a typed `config.yml`; seed a mix of question types and assert the
  restricted option set)

  **Config/schema impact:** None — reads the existing question `type` field already present on each
  question object.

  **Acceptance criteria**
  - The split-by dropdown lists ONLY columns whose question `type` starts with `select_one` (i.e.
    `select_one` and `select_one_from_file`)
  - `select_multiple*`, `integer`/`decimal`/`range`, `text`, `note`, `gps`/`geo*`, and `date*`
    columns are NOT offered as split-by options (even though they are main-table columns)
  - The "No split — one combined report" option remains FIRST in the list and still clears `split_by`
  - The restriction applies identically in the Express review panel (Templates.jsx) and the regular
    Reports build path (Reports.jsx) — both render the same `BuildOptions`
  - The XTF-17 typeahead filter still works over the restricted (select_one-only) option set
  - The downstream build contract is unchanged (a chosen `split_by`/`split_sample` is still forwarded)
  - Impeccable audit/critique clean on the restricted combobox

  **Unit tests:** N/A (frontend-only filter change; Vitest is not installed — the gate is asserted by
  the Playwright E2E below, consistent with XTF-7/XTF-17/XTF-21).

  **E2E:** `frontend/tests/e2e/build-options.spec.ts` (extend) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — seed the mocked `config.yml` with a mix of main-table question types: a
  `select_one` column, a `select_multiple` column, an `integer` column, a `text` column, and a `note`
  column (all without `repeat_group`). Open the split-by combobox and assert ONLY the `select_one`
  column appears as a `build-split-option` (assert each of the `select_multiple`/`integer`/`text`/
  `note` columns is absent), and assert the "No split" option is present and first. Capture a
  `toHaveScreenshot` baseline of the open dropdown showing the restricted list at all three viewports
  (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves the new baselines.

  **UAT:**
  1. With downloaded data on a form that has a mix of question types, open the Build options (Reports
     → Build, or Express review panel) and click the "Split by" field.
     Expected: the dropdown opens and "No split — one combined report" is the first entry.
  2. Scan the listed options. Expected: only single-select (select_one) columns are listed — number,
     date, free-text/note, username, and multi-select questions are NOT present.
  3. Type part of a select_one column name (XTF-17 typeahead). Expected: the list narrows to matching
     select_one columns; no excluded-type column ever appears regardless of the filter text.
  4. Pick a select_one column and build. Expected: the report splits by that single-select column as
     before.

  **Verify:** `cd frontend && npx playwright test build-options.spec.ts`

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

- [x] **VIS-2 — Reconcile drifted visual baselines (A11Y-1/-2/-3, PUX-1)**

  Several merged cards' candidate visual baselines drifted stale because later merges changed
  *shared* surfaces: PUX-1 (plain-language relabel) and PUX-2 (first-run state) modified Home and
  Questions **after** A11Y-1 / A11Y-3 / PUX-1 captured their baselines, and A11Y-2's ProjectForm
  baseline drifted too. They were committed as "candidate, awaiting approval" and never reconciled,
  so the visual suite was red on `develop` (incl. A11Y-1, already `[x]`). Regenerate the drifted
  baselines against current `develop` so the suite is green again. **No application/source change** —
  baseline reconciliation only. (The separate A11Y-4 Validate-test flakiness — a deeper keep-alive /
  findings-visibility race — was spun out to **A11Y-7**.)

  **Files:** regenerated baselines under
  `frontend/tests/e2e/{a11y-1,a11y-2,a11y-3,pux-1}.spec.ts-snapshots/` (no app source edits —
  Home/Questions/ProjectForm already render correctly)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - All drifted baselines (A11Y-1, A11Y-2, A11Y-3, PUX-1) are regenerated against current `develop`
    so each `toHaveScreenshot` matches the current rendered UI
  - The `a11y-1`, `a11y-2`, `a11y-3`, `pux-1` specs are green at all three viewports and stable on
    repeats (verified 436/436 then 405/405 over repeat runs)
  - No application/source behavior change — only regenerated baseline PNGs (human-approved as the
    frozen contract)
  - A11Y-1 (already `[x]`) is no longer red: its Home-stage-cards baseline reflects the current
    post-PUX-1/PUX-2 Home

  **Unit tests:** N/A (baseline reconciliation; no Python/unit surface).

  **E2E:** `frontend/tests/e2e/{a11y-1,a11y-2,a11y-3}.spec.ts` + `pux-1.spec.ts` green at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); regenerated `toHaveScreenshot`
  baselines, human-approved.

  **UAT:**
  1. Run `cd frontend && npx playwright test a11y-1 a11y-2 a11y-3 pux-1` and confirm green (no diffs).
  2. Review the regenerated baseline PNGs for A11Y-1/-2/-3 and PUX-1 and confirm each shows the
     correct current UI (no unexpected visual regression).

  **Verify:** `cd frontend && npx playwright test a11y-1 a11y-2 a11y-3 pux-1` and
     confirm the full suite is green (no visual diffs, no flaky failures).
  2. Re-run the A11Y-4 Validate spec with `--repeat-each=5` at mobile and confirm it passes every
     time (flakiness gone).
  3. Review the regenerated baseline PNGs for A11Y-1/-2/-3/-4 and PUX-1 and confirm each shows the
     correct current UI (no unexpected visual regression).

  **Verify:** `cd frontend && npx playwright test a11y-1 a11y-2 a11y-3 a11y-4 a11y-5 pux-1 pux-2`

---

## Internationalization (i18n)

> Interface localization so French-speaking M&E officers + field coordinators (per `PRODUCT.md` /
> `DESIGN.md`, many of whom work in French) can use the app in their language. Scope is exactly
> **two languages — English (default) and French** — covering the **whole interface**. Users pick
> a language in their profile and may switch it at any time; the choice persists per user and
> applies live (no reload). No i18n framework exists yet, so this area introduces one. Every card
> is UI-facing → real three-viewport `toHaveScreenshot` E2E + impeccable audit/critique + numbered
> UAT. Cards touching a Python web endpoint / DB carry a real pytest target (Vitest is **not**
> installed in this repo — frontend-only assertions are covered by Playwright E2E, per the XTF-7
> precedent). The plain-language principle (PUX area) governs the *wording* of both bundles; this
> area governs the *mechanism* + *coverage*. **I18N-2 depends on I18N-1.**

---

- [x] **I18N-1 — i18n framework + language switcher + persisted profile preference (P1)**

  Stand up the localization mechanism end to end: introduce an i18n library (e.g. `react-i18next`
  + `i18next`) wrapping the React app with an `en` (default) and `fr` resource bundle and a
  translation hook; add a per-user **interface language** preference (a new profile column +
  read/write API) and expose a language switcher in the Profile page (and/or the top ribbon) with
  exactly the two options English / French. The selection persists per user, is applied on app
  load from the saved preference, and switches **live without a reload**. This is the foundation
  card — it ships the plumbing + the switcher with a small initial set of strings wired through the
  bundles; the exhaustive string coverage is the separate I18N-2 deliverable. Touches a Python web
  endpoint + the app DB, so it carries a real pytest target alongside the E2E.

  **Files:** `frontend/package.json` (add `react-i18next` + `i18next` deps) ·
  `frontend/src/lib/i18n.js` (new — i18next init: `en`/`fr` resources, default `en`, the
  language-detection/persistence wiring) · `frontend/src/locales/en.json` +
  `frontend/src/locales/fr.json` (new — initial resource bundles) · `frontend/src/main.jsx` (or
  `App.jsx`) (wrap the app with the i18n provider; apply the user's saved language on load) ·
  `frontend/src/pages/Profile.jsx` + `frontend/src/pages/ProfileForm.jsx` (language switcher
  control bound to the profile preference) · `web/db/models.py` (new `language` column on the user
  profile, default `"en"`) · `web/db/repository.py` (read/write the language preference) ·
  `web/main.py` (extend the profile GET/PATCH endpoints to return + accept `language`) · an Alembic
  migration adding the column · `tests/test_profile_language.py` (new pytest target) ·
  `frontend/tests/e2e/i18n-switch.spec.ts` (new Playwright spec)

  **Config/schema impact:** **New profile `language` column** on the user/profile table
  (`web/db/models.py`), nullable or defaulting to `"en"`, with an **Alembic migration** (runs on
  FastAPI startup; SQLite test path via `DATABRIDGE_SKIP_MIGRATIONS=1`). No `config.yml` schema
  change.

  **Acceptance criteria**
  - The app is wrapped by an i18n provider exposing a translation function; `en` is the default
    language and `fr` is the only other available language (exactly two options — no others
    selectable)
  - The Profile page exposes a language switcher with English + French; choosing French updates a
    known set of already-wired interface strings (e.g. the Profile page's own labels + the primary
    nav tab labels) **live, without a page reload**, and choosing English reverts them
  - The selected language is persisted to the user's profile via the profile API (`language`
    column) and is re-applied automatically on the next app load and after re-login (survives
    reload + relogin)
  - When a user has no saved preference (new user / null column), the interface defaults to English
  - The profile GET endpoint returns the user's `language`; the profile update endpoint accepts and
    persists `language` and rejects any value other than `en`/`fr` (validation), scoped to the
    authenticated caller (a user can only set their own language)
  - The switcher control is keyboard-operable with an accessible name and visible focus ring
  - Impeccable audit/critique clean on the Profile language switcher

  **Unit tests:** `tests/test_profile_language.py` (new) — (1) `test_profile_returns_language_default_en`:
  a profile with no stored language returns `language: "en"` from the profile GET endpoint. (2)
  `test_update_profile_language_persists`: PATCH the profile with `language: "fr"` as the
  authenticated user, then GET and assert it returns `"fr"` (persisted across the round-trip). (3)
  `test_update_profile_language_rejects_unknown`: PATCH with `language: "de"` (or any non-en/fr
  value) returns a 4xx validation error and does not change the stored value. (4)
  `test_update_profile_language_scoped_to_caller`: a caller cannot set another user's language (the
  endpoint writes only the authenticated user's row).

  **E2E:** `frontend/tests/e2e/i18n-switch.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — load the app (mock the profile endpoint → `language: "en"`) and assert a
  representative wired string (e.g. a Profile label + a primary nav tab label) renders in English;
  open the Profile language switcher and select French, asserting the same strings switch to their
  French equivalents **without a navigation/reload** and that the switcher posts `language: "fr"`
  to the profile update endpoint; reload the page with the profile mock now returning
  `language: "fr"` and assert the interface comes up in French (preference re-applied on load).
  Capture `toHaveScreenshot` baselines of the Profile page with the language switcher in both the
  English and French states at all three viewports (mobile 390×844, tablet 820×1180, desktop
  1440×900); a human approves them.

  **UAT:**
  1. Open your Profile page in a fresh session. Confirm the interface is in English by default and
     a language switcher offers exactly English and French.
  2. Select French. Confirm the Profile labels and the main navigation tab names change to French
     immediately, without the page reloading.
  3. Reload the app (and/or sign out and back in). Confirm the interface comes back up in French —
     your choice was remembered.
  4. Switch back to English and confirm the interface returns to English and that choice likewise
     persists across a reload.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_profile_language.py` ·
  `cd frontend && npx playwright test i18n-switch.spec.ts`

---

- [x] **I18N-2 — Full English + French translation coverage of the interface (P1)**

  Build on I18N-1's mechanism to localize the **entire** interface: externalize every user-facing
  string across the six pages + shared components into the `en`/`fr` resource bundles so no
  hardcoded UI literal remains, and make both bundles complete and key-aligned (every key present
  in `en` is present in `fr` and vice-versa, with no empty values). Add a guard (a small test /
  lint) that fails the build when (a) the two bundles' key sets diverge or a value is empty, and
  (b) user-facing literal strings remain hardcoded in the audited components. **Depends on
  I18N-1.**

  **Files:** `frontend/src/locales/en.json` + `frontend/src/locales/fr.json` (complete, key-aligned
  bundles) · `frontend/src/pages/Home.jsx` · `frontend/src/pages/Sources.jsx` ·
  `frontend/src/pages/Questions.jsx` · `frontend/src/pages/Composition.jsx` ·
  `frontend/src/pages/Reports.jsx` · `frontend/src/pages/Templates.jsx` (replace hardcoded
  user-facing literals with translation-key lookups) · `frontend/src/components/**` (shared
  components — same externalization) · `frontend/src/App.jsx` (nav / ribbon / shell strings) ·
  `frontend/scripts/check-i18n.mjs` (new — key-parity + no-empty-values + hardcoded-literal guard) ·
  `frontend/package.json` (a `check:i18n` script wired into the lint/CI path) ·
  `frontend/tests/e2e/i18n-coverage.spec.ts` (new Playwright spec)

  **Config/schema impact:** None — additive locale bundles + a check script; no DB / `config.yml`
  change (the mechanism + the `language` column ship in I18N-1).

  **Acceptance criteria**
  - Every user-facing string across the six pages (Home, Sources/Extract, Questions, Composition,
    Reports, Templates) and the shared components/shell is sourced from the `en`/`fr` bundles —
    no hardcoded user-facing literal remains in the audited components (the guard enforces this)
  - The `en` and `fr` bundles are **key-aligned**: the set of keys is identical between the two
    files and no value is empty in either bundle (the guard fails on a missing or extra key or an
    empty value)
  - Switching to French translates representative strings on **each** of the six tabs (not just
    the I18N-1 initial set); switching back to English restores them
  - A `check:i18n` script exists and (a) fails on en/fr key divergence or empty values and (b)
    fails when a hardcoded user-facing literal is detected in the audited components; it passes on
    the completed bundles
  - No regression to I18N-1 behavior (default English, live switch, persisted preference)
  - Impeccable audit/critique clean on the translated surfaces (no truncation/overflow from longer
    French strings at any viewport)

  **Unit tests:** N/A (the coverage gate is the `check:i18n` script + the Playwright E2E below;
  Vitest is not installed — frontend-only, per the XTF-7 precedent. The key-parity / no-empty /
  no-hardcoded-literal guard runs via `check:i18n` and is exercised by the Verify command.)

  **E2E:** `frontend/tests/e2e/i18n-coverage.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — with the profile mocked to `language: "fr"`, visit each of the six tabs in
  turn and assert a representative, known string on each tab renders in French (not the English
  literal); switch back to English and assert each reverts. Assert no raw translation **key**
  (e.g. a `foo.bar` token) leaks into the rendered UI on any tab (every referenced key resolves).
  Capture `toHaveScreenshot` baselines of two representative tabs (e.g. Home + Reports) in French
  at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves
  them and confirms no French-length overflow/truncation.

  **UAT:**
  1. Set your interface language to French. Visit each of the six tabs (Home, Sources/Extract,
     Questions, Composition, Reports, Templates) and confirm the visible labels, buttons, headings,
     and helper text are in French — with nothing left in English and no raw key codes showing.
  2. Switch back to English and confirm every tab reverts fully to English.
  3. On both languages, confirm no text is cut off or overflowing its control at mobile, tablet,
     and desktop widths (French strings are typically longer).
  4. Confirm the language choice still persists across a reload (no regression to I18N-1).

  **Verify:** `cd frontend && npm run check:i18n` ·
  `cd frontend && npx playwright test i18n-coverage.spec.ts`
- [ ] **I18N-3 — Externalize the remaining non-tab surfaces to EN/FR (P2)**

  Follow-up from I18N-2 (which covered the six tabs + shell + in-tab shared components, leaving the
  standalone Ask + Validate panels and ProjectForm / ProjectMembersPanel / members modal in English).
  Externalize their user-facing strings into the en/fr bundles + extend the `check:i18n` audited set.

  **Files:** `frontend/src/pages/Ask.jsx` · `frontend/src/pages/Validate.jsx` ·
  `frontend/src/pages/ProjectForm.jsx` · `frontend/src/components/ProjectMembersPanel.jsx` (+ members
  modal) · `frontend/src/locales/{en,fr}.json` · `frontend/scripts/check-i18n.mjs` ·
  `frontend/tests/e2e/i18n-remaining.spec.ts` (new)

  **Config/schema impact:** None — additive locale keys + check-script scope.

  **Acceptance criteria**
  - Every user-facing string in those components is sourced from the en/fr bundles — no hardcoded
    literal remains (the extended `check:i18n` guard enforces this)
  - en/fr stay key-aligned, no empty values; `check:i18n` passes
  - With language=fr, representative strings on the Ask + Validate panels + the project form/members
    panel render in French; English reverts
  - English output byte-identical (no existing baseline drift)

  **Unit tests:** N/A (frontend; Vitest not installed — asserted by the Playwright E2E + `check:i18n`).

  **E2E:** `frontend/tests/e2e/i18n-remaining.spec.ts` (new) + visual — with profile language=fr, assert
  a representative string on the Ask panel, the Validate panel, and the members panel renders in French
  and no raw key leaks; `toHaveScreenshot` baseline of one such surface in French at three viewports; a
  human approves (checking no FR overflow).

  **UAT:**
  1. In French, open the Ask panel, the Validate panel, and a project's Members panel; confirm all
     labels/buttons are French with no raw keys.
  2. Switch to English; confirm they revert.
  3. Confirm no text overflows at mobile/tablet/desktop.

  **Verify:** `cd frontend && npm run check:i18n` ·
  `cd frontend && npx playwright test i18n-remaining.spec.ts`

---

- [ ] **I18N-4 — Native French review + correction of fr.json (P2)**

  Follow-up from I18N-1/I18N-2: `fr.json` is best-effort assistant translation. A native French speaker
  familiar with M&E / humanitarian terminology reviews + corrects every value for accuracy + natural
  register. Changes only `fr` VALUES — no keys change, so en/fr stay key-aligned and `check:i18n` + the
  i18n E2E still pass.

  **Files:** `frontend/src/locales/fr.json` (corrected values only)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - Every `fr.json` value reviewed by a French-proficient M&E reviewer + corrected where inaccurate,
    awkward, or wrong-register for the humanitarian/M&E domain
  - No translation KEY added/removed/renamed (key set identical to `en.json`); no empty values
  - `check:i18n` stays green; `i18n-coverage.spec.ts` still passes (update an expected FR string in
    lockstep only if the review changes that exact phrase)

  **Unit tests:** N/A — content/translation review; the parity guard is `check:i18n`.

  **E2E:** N/A — no behavior change (the externalization mechanism is already covered by I18N-2's
  `i18n-coverage.spec.ts`, which continues to pass).

  **UAT:**
  1. A native French M&E speaker reads through the app in French across all tabs; confirms wording is
     correct, natural, and uses the right M&E/humanitarian terms.
  2. Confirm no key codes or English remain.
  3. Confirm `npm run check:i18n` passes (key parity intact).

  **Verify:** `cd frontend && npm run check:i18n`

---

- [ ] **I18N-5 — Translate the navigation sub-tabs + guard against label-in-data-array escapes (P2)**

  The secondary sub-tab bar renders `{sub.label}` — a hardcoded English string from the STAGES
  array (`frontend/src/App.jsx` ~649; the sub objects are defined ~79–99 with **no** `labelKey`), so
  the sub-tabs (Connection, AI configuration, Questions, Profile, Validate, Views, Ask, Charts &
  indicators, Output, Templates, Reports) stay in English even when the interface language is French.
  The translations already exist and are complete in **both** bundles (the `subs.*` namespace in
  `frontend/src/locales/{en,fr}.json`) — they are simply never invoked. This is a coverage escape
  from I18N-2: the literal lives inside a data array, not as a JSX literal that the `check:i18n`
  guard scans. Wire the sub-tab render through `t()` against the existing keys and **extend the guard**
  so user-facing label literals in the nav/data arrays are caught and this cannot recur. Frontend-only;
  no new translation resources required. Independent of PUX-8 (that one fixes the **primary** tab
  wording), though both touch the nav.

  **Files:** `frontend/src/App.jsx` (render the sub-tab label via `t()` against the existing
  `subs.${sub.id}` key — e.g. add a `labelKey` to each sub or look up by id ~649; keep the English
  `label` as a fallback) · `frontend/scripts/check-i18n.mjs` (extend the hardcoded-literal audit to
  flag user-facing `label:` string literals in the STAGES / nav arrays so the escape can't recur) ·
  `frontend/src/locales/{en,fr}.json` (only if a `subs.*` key turns out to be missing — current
  audit says the namespace is complete and key-aligned) · `frontend/tests/e2e/i18n-subtabs.spec.ts`
  (new)

  **Config/schema impact:** None — wiring + guard scope only; the `subs.*` keys already exist.

  **Acceptance criteria**
  - With the interface language set to **French**, every secondary sub-tab label renders its French
    translation from the `subs.*` bundle (e.g. Connexion, Profil, Valider, Vues, Interroger,
    "Graphiques et indicateurs", Sortie, Modèles, Rapports) — no English sub-tab label remains
  - With **English** selected, the sub-tabs render the English strings (no regression, no raw `subs.*`
    key leaking into the UI)
  - The sub-tab labels are sourced from the existing `subs.*` keys via `t()` (no duplicated/parallel
    string set); en/fr stay key-aligned and `check:i18n` passes
  - `check:i18n` is **extended** so a user-facing `label:` literal in the STAGES / nav data arrays
    fails the check — it would flag the regression if the `t()` wiring were removed, and passes on the
    fixed code
  - **No behaviour change:** sub-tab ids, routes, ordering, and selection behaviour are unchanged —
    only the displayed label is translated

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the translated sub-tabs and the guard
  behaviour are asserted by the Playwright E2E below + `check:i18n`, per the i18n-area precedent).

  **E2E:** `frontend/tests/e2e/i18n-subtabs.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — with the profile mocked to language=fr, navigate to a stage that has sub-tabs
  (Transform → Questions/Profile/Validate, and Deliver → Output/Templates/Reports) and assert the
  sub-tab bar renders the French labels (e.g. "Profil", "Valider", "Modèles", "Rapports") and that no
  raw `subs.*` key leaks; switch to English and assert they revert to the English labels. Capture
  `toHaveScreenshot` baselines of a French sub-tab bar at all three viewports (mobile 390×844, tablet
  820×1180, desktop 1440×900); a human approves them (confirming no French-length overflow).

  **UAT:**
  1. Switch the interface to French. Open Transform and confirm the sub-tabs read "Questions /
     Profil / Valider" (not English).
  2. Open Deliver and confirm the sub-tabs read "Sortie / Modèles / Rapports".
  3. Switch back to English and confirm the sub-tabs revert to English.
  4. Run `cd frontend && npm run check:i18n` and confirm it passes; confirm it now fails if a nav
     label literal is left un-translated.

  **Verify:** `cd frontend && npx playwright test i18n-subtabs.spec.ts && npm run check:i18n`

---

## Project output language

> A per-project **output language** that is chosen once when the project is created and is then
> fixed, governing the language of **AI-generated** report content (narrative text, AI summaries,
> AI chart/indicator suggestions, Ask captions). It is **independent of the user-profile interface
> language** (the i18n area): a francophone report can be produced from an English interface and
> vice-versa. A `project.meta.language` field + a `ProjectForm` selector already exist
> (English/French/Spanish/Portuguese/Arabic) but are editable after creation and never reach the
> generation pipeline (which reads a separate, independently-editable `ai.language`). This area
> makes the project language immutable, the single source of truth for the AI output language, and
> actually consumed by every generation site. **Scope (confirmed): AI-generated text only** —
> user-authored chart/indicator titles and question-derived axis labels render exactly as the user
> entered them (no auto-translation pass). Ordered by dependency: **PLANG-2 and PLANG-3 depend on
> PLANG-1.**

---

- [ ] **PLANG-1 — Project language is set once at creation and drives the AI output language (backend + config mirroring)**

  `project.meta.language` already exists (offered in `ProjectForm` as
  English/French/Spanish/Portuguese/Arabic) but (a) it is **editable post-creation** via
  `PATCH /api/projects/{id}` (`web/main.py` ~278–284; `_META_KEYS` includes `language`;
  `repository.update_project` ~177–191 merges meta), and (b) it **never reaches the generation
  pipeline** — `project.meta` is not mirrored to `config.yml`, so generation reads the separate,
  independently-editable `ai.language` (`sample.config.yml` ~540; `narrator.py` ~83;
  `summaries.py` ~268). Make the project language **immutable after creation** and the **single
  source of truth** for the AI output language by injecting it into `config.ai.language` whenever
  the config is materialized for the CLI. **Backend / data only** — the form + AI-config UI are
  PLANG-2; threading the language into each generation site is PLANG-3.

  **Files:** `web/main.py` (create still accepts `language`; the PATCH path must **not** change it —
  drop `language` from the patch meta merge / reject attempts, ~222–284) · `web/db/repository.py`
  (`update_project` preserves an existing `meta.language`, ~177–191) · `web/db/bridge.py`
  (`materialize_config` / `mirror_active` set `cfg["ai"]["language"]` from `project.meta.language`
  with a legacy default, ~11–24) · `tests/test_project_language.py` (new) · `tests/test_bridge.py`
  (reconcile the existing `materialize_config` round-trip assertion to the injected `ai.language`)

  **Config/schema impact:** No new DB column (lives in the existing `meta` JSONB). `config.ai.language`
  becomes a **derived** mirror of the project language at materialize time — a manually-edited
  `ai.language` is overwritten from the project on the next materialize.

  **Acceptance criteria**
  - A project's `language` is accepted at creation (`POST /api/projects`) and stored in
    `project.meta.language`
  - After creation the language is **immutable**: `PATCH /api/projects/{id}` does not change
    `meta.language` (an attempt is ignored or rejected, still membership-scoped as today) and
    `update_project` preserves the existing value
  - When the active project's config is materialized to `config.yml`, `ai.language` is set from
    `project.meta.language`, so the CLI + generation pipeline use the project language regardless of
    any value previously stored in `ai.language`
  - A **legacy** project with no `meta.language` falls back to its existing `config.ai.language` if
    present, else `"English"` (deterministic default, no crash)
  - Per-project isolation preserved: one project's language never appears in another's materialized
    config

  **Unit tests:** `tests/test_project_language.py` — (1) `test_create_persists_language`: create stores
  `meta.language`. (2) `test_language_immutable_on_patch`: a PATCH attempting to change the language
  leaves `meta.language` unchanged. (3) `test_materialize_injects_project_language`: `materialize_config`
  sets `ai.language` from the project, overriding a stale `ai.language` already in the config. (4)
  `test_legacy_default`: a project with no `meta.language` materializes the existing `ai.language` if
  present, else `"English"`. (5) `test_per_project_isolation`: two projects materialize their own
  languages independently. Uses the suite's SQLite + local-storage self-provisioning.

  **E2E:** N/A (no UI surface — backend immutability + config mirroring; the form / AI-config UI is
  PLANG-2 and is covered there).

  **UAT:** N/A (back-end change, no UI surface of its own — verified via the Verify command, the unit
  tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_project_language.py`

---

- [ ] **PLANG-2 — Create-only language field + read-only language in AI config (UI)**

  With PLANG-1 making the project language immutable + authoritative, reflect that in the UI. In
  `ProjectForm` the language `<select>` (`frontend/src/pages/ProjectForm.jsx` ~11/50/188–191) is
  editable only when **creating** a project; in **edit** mode it is shown read-only/disabled with a
  one-line note that it is fixed at creation. In the AI-config tab
  (`frontend/src/pages/Sources.jsx` section="ai") the language stops being an editable input and
  instead shows the **project's** language read-only, with a hint that it is set on the project and
  governs generated output. New strings land in EN + FR (parity enforced). **Depends on PLANG-1.**

  **Files:** `frontend/src/pages/ProjectForm.jsx` (language field editable on create, read-only /
  disabled + helper note on edit; keep dirty-tracking correct for the now-immutable field
  ~50/69–75/188–191) · `frontend/src/pages/Sources.jsx` (AI section: replace the editable language
  control with a read-only display sourced from the active project's language + hint) ·
  `frontend/src/lib/projects.js` (only if the active project's language is not already available to
  the AI-config view) · `frontend/src/locales/{en,fr}.json` (read-only hints / labels) ·
  `frontend/tests/e2e/project-language.spec.ts` (new)

  **Config/schema impact:** None — UI only (PLANG-1 owns persistence + mirroring).

  **Acceptance criteria**
  - In the **create** project form the language selector is editable (English/French/Spanish/
    Portuguese/Arabic) and its value is submitted on create
  - In the **edit** project form the language is shown read-only / disabled with a visible one-line
    note that it is set at creation and cannot be changed; the form's dirty-tracking does not flag
    the unchanged read-only language
  - The AI-config tab no longer presents language as an editable input; it displays the active
    project's language as a read-only value with a hint that it is the project's language and drives
    generated output
  - The read-only AI-config language **matches** the project's language
  - All new strings exist in both `en.json` and `fr.json` (key-aligned, `check:i18n` passes); the
    controls are keyboard-accessible with accessible names and a visible focus ring
  - Impeccable audit/critique clean

  **Unit tests:** N/A (frontend-only; Vitest is not installed — the create-vs-edit field state, the
  read-only AI-config display, and i18n parity are asserted by the Playwright E2E below + `check:i18n`,
  per the i18n/PUX precedent).

  **E2E:** `frontend/tests/e2e/project-language.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — in the create form assert the language `<select>` is enabled and selectable; in
  the edit form assert the language control is disabled / read-only and the fixed-at-creation note is
  shown; on the AI-config tab assert the language renders read-only matching the project's language with
  no editable input. Run a Playwright axe audit on both surfaces and assert no new violations. Capture
  `toHaveScreenshot` baselines of the edit-mode read-only language field and the AI-config read-only
  language at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves.

  **UAT:**
  1. Create a new project, choose **French** as the language, and save. Reopen the project's edit form
     and confirm the language is shown but cannot be changed, with a note explaining it is fixed at
     creation.
  2. Open Extract → AI configuration and confirm the language is shown read-only as "French" with a
     hint that it is the project's language.
  3. Switch your **interface** (profile) language to English and confirm the **project** language stays
     French (the two are independent).

  **Verify:** `cd frontend && npx playwright test project-language.spec.ts && npm run check:i18n`

---

- [ ] **PLANG-3 — Generate AI output (narrative, summaries, suggestions, Ask) in the project language**

  With PLANG-1 feeding the project language into `config.ai.language`, ensure **every** AI generation
  site honours it so generated text comes out in the project language (per the confirmed scope —
  **AI-generated text only**; user-typed chart/indicator titles and question-derived axis labels render
  as entered). The narrator already reads `ai.language` (`src/reports/narrator.py` ~83) and AI
  summaries do too (`src/reports/summaries.py` ~268); extend the sites that currently ignore it: the
  Ask engine caption/proposal prompts (`src/reports/ask_engine.py` ~189–206/422–442) and the AI
  suggesters (`src/reports/ai_chart_suggester.py` and the other `ai_*_suggester.py` / template
  inference) so their LLM prompts include the output-language instruction. Add a regression test that
  each generation site passes the configured language into its prompt variables. **Depends on PLANG-1.**

  **Files:** `src/reports/ask_engine.py` (thread language from `ai_cfg` into the propose / refine /
  caption prompt variables) · `src/reports/ai_chart_suggester.py` + the other
  `src/reports/ai_*_suggester.py` (+ template inference) that omit language (add the language prompt
  var) · `src/reports/summaries.py` (the keyword-frequency stop-word language ~152 — derive from
  `ai.language` rather than a hardcoded default where a sensible mapping exists) ·
  `tests/test_generation_language.py` (new)

  **Config/schema impact:** None — reads the existing `ai.language` (now fed by the project language via
  PLANG-1).

  **Acceptance criteria**
  - Narrator, AI summaries, the Ask engine (captions / proposals), and the AI suggesters (chart /
    indicator / etc.) each include the configured `ai.language` as the output-language instruction in
    their LLM prompt variables
  - Given `ai.language = "French"`, each site's prompt carries the French language instruction (provable
    by capturing the prompt variables / mocking the LLM) — no site silently emits in a hardcoded language
  - The keyword-frequency summary stop-word language follows `ai.language` (mapped to its code) rather
    than a hardcoded default where a mapping exists; an unknown/unsupported language degrades gracefully
    (no crash)
  - User-authored chart/indicator titles + question-derived axis labels are **unchanged** (the confirmed
    scope excludes translating user-typed strings) — only AI-generated text is language-driven
  - AI features remain no-ops when no AI key is configured (no regression to the offline / seed path)

  **Unit tests:** `tests/test_generation_language.py` — for the narrator, AI summaries, the Ask engine,
  and at least one suggester: set `ai.language="French"`, mock/capture the LLM call, and assert the
  language value reaches the prompt variables; assert a missing/empty `ai.language` defaults
  deterministically to English; assert the no-AI-key path no-ops without error. Uses the suite's existing
  fakes — no live LLM call.

  **E2E:** N/A (no UI surface — generation pipeline; it consumes the config produced by PLANG-1/PLANG-2,
  whose UI is covered there).

  **UAT:** N/A (back-end generation, no UI surface of its own — verified via the Verify command, the unit
  tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_generation_language.py`

---

## Performance

> The web app feels slow (up to ~10s) when navigating between pages because there is **no caching
> anywhere**: every page mount refetches its data, and the heavy read-only endpoints
> (`/api/profile`, `/api/data-quality`, `/api/base-tables`) recompute everything server-side on each
> call — re-reading CSV/parquet off disk + reflattening repeat groups via `load_processed_data`
> (`src/data/transform.py`), then running full pandas EDA (`profile_dataset`, `src/data/profile.py`)
> and the data-quality pass (`compute_data_quality`, `src/reports/data_quality.py`). There is no
> `lru_cache`/memoization in `src/utils/config.py` or `src/data/flatten.py`. This area adds a
> server-side cache so identical repeat reads skip the recompute. **Out of scope here** (possible
> future cards): a client-side query cache in the React app, and background pre-loading/prefetch of
> the next tab's data — those are separate deliverables and are intentionally not bundled into PERF-1.

---

- [x] **PERF-1 — Cache the expensive read-only server computations on a (data-session + config) fingerprint**

  Add a server-side cache layer in front of the three heavy read-only endpoints (`/api/profile`,
  `/api/data-quality`, `/api/base-tables`) keyed on a fingerprint of the **active project's data
  session + config**. Identical repeat requests (the common case when a user navigates back and forth
  between tabs) return the memoized result instead of re-running `load_processed_data` /
  `profile_dataset` / `compute_data_quality`. The fingerprint changes — invalidating the cache — when
  new data is downloaded (download completion) or the config is saved (`POST /api/config`), so a stale
  result is never served. Caching is **per project** so one project's cached result is never returned
  for another. This is the server-side caching deliverable only (the client query-cache and
  background-prefetch ideas are out of scope; see the section intro). Depends on **XTF-1–XTF-24** /
  **VIS-1** (shipped); independent of the OUT/UX/ME cards.

  **Files:** `web/perf_cache.py` (new — the fingerprint + cache helper: `fingerprint(org_id,
  project_id, cfg, session)` over the active data-session identity + a config hash; a per-project
  `get_or_compute(key, compute_fn)` keyed store with an explicit `invalidate(org_id, project_id)`) ·
  `web/main.py` (the three endpoints `/api/profile` ~2355, `/api/data-quality` ~2369,
  `/api/base-tables` ~2313 wrap their compute in `perf_cache.get_or_compute`; the `POST /api/config`
  save handler and the download-completion path call `perf_cache.invalidate` for the active
  org/project) · `tests/test_perf_cache.py` (new)

  **Config/schema impact:** None — in-process caching only; no `config.yml` field, no DB/schema change.

  **Acceptance criteria**
  - A cache helper computes a fingerprint from the active project's **data-session identity + a hash
    of the config**; two requests with the same fingerprint hit the cache, a changed fingerprint
    misses and recomputes
  - On a **cold** cache, `/api/profile`, `/api/data-quality`, and `/api/base-tables` each return a
    result **byte-identical** to the current (un-cached) implementation — correctness is preserved
  - On a **warm** second call with an unchanged fingerprint, the underlying heavy function
    (`load_processed_data` / `profile_dataset` / `compute_data_quality`) is **not** invoked again
    (the memoized value is returned) — provable by a call-count spy on the heavy functions
  - Saving config via `POST /api/config` invalidates the cache for that project, so the next
    `/api/profile` (etc.) recomputes rather than serving the pre-save result
  - Completing a `download` invalidates the cache for that project, so post-download reads reflect the
    new data, never the pre-download cached result
  - **Per-project isolation:** a cache entry computed for project A is never returned for a request
    scoped to project B (distinct fingerprints / namespacing by org+project)

  **Unit tests:** `tests/test_perf_cache.py` — (1) `test_fingerprint_stable_then_changes`: the
  fingerprint is identical for the same (session, config) and changes when the config hash or the
  data-session identity changes. (2) `test_warm_call_skips_recompute`: wrap a spy compute fn in
  `get_or_compute`; first call invokes it once, a second call with the same key returns the cached
  value WITHOUT invoking the spy again (assert call count == 1). (3) `test_cold_result_matches_uncached`:
  for each of profile / data-quality / base-tables, the cached path returns a value byte-identical to
  calling the underlying function directly on a fixture session (correctness preserved). (4)
  `test_config_save_invalidates`: after `invalidate(org, project)` (the hook `POST /api/config` calls),
  the next `get_or_compute` re-invokes the compute fn. (5) `test_download_invalidates`: simulate the
  download-completion invalidation hook and assert the next read recomputes. (6)
  `test_per_project_isolation`: a value cached under (orgA, projA) is not returned for (orgB, projB) —
  the second project misses and computes its own. Fixtures use the suite's existing
  SQLite + local-storage self-provisioning (no Postgres/Minio).

  **E2E:** N/A (no UI surface — server-side caching; the three endpoints' UI consumers are unchanged
  and already covered elsewhere).

  **UAT:** N/A (back-end performance fix, no UI surface of its own — verified via the Verify command,
  the unit tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_perf_cache.py`

---

- [x] **PERF-2 — Shared (cross-worker) cache backend for the perf cache**

  Follow-up to PERF-1 (shipped: an in-process dict cache in `web/perf_cache.py` fronting
  `/api/profile`, `/api/data-quality`, `/api/base-tables`, invalidated on config-save and
  download-completion). PERF-1's cache is a module-level dict living inside ONE process, so under
  multi-worker uvicorn (`--workers N`) each worker keeps its own copy: (a) a given view warms up to N
  times (once per worker) before all workers are fast, and (b) an `invalidate()` only clears the
  worker that handled the request. **This is a performance/scale improvement, NOT a correctness fix:**
  (b) is harmless today because the cache key embeds a config+data fingerprint that changes on
  save/download, so stale entries are simply never looked up again — they are inert until the process
  restarts. PERF-2 makes the cache backend **pluggable** so it can use a shared out-of-process store
  (Redis) when configured, falling back to the current in-process dict when not — fewer cold
  recomputes across workers + global invalidation, with zero new infrastructure for single-worker
  deployments. Depends on **PERF-1** (shipped); independent of the OUT/UX/ME cards.

  **Files:** `web/perf_cache.py` (introduce a backend abstraction behind the existing
  `get_or_compute`/`invalidate`/`fingerprint` surface: an in-process dict backend as the default and a
  shared Redis backend selected when a connection URL is configured) · `tests/test_perf_cache_shared.py`
  (new) · the new optional env var (`REDIS_URL` / `PERF_CACHE_URL`) added to the env-vars table in
  `CLAUDE.md` and to `.env.example` · `requirements.txt` (Redis client) and `requirements-dev.txt`
  (`fakeredis`, dev/test only) if the shared backend / its test double are used. PERF-1's existing
  `tests/test_perf_cache.py` must keep passing unchanged against the default backend.

  **Config/schema impact:** None to `config.yml`; adds one **optional** env var
  (`REDIS_URL` / `PERF_CACHE_URL`). When unset, behavior is identical to PERF-1 (in-process dict);
  no new infrastructure required for single-worker deployments.

  **Acceptance criteria**
  - `web/perf_cache.py` gains a backend abstraction: the existing in-process dict is the **default**
    backend; a shared backend (Redis) is selected when a connection is configured via the env var
    (`REDIS_URL` / `PERF_CACHE_URL`). With the env var unset, behavior is identical to PERF-1
  - The public surface `get_or_compute` / `invalidate` / `fingerprint` is **unchanged** — only the
    storage behind it changes; PERF-1's frozen `tests/test_perf_cache.py` still passes against the
    default backend
  - With the shared backend configured, a value cached by one worker is readable by another (simulated
    in tests by two backend instances pointed at the same store, e.g. `fakeredis`), and
    `invalidate(org, project)` clears it for **all** instances/workers
  - Per-project namespacing and the config+data fingerprint key are preserved **exactly** (no
    correctness change to what counts as a cache hit)
  - **Graceful degradation:** if the shared store is configured but unreachable at request time, the
    endpoints still serve correct results by computing directly (the cache becomes a no-op) rather than
    erroring — a cache outage must never take down `/api/profile` etc.

  **Unit tests:** `tests/test_perf_cache_shared.py` — (1) `test_default_backend_matches_perf1`: with
  no URL set, `get_or_compute`/`invalidate`/`fingerprint` behave identically to PERF-1 (in-process
  dict; warm call skips recompute, fingerprint stable-then-changes). (2)
  `test_shared_backend_cross_worker_hit`: two shared-backend instances over one fake store (`fakeredis`
  or an in-memory double) share reads — a value written by instance A is returned to instance B without
  recomputing. (3) `test_shared_invalidate_clears_all`: `invalidate(org, project)` on one instance
  clears the entry seen by the other. (4) `test_namespacing_and_fingerprint_unchanged`: per-project
  namespacing + the config+data fingerprint key are byte-for-byte the same as PERF-1 (a different
  project / changed fingerprint misses). (5) `test_shared_store_unreachable_falls_back`: with the store
  configured but unreachable, `get_or_compute` computes directly and returns the correct value without
  raising (cache no-ops). Use `fakeredis` (a new dev dependency) or an in-memory double so no real
  Redis is needed in CI.

  **E2E:** N/A (no UI surface — server-side cache backend; the three endpoints' UI consumers are
  unchanged and already covered elsewhere).

  **UAT:** N/A (back-end performance/scale change, no UI surface of its own — verified via the Verify
  command, the unit tests, the verifier, and PR review; UAT moves in lockstep with E2E).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_perf_cache_shared.py`

---

- [ ] **PERF-3 — Per-page skeleton loaders for the data-driven tabs (perceived performance)**

  A complement to PERF-1/PERF-2 (server-side cache) on the **client** side: today every
  data-driven tab initialises its data to `null` and renders a single centred grey "Loading…"
  line (`.empty-state`, `frontend/src/styles.css` ~176) on first mount — so on a cold load /
  refresh, and on the first visit to each tab, the user sees a blank panel with one line of text
  while the mount fetch is in flight (`Questions.jsx` ~450, `Sources.jsx` ~162, `Profile.jsx`
  ~177, `Reports.jsx` ~185/230, `Validate.jsx` ~177). Replace that plain text with a reusable
  **skeleton** placeholder whose shape approximates the real content, so the interface feels
  responsive and content swaps in without a jarring layout shift. **Perceived-performance / UI
  only — no change to data fetching, the keep-alive pane machinery, or the epoch/remount logic
  (`frontend/src/App.jsx`); only the loading placeholder changes.** Scope is the five tabs that
  currently render a mount-time `null → "Loading…"` state (Questions, Sources, Profile, Reports,
  Validate); on-demand/action loads (Composition previews, Ask) and the app-shell are out of
  scope (possible future cards). Independent of PERF-1/PERF-2 (no server change); independent of
  the OUT/UX/ME/A11Y cards.

  **Files:** `frontend/src/components/Skeleton.jsx` (new — a reusable `<Skeleton>` primitive:
  shimmer block(s) with width/height/variant props, plus small composed layouts the pages reuse;
  the wrapper carries `aria-busy="true"` + a visually-hidden "Loading" label and the shimmer
  blocks are `aria-hidden`) · `frontend/src/styles.css` (a `.skeleton` class + shimmer
  `@keyframes` that respects the existing `@media (prefers-reduced-motion: reduce)` block —
  static placeholder, no shimmer, when reduced motion is set; design-token colours only) ·
  `frontend/src/pages/Questions.jsx` (~450) · `frontend/src/pages/Sources.jsx` (~162) ·
  `frontend/src/pages/Profile.jsx` (~177) · `frontend/src/pages/Reports.jsx` (~185/230) ·
  `frontend/src/pages/Validate.jsx` (~177) — swap the `<p className="empty-state">…loading…</p>`
  branch for a layout-matched skeleton · `frontend/tests/e2e/perf-3-skeleton.spec.ts` (new)

  **Config/schema impact:** None — frontend presentation only; no `config.yml`, DB, or endpoint
  change.

  **Acceptance criteria**
  - A reusable `Skeleton` component exists (`frontend/src/components/Skeleton.jsx`) with a shimmer
    animation driven by tokenised colours; its container exposes `aria-busy="true"` and a
    visually-hidden text label (e.g. "Loading"), and the decorative shimmer blocks are
    `aria-hidden="true"` so assistive tech announces a single loading state, not noise
  - Each of the five mount-loading tabs (Questions, Sources, Profile, Reports, Validate) renders a
    layout-matched skeleton **in place of** the current plain "Loading…" text while its mount
    fetch is in flight — the skeleton's overall shape approximates the real content (so content
    swaps in with no major layout shift)
  - Once the data arrives, the skeleton is fully replaced by the real content; on fetch error the
    existing error/toast path is unchanged (no skeleton left stuck on screen)
  - The skeleton honours `prefers-reduced-motion: reduce` — no shimmer animation under reduced
    motion (a static placeholder is shown instead)
  - **No behaviour change** to data fetching, the keep-alive panes, or the epoch/remount logic —
    only the loading placeholder differs; a returning user (tab already mounted, data cached) sees
    no skeleton on tab switch (the existing keep-alive path is unchanged)
  - Impeccable audit/critique clean on the skeleton states

  **Unit tests:** N/A (frontend-only; Vitest is not installed in this repo — the skeleton
  presence, the reduced-motion behaviour, and the skeleton→content swap are asserted by the
  Playwright E2E below, consistent with the A11Y/PUX cards' coverage approach).

  **E2E:** `frontend/tests/e2e/perf-3-skeleton.spec.ts` (new) + visual (impeccable audit/critique +
  `toHaveScreenshot`) — for at least Questions and Profile: intercept the page's mount fetch
  (`/api/questions`, `/api/profile`) and delay the response, assert the skeleton container
  (`aria-busy="true"` / a `data-testid="skeleton"`) is visible while the request is pending and
  that the plain "Loading…" text is gone; release the response and assert the skeleton is removed
  and the real content is shown. Run a Playwright axe audit on a skeleton state and assert no new
  violations (the busy region is announced once, shimmer blocks are hidden). Emulate
  `prefers-reduced-motion: reduce` and assert the shimmer animation is not applied. Capture
  `toHaveScreenshot` baselines of a Questions skeleton and a Profile skeleton at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. With a throttled connection (or a cold project), open the app and visit Questions, Sources,
     Profile, Reports, and Validate for the first time. Confirm each shows a skeleton that
     resembles its eventual layout — not a blank panel with one line of text — and that the real
     content then replaces the skeleton without the page jumping.
  2. Switch away from a tab you've already loaded and back again. Confirm it appears instantly with
     no skeleton (keep-alive unchanged).
  3. Enable "reduce motion" in your OS/browser and reload. Confirm the skeletons are static (no
     shimmer) but still present.
  4. With a screen reader on, load a tab and confirm it announces a single "loading/busy" state
     rather than reading out each placeholder block.

  **Verify:** `cd frontend && npx playwright test perf-3-skeleton.spec.ts`

---

## Maintenance & hardening

> Tracked tech-debt / hardening surfaced during the 2026-06 build-out. Not feature work — small,
> well-scoped fixes that keep the suite + toolchain healthy.

---

- [ ] **MNT-1 — Stabilize the order-dependent ask-save indicator test (P2)**

  `tests/test_ask_api.py::test_ask_save_indicator_appends_to_indicators` passes in the full suite but
  FAILS run in isolation — a test-isolation/ordering bug (leaked shared/config state). Pre-existing on
  `develop`. Make it deterministic regardless of run order.

  **Files:** `tests/test_ask_api.py` (+ the fixture / module-level state it depends on)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - The named test passes RUN ALONE
  - It also passes in the full suite (no regression)
  - Root cause (leaked state) fixed at the fixture/isolation level, not by reordering

  **Unit tests:** the card IS a pytest-stability fix — covered by running the named test in isolation
  then in the full file.

  **E2E:** N/A (backend test-infra).

  **UAT:** N/A (verified via the Verify command + the verifier + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_api.py::test_ask_save_indicator_appends_to_indicators` (alone), then `tests/test_ask_api.py`

---

- [ ] **MNT-2 — Clear dev-dependency CVEs (vite High + esbuild Moderate) (P2)**

  `npm audit` flags pre-existing advisories in the frontend DEV toolchain: vite (High — needs >= 8.1) +
  esbuild (Moderate — needs >= 0.25, dragged by the vite bump). Dev-only (not in the shipped bundle) but
  should be cleared. Bump + verify the dev server, Playwright harness, and build still work.

  **Files:** `frontend/package.json` · `frontend/package-lock.json` · possibly
  `frontend/vite.config.*` / `frontend/playwright.config.ts` (if the major bump needs config changes)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - vite + esbuild bumped to versions with no outstanding High/Moderate advisory (npm audit clear for them)
  - `npm run build` succeeds; the Vite dev server serves; the Playwright e2e harness runs
  - No app/runtime behavior change (visual baselines unaffected, or refreshed + human-approved if the
    toolchain bump shifts rendering)

  **Unit tests:** N/A (dependency/toolchain chore).

  **E2E:** the existing Playwright suite is the regression check — must stay green post-bump (no new
  baselines expected; flag + human-approve any genuine drift).

  **UAT:** N/A (verified via build + e2e green + dep-audit clean + PR review).

  **Verify:** `cd frontend && npm audit` (vite/esbuild cleared) · `npm run build` · `npm run test:e2e`

---

- [ ] **MNT-3 — I18N-1 backend hygiene: double-commit + verbatim Zitadel error (P3)**

  Two Low items from the I18N-1 security review. (a) `PATCH /api/me` commits twice — `set_user_language()`
  commits internally and `patch_me` commits again (redundant). (b) The Zitadel sync error path echoes the
  raw exception verbatim in the PATCH response (could embed internal URLs). Single commit site + sanitize
  the message.

  **Files:** `web/main.py` (`patch_me`) · `web/db/repository.py` (`set_user_language`) ·
  `tests/test_profile_api.py`

  **Config/schema impact:** None.

  **Acceptance criteria**
  - `PATCH /api/me` commits exactly once (no redundant commit/refresh); behavior unchanged
  - The Zitadel error path returns a sanitized message (no raw exception/internal URL) in the response
  - Existing profile/language tests still pass (no regression to I18N-1)

  **Unit tests:** `tests/test_profile_api.py` — a language PATCH persists via a single commit path
  (behavior unchanged); a simulated Zitadel sync error yields a sanitized (non-verbatim) message.

  **E2E:** N/A (backend).

  **UAT:** N/A (verified via the Verify command + the verifier + PR review).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_profile_api.py tests/test_profile_language.py`

---

## Backlog — parked (out of scope for now)

> Captured so they aren't lost; not scheduled. Promote into a domain section above when picked up.

- **Skip the download when the remote is unchanged** — `run-all` already skips a stale
  build-report; skipping the *download* itself when the Kobo/Ona remote hasn't changed is a
  later slice (would need a remote content fingerprint).
- **True multi-user read isolation** — concurrent users with different active projects share
  the one `BASE_DIR` read-mirror (best-effort, last-writer-wins). Durable Minio/DB data is
  always correct; per-user read isolation is out of scope (see `CLAUDE.md` → run concurrency).
