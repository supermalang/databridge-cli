# Project management & top ribbon (UX) — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **UX-10 — Navigate to Home tab on project switch (P2)**

  **Created:** 2026-06-27 · **Completed:** 2026-06-28

  When a user switches project via the project picker, they remain on whatever tab they
  were on. Tab content may be stale or project-specific (e.g. Extract showing the old
  project's config). Switching project should always land on Home.

  **Files:** `frontend/src/App.jsx` (`switchProject` function, ~line 220)

  **Config/schema impact:** None.

  **Acceptance criteria**
  - After switching to any project the active tab is Home, regardless of which tab was
    active before the switch
  - The Home dashboard renders the new project's content (correct name, stage cards)
  - No extra flash or double-render during the switch
  - If the user was already on Home the tab selection is unchanged (no flicker)

  **Unit tests:** N/A (frontend-only; Vitest not installed — covered by Playwright E2E).

  **E2E:** `frontend/tests/e2e/project-switch-home.spec.ts` — navigate to Reports tab,
  switch to a second project, assert the active stage is Home and the project name in the
  header reflects the new project. `toHaveScreenshot` baselines at mobile (390×844),
  tablet (820×1180), desktop (1440×900). Impeccable audit/critique on the settled Home view.

  **UAT:**
  1. Open the app on the Reports tab.
  2. Switch to a different project via the project picker.
  3. Confirm the active tab is immediately Home, not Reports.
  4. Confirm the Home dashboard shows the new project's content.

  **Verify:** `cd frontend && npx playwright test project-switch-home.spec.ts`

---

- [x] **UX-9 — Global "switching…" feedback**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

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

- [x] **UX-8 — Accessible labels on color swatches / icon buttons**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

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

- [x] **UX-7 — Explain read-only email (ProfileForm)**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

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

- [x] **UX-6 — Inline validation for required name (ProjectForm)**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

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

- [x] **UX-5 — Member rows fall back to a raw UUID**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

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

- [x] **UX-4 — Unsaved-changes guard on the project form**

  **Created:** 2026-06-17 · **Completed:** 2026-06-26

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

- [x] **UX-3 — Archived rows look clickable but do nothing**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

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

- [x] **UX-2 — Keyboard-accessible project switcher**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

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

- [x] **UX-1 — Show project color & icon**

  **Created:** 2026-06-17 · **Completed:** 2026-06-25

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

