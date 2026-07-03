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
- Scope is limited to one deliverable (**INVEST: Independent + Small** — completable in one
  session/sprint without depending on unshipped sibling tasks)
- Priority is declared: `P0` (must-ship/blocking) · `P1` (important, non-blocking) · `P2` (nice-to-have)
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

## Sprint rituals (cadence-level checks)

The DoR/DoD above are per-task gates. Some work is per-sprint, not per-task — it can't be a
task checkbox, so it lives here, verified by the sprint rituals that bracket a sprint.

Sprint entry — checked by /sprint-start:
- [ ] Every planned task satisfies the task DoR
- [ ] The story map is current — the user journey is mapped and every journey gap is either
      planned as a task or consciously deferred (/story-map)

Sprint exit — checked by /report + /retro:
- [ ] Every task taken into the sprint is DoD-done [x] or explicitly carried over
- [ ] Usability checked on the user-facing features shipped this sprint — heuristic pass at
      minimum, real-user sessions when scheduled (/usability-test); findings filed as /planner tasks
- [ ] Progress report generated for the review (/report)
- [ ] Retrospective held and action items captured (/retro)

> Why here and not the DoD: story mapping and usability testing are about the product/journey
> across many tasks, are periodic, and (for real-user testing) need humans — so they're
> sprint-cadence checks, not per-task gates. Their outputs become tasks, which then pass the
> normal DoD.

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Output / export formats](#output--export-formats) | 3 | 3 / 3 |
| [Project management & top ribbon (UX)](#project-management--top-ribbon-ux) | 10 | 10 / 10 |
| [Accessibility (WCAG 2.1 AA)](#accessibility-wcag-21-aa) | 8 | 8 / 8 |
| [Product UX — non-expert self-serve](#product-ux--non-expert-self-serve) | 14 | 14 / 14 |
| [M&E capabilities](#me-capabilities) | 7 | 7 / 7 |
| [Express Template Fill](#express-template-fill) | 28 | 28 / 28 |
| [Visual / E2E harness](#visual--e2e-harness) | 3 | 3 / 3 |
| [Internationalization (i18n)](#internationalization-i18n) | 5 | 5 / 5 |
| [Project output language](#project-output-language) | 3 | 3 / 3 |
| [Performance](#performance) | 4 | 4 / 4 |
| [Maintenance & hardening](#maintenance--hardening) | 16 | 15 / 16 |

---

## ✅ Delivered (archived)

> Full card bodies live in `docs/roadmap/archive/` and in git history.

| ID | Title | Area | Done |
|----|-------|------|------|
| MNT-16 | Hook-block agent self-approval of Playwright visual baselines via Bash | Maintenance & hardening | ✅ 2026-07-03 |
| MNT-15 | Fix: manually-created charts can ship with a blank title | Maintenance & hardening | ✅ 2026-07-03 |
| MNT-14 | Handle a `[[`/`]]` delimiter character split mid-token across docx runs | Maintenance & hardening | ✅ 2026-07-03 |
| MNT-13 | Fix unbounded `select(User)` in `apply_superadmin_emails` | Maintenance & hardening | ✅ 2026-07-01 |
| MNT-12 | Fix N+1 role queries in `/api/projects` list endpoint | Maintenance & hardening | ✅ 2026-07-02 |
| MNT-11 | Named chart colour palettes selectable from `config.yml` | Maintenance & hardening | ✅ 2026-07-01 |
| MNT-10 | Fix Tips card blank inline-code placeholders in `<Trans>` | Maintenance & hardening | ✅ 2026-06-28 |
| MNT-9 | Translate chart hardcoded strings to project language | Maintenance & hardening | ✅ 2026-06-28 |
| MNT-8 | Strip residual `[[` `]]` delimiters from built report output | Maintenance & hardening | ✅ 2026-07-01 |
| MNT-7 | Fix Express Fill silent empty state when LLM response is malformed | Maintenance & hardening | ✅ 2026-06-30 |
| MNT-6 | Remove dead code (components, exports, imports) | Maintenance & hardening | ✅ 2026-06-28 |
| MNT-5 | Guard period API fetches when no project is active | Maintenance & hardening | ✅ 2026-06-28 |
| MNT-4 | Fix Toast crash: i18n `t` shadowed by the toasts.map variable | Maintenance & hardening | ✅ 2026-06-27 |
| MNT-3 | I18N-1 backend hygiene: double-commit + verbatim Zitadel error | Maintenance & hardening | ✅ 2026-06-27 |
| MNT-2 | Clear dev-dependency CVEs (vite High + esbuild Moderate) | Maintenance & hardening | ✅ 2026-06-27 |
| MNT-1 | Stabilize the order-dependent ask-save indicator test | Maintenance & hardening | ✅ 2026-06-27 |
| PERF-4 | Client-side stale-while-revalidate cache (instant UI on reload / project-switch / refresh) | Performance | ✅ 2026-06-27 |
| PERF-3 | Per-page skeleton loaders for the data-driven tabs (perceived performance) | Performance | ✅ 2026-06-26 |
| PERF-2 | Shared (cross-worker) cache backend for the perf cache | Performance | ✅ 2026-06-25 |
| PERF-1 | Cache the expensive read-only server computations on a (data-session + config) fingerprint | Performance | ✅ 2026-06-20 |
| PLANG-3 | Generate AI output (narrative, summaries, suggestions, Ask) in the project language | Project output language | ✅ 2026-06-26 |
| PLANG-2 | Create-only language field + read-only language in AI config (UI) | Project output language | ✅ 2026-06-26 |
| PLANG-1 | Project language is set once at creation and drives the AI output language (backend + config mirroring) | Project output language | ✅ 2026-06-26 |
| VIS-3 | Cap Playwright workers to stop parallel-worker browser crashes in the E2E suite | Visual / E2E harness | ✅ 2026-07-03 |
| VIS-2 | Reconcile drifted visual baselines (A11Y-1/-2/-3, PUX-1) | Visual / E2E harness | ✅ 2026-06-22 |
| VIS-1 | Playwright visual harness (mobile/tablet/desktop) | Visual / E2E harness | ✅ 2026-06-18 |
| XTF-28 | Express Fill: infer split_value placeholder from template context | Express Template Fill | ✅ 2026-07-01 |
| XTF-27 | Express Fill: bullet_list render type for column-value lists in reports | Express Template Fill | ✅ 2026-07-01 |
| XTF-26 | Express Fill: auto-resolve proposals when column lives in a repeat table | Express Template Fill | ✅ 2026-06-30 |
| XTF-25 | Express Template Fill: extractor must read Word content controls (w:sdt) | Express Template Fill | ✅ 2026-06-27 |
| XTF-24 | Restrict split-by dropdown to select_one columns | Express Template Fill | ✅ 2026-06-19 |
| XTF-23 | DELETE /api/reports (all + single) deletes durable storage objects | Express Template Fill | ✅ 2026-06-19 |
| XTF-22 | Deterministic auto-modeling resolver for cross-table columns | Express Template Fill | ✅ 2026-06-19 |
| XTF-21 | Express split-by dropdown no longer clipped (CSS stacking) | Express Template Fill | ✅ 2026-06-19 |
| XTF-20 | Reports listing shows storage build-time (with local-mtime fallback) | Express Template Fill | ✅ 2026-06-19 |
| XTF-19 | Storage push mirrors output categories (fixes split-preview leaving stale reports) | Express Template Fill | ✅ 2026-06-19 |
| XTF-18 | Fix: express-path terminal does not auto-collapse after ~5s | Express Template Fill | ✅ 2026-06-19 |
| XTF-17 | Searchable split-by dropdown in the build options | Express Template Fill | ✅ 2026-06-19 |
| XTF-16 | build-report clears the reports output dir so each build is the current set | Express Template Fill | ✅ 2026-06-19 |
| XTF-15 | Remove the redundant rail "Build report" Quick Action on the Reports page | Express Template Fill | ✅ 2026-06-19 |
| XTF-14 | Reposition the run alert in-page (below the title, content width) + icon Stop | Express Template Fill | ✅ 2026-06-19 |
| XTF-13 | Build options for Express & regular build: split-by (main-table columns) + sample preview (`--split-sample`) | Express Template Fill | ✅ 2026-06-19 |
| XTF-12 | Reports page: "Delete all reports" + bulk-delete endpoint | Express Template Fill | ✅ 2026-06-19 |
| XTF-11 | Terminal: show ~5s during a build then auto-collapse; auto-expand on error | Express Template Fill | ✅ 2026-06-19 |
| XTF-10 | Replace the run badge with a fixed "report building…" alert + stop/cancel | Express Template Fill | ✅ 2026-06-18 |
| XTF-9 | Gate the "In a hurry?" Express banner on questions + data | Express Template Fill | ✅ 2026-06-18 |
| XTF-8 | Fix: Express apply persists the resolved template to durable storage + a relative `report.template` | Express Template Fill | ✅ 2026-06-18 |
| XTF-7 | Gate the Express "Infer" button on AI-tested status (parity with other AI buttons) | Express Template Fill | ✅ 2026-06-18 |
| XTF-6 | Fix: persist the uploaded template across infer → apply | Express Template Fill | ✅ 2026-06-18 |
| XTF-5 | Web review/approve panel + discoverability | Express Template Fill | ✅ 2026-06-18 |
| XTF-4 | CLI commands (`infer-template`, `apply-template`) | Express Template Fill | ✅ 2026-06-18 |
| XTF-3 | Apply: persist config + resolve template (`apply_inference`) | Express Template Fill | ✅ 2026-06-18 |
| XTF-2 | Batched inference + local validation (`infer_specs`, `annotate_proposals`) | Express Template Fill | ✅ 2026-06-18 |
| XTF-1 | Placeholder extraction from .docx (`extract_placeholders`) | Express Template Fill | ✅ 2026-06-18 |
| ME-7 | Chart `form:` selector for multi-form | M&E capabilities | ✅ 2026-06-27 |
| ME-6 | Surface below-threshold indicators in the Validate panel | M&E capabilities | ✅ 2026-06-27 |
| ME-5 | Sampling weights | M&E capabilities | ✅ 2026-06-26 |
| ME-4 | Multi-form / longitudinal linkage | M&E capabilities | ✅ 2026-06-26 |
| ME-3 | Indicator metadata catalog | M&E capabilities | ✅ 2026-06-26 |
| ME-2 | Variance / traffic-light dashboards | M&E capabilities | ✅ 2026-06-26 |
| ME-1 | Equity / inclusion lens | M&E capabilities | ✅ 2026-06-26 |
| PUX-14 | Chart editor: surface the live preview above the fold on mobile | Product UX — non-expert self-serve | ✅ 2026-07-03 |
| PUX-13 | Chart editor: link preview errors back to the offending field | Product UX — non-expert self-serve | ✅ 2026-07-03 |
| PUX-12 | Chart editor preview: keep last image visible during re-fetch | Product UX — non-expert self-serve | ✅ 2026-07-02 |
| PUX-11 | Inline live preview in the chart editor modal | Product UX — non-expert self-serve | ✅ 2026-07-01 |
| PUX-10 | Auto-save the connection before Fetch/Download (no stale-config runs) | Product UX — non-expert self-serve | ✅ 2026-06-27 |
| PUX-9 | Copy-placeholder buttons for charts / indicators / summaries / tables on the Analyze tab | Product UX — non-expert self-serve | ✅ 2026-06-26 |
| PUX-8 | Primary navigation labels adopt the PUX-1 plain-language stage names | Product UX — non-expert self-serve | ✅ 2026-06-26 |
| PUX-7 | Gate Fetch/Download on a confirmed connection; flip the sample-data affordance | Product UX — non-expert self-serve | ✅ 2026-06-26 |
| PUX-6 | Harden Home first-run readiness fetch (error + project-switch) | Product UX — non-expert self-serve | ✅ 2026-06-22 |
| PUX-5 | Reduce setup-before-value friction (demo / sample path) | Product UX — non-expert self-serve | ✅ 2026-06-22 |
| PUX-4 | In-app contextual help per stage | Product UX — non-expert self-serve | ✅ 2026-06-22 |
| PUX-3 | Reduce Composition cognitive load via progressive disclosure | Product UX — non-expert self-serve | ✅ 2026-06-22 |
| PUX-2 | First-run / empty-state onboarding with a single recommended next action | Product UX — non-expert self-serve | ✅ 2026-06-21 |
| PUX-1 | Plain-language relabeling of data-engineering vocabulary | Product UX — non-expert self-serve | ✅ 2026-06-22 |
| UX-10 | Navigate to Home tab on project switch | Project management & top ribbon (UX) | ✅ 2026-06-28 |
| UX-9 | Global "switching…" feedback | Project management & top ribbon (UX) | ✅ 2026-06-25 |
| UX-8 | Accessible labels on color swatches / icon buttons | Project management & top ribbon (UX) | ✅ 2026-06-26 |
| UX-7 | Explain read-only email (ProfileForm) | Project management & top ribbon (UX) | ✅ 2026-06-26 |
| UX-6 | Inline validation for required name (ProjectForm) | Project management & top ribbon (UX) | ✅ 2026-06-26 |
| UX-5 | Member rows fall back to a raw UUID | Project management & top ribbon (UX) | ✅ 2026-06-26 |
| UX-4 | Unsaved-changes guard on the project form | Project management & top ribbon (UX) | ✅ 2026-06-26 |
| UX-3 | Archived rows look clickable but do nothing | Project management & top ribbon (UX) | ✅ 2026-06-25 |
| UX-2 | Keyboard-accessible project switcher | Project management & top ribbon (UX) | ✅ 2026-06-25 |
| UX-1 | Show project color & icon | Project management & top ribbon (UX) | ✅ 2026-06-25 |
| OUT-3 | PostgreSQL remote table export | Output / export formats | ✅ 2026-06-25 |
| OUT-2 | MySQL remote table export | Output / export formats | ✅ 2026-06-25 |
| OUT-1 | JSON export (records array) | Output / export formats | ✅ 2026-06-25 |

---

## Output / export formats

> The **Deliver → Output** tab ships **CSV** and **XLSX** data-file exports today
> (`export.format`). The targets below are designed in the config schema and have
> CLI/back-end support, but are gated off in the UI until verified end-to-end per project.
> To re-enable a format: drop its `soon: true` flag in `FORMATS`
> ([frontend/src/pages/Sources.jsx](../frontend/src/pages/Sources.jsx)) and confirm the
> matching `_export_*` path in [src/data/transform.py](../src/data/transform.py).

---

## Project management & top ribbon (UX)

> Findings from a UX audit of the project switcher / create-edit form / profile / members
> flow (shipped in #63). Grouped by impact.

### High

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

- [x] **A11Y-8 — Deferred a11y polish: home-card subtext contrast + picker focus ring (P2)**

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

## M&E capabilities

> Still-open gaps from the 2026-04-07 M&E audit. The audit's top findings have **shipped** —
> see *Shipped foundations* above. The full original audit + scorecard is archived at
> [docs/archive/2026-04-07-me-audit.md](archive/2026-04-07-me-audit.md). What remains:

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

## Visual / E2E harness

> The Definition of Done requires Playwright `toHaveScreenshot` baselines at mobile/tablet/desktop
> for every UI card, but the harness to produce them did not exist. This stands it up once so all
> UI cards (XTF-5, UX-*) can satisfy that gate.

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
- [x] **I18N-3 — Externalize the remaining untranslated surfaces to EN/FR + close the guard blind spots (P2)**

  Follow-up from I18N-2. A full translation audit (2026-06) found the locale bundles are perfectly
  key-aligned (0 missing / 0 empty), but several surfaces render **hardcoded English** because the
  strings never call `t()` — and `check:i18n` missed them for two reasons: (1) it only scans the
  literal props `title`/`aria-label`/`placeholder`/`alt` (not `eyebrow`/`sub`/`saveLabel`/`hint`),
  and (2) it doesn't audit Profile / Ask / Validate / ProjectForm / members at all. Externalize every
  remaining user-facing literal on those surfaces AND harden the guard so the blind spots can't recur.

  **Untranslated surfaces (from the audit):** **Profile.jsx** — `PageHeader` (eyebrow/title/sub),
  the column-table headers (Column, Role, Completeness, Outlier rate, Dup. rate, Distinct, Detail),
  "No visible columns.", the loading label ("Profiling…"), and the empty/error states ("Profiling
  failed", "Nothing to profile yet"). **Ask.jsx** — header, the two placeholders, "Ask anything
  about your data", "Couldn't answer that". **Validate.jsx** — header, "Running validation…",
  "Validation failed", "No issues found…". **ProjectForm.jsx** — tabs (Details / Members / Danger
  zone), field labels (Name, Description, Tags, Default language, Color, Icon) + placeholders, the
  Delete-project block. **ProjectMembersPanel.jsx** (+ members modal) — Loading…, Member, Role,
  Remove, Pending invites, Invite someone, the invite aria-labels + placeholder. **Composition.jsx**
  strays — `saveLabel="Suggest"`, the AI `hint`, `title="Edit"`/`title="Delete"` row buttons,
  "Download". **Questions.jsx** stray — "PII". (Out of scope / intentional literals: code-style
  example placeholders such as `env:DB_USER`, `aAbBcCdDeEfFgGhH`, `top_n: 10`, `Age > 18 …`.)

  **Files:** `frontend/src/pages/Profile.jsx` · `frontend/src/pages/Ask.jsx` ·
  `frontend/src/pages/Validate.jsx` · `frontend/src/pages/ProjectForm.jsx` ·
  `frontend/src/pages/Composition.jsx` (strays) · `frontend/src/pages/Questions.jsx` (PII stray) ·
  `frontend/src/components/ProjectMembersPanel.jsx` (+ members modal) ·
  `frontend/src/locales/{en,fr}.json` (additive, key-aligned) · `frontend/scripts/check-i18n.mjs`
  (add `eyebrow`/`sub`/`saveLabel`/`hint` to the scanned literal props AND add the above files to the
  audited set) · `frontend/tests/e2e/i18n-remaining.spec.ts` (new)

  **Config/schema impact:** None — additive locale keys + check-script scope.

  **Acceptance criteria**
  - Every user-facing string on the surfaces listed above is sourced from the en/fr bundles — no
    hardcoded literal remains (the intentional code-style example placeholders are exempt)
  - `check:i18n` is **hardened** so it would now FAIL on this class of escape: it scans
    `eyebrow`/`sub`/`saveLabel`/`hint` literal props in addition to `title`/`aria-label`/
    `placeholder`/`alt`, and its audited set includes Profile / Ask / Validate / ProjectForm /
    ProjectMembersPanel / Composition / Questions; it PASSES on the completed bundles
  - en/fr stay key-aligned with no empty values
  - With language=fr, representative strings on **Profile** (the screenshot surface), Ask, Validate,
    ProjectForm, and the members panel render in French; switching to English reverts them; no raw
    translation key leaks into the UI
  - English output is unchanged (same visible text in English as before — pure externalization)

  **Unit tests:** N/A (frontend; Vitest not installed — asserted by the Playwright E2E + `check:i18n`).

  **E2E:** `frontend/tests/e2e/i18n-remaining.spec.ts` (new) + visual — with profile language=fr,
  visit Profile, Ask, Validate, the project form, and the members panel and assert a representative
  string on each renders in French and that no raw key (`foo.bar`) leaks; assert the same strings
  revert in English. Add a guard-teeth check: a temporary hardcoded `eyebrow`/`sub` literal makes
  `check:i18n` exit non-zero. `toHaveScreenshot` baseline of the French Profile header at three
  viewports (mobile 390×844 / tablet 820×1180 / desktop 1440×900); a human approves (checking no FR
  overflow).

  **UAT:**
  1. In French, open Profile and confirm the eyebrow/title/description and the column-table headers
     are all French (no English, no raw keys).
  2. In French, open Ask, Validate, the project edit form, and a project's Members panel; confirm all
     labels/buttons/placeholders are French.
  3. Switch to English; confirm everything reverts. Confirm no text overflows at mobile/tablet/desktop.

  **Verify:** `cd frontend && npm run check:i18n` ·
  `cd frontend && npx playwright test i18n-remaining.spec.ts`

---

- [x] **I18N-4 — Native French review + correction of fr.json (P2)**

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

- [x] **I18N-5 — Translate the navigation sub-tabs + guard against label-in-data-array escapes (P2)**

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

## Maintenance & hardening

> Tracked tech-debt / hardening surfaced during the 2026-06 build-out. Not feature work — small,
> well-scoped fixes that keep the suite + toolchain healthy.

---

## Backlog — parked (out of scope for now)

> Captured so they aren't lost; not scheduled. Promote into a domain section above when picked up.

- **Skip the download when the remote is unchanged** — `run-all` already skips a stale
  build-report; skipping the *download* itself when the Kobo/Ona remote hasn't changed is a
  later slice (would need a remote content fingerprint).
- **True multi-user read isolation** — concurrent users with different active projects share
  the one `BASE_DIR` read-mirror (best-effort, last-writer-wins). Durable Minio/DB data is
  always correct; per-user read isolation is out of scope (see `CLAUDE.md` → run concurrency).
- **Indicator/View/Summary preview consistency with the chart editor** — PUX-11 merged the
  chart preview inline into `ChartModal`; the Indicator/View/Summary "Preview" actions in
  `Composition.jsx` still open a separate titled modal, the exact pattern PUX-11 removed for
  charts. Not urgent (no reported user confusion), but worth a deliberate look — either migrate
  them to the same inline pattern, or record why charts specifically warranted it and the
  others don't.
