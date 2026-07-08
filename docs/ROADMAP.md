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
| [Visual / E2E harness](#visual--e2e-harness) | 12 | 11 / 12 |
| [Internationalization (i18n)](#internationalization-i18n) | 5 | 5 / 5 |
| [Project output language](#project-output-language) | 3 | 3 / 3 |
| [Performance](#performance) | 4 | 4 / 4 |
| [Maintenance & hardening](#maintenance--hardening) | 33 | 32 / 33 |

---

## ✅ Delivered (archived)

> Full card bodies live in `docs/roadmap/archive/` and in git history.

| ID | Title | Area | Done |
|----|-------|------|------|
| MNT-21 | Fix: bullet_list chart preview fails instead of rendering text | Maintenance & hardening | ✅ 2026-07-05 |
| MNT-22 | Fix: stale "Transform" nav-label assertions in i18n-switch.spec.ts + a11y-4.spec.ts break deterministically on current develop | Maintenance & hardening | ✅ 2026-07-04 |
| MNT-20 | Prompt guidance: tell the LLM when to use `bullet_list` instead of `table` (Express Fill inference) | Maintenance & hardening | ✅ 2026-07-04 |
| MNT-19 | Add `bullet_list` as a proposable AI-inference type (stop over-defaulting free-text/list placeholders to `table`) | Maintenance & hardening | ✅ 2026-07-04 |
| MNT-18 | Add `{{ year }}` / `{{ month }}` / `{{ day }}` date-component placeholders | Maintenance & hardening | ✅ 2026-07-04 |
| MNT-17 | Fix: `{{ split_value }}` documented (and relied on by Express Fill) but missing from the render context | Maintenance & hardening | ✅ 2026-07-04 |
| VIS-12 | Split Tier 1 specs into functional + visual, Shard C: build/report/misc (10 files) | Visual / E2E harness | ✅ 2026-07-04 |
| VIS-11 | Split Tier 1 specs into functional + visual, Shard B: i18n / product-UX / composition (15 files) | Visual / E2E harness | ✅ 2026-07-04 |
| VIS-9 | Scaffold the visual-review root directory + dedicated Tier 1 visual config + relocate the Tier 3 review app + ledger | Visual / E2E harness | ✅ 2026-07-04 |
| VIS-7 | Fix: guard-visual-update.sh false-positive blocks unrelated commands + silent jq-missing fail-open | Visual / E2E harness | ✅ 2026-07-04 |
| VIS-4 | Adopt Storybook (Tier 2) + local review app (Tier 3) + visual-approval ledger | Visual / E2E harness | ✅ 2026-07-03 |
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

- [x] **VIS-8 — Fix: uncap hardcoded worker count to stop full-suite instability (P2)**

  **Created:** 2026-07-04 · **Started:** 2026-07-05 · **Completed:** 2026-07-06

  Both `frontend/playwright.config.ts` (line 30) and `frontend/playwright.storybook.config.ts`
  (line 21) hardcode a fixed worker count of 4, contradicting VIS-3's own in-file rationale
  ("Serialize to one worker so specs that pass in isolation also pass in the full suite...
  applies BOTH in CI and locally") and confirmed unstable this session: 25/69 failures at 4
  workers vs 0/69 at 1 worker on an identical spec file under full-suite load. The hardcoded 4
  is drift that silently broke VIS-3's frozen contract (`vis-3-worker-cap.spec.ts` requires the
  resolved `workers` value to be a number in [1,2] under both CI and local). Not urgent enough
  to block other work — captured here to fix later, at low priority, independent of the
  visual-review migration.

  **Type:** Fix

  **Amendment (2026-07-06):** the original proposal set the local branch to
  `process.env.CI ? 1 : '50%'`. That is withdrawn — `'50%'` (≥4 workers on most machines) can
  never satisfy VIS-3's frozen [1,2] numeric assertion and would reintroduce the shared-dev-server
  crashes VIS-3 fixed, contrary to VIS-8's own 0/69-at-1-worker evidence. The fix is a flat
  `workers: 1` (proven clean, honors VIS-3). Storybook-only local parallelism (its static
  `http-server` build is not constrained by VIS-3) is a possible future follow-up, out of scope
  here.

  **Files:** `frontend/playwright.config.ts` (line ~30, worker count → flat `1`; revise the stale
  comment above it, lines ~23-29, which currently argues for a single-worker cap in both CI and
  local — bring the comment in line with the actual value) · `frontend/playwright.storybook.config.ts`
  (line ~21, same change to flat `1`; note in a comment that this config screenshots a static
  `http-server`-served Storybook build, not the shared Vite dev server, so the contention
  argument is weaker here — capped at 1 for consistency, could be relaxed later)

  **Config/schema impact:** None — test harness config only.

  **Acceptance criteria**
  - Worker count is a flat `workers: 1` in both configs, replacing the hardcoded value of 4
    (supersedes the earlier `process.env.CI ? 1 : '50%'` proposal, which conflicted with VIS-3's
    frozen test)
  - The resolved worker value is `1` under both CI (`process.env.CI` truthy) and local, keeping
    the run single-worker / deterministic and satisfying VIS-3's [1,2] contract
  - Locally, `cd frontend && npm run test:e2e` (full suite, all 3 viewports) completes with
    **zero crash-class failures** (page-crash / target-closed / worker-timeout) across 3
    consecutive full runs
  - `chart-editor.spec.ts` (the VIS-3 regression spec) still passes 33/33 across all three
    viewports as part of the full suite
  - No change to `fullyParallel`, `retries`, `expect.toHaveScreenshot`, or `webServer`

  **Unit tests:** `tests/test_vis8_worker_count.py` — static config-contract assertions that both
  configs declare `workers: 1` and that `fullyParallel` / `retries` / `toHaveScreenshot` /
  `webServer` are unchanged (same static-config posture as `test_vis11_*`).

  **E2E:** Validated by the harness itself — `cd frontend && npm run test:e2e` and
  `npm run test:visual:storybook`, each run 3 consecutive times, zero crash-class failures. No
  new spec or baseline. VIS-3's frozen `vis-3-worker-cap.spec.ts` also re-passes once `workers`
  is `1`.

  **UAT:** N/A (test-infra/CI change, no user-facing surface — PR review + 3 green local/CI runs
  are the human gate, same posture as VIS-3).

  **Verify:** `cd frontend && npm run test:e2e` (repeat 3x) · `cd frontend && npm run test:visual:storybook`

---

- [x] **VIS-10 — Split Tier 1 specs into functional + visual, Shard A: Accessibility + project-ribbon UX (15 files) (P2)**

  **Created:** 2026-07-04 · **Started:** 2026-07-06 · **Completed:** 2026-07-07

  First of three mechanical-transformation shards splitting the 41 Tier 1 spec files that mix
  functional AC tests and screenshot assertions in one file (per VIS-9's now-proven contract).
  For each file: the visual test block(s) — plus whatever setup (route stubs, navigation
  helpers) they need, duplicated inline per this codebase's existing per-spec self-containment
  convention — move verbatim into a new `visual-review/specs/<name>.visual.spec.ts`; the
  functional file stays at `frontend/tests/e2e/<name>.spec.ts` with the screenshot assertion(s)
  removed and its functional test bodies otherwise untouched; the baseline directory moves via
  `git mv` with filenames updated to the new template established by VIS-9 (pixel-identical,
  filename only). **Note (applies to the whole initiative, stated once here):**
  `connection-autosave.spec.ts`, `i18n-guard-navlabels.spec.ts`, and `toast-i18n.spec.ts` contain
  zero screenshot assertions and are out of scope for VIS-10/11/12 entirely — not touched by any
  shard.

  **Type:** Feature

  **Files:** for each of the 15 files below: keep `frontend/tests/e2e/<name>.spec.ts` (visual
  assertions + now visual-only helpers removed) · add `visual-review/specs/<name>.visual.spec.ts`
  (new) · `git mv` the baseline PNGs from `frontend/tests/e2e/<name>.spec.ts-snapshots/` to
  `visual-review/baselines/<name>.visual.spec.ts/` (renamed to the new template) · delete
  the emptied `frontend/tests/e2e/<name>.spec.ts-snapshots/`.
  Files: `a11y-1.spec.ts`, `a11y-2.spec.ts`, `a11y-3.spec.ts`, `a11y-4.spec.ts`, `a11y-5.spec.ts`,
  `a11y-8.spec.ts`, `ux-1.spec.ts`, `ux-2.spec.ts`, `ux-3.spec.ts`, `ux-4.spec.ts`, `ux-5.spec.ts`,
  `ux-6.spec.ts`, `ux-7.spec.ts`, `ux-8.spec.ts`, `ux-9.spec.ts`.

  **Config/schema impact:** None — test-file reorganization only.

  **Acceptance criteria**
  - Each of the 15 files is split as described: the file remaining at `frontend/tests/e2e/<name>.spec.ts`
    contains zero screenshot assertions; its functional/AC/axe tests are behaviorally identical
    to before the split
  - Each `visual-review/specs/<name>.visual.spec.ts` contains exactly the extracted visual test(s)
    (verbatim bodies) plus the minimal duplicated setup they need
  - Each `visual-review/baselines/<name>.visual.spec.ts/` reproduces the same three viewport
    baselines as the old colocated snapshots directory, renamed to the new filename template
  - `cd frontend && npm run test:visual` passes clean (no diff) for all 15 migrated specs against
    their moved baselines, with **no recapture** — except any spec proven to have a live CSS
    transition/animation mid-capture (called out individually if found, with its baseline
    regenerated + human-approved instead of moved verbatim, since the new config's
    animation-freezing option can change captured pixels for such a spec)
  - `cd frontend && npm run test:e2e` is green for all 15 files, same pass/fail behavior as
    before the split
  - No file remains in any of the 15 old snapshots directories (fully moved, not duplicated)

  **Unit tests:** N/A (frontend-only test-file reorg; Vitest is not installed — correctness is
  exactly what the migrated Playwright specs below assert, per the XTF-7 precedent).

  **E2E:** the 15 new `visual-review/specs/*.visual.spec.ts` files listed above, at all three
  viewports, against the moved (pixel-identical) baselines — no new product-UI captures. The 15
  retained `frontend/tests/e2e/*.spec.ts` files continue to pass unchanged.

  **UAT:** N/A (test-infra file reorganization, not a product change; no new UI behavior — PR
  review + the green functional+visual runs are the human gate).

  **Verify:** `cd frontend && npx playwright test a11y-1 a11y-2 a11y-3 a11y-4 a11y-5 a11y-8 ux-1 ux-2 ux-3 ux-4 ux-5 ux-6 ux-7 ux-8 ux-9`
  (functional, green) · `cd frontend && npm run test:visual -- a11y-1 a11y-2 a11y-3 a11y-4 a11y-5 a11y-8 ux-1 ux-2 ux-3 ux-4 ux-5 ux-6 ux-7 ux-8 ux-9`
  (visual, green against moved baselines)

  **Depends on:** VIS-9 (needs `visual-review/specs/`, `visual-review/baselines/`,
  `playwright.visual.config.ts`, and the Tier 1 dedicated-config visual-run script).

---

- [x] **VIS-13 — Relocate Tier 2 Storybook config + stories + specs into visual-review/storybook/ (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-07

  Tier 2's one existing spec (`example.visual.spec.ts`) is already visual-only (no functional AC
  mixed in), so this card is a relocation, not a functional/visual split. Moves the Storybook
  config, the placeholder story, its visual spec, and its baselines into `visual-review/storybook/`,
  and the Playwright config that drives them to `visual-review/playwright.storybook.config.ts`
  (sibling of VIS-9's `playwright.visual.config.ts`), completing the directory contract from VIS-9.
  **Depends on VIS-9** (needs `visual-review/review-app/` already relocated) **and VIS-8** (VIS-8
  edits `frontend/playwright.storybook.config.ts` at its pre-migration path — if VIS-13 lands
  first, that file no longer exists there and VIS-8 becomes unimplementable as scoped; land VIS-8
  before VIS-13, or fold VIS-8's worker-count change directly into this card's relocated config
  if VIS-13 lands first). VIS-5 and VIS-6 (parked in the Backlog) already target the post-VIS-13
  `visual-review/storybook/` paths as of 2026-07-04 — no further conflict-resolution needed here.

  **Type:** Feature

  **Files:**
  - MOVE `frontend/.storybook/main.js` → `visual-review/storybook/main.ts` (rename to `.ts` per
    the target tree; update the `stories` glob — currently relative to `.storybook/` — so it
    still finds real app-component stories under `frontend/src/**` (the VIS-5/VIS-6 colocation
    convention) *and* harness/example stories now under `visual-review/storybook/stories/`)
  - MOVE `frontend/.storybook/preview.js` → `visual-review/storybook/preview.ts`
  - MOVE `frontend/playwright.storybook.config.ts` → `visual-review/playwright.storybook.config.ts`
    (update `testDir` to `./storybook/specs`; add `snapshotDir: 'storybook/baselines'` and the
    same custom `snapshotPathTemplate` pattern as VIS-9's Tier 1 config (project-name token
    required — omitting it collapses viewports); `outputDir: 'results/storybook/output'`;
    `use.baseURL` unchanged (`http://localhost:6006`); `webServer.command` unchanged (a static
    http-server serving the Storybook build) but now points at the relocated build output — see
    the build-script change below; carry forward VIS-8's worker-count change if VIS-8 hasn't
    already landed at this path)
  - MOVE `frontend/tests/storybook/Example.stories.jsx` → `visual-review/storybook/stories/Example.stories.jsx`
  - MOVE `frontend/tests/storybook/example.visual.spec.ts` → `visual-review/storybook/specs/example.visual.spec.ts`
  - `git mv` the 6 baseline PNGs from `frontend/tests/storybook/example.visual.spec.ts-snapshots/`
    to `visual-review/storybook/baselines/example.visual.spec.ts/` (renamed to the new template,
    pixel-identical)
  - delete emptied `frontend/.storybook/`, `frontend/tests/storybook/`
  - `frontend/package.json` — update the `storybook` dev-server script, the `storybook:build`
    script, and both Tier 2 visual test scripts to reference the new config-dir and output-dir
    under `visual-review/storybook/`
  - `visual-review/review-app/server.mjs` — scan **two** tier pairs instead of one: the Tier 1
    baseline/output pair and the Tier 2 baseline/output pair, merge the results for the diffs
    endpoint, and dispatch approve/reject to whichever tier's entry matched by id
  - `visual-review/review-app/test.mjs` — extend with a case covering the two-tier merge
  - `.gitignore` — remove the dead pre-migration Storybook build/report output lines; add
    `visual-review/storybook/static/`

  **Config/schema impact:** None — pure frontend dev-tooling relocation, no `config.yml`/DB
  surface.

  **Acceptance criteria**
  - `cd frontend && npm run storybook:build` produces `visual-review/storybook/static/` with the
    Example story chunk, using the relocated config files
  - `cd frontend && npm run test:visual:storybook` runs `example.visual.spec.ts` from
    `visual-review/storybook/specs/` against the moved baselines and passes clean at all three
    viewports (each viewport independently distinct, per the project-name-token template), with
    **no recapture**
  - the review app's diffs endpoint correctly reports diffs sourced from *both* Tier 1 and Tier 2
    baseline trees (verified with one manufactured Tier 1 diff and one manufactured Tier 2 diff
    present simultaneously)
  - `node visual-review/review-app/test.mjs` passes, including the new two-tier merge case
  - `frontend/.storybook/`, `frontend/tests/storybook/`, and `frontend/playwright.storybook.config.ts`
    no longer exist
  - `cd frontend && npm run build` and the (still-current-location) Tier 1 functional/visual
    suites are unaffected

  **Unit tests:** `visual-review/review-app/test.mjs` (extend) — new assertion that the diffs
    handler merges Tier 1 + Tier 2 results into one list with no id collisions. Run:
    `node visual-review/review-app/test.mjs`.

  **E2E:** `visual-review/storybook/specs/example.visual.spec.ts` (relocated) — the two example
  story variants at all three viewports against the moved baselines; no new product-UI capture.

  **UAT:**
  1. Run `cd frontend && npm run storybook` (now internally targeting the relocated config-dir)
     and confirm the Storybook workbench opens at `http://localhost:6006` showing the
     Example/Button story with Primary/Disabled variants.
  2. Run `cd frontend && npm run storybook:build && npm run test:visual:storybook` and confirm it
     passes clean against the relocated baselines — no diff, no recapture needed.
  3. Run `node visual-review/review-app/server.mjs`, open `http://localhost:4444`, and confirm it
     reports zero pending diffs on a clean tree (proving both Tier 1 and Tier 2 baseline trees are
     scanned together without false positives).

  **Verify:** `cd frontend && npm run storybook:build` · `cd frontend && npm run test:visual:storybook` ·
  `node visual-review/review-app/test.mjs` · `cd frontend && npm run build`

---

- [ ] **VIS-14 — Cut over CI + guard-hook comments + docs to the visual-review layout; retire dead old locations (P2)**

  **Created:** 2026-07-04

  Final card: makes `visual-review/` the CI-enforced and documented source of truth, and sweeps
  up everything the previous cards left as follow-on debt (stale doc paths, stale gitignore
  lines, and the visual-review agent's git-diff logic mistaking this migration's own
  pixel-identical renames for brand-new unapproved baselines).

  **Type:** Feature

  **Files:**
  - `.github/workflows/visual.yml` — keep the existing Tier 1 functional job (now
    functional-only post VIS-10-12); add steps/jobs running the Tier 1 visual suite and the
    Tier 2 visual suite from `frontend/`; extend the PR path trigger to include `visual-review/**`
    alongside `frontend/**`
  - `.claude/hooks/guard-visual-update.sh` — update header-comment example paths to the new
    baseline locations (comment only; VIS-7's denylist is path-agnostic)
  - `.gitignore` — remove the now-fully-dead pre-migration output lines (nothing writes there
    once CI/local runs point at `visual-review/`); confirm the new gitignored paths are present
  - `CLAUDE.md` — rewrite the Tests-Visual/E2E section and the Development-workflow
    Visual-testing section to describe the new layout: Tier 1 split into functional
    `frontend/playwright.config.ts` + visual `visual-review/playwright.visual.config.ts`; Tier 2
    `visual-review/playwright.storybook.config.ts` + `visual-review/storybook/`; Tier 3
    `visual-review/review-app/`; update example commands
  - `.claude/context.md` — same path references, if present
  - `.claude/skills/visual-review/SKILL.md` — update the baseline glob patterns, ledger location,
    and review-app path
  - `.claude/agents/visual-review.md` — same path updates; **also** add rename-detection to its
    git-diff/git-status baseline-change detection, so VIS-9-13's pixel-identical `git mv` renames
    are recognized as renames, not new-and-therefore-pending baselines

  **Config/schema impact:** None — CI/docs/hook-comment cutover only.

  **Acceptance criteria**
  - CI runs Tier 1 functional, Tier 1 visual, and Tier 2 visual, all green on a clean PR; the
    workflow triggers on PRs touching only `visual-review/**`
  - `.gitignore` no longer references any now-dead pre-migration output path, and lists the
    `visual-review/` equivalents
  - `CLAUDE.md`, `.claude/context.md`, `.claude/skills/visual-review/SKILL.md`, and
    `.claude/agents/visual-review.md` reference only `visual-review/` paths — no stale
    pre-migration path remains in any of them
  - Running the visual-review check on a branch that contains only this migration's renames (no
    other pixel change) reports clear, not a wall of spurious pending entries
  - `frontend/playwright.storybook.config.ts`, `frontend/.storybook/`,
    `frontend/scripts/visual-review-app/`, and the root approvals-ledger file do not exist
    anywhere in the repo
  - Full regression: the functional suite, the Tier 1 visual suite, the Storybook build, and the
    Tier 2 visual suite all green in one pass; the main app build unaffected

  **Unit tests:** N/A (CI/docs/config cutover; no isolable application logic).

  **E2E:** N/A beyond re-running the existing suites as the Verify command — this card re-points
  CI/docs at what VIS-9-13 already built and proved; no new product-UI coverage is added.

  **UAT:** N/A (infra/CI/docs cutover, no product UI change — PR review + a green CI run on this
  PR are the human gate, consistent with VIS-1/VIS-3's posture for this same harness).

  **Verify:** open a PR touching only `visual-review/**` and confirm the Visual workflow triggers
  with all jobs green · run the full regression command above · run the visual-review check on
  the migration branch and confirm it reports clear · grep the docs/hooks tree for any remaining
  reference to a pre-migration path and confirm nothing is found

  **Depends on:** VIS-9, VIS-10, VIS-11, VIS-12, VIS-13 (all must be merged first — final cutover).

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

- [x] **MNT-23 — Backend foundation for a first-class `list` kind (P1)**

  **Created:** 2026-07-05 · **Completed:** 2026-07-05

  **Type:** Feature (refactor/promotion of existing bullet_list machinery)

  `bullet_list` today only exists as a hidden sub-type of `kind="chart"` (`spec.type="bullet_list"`)
  across `src/reports/ask_engine.py`, `src/reports/template_inference.py`,
  `src/reports/builder.py`, and `src/reports/template_generator.py`. This card promotes it to a
  genuine first-class `list` kind, mirroring the precedent already established for `table` (which
  has its own `_KIND_SECTION` entry and its own `cfg['tables']` config section, distinct from
  generic `charts:`, even though it renders via the same chart engine). This is **purely
  additive** — the existing `charts: [{type: bullet_list}]` shape must keep working completely
  unchanged (no config migration, no back-compat shim needed, both shapes coexist indefinitely).
  No user-facing UI surface changes in this card (that's MNT-24/MNT-25).

  **Files:**
  - `src/reports/ask_engine.py` — add `"list"` alongside `"table"` in 4 spots: the
    column-requirement rule (~L75, a list needs ≥1 column, no categorical requirement — reuse the
    existing bullet_list rule already at ~L76), `validate_recipe` (~L95, mirror `if
    kind=="table": return _validate_chart(...)`), `_execute_item` (~L363, mirror the table
    render-recipe-in override), `_SAVE_SECTIONS`/`save_recipe` (~L521-540, mirror table's section
    mapping + forced type).
  - `src/reports/template_inference.py` — add `_KIND_SECTION["list"] = ("lists", "list_")`
    (~L782-787); remove the `if kind=="chart" and spec.get("type")=="bullet_list":
    prefix="list_"` hack in `apply_inference` (~L918-922); add `"list"` to the `_KINDS` tuple
    (~L231).
  - `src/reports/builder.py` — new `self.lists_cfg` + `_generate_lists()` method mirroring
    `_generate_tables()`/`self.tables_cfg`, reading `cfg.get("lists", [])` and calling the
    existing `build_bullet_list_text` (`src/reports/charts.py`) to produce `{{ list_<name> }}`
    context entries. The old bullet_list-inside-`_generate_charts` special case (~L447-453) stays
    unchanged for back-compat.
  - `src/reports/template_generator.py` — new `cfg.get('lists', [])` iteration branch mirroring
    the 3 places it already iterates `cfg.get('tables',[])`. Old bullet_list-inside-charts
    iteration stays for back-compat.
  - `src/utils/seed_prompts.py` — update the `_TEMPLATE_INFERENCE` prompt (~L952-994) and
    `_TEMPLATE_INFERENCE_OUTPUT_SCHEMA`'s kind enum (~L939-941) to include `"list"` as a
    first-class proposable kind (replacing the MNT-20 "steer LLM to use kind=chart+type=bullet_list"
    wording).

  **Config/schema impact:** New optional top-level `lists:` config.yml section (list-of-dicts:
  `name`, `title`, `question`, optional `filter`), additive only — no migration of existing
  `charts:` entries.

  **Acceptance criteria**
  - A recipe/proposal with `kind="list"` validates, executes, and saves correctly through
    `ask_engine.py` exactly as `kind="table"` does today (same 4 code paths), requiring only ≥1
    column (no categorical requirement)
  - `template_inference.py`'s `apply_inference` persists an approved `kind="list"` proposal into
    `cfg['lists']` (not `cfg['charts']`) and rewrites its template token to `{{ list_<name> }}`
  - `ReportBuilder._generate_lists()` renders every `cfg['lists']` entry into a `{{ list_<name>
    }}` context value via `build_bullet_list_text`, identically to how the old
    bullet_list-as-chart-type path renders today
  - `template_generator.py` emits `{{ list_<name> }}` placeholders for `cfg['lists']` entries when
    auto-building a Word template
  - The Express inference prompt can propose `kind="list"` directly; the AI schema's kind enum
    includes `"list"`
  - Existing configs with `charts: [{type: bullet_list}]` continue to render exactly as before —
    zero regression, verified by the existing bullet_list test suite passing unchanged

  **Unit tests:** Extend/add cases in `tests/test_ask_engine.py` (list kind through
  validate_recipe/_execute_item/save_recipe), `tests/test_template_inference.py` (list kind
  section routing + placeholder prefix), `tests/test_seed_prompts.py` (schema enum includes
  "list"), `tests/test_ask_api.py` and `tests/test_template_api.py` if those exercise kind
  dispatch. Add a builder-level test for `_generate_lists()` reading `cfg['lists']`.

  **E2E:** N/A (pure backend/config-schema addition — no new UI surface in this card; the UI
  surface is added by MNT-24/MNT-25).

  **UAT:** N/A (non-UI/CLI card — relies on unit tests + PR review per this repo's DoD convention
  for backend-only cards).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_engine.py
  tests/test_template_inference.py tests/test_seed_prompts.py tests/test_ask_api.py
  tests/test_template_api.py -q`

---

- [x] **MNT-24 — Express review UI: expose `list` as a selectable kind (P0) — fixes the reported bug**

  **Created:** 2026-07-05 · **Completed:** 2026-07-05

  **Depends on: MNT-23.**

  **Type:** Fix

  In the Express Template Fill review panel, a placeholder like a plain list of partner names
  ("liste_partenaires", no categorical column) gets AI-proposed as `kind="table"`, which fails
  validation ("'table' needs ≥1 categorical column"). The user has no way to manually reclassify
  the row, because the review panel's `KINDS` dropdown (`frontend/src/pages/Templates.jsx`) only
  offers `chart/indicator/summary/table/narrative/metadata` — `bullet_list` isn't selectable since
  it's hidden as a chart sub-type, and the spec column is read-only. This card is the direct fix,
  once MNT-23 makes `list` a real, round-trippable kind.

  **Folded in from MNT-23's PR review (security-audit, 2026-07-05):** two `question`/`questions`
  field-name mismatches that would otherwise silently defeat this card's own UAT. (1)
  `ask_engine.validate_recipe`'s `kind=="list"` branch (`src/reports/ask_engine.py:97-98`)
  delegates to `_validate_chart({**recipe, "type": "bullet_list"}, ...)`, which only reads the
  plural `questions` field — but the Express-inferred/manually-set list spec uses the singular
  `question` (matching `cfg['lists']`'s actual persisted shape). Every list proposal therefore
  fails a generic "needs ≥1 column" check *before* reaching the hidden/PII-column gate, so a user
  who reclassifies a row to `list` and clicks Apply would see it silently bounce back to
  `needs_attention` server-side with the wrong (and unhelpful) rejection reason — directly
  breaking this card's own UAT step 3/4. (2) `ask_engine.save_recipe` (`src/reports/ask_engine.py`
  ~L539-558) forces `type: "table"` for `kind=="table"` but has no equivalent normalization for
  `kind=="list"`, so a list saved via the Ask panel keeps a plural `questions` key that
  `ReportBuilder._generate_lists()` (MNT-23) never reads (it only reads singular `question`),
  silently rendering an empty `{{ list_<name> }}`. Both are fail-safe/fail-closed (no data
  exposure), but must be fixed as part of this card since MNT-24's own UAT (apply a list, confirm
  it builds with content) cannot pass otherwise.

  **Folded in from this card's own PR review round 2 (roadmap-verifier, 2026-07-05):** a third
  instance of the same field-mismatch pattern, this time a real PII-leak path, not just a
  data-correctness gap. `web/main.py::_bullet_list_names_excluded` — the cfg-only PII/hidden-column
  gate used as the "no data downloaded yet" fallback by both `POST /api/ask/save` and
  `POST /api/template/apply` — only recognized a spec as gate-worthy when `spec.get('type') ==
  'bullet_list'` and only read the plural `spec.get('questions')` field. A genuine `kind='list'`
  spec (exactly the shape `save_recipe` now normalizes to, and the exact shape the Express AI
  schema instructs the LLM to produce: `{name, title, question}`) carries no `type` key at all and
  uses the singular `question` field, so it was invisible to the gate — a `kind='list'` recipe
  naming a PII/hidden column, saved via the Ask panel or applied via Express Fill's
  `/api/template/apply` *before* any data has been downloaded for the project (profile
  unavailable), would silently bypass the documented fail-closed gate and get persisted into
  `cfg['lists']`, later rendered verbatim into the `.docx` — an actual PII leak. Fixed by giving
  `_bullet_list_names_excluded` an explicit `kind` parameter (both call sites now pass it through)
  and recognizing `kind == "list"` (reading either singular `question` or plural `questions`) in
  addition to the legacy `type == "bullet_list"` check.

  **Folded in from this card's own PR review round 3 (roadmap-verifier, 2026-07-05):** adding the
  3 new `express-list-kind-selected-*` baseline PNGs bumped `express-template-fill`'s baseline
  count from 21 to 24, but VIS-12's frozen guard test (`tests/test_vis12_visual_split_shard_c.py`,
  `PRE_MIGRATION_BASELINE_COUNTS`) still expected 21 — the exact precedent for bumping this frozen
  constant when a later card adds a baseline is already documented in the same file for MNT-21's
  `chart-editor` entry. Fixed by bumping the constant to 24 with an equivalent comment, and adding
  a clarifying comment to the sibling `pre_migration_counts["express-template-fill"]: 8` in
  `test_visual_spec_preserves_same_number_of_screenshot_assertions` (the number itself was already
  correct post-fix, but undocumented as to why).

  **Files:**
  - `frontend/src/pages/Templates.jsx` — add `'list'` to the `KINDS` array (~L14); extend
    `summariseSpec` (~L295-298) with a `kind==='list'` branch (e.g. `list · <question>`).
  - `src/reports/ask_engine.py` — in `validate_recipe`'s `kind=="list"` branch (~L97-98), normalize
    the spec before delegating to `_validate_chart`: build a plural `questions` list from
    `recipe.get('questions') or ([recipe['question']] if recipe.get('question') else [])`,
    mirroring `_referenced_columns`'s existing dual-field handling
    (`src/reports/template_inference.py:568-582`). In `save_recipe` (~L539-558), normalize
    `kind=="list"` the same way `kind=="table"` forces `type`: collapse a saved `questions` list
    back to the singular `question` field (e.g. `saved["question"] = (saved.pop("questions", None)
    or [None])[0]`) so `ReportBuilder._generate_lists()` can read it.
  - `web/main.py` — `_bullet_list_names_excluded` (~L2602-2620) gains a `kind: str = "chart"`
    parameter; recognizes `kind == "list"` (reading singular `question` or plural `questions`) in
    addition to the legacy `kind == "chart" and type == "bullet_list"` case. Both call sites —
    `POST /api/ask/save` (~L2718, passes `payload.kind`) and `POST /api/template/apply` (~L2915,
    passes `p.get("kind", "chart")`) — updated to pass `kind` through.
  - `tests/test_vis12_visual_split_shard_c.py` — bump `PRE_MIGRATION_BASELINE_COUNTS
    ["express-template-fill"]` 21→24 and annotate `pre_migration_counts["express-template-fill"]`,
    per the fold-in above.

  **Config/schema impact:** None beyond MNT-23's — field-normalization only, no shape change to
  `cfg['lists']` itself (still singular `question`).

  **Acceptance criteria**
  - The Express review panel's kind dropdown includes `"list"` as a selectable option for any row
  - Reclassifying a `needs_attention` row (e.g. one the AI proposed as `table` but that has no
    categorical column) to `kind="list"` clears its flagged state, matching the existing re-kind
    behavior for other kinds
  - Applying a row with `kind="list"` persists a `lists:` entry into `config.yml` and resolves the
    template token to `{{ list_<name> }}`
  - The spec-summary column shows a sensible one-line description for a list row (not blank or
    `undefined`)
  - A `kind="list"` recipe/proposal naming a column passes `ask_engine.validate_recipe` (no longer
    rejected by a spurious "needs ≥1 column" error caused by the question/questions mismatch); one
    naming a hidden/PII-flagged column is rejected with the **specific** hidden/PII reason, not a
    generic column-count error
  - A list saved via `ask_engine.save_recipe` (Ask panel) round-trips correctly into
    `ReportBuilder._generate_lists()` and renders non-empty bullet-point text at build time (no
    silent empty `{{ list_<name> }}`)
  - Before any data is downloaded (no profile available), a `kind="list"` recipe/proposal naming a
    PII/hidden-flagged column is rejected by the cfg-only fallback gate
    (`_bullet_list_names_excluded`) on both `POST /api/ask/save` and `POST /api/template/apply` —
    it cannot be smuggled into `cfg['lists']` before download and rendered verbatim at build time

  **Unit tests:** `tests/test_ask_engine.py` — extend with: (1) a `kind="list"` recipe naming a
  normal column passes `validate_recipe` (regression pin for the question/questions fix); (2) a
  `kind="list"` recipe naming a `pii`/`hidden`-flagged column is rejected by `validate_recipe` with
  a reason string naming that column specifically (not a generic column-count message); (3)
  `save_recipe(kind="list")` on a recipe with a `questions` list persists a singular `question` key
  into `cfg['lists']`. `tests/test_ask_api.py::test_ask_save_rejects_pii_list_kind_without_data` and
  `tests/test_template_api.py::test_apply_drops_pii_list_kind_without_data` (both new) — the
  no-profile PII-gate regression for `kind="list"` via `/api/ask/save` and `/api/template/apply`.
  `tests/test_vis12_visual_split_shard_c.py` — bumped frozen baseline-count constants (see fold-in
  above); its two unrelated failures (`test_no_snapshots_directories_remain_anywhere_under_frontend_tests_e2e`,
  `test_no_snapshots_directories_found_via_repo_wide_search`) are pre-existing, waiting on the
  not-yet-started VIS-10 (confirmed identical on the pre-MNT-24 base commit), not a regression from
  this card. Frontend kind-dropdown addition itself stays N/A (Vitest not installed — covered by the
  Playwright E2E below, consistent with the XTF-* convention).

  **E2E:** Extend the existing Express Fill Playwright spec — upload a template with a
  no-categorical-column placeholder, confirm it can be reclassified to `kind="list"` via the
  dropdown, confirm the `needs_attention` flag clears, apply, and assert the resolved template /
  returned config contains a `lists:` entry and a `{{ list_<name> }}` placeholder **with non-empty
  rendered content** (regression check for the save/build round-trip fix). Visual: impeccable
  audit/critique + `toHaveScreenshot` of the review panel with a list-kind row selected, at all
  three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. Upload a Word template containing a placeholder for a plain list of text values (no
     categorical column available) to Express Fill.
  2. Confirm the AI proposes something that gets flagged `needs_attention` (e.g. `table`).
  3. Change that row's kind to "list" in the dropdown and confirm the flag clears.
  4. Click Apply & Build and confirm the report builds successfully with the list rendered as
     **actual bullet-point content** (not an empty section) in the output `.docx`.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_engine.py
  tests/test_ask_api.py tests/test_template_api.py -k "not snapshots_directories"
  tests/test_vis12_visual_split_shard_c.py::test_baselines_relocated_with_same_total_png_count
  tests/test_vis12_visual_split_shard_c.py::test_visual_spec_preserves_same_number_of_screenshot_assertions -q` ·
  `cd frontend && npx playwright test <the extended express-fill spec>`

---

- [x] **MNT-25 — Composition UI migration to a first-class Lists section (P2)**

  **Created:** 2026-07-05 · **Completed:** 2026-07-06

  **Depends on: MNT-23.**

  **Type:** Feature

  Give `list` its own Composition UI section, mirroring `TablesCard`/`IndicatorsCard`, and retire
  `bullet_list` as a selectable chart type in the regular (non-Express) authoring flow. Independent
  of MNT-24 — can ship any time after MNT-23.

  **Folded in from this card's own PR review (ux-review, 2026-07-05):** two High-severity findings.
  (1) `SECTION_LABELS` (the right-rail Status card's source of truth) was never given a `lists`
  entry, so the Status card never showed a "N lists" line even though `counts.lists` was already
  wired through — every sibling section (charts/indicators/tables/summaries/views) gets this
  affordance, Lists didn't. Naively adding `lists` to `SECTION_LABELS` would also add a broken
  "Suggest lists" AI quick-action (there is no `suggest-lists` CLI command), so the fix decouples
  the two: `SECTION_LABELS` now includes `lists` (status row), while a new `AI_SUGGESTABLE_KINDS`
  array (excluding `lists`) drives the AI-suggest actions. (2) The new Lists card/ListModal shipped
  with zero entries in either `frontend/src/locales/en.json` or `fr.json` — every string relied
  solely on inline i18next `defaultValue` fallbacks, so French-locale users would see hardcoded
  English on an otherwise fully translated screen. Fixed by adding the full `composition.list*`/
  `composition.kind.lists` key set to both locale files, matching the existing `tables` pattern
  (also fixed the pre-existing empty `listsSubPost` trailing clause while in there, for parity with
  sibling cards' subtitle copy). `npm run check:i18n` passes clean (838 keys, en/fr aligned).

  **Files:**
  - `frontend/src/pages/Composition.jsx` (2341 lines) — remove `'bullet_list'` from `CHART_TYPES`
    (~L20) and its special-cased validation/preview/empty-vs-idle-state logic in the chart modal
    (MNT-21 added the empty-vs-idle preview distinction there — search "bullet_list"); add
    `'lists'` to `ALL_SECTIONS` (~L189) and `SECTION_LABELS` (~L895); new `lists` state array +
    dirty-tracking (~L519-520) + save logic (`has('lists')`, `setOrDelete('lists', lists)`
    mirroring indicators/summaries ~L492-494); new `ListsCard` + `ListModal` components mirroring
    `TablesCard`/`IndicatorsCard` (~L1268-1432) — fields: name, title, question (single column),
    optional filter. Decide placement relative to PUX-3's progressive-disclosure "Advanced"
    section (tables + summaries are tucked behind a toggle) — group Lists there alongside Tables.
    New `AI_SUGGESTABLE_KINDS` constant (~L909) decouples the AI-suggest action list from
    `SECTION_LABELS`'s status-row list, per the fold-in above.
  - `frontend/src/hooks/useChartPreview.js` — remove/generalize its bullet_list special case.
  - `frontend/src/locales/en.json` + `fr.json` — add `composition.kind.lists`, `listsTitle`,
    `listsSubPre`, `listsSubPost`, `addList`, `noLists`, `editList`, `addListModal`, `listName`,
    `listTitleField`, `listQuestion`, `listFilter` to both bundles, per the fold-in above.
  - `frontend/src/App.jsx` — add `'lists'` to `ANALYZE_SECTIONS` (necessary companion change,
    without which `has('lists')` is always false and `ListsCard` never mounts; omitted from the
    original Files list, called out by roadmap-verifier's scope check and documented here).

  **Folded in from this card's own PR review round 2 (roadmap-verifier, 2026-07-05):** two more
  gaps. (1) No functional (non-visual) test covered the Status-rail AC — only the visual baseline
  incidentally exercised it, and that baseline was itself stale (see next). Added
  `frontend/tests/e2e/composition-bullet-list.spec.ts::"status rail shows \"N lists\" and does not
  add a Suggest-lists quick action"`, asserting the check-list label text and the absence of a
  `.rail-action` matching "suggest lists" — verified green. (2) The `mnt25-composition-lists-
  advanced-*` baseline PNGs (all 3 viewports) were captured from an iteration *before* the round-1
  ux-review fold-in landed — they still showed the old, broken "Suggest lists" action and were
  missing the "N lists" status line, so they were stale, not just unapproved. These 3 need
  regeneration (human `npm run test:visual:update`) against current code before they can be
  reviewed/approved; the 3 `mnt25-composition-list-modal-*` baselines were unaffected (that capture
  doesn't include the right rail) and only needed a ledger entry.

  **Config/schema impact:** Composition now reads/writes `cfg['lists']` (defined by MNT-23)
  instead of `charts: [{type: bullet_list}]` for newly-created lists. Existing `charts:` entries
  with `type=bullet_list` are left as-is in already-saved configs (MNT-23's back-compat render
  path keeps them working) but are no longer editable from Composition's chart modal — call this
  out in the AC as a known limitation, not a bug.

  **Acceptance criteria**
  - `bullet_list` no longer appears in the chart-type dropdown when adding/editing a chart in
    Composition
  - A new "Lists" card exists (grouped with Tables under the Advanced/progressive-disclosure
    toggle), listing existing `cfg['lists']` entries with add/edit/remove actions
  - Creating a list via the new modal (name, title, question, optional filter) saves it into
    `cfg['lists']`, round-trips on reload, and renders correctly at build-report time
  - Dirty-tracking and Save correctly include the `lists` section (unsaved list changes trigger
    the same "unsaved changes" guard as other sections)
  - No regression to any other Composition section (charts, indicators, tables, summaries, views,
    framework)
  - The right-rail Status card shows a "N lists" line once `lists` is a configured section, without
    also adding a "Suggest lists" AI quick-action (no backend command exists for it) — covered by a
    real functional test, not just the visual baseline
  - Every Lists card / ListModal string is sourced from the `en`/`fr` locale bundles — no hardcoded
    English literal remains reachable via `defaultValue` fallback alone; `npm run check:i18n`
    stays green (key-aligned, no empty values)

  **Unit tests:** N/A (frontend-only; Vitest not installed — covered by Playwright E2E below).

  **E2E:** Rewrite `frontend/tests/e2e/composition-bullet-list.spec.ts` as a Lists-section spec
  (add/edit/remove a list via the new ListsCard/ListModal, confirm it's absent from the chart-type
  dropdown) and remove/replace the MNT-21 bullet_list block inside
  `frontend/tests/e2e/chart-editor.spec.ts` (and their `visual-review/specs/` counterparts). The 6
  existing human-approved baselines under
  `visual-review/baselines/composition-bullet-list.visual.spec.ts/` and
  `visual-review/baselines/chart-editor.visual.spec.ts/` (`chart-editor-modal-bullet-list-*`) are
  retired; capture fresh baselines for the new Lists UI at all three viewports (mobile 390×844,
  tablet 820×1180, desktop 1440×900); a human approves them.

  **UAT:**
  1. Open Composition, confirm "bullet_list" is gone from the Add Chart type dropdown.
  2. Find the new Lists card (under Advanced, alongside Tables); add a list bound to a text
     question.
  3. Save, reload the page, confirm the list persists.
  4. Build a report and confirm the list still renders as bullet points in the output, same as
     before.

  **Verify:** `cd frontend && npx playwright test composition-bullet-list chart-editor`

---

- [x] **MNT-26 — `{{ split_by }}` template placeholder (P2)**

  **Created:** 2026-07-05 · **Completed:** 2026-07-06

  **Independent of MNT-23/24/25.**

  **Type:** Feature

  `{{ split_value }}` (the split dimension's VALUE, e.g. "North") already exists and works
  (shipped via the now-archived MNT-17 + XTF-28), but the split dimension's NAME/label itself
  (e.g. "Region") is never exposed as a placeholder. `split_col` is computed in
  `src/reports/builder.py`'s `build()` (~L198) but never threaded into `_render()` or the docxtpl
  context dict.

  **Files:**
  - `src/reports/builder.py` — add `split_by: Optional[str] = None` param to `_render()` (~L218);
    pass `split_col` through from all 3 call sites in `build()` (~L202 no-split → `None`, ~L213
    split case → `split_col`, ~L216 no-split → `None`); add `"split_by": split_by or ""` to the
    context dict (~L341, alongside the existing `"split_value": split_value or ""`). No extra
    label-resolution needed — the processed dataframe's columns are already export_label-named.
  - `src/reports/template_inference.py` — mirror the existing `split_value` literal-kind handling
    exactly: add `"split_by"` to `_KINDS` (~L231), mirror the annotate branch (~L488-501) and the
    apply branch (~L911-915), including the same warn-if-no-split_by-configured behavior.
  - `docs/reference/templates.md` — document `{{ split_by }}` next to `{{ split_value }}`.

  **Config/schema impact:** None — pure render-context/placeholder addition, no config.yml shape
  change.

  **Acceptance criteria**
  - When `report.split_by` is set and a build produces per-value reports, each rendered report's
    `{{ split_by }}` placeholder resolves to the split dimension's column name (e.g. "Region"),
    while `{{ split_value }}` continues to resolve to that report's specific value (e.g. "North")
  - When no `split_by` is configured, a template containing `{{ split_by }}` renders as an empty
    string (no crash, no literal `{{ split_by }}` left in output) — same graceful-empty behavior
    as `split_value`
  - Express Fill's inference recognizes a placeholder naming the split dimension (e.g. "Split by",
    "Grouping") as the `split_by` literal kind and resolves it to canonical `{{ split_by }}`,
    warning if no split_by dimension is configured — mirroring the existing `split_value` behavior
    exactly
  - `docs/reference/templates.md` documents `{{ split_by }}`

  **Unit tests:** `tests/test_builder.py` — `test_split_by_in_render_context_when_split_by_set`
  (build with `split_by` set, assert `{{ split_by }}` resolves to the column name) and
  `test_split_by_empty_when_no_split_by` (build with no `split_by`, assert it renders empty),
  mirroring the existing `test_split_value_*` tests. Extend `tests/test_template_inference.py`
  with a case mirroring the existing XTF-28 `split_value` inference test for the new `split_by`
  literal kind.

  **E2E:** N/A (no UI surface — `split_by` is a docxtpl/Jinja2 template placeholder, exactly as
  `split_value` itself is N/A for E2E per the now-archived MNT-17).

  **UAT:** N/A (non-UI/CLI card — relies on unit tests + PR review, consistent with the
  now-archived MNT-17's precedent for the sibling `split_value` placeholder).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder.py -k split_by &&
  PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py -k split_by`

---

- [x] **MNT-27 — Fix: Express "Apply & Build" feels like a silent hang (redundant uncached profile recompute + no loading state) (P2)**

  **Created:** 2026-07-05 · **Started:** 2026-07-06 · **Completed:** 2026-07-07

  **Type:** Fix

  Clicking "Apply & Build" in the Express Template Fill review panel takes ~10+ seconds with no
  visible feedback before the build even starts. Root cause: `/api/template/infer`
  (`web/main.py` ~L2843) computes the full data profile via `profile_dataset(cfg, df, repeats)`
  **directly**, without going through the shared perf-cache (`perf_cache.get_or_compute`) that
  `/api/profile` and `/api/template/apply` (`web/main.py` ~L2900-2909) use. `/api/template/apply`
  then does its own cache-or-compute lookup under the same `_cache_key(request, cfg, "profile")`
  — but because infer never populated that cache key, apply's lookup is effectively guaranteed to
  miss immediately after an infer, so apply redundantly recomputes the exact full CSV/parquet read
  + per-column EDA that infer just did moments earlier (the code's own comment at
  `web/main.py` ~L2896-2899 already calls this recompute "event-loop-blocking"). Compounding the
  delay, the frontend (`frontend/src/pages/Templates.jsx` ~L130-151) shows no loading/disabled
  state while the `/api/template/apply` fetch is in flight — the button's label only switches to
  "building…" after that fetch resolves and `run('build-report')` starts, so the whole
  multi-second backend cost (profile recompute + docx rewrite + Minio/S3 push + config write) is
  silently absorbed with zero visual feedback.

  **Folded in from this card's own PR review (qa-tester + perf/ux notes, 2026-07-06):** the
  RED-phase test author put the new `toHaveScreenshot('mnt-27-apply-loading-state.png')` assertion
  directly in the functional spec (`frontend/tests/e2e/express-template-fill.spec.ts`) instead of
  the visual spec, violating the VIS-12 functional/visual split convention (same class of mistake
  MNT-24 hit) — moved into `visual-review/specs/express-template-fill.visual.spec.ts` as its own
  `test.describe` block, and the stray `frontend/tests/e2e/express-template-fill.spec.ts-snapshots/`
  directory it created was deleted. This also bumped `express-template-fill`'s frozen baseline
  counts in `tests/test_vis12_visual_split_shard_c.py` (8→9 assertions, 24→27 baselines) — fixed
  with the same comment convention already used for MNT-24/MNT-25's equivalent bumps. Also added
  `aria-busy={applying || running}` to the Apply & Build button per a ux-review accessibility note
  (WCAG 4.1.3 Status Messages) — closes a silent-state-transition gap this card's longer,
  network-dependent loading window made newly worth fixing (the neighboring Infer button has the
  same unfixed gap, left as-is — out of scope here).

  **Files:**
  - `web/main.py` — wrap `/api/template/infer`'s `profile_dataset(cfg, df, repeats)` call
    (~L2843) in the same `perf_cache.get_or_compute(key, _compute)` pattern already used by
    `/api/profile` (~L2537-2550) and `/api/template/apply` (~L2900-2909), keyed via the same
    `_cache_key(request, cfg, "profile")` helper, so apply's subsequent lookup is a guaranteed
    cache hit instead of a redundant recompute.
  - `frontend/src/pages/Templates.jsx` — add a loading/disabled state to the "Apply & Build"
    button (~L130-151, ~L269-277) covering the `/api/template/apply` fetch itself, not just the
    subsequent `run('build-report')` call, so the user gets visible feedback for the whole
    operation instead of an apparent hang; `aria-busy={applying || running}` on the same button
    per the fold-in above.
  - `visual-review/specs/express-template-fill.visual.spec.ts` — the MNT-27 loading-state visual
    assertion (moved here per the fold-in above).
  - `tests/test_vis12_visual_split_shard_c.py` — bumped `express-template-fill`'s frozen
    assertion/baseline counts, per the fold-in above.

  **Config/schema impact:** None — cache-sharing + UI-state only, no `config.yml` shape change.

  **Acceptance criteria**
  - Clicking "Apply & Build" immediately after a successful "Infer" no longer triggers a second
    full profile recompute — `/api/template/apply`'s profile cache lookup is a hit (verified via a
    cache-hit/call-count assertion on `profile_dataset`/the endpoint's `_compute`)
  - The "Apply & Build" button shows a visible loading/disabled state from the moment it's clicked
    until the build-report run starts streaming logs — no silent multi-second gap with no feedback
  - No regression to the existing re-validation behavior (`needs_attention` rows are still
    correctly re-flagged server-side using the now cache-shared profile)
  - No regression to `/api/profile`'s own caching behavior (still a hit for existing callers)

  **Unit tests:** `tests/test_template_api.py` — new case asserting a second profile computation
  (`profile_dataset`/the endpoint's `_compute`) is NOT re-invoked when `/api/template/apply` is
  called right after `/api/template/infer` within the same cache window (mock/spy on
  `profile_dataset` call count). Extend existing `/api/profile` cache tests if present to confirm
  no cross-endpoint regression.

  **E2E:** N/A for the caching fix itself (backend timing, not a visible DOM assertion), but
  extend `frontend/tests/e2e/express-template-fill.spec.ts` to assert the Apply button
  enters a visible loading/disabled state immediately on click (before the build-report terminal
  appears) — this part IS UI-facing. Visual: impeccable audit/critique + `toHaveScreenshot` of the
  Apply button's new loading state at all three viewports (mobile 390×844, tablet 820×1180,
  desktop 1440×900); a human approves them.

  **UAT:**
  1. Upload a template and click Infer.
  2. Immediately click Apply & Build.
  3. Confirm the button visibly changes state (spinner/disabled/"applying…") the instant you
     click, with no unexplained pause before that.
  4. Confirm the report still builds successfully afterward, same as before.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_api.py -k apply -q` ·
  `cd frontend && npx playwright test tests/e2e/express-template-fill.spec.ts`

---

- [x] **MNT-28 — Fix: single-column chart types silently drop extra questions/group_by instead of rejecting them (P1)**

  **Created:** 2026-07-05 · **Completed:** 2026-07-07

  **Type:** Fix

  Found via live manual testing of Express Template Fill (real Anthropic call, real
  `build-report` run, not mocked). `ask_engine.py`'s `CHART_REQS` (`src/reports/ask_engine.py:62`)
  is used both as the LLM prompt's chart-type requirement text (`_CHART_TYPES_BLOCK`) and as the
  deterministic post-inference validator (`_validate_chart`). For six chart types that
  `charts.py` only ever renders from `questions[0]` — `bar`, `horizontal_bar`, `pie`, `donut`,
  `histogram`, `table` (`chart_bar`/`chart_horizontal_bar`/`chart_pie`/`chart_donut`/
  `chart_histogram`/`chart_table`, each doing `c = q[0]` and never reading `q[1:]` or
  `opts['group_by']`) — `CHART_REQS` only enforces a minimum column count (e.g. table: "≥1
  categorical column"). `_validate_chart` (~L110) additionally appends `group_by` into the
  counted columns rather than rejecting it when the chart type doesn't support one. Result: a
  proposal like `{type: table, questions: [Satisfaction, Region], group_by: Region}` passes
  validation cleanly (2 categorical columns ≥ 1), but `chart_table()` silently drops
  `Region`/`group_by` and renders a flat single-column count table — while the AI-generated title
  still says "Satisfaction by Region", producing a misleadingly-titled, factually wrong report
  artifact with no error anywhere in the pipeline.

  **Repro (live, real Anthropic call):** uploaded a `.docx` with placeholder `[table of
  Satisfaction by Region]` through the real Express Fill flow (`POST /api/template/infer` →
  `/api/template/apply` → `build-report` CLI) against the bundled PUX-5 sample dataset. The LLM
  correctly proposed `{type: table, questions: [Satisfaction, Region], group_by: Region}`; it
  passed local validation; `build-report` ran clean with no errors; the final `.docx`'s table
  image was titled "Satisfaction by Region" but showed only a flat Satisfaction count (identical
  numbers to the standalone bar chart), with no Region breakdown at all. The bar chart, pie
  chart, and a `bullet_list` text-injection placeholder in the same document all rendered
  correctly with real data — only the multi-column table case is affected.

  **Files:**
  - `src/reports/ask_engine.py` — in `_validate_chart`, for the single-column chart types (`bar`,
    `horizontal_bar`, `pie`, `donut`, `histogram`, `table`), reject (`needs_attention`, not
    silently pass) any proposal that sets `group_by` or supplies more than the one question the
    renderer actually consumes, with a clear reason string (e.g. "'table' renders exactly 1
    column; got 2 + group_by — use 'grouped_bar' or 'heatmap' for a cross-tab breakdown"). Also
    tighten `CHART_REQS`'s requirement text for those six types (used verbatim in the LLM prompt
    via `_CHART_TYPES_BLOCK`) to state the exact/max column count and the no-`group_by`
    constraint — secondary mitigation only; prompt wording alone lowers the probability of the
    malformed shape but doesn't guarantee correctness, and this product's design principles
    explicitly favor "credible over clever" / deterministic safety over silent AI mistakes.

  **Config/schema impact:** None — validation-logic tightening only, no config.yml shape change.

  **Acceptance criteria**
  - For each of `bar`, `horizontal_bar`, `pie`, `donut`, `histogram`, `table`: a proposal setting
    `group_by` is rejected by `_validate_chart` with a reason naming the chart type and the
    constraint (not silently passed)
  - For each of those six types: a proposal with 2+ `questions` is rejected the same way
  - For each of those six types: a proposal with exactly 1 question and no `group_by` still
    passes validation unchanged (no regression to the legitimate single-column case)
  - Chart types that legitimately consume `group_by`/multiple questions (e.g. `grouped_bar`,
    `stacked_bar`, `heatmap`) are unaffected — still validate exactly as before
  - This validator is shared by both call sites — Express Fill inference (`annotate_proposals` →
    `_validate_data_proposal` → `validate_recipe` → `_validate_chart` in
    `src/reports/template_inference.py`) and the Ask engine path — both are covered
  - `CHART_REQS`'s requirement text for the six affected types states the exact/max column count
    and no-`group_by` constraint (reflected in the LLM prompt)
  - No UI change needed: `needs_attention` proposals are already correctly blocked from Apply by
    the frontend (`Templates.jsx`'s `canApply`) — existing plumbing handles the rejection

  **Unit tests:** `tests/test_ask_engine.py` — extend `test_validate_recipe_table_needs_categorical`
  (~L221) and add cases for all six affected types × 2 failure modes (`group_by` set; 2+
  `questions`), plus one regression-pin passing case per type (exactly 1 question, no
  `group_by`), plus a confirmation that `grouped_bar`/`stacked_bar`/`heatmap` validation is
  unaffected. `tests/test_template_inference.py` — extend with an `annotate_proposals` case
  covering the Express Fill call site for at least one of the six types.

  **E2E:** N/A — backend-only validation logic, no new UI surface (existing `needs_attention` UI
  plumbing is unchanged).

  **UAT:** N/A — non-UI/CLI card, relies on unit tests + PR review as the human gate.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_ask_engine.py
  tests/test_template_inference.py -q`

---

- [x] **MNT-29 — Fix: stale chart-editor frozen baseline-count constants after MNT-25's bullet_list removal (P2)**

  **Created:** 2026-07-06 · **Completed:** 2026-07-06

  **Type:** Fix

  Merge-conflict-resolution artifact discovered while merging MNT-24's and MNT-25's PRs into
  `develop`. MNT-25 removed the MNT-21 bullet_list preview baseline from `chart-editor`
  (`frontend/tests/e2e/chart-editor.spec.ts` + `visual-review/specs/chart-editor.visual.spec.ts`),
  dropping its baseline count from 15→12 PNGs and its visual-spec assertion count from 7→6 — but
  `tests/test_vis12_visual_split_shard_c.py`'s frozen `pre_migration_counts["chart-editor"]` (still
  7) and `PRE_MIGRATION_BASELINE_COUNTS["chart-editor"]` (still 15) were never updated, because
  MNT-25's own scoped `Verify:` command (`npx playwright test composition-bullet-list chart-editor`)
  never exercises this backend pytest guard file. Same class of fix as the one already folded into
  MNT-24 (bumping `express-template-fill`'s counts), just in the opposite direction (a removal, not
  an addition) and for a different shard file.

  **Files:** `tests/test_vis12_visual_split_shard_c.py` — `pre_migration_counts["chart-editor"]`
  7→6, `PRE_MIGRATION_BASELINE_COUNTS["chart-editor"]` 15→12, both with a comment explaining the
  MNT-21-then-MNT-25 history (mirroring the file's existing comment convention for this exact
  situation).

  **Config/schema impact:** None — test-constant fix only, no application behavior change.

  **Acceptance criteria**
  - `tests/test_vis12_visual_split_shard_c.py::test_visual_spec_preserves_same_number_of_screenshot_assertions[chart-editor]` passes
  - `tests/test_vis12_visual_split_shard_c.py::test_baselines_relocated_with_same_total_png_count[chart-editor]` passes
  - No other shard file's constant is touched; no regression to any other `test_vis12_visual_split_shard_c.py` case

  **Unit tests:** The two tests named above are the acceptance test — no new test needed, this
  card exists to make already-correct application state pass an already-correct test whose frozen
  constant fell behind.

  **E2E:** N/A — pure backend pytest constant fix, no UI/behavior change.

  **UAT:** N/A — non-UI/CLI card, relies on the Verify command + PR review as the human gate.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_vis12_visual_split_shard_c.py -k chart-editor -q`

---

- [x] **MNT-30 — Fix: report tables render as PNG images instead of native Word tables (P1)**

  **Created:** 2026-07-07 · **Started:** 2026-07-07 · **Completed:** 2026-07-07

  **Type:** Fix

  Report table output currently renders as a flattened image, not editable Word content.
  `src/reports/builder.py::_generate_tables` (~L463-487) forces every `{{ table_<name> }}`
  placeholder to `type: "table"` and emits it as a docxtpl `InlineImage` PNG produced by the
  `table` chart type (`chart_table` in `src/reports/charts.py`, `CHART_DISPATCH`). This violates
  the project rule that tabular output must be a native python-docx table (selectable, editable,
  accessible text) — a PNG table is unsearchable, non-editable, and inaccessible to screen
  readers. Charts (bar/pie/line/etc.) stay as image renders — python-docx has no chart API, so
  that is expected and explicitly out of scope.

  **Approach:** render each `tables:` recipe into a docxtpl subdoc — `sub = tpl.new_subdoc();
  tbl = sub.add_table(...)` — styled `Table Grid` when that style exists in the template, else
  borders applied manually via `OxmlElement('w:tblBorders')` (`add_table()` adds none by
  default); one header row + one row per record via `tbl.add_row().cells`; substitute the subdoc
  at `{{ table_<name> }}`. This preserves the existing placeholder contract and `generate-template`
  output (no template-syntax change). Alternatives considered: template-side `{% for %}` table
  loops, or post-render docx walking — subdoc is the least invasive.

  **Files:**
  - `src/reports/builder.py` — `_generate_tables` (~L463-487): build a native table subdoc per
    recipe instead of forcing `type: "table"` + `InlineImage`; keep source/filter/aggregate/
    `join_parent` resolution unchanged.
  - `src/reports/charts.py` — `chart_table` / `CHART_DISPATCH` (~L795): retained for an explicit
    `charts:` entry of type `table` (a user-chosen chart), but no longer the path for
    `{{ table_<name> }}` recipes. Do NOT delete `CHART_DISPATCH["table"]` — `table` stays a
    user-selectable chart type; only remove `chart_table` itself if it proves genuinely dead.
  - `src/reports/template_generator.py` — confirm `{{ table_<name> }}` placeholder emission is a
    single unbroken run and valid for subdoc substitution.

  **Config/schema impact:** None — output-rendering change only; the `tables:` recipe shape is
  unchanged.

  **Acceptance criteria**
  - A report built from a `tables:` recipe renders `{{ table_<name> }}` as a native Word table:
    the output `.docx` contains a `w:tbl` element for that placeholder (visible in python-docx
    `document.tables`) and NO embedded image for it
  - The table has one header row (field/column labels) plus one row per record, populated as text
    cells (not drawn as a figure)
  - The table has visible borders — the `Table Grid` style when present in the template, otherwise
    a manually-applied `w:tblBorders` element
  - No regression to charts: a `bar` (or other) chart in the same report is still inserted as an
    `InlineImage` PNG
  - No regression to table data resolution: source selection, per-table filter/sample,
    aggregation, and `join_parent` behave exactly as before (same rows/columns, now as native
    cells)

  **Unit tests:** `tests/test_native_tables.py` (new) — build a report whose config has one
  `tables:` recipe and one `bar` chart, render to a temp `.docx`, then assert with python-docx:
  (a) `len(document.tables) >= 1` and the recipe table has a header row + one row per record;
  (b) the recipe placeholder resolves to a `w:tbl`, not an inline image; (c) borders are present
  (`Table Grid` style or a `w:tblBorders` element); (d) the chart placeholder is still an
  InlineImage/embedded PNG (no chart regression); (e) borders are covered **both ways** — render
  once against a template that defines the `Table Grid` style and once against one that does not,
  asserting a bordered table in each so the manual-`w:tblBorders` fallback path is exercised.
  Extend `tests/test_builder.py` instead if a shared fixture fits better.

  **E2E:** N/A (reason: no UI surface — this changes CLI/back-end `.docx` generation only; the
  rendered document content is asserted by the pytest above, per the non-UI convention).

  **UAT:** N/A (reason: non-UI/CLI card — the Verify command + unit tests + PR review are the
  human gate; a reviewer opens a built report and confirms the table is selectable/editable text,
  not an image).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_native_tables.py -q`

---

- [x] **MNT-31 — Fix: `/api/reports` does N+1 S3 `head_object` calls instead of reusing `list_objects_v2`'s `LastModified` (P2)**

  **Created:** 2026-07-07 · **Completed:** 2026-07-07

  **Type:** Fix

  Found via a read-only performance investigation of the Reports tab's cold-load time (no user
  report — the tab works correctly, it's just slow to paint on an S3/Minio-backed project).
  `S3Storage.list()` (`web/storage/s3.py:61-67`) already retrieves each object's `LastModified`
  from the `list_objects_v2` paginator response, but discards it and returns only keys.
  `/api/reports` (`web/main.py:1972-2007`) then calls `store.last_modified(key)` once per report
  file (`~L1994`), each doing a **separate** `head_object()` request (`web/storage/s3.py:47-59`)
  — N extra network round trips for data the list call already had. On the local storage backend
  this doesn't happen at all (`LocalStorage` reads `f.stat().st_mtime` directly); this is purely
  an S3/Minio-backend inefficiency.

  **Files:**
  - `web/storage/base.py` — add `list_with_metadata(prefix)` to the `Storage` ABC with a default,
    concrete implementation (`{key: (size, last_modified) for key ...}` built by looping the
    existing `list()` + `last_modified()`), so any backend that doesn't override it keeps today's
    behavior unchanged.
  - `web/storage/s3.py` — override `list_with_metadata(prefix)`: read `Size`/`LastModified`
    directly off each `list_objects_v2` page's `Contents` entries (same paginator `list()`
    already uses), with zero additional `head_object` calls.
  - `web/main.py` — `/api/reports` (~L1972-2007): replace the per-file `store.last_modified(key)`
    loop with one `store.list_with_metadata(prefix)` call, then look up each local report file's
    modified time from the returned dict (falling back to local `stat()` exactly as today when
    the key is missing or storage is unavailable).

  **Config/schema impact:** None — internal `Storage` interface addition + endpoint internals
  only; `/api/reports`'s response shape and values are unchanged.

  **Acceptance criteria**
  - On the S3/Minio backend, resolving modified times for all of a project's report files makes
    **zero** `head_object` calls and exactly **one** paginated `list_objects_v2` call, regardless
    of report count (verified against a mocked/stubbed S3 client with N ≥ 2 objects)
  - `Storage.list_with_metadata(prefix)` exists on the ABC with a default implementation (built
    from `list()` + `last_modified()`) that a subclass not overriding it still satisfies
    correctly — verified against the existing `_SpyStorage` test double in
    `tests/test_reports_api.py`
  - `S3Storage.list_with_metadata(prefix)` returns modified times that match the `LastModified`
    values from the `list_objects_v2` response, with no `head_object` call
  - `/api/reports`'s returned JSON (`{name, size_kb, modified}` per file) is byte-for-byte
    unchanged from before this fix — a performance-only change with no visible behavior
    difference
  - Local (non-S3) storage mode's `/api/reports` behavior is unchanged (regression-pinned)

  **Unit tests:** `tests/test_reports_api.py` (extend) — mock the boto3 S3 client so
  `list_objects_v2` returns N ≥ 2 objects each with a `LastModified`/`Size`; assert
  `S3Storage.list_with_metadata` issues exactly one paginated call and zero `head_object` calls,
  and that the returned dict's modified times match the response; add a base-ABC-level case using
  `_SpyStorage` confirming a subclass that does NOT override `list_with_metadata` still returns
  correct data via the default fallback; extend the existing local-storage `/api/reports` test as
  a regression pin (response unchanged).

  **E2E:** N/A (reason: backend-only performance fix — `/api/reports`'s response shape and the
  rendered Reports page are unchanged; verified entirely by the pytest above, per the non-UI
  convention).

  **UAT:** N/A (reason: non-UI/CLI card — the Verify command + unit tests + PR review are the
  human gate; no visible behavior changes to manually check).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_reports_api.py -q`


- [x] **MNT-32 — Fix: Express-inferred `list` on repeat-group data is wrongly flagged `needs_attention` and dropped (`list` excluded from repeat-source auto-resolution) (P1)**

  **Created:** 2026-07-07 · **Completed:** 2026-07-07

  **Type:** Fix

  Reported: in the Express path a placeholder was inferred as a `list`, the user kept the `list`
  kind, yet the built report showed a table PNG. Root cause (reproduced): `_DATA_KINDS` in
  `src/reports/template_inference.py` (~L582) is `("chart", "indicator", "summary", "table")` —
  it **excludes `"list"`**. `_autoresolve_repeat_source` (~L415) bails immediately for any kind
  not in that tuple, so a `list` spec whose column lives in a repeat-group base table (the
  natural case — a list of village/member names) never gets its `source` stamped.
  `annotate_proposals` (~L541) then validates it against the `main` table only, the column isn't
  there, and it is flagged `needs_attention` (`reason: "column '<x>' not found in 'main'"`). The
  Express review UI blocks "Apply & Build" while any row is `needs_attention`, so the user must
  drop or re-kind the list — the identical column validates clean as a `table` — funnelling a
  repeat-group list onto the table path (and, pre-MNT-30, into a PNG). Reproduced
  deterministically: identical `Village` column in a repeat table → `list` = `needs_attention`,
  `table` = `ok, source=hh_members`.

  **Files:**
  - `src/reports/template_inference.py` — add `"list"` to `_DATA_KINDS` (~L582) so
    `_autoresolve_repeat_source` stamps the repeat-group `source` for list specs exactly as it
    already does for `table`/`chart`/`summary`. Confirm `_referenced_columns` reads a list spec's
    column whether stored as `question` (singular) or `questions` (plural).
  - `src/reports/builder.py` — (verify) `_generate_lists` reads `l.get("question")` (singular);
    ensure an auto-resolved list spec carries the key `_generate_lists` reads (normalize on write
    if needed) so a repeat-group list actually renders its rows as text, not empty.

  **Acceptance criteria**
  - A `list` proposal whose only referenced column lives in a single repeat-group base table (not
    in `main`) is auto-resolved: `annotate_proposals` returns `status: "ok"` with the repeat table
    stamped onto `spec["source"]` — matching the behavior of an identical `table` proposal
  - When multiple repeat tables hold the column, the `list` proposal resolves to the largest by
    row count with `status: "review"` and a note listing alternatives — identical to the `table`
    kind's multi-table behavior
  - A `list` proposal whose column is genuinely absent from every table still flags
    `needs_attention` (no false-positive resolution)
  - After `apply_inference`, the resolved list spec lands in `cfg["lists"]` (never `cfg["charts"]`
    or `cfg["tables"]`) and a build renders `{{ list_<name> }}` as a text run (a `w:t`, no
    `InlineImage`/embedded PNG) containing the repeat-group row values
  - The `main`-table list case (column already in `main`) is unchanged (regression-pinned)

  **Unit tests:** `tests/test_template_inference.py` (extend) — add a repeat-group profile
  (`main` + an `hh_members`-style base table holding the list column) and assert: (a) a `list`
  proposal on the repeat-only column returns `status: "ok"` with `spec["source"]` stamped to the
  repeat table; (b) the identical `table` and `list` proposals now resolve the same source; (c) a
  multi-repeat-table column yields `status: "review"`; (d) a truly-absent column still flags
  `needs_attention`. Plus `tests/test_lists_section.py` (extend) — after `apply_inference` of a
  resolved repeat-group list, assert the entry is written to `cfg["lists"]` and `_generate_lists`
  produces non-empty text for it (no PNG/InlineImage).

  **E2E:** N/A (reason: backend inference + validation fix — no UI/JSX change; the Express review
  UI already renders whatever `annotate_proposals` returns. Verified entirely by the pytest above,
  per the non-UI convention.)

  **UAT:** N/A (reason: non-UI/CLI card — the Verify command + unit tests + PR review are the human
  gate.)

  **Config impact:** none (no schema/config-shape change; a `list` recipe may now carry an
  auto-stamped `source:` exactly as `table` recipes already do).

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_template_inference.py tests/test_lists_section.py -q`

- [x] **MNT-33 — Fix: the `table` chart type still renders tabular data as a PNG image instead of a native Word table (P1)**

  **Created:** 2026-07-07 · **Completed:** 2026-07-07

  **Type:** Fix

  MNT-30 made the dedicated `tables:` config section render a native `w:tbl`, but the old `table`
  **chart type** was left in place: `chart_table` is still registered in `CHART_DISPATCH`
  (`src/reports/charts.py` ~L795), still offered in the frontend `CHART_TYPES` list
  (`frontend/src/pages/Composition.jsx` ~L23), and any `charts:` entry with `type: table` still
  flows through `_generate_charts` → `generate_chart` → matplotlib PNG → `InlineImage`
  (`src/reports/builder.py` ~L553-555). This violates the project rule (established by MNT-30)
  that tabular output must be a native, selectable/editable/accessible python-docx table — a PNG
  table is unsearchable, non-editable, and invisible to screen readers — and leaves a second,
  UI-exposed way to produce exactly the image tables MNT-30 set out to eliminate.

  **Files:**
  - `src/reports/builder.py` — in `_generate_charts`, when a resolved chart's `type == "table"`,
    route it to the native table path (build the display frame + emit a `{{ table_<name> }}`
    sentinel via the same mechanism `_generate_tables`/`_insert_native_tables` use) instead of
    `generate_chart` + `InlineImage`. Bridges legacy `charts: [{type: table}]` configs to native
    output with no config migration required.
  - `frontend/src/pages/Composition.jsx` — remove `'table'` from the chart-type `CHART_TYPES`
    list (~L23) and its helper entries (~L40, ~L114) so new tables are added via the Tables
    section, not the chart dropdown. Existing `type: table` charts still load and now render
    native.
  - `src/reports/charts.py` — keep `chart_table`/`CHART_DISPATCH["table"]` for the Tables-section
    live preview the editor reuses (`/api/charts/preview` with `type: "table"`), OR redirect that
    preview too; decide in implementation. Do not break the Tables-section preview.

  **Acceptance criteria**
  - A `charts:` config entry with `type: table` renders in the built `.docx` as a native
    python-docx table (`document.tables` gains a `w:tbl`) with borders and NO `InlineImage`/
    embedded PNG for it — identical output to the equivalent `tables:` recipe
  - Real chart types (bar/pie/line/histogram/etc.) still render as `InlineImage` PNGs (no chart
    regression — python-docx has no chart API, explicitly out of scope)
  - The Composition chart-type dropdown no longer offers `table`; the Tables section remains the
    way to add a native table
  - Loading a legacy config that contains a `type: table` chart does not error and produces a
    native table (backward-compatible, no migration step required of the user)
  - The Tables-section live preview (`/api/charts/preview`) still renders

  **Unit tests:** `tests/test_builder_tables*.py` / `tests/test_lists_section.py`-adjacent (new
  or extend) — build a report from a `charts:` config with a single `type: table` entry; assert
  the rendered doc contains a native `w:tbl` (via `document.tables`) for it and zero
  `InlineImage`/embedded-PNG parts attributable to that entry; assert a sibling `type: bar` chart
  in the same config still renders an `InlineImage` (regression guard). Frontend:
  `frontend/tests/` (Vitest) assert `CHART_TYPES` excludes `'table'`.

  **E2E:** N/A (reason: the only UI change is removing one option from a dropdown, verified by the
  Vitest assertion on `CHART_TYPES`; the docx-output change is backend, verified by pytest. No new
  screen or visual surface. If review deems the dropdown change needs a visual baseline, promote to
  a real E2E at that point.)

  **UAT:** N/A (reason: non-UI/CLI card — Verify command + unit tests + PR review are the human
  gate.)

  **Config impact:** `charts: [{type: table}]` entries now render native (output-quality change,
  no schema change). `table` is no longer selectable as a chart type in the UI; the `tables:`
  section is the supported path for tabular output.

  **Verify:** `PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_builder_tables*.py -q` and
  `cd frontend && npm run test`
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

> Parked here **in full** (not condensed to a one-line bullet) since both are already
> fully DoR-ready cards with complete Acceptance criteria / Unit tests / E2E / UAT / Files —
> promote them back into "Visual / E2E harness" verbatim when picked back up.

---

- [ ] **VIS-5 — Storybook stories for EmptyState + Skeleton (P2)**

  **Created:** 2026-07-03

  VIS-4 stood up the Storybook harness (Tier 2) but only ships one throwaway placeholder story.
  This card gives it real component-isolation coverage for the two simplest presentational
  components — `EmptyState` and `Skeleton` — both plain, prop-driven components with no
  hook-based imperative API, so they story cleanly without a wrapper. Also adds the i18n
  decorator Storybook is currently missing: `Skeleton` calls `t('common.loading')` and would
  otherwise render the raw translation key instead of real copy in captures. Split from a
  broader four-component proposal (VIS-6 covers `Toast` + `ConfirmDialog`, which need
  hook-wrapper components and are scoped separately per INVEST/Independent+Small).

  **Note (2026-07-04):** paths below target the post-VIS-13 `visual-review/storybook/` layout
  (VIS-7–VIS-14 relocate Tier 2 out of `frontend/.storybook/`/`frontend/tests/storybook/`). If
  this card is picked up before VIS-13 ships, retarget these paths back to the pre-migration
  `frontend/.storybook/`/`frontend/tests/storybook/` locations instead.

  **Type:** Feature

  **Files:** `frontend/src/components/EmptyState.stories.jsx` (new) ·
  `frontend/src/components/Skeleton.stories.jsx` (new) ·
  `visual-review/storybook/preview.ts` (modified — import `../../frontend/src/lib/i18n.js` so
  `t()` resolves to real English strings in every story, not raw keys) ·
  `visual-review/storybook/specs/components.visual.spec.ts` (new) ·
  `visual-review/storybook/baselines/components.visual.spec.ts/` (new, baselines pending human
  approval)

  **Config/schema impact:** None — pure frontend dev-tooling addition (no `config.yml` or DB
  schema surface).

  **Acceptance criteria**
  - `EmptyState` stories cover at least the with-action and without-action variants
  - `Skeleton` stories cover at least its loading shape(s) as used in the app (e.g. a single
    skeleton row and a `SkeletonList` of several rows)
  - Both are discovered by the existing `../../frontend/src/**/*.stories.@(js|jsx)` glob in
    `visual-review/storybook/main.ts` (no glob change needed)
  - `visual-review/storybook/preview.ts` initializes i18n so `Skeleton`'s `t('common.loading')`
    renders "Loading…" (English), not the raw key `common.loading`, in every story and capture
  - `cd frontend && npm run storybook` shows both components in the sidebar with their variants
    selectable and rendering correctly, with real (non-key) text
  - `cd frontend && npm run storybook:build` succeeds and includes chunks for both new stories
  - `cd frontend && npm run test:visual:storybook` runs a `toHaveScreenshot` assertion per story
    variant at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900)
  - No existing component behavior changes — this is additive (stories + a preview-only i18n
    init), verified by `cd frontend && npm run build` and the existing Tier 1 E2E suite
    (`npm run test:e2e`) staying green

  **Unit tests:** N/A (no application logic changes — the two components are unmodified; only new
  story files that render them plus a Storybook-preview-only i18n import. Vitest is not installed
  in this repo (see XTF-7); visual correctness is covered by the Playwright E2E below.)

  **E2E:** `visual-review/storybook/specs/components.visual.spec.ts` (new) — for each of the two
  components' story variants, navigate via `/iframe.html?id=...` and assert `toHaveScreenshot` at
  all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900); assert the rendered
  Skeleton loading text is "Loading…", not the raw `common.loading` key (i18n-decorator
  regression check). First-run baselines are pending human approval (`npm run
  test:visual:storybook:update`, human reviews via the review app or direct diff, then
  commits) — not self-approved, per `guard-visual-update.sh`.

  **UAT:**
  1. Run `cd frontend && npm run storybook` and confirm EmptyState and Skeleton each appear in the
     sidebar with their documented variants, showing real English copy (not translation keys).
  2. Click through each variant and visually confirm it matches the component's real in-app
     appearance.
  3. Run `cd frontend && npm run storybook:build && npm run test:visual:storybook:update`, review
     the generated baselines (via `node visual-review/review-app/server.mjs` at
     `http://localhost:4444` or by eye), and approve/commit them.
  4. Re-run `npm run test:visual:storybook` and confirm it passes against the committed baselines.

  **Verify:** `cd frontend && npm run storybook:build` ·
  `cd frontend && npm run test:visual:storybook` ·
  `cd frontend && npm run build` (main app unaffected) ·
  `cd frontend && npm run test:e2e` (Tier 1 harness unaffected)

---

- [ ] **VIS-6 — Storybook stories for Toast + ConfirmDialog (hook-wrapper components) (P2)**

  **Created:** 2026-07-03

  Follow-up to VIS-5, split out because `Toast` and `ConfirmDialog` aren't plain presentational
  components: `Toast.jsx` exports only `ToastProvider` + the imperative `useToast()` hook (no
  default-exported `Toast` component), and toasts self-dismiss (`setTimeout`, 3s success / 6s
  error) — a race against `toHaveScreenshot` capture. `ConfirmDialog.jsx` exports only
  `useConfirm()`, a hook that renders `Modal.jsx` (with a `danger` prop) when invoked — there's no
  `ConfirmDialog` component to point a CSF `component:` at. Both need a small story-only wrapper
  component that calls the hook and renders its result; **no changes to the components'
  application behavior**. Depends on **VIS-5** for the shared Storybook preview's i18n decorator
  (`Modal.jsx` and `ToastProvider` both call `t()`).

  **Note (2026-07-04):** paths below target the post-VIS-13 `visual-review/storybook/` layout
  (VIS-7–VIS-14 relocate Tier 2 out of `frontend/.storybook/`/`frontend/tests/storybook/`). If
  this card is picked up before VIS-13 ships, retarget these paths back to the pre-migration
  `frontend/.storybook/`/`frontend/tests/storybook/` locations instead.

  **Type:** Feature

  **Files:** `frontend/src/components/Toast.stories.jsx` (new — wraps `ToastProvider`; a
  Storybook `play` function calls `useToast().push()` and the story asserts/captures before the
  3s/6s auto-dismiss elapses) · `frontend/src/components/ConfirmDialog.stories.jsx` (new — wraps
  `useConfirm()`, opening the dialog on render to cover default and `danger: true` variants) ·
  `visual-review/storybook/specs/hook-components.visual.spec.ts` (new) ·
  `visual-review/storybook/baselines/hook-components.visual.spec.ts/` (new, baselines pending
  human approval)

  **Config/schema impact:** None — pure frontend dev-tooling addition (no `config.yml` or DB
  schema surface).

  **Acceptance criteria**
  - `Toast` stories cover at least success, error, and info variants, each rendered via a `play`
    function invoking `useToast().push(...)` inside a `ToastProvider` wrapper
  - `Toast` captures happen deterministically within the component's own auto-dismiss TTL (3s
    success/info, 6s error) — the visual spec does not race the timer (e.g. captures immediately
    after the toast becomes visible, before waiting on anything else)
  - `ConfirmDialog` stories cover at least its default and `danger: true` variants, each rendered
    via a wrapper that calls `useConfirm()` and opens the dialog on mount (no real user click
    required to see it in Storybook)
  - Both story files are discovered by the existing `../../frontend/src/**/*.stories.@(js|jsx)`
    glob in `visual-review/storybook/main.ts` (no glob change needed)
  - Rendered text (button labels, dismiss labels) shows real English copy, not raw translation
    keys — confirms VIS-5's preview i18n decorator covers these hook-driven components too
  - `cd frontend && npm run storybook` shows both in the sidebar with their variants; `npm run
    storybook:build` succeeds and includes chunks for both
  - `cd frontend && npm run test:visual:storybook` passes a `toHaveScreenshot` assertion per
    variant at all three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900), with no
    flake from the Toast auto-dismiss timer across 5 consecutive runs
  - No changes to `Toast.jsx` or `ConfirmDialog.jsx` application behavior — verified by `cd
    frontend && npm run build` and the existing Tier 1 E2E suite (`npm run test:e2e`) staying green

  **Unit tests:** N/A (no application logic changes — `Toast.jsx`/`ConfirmDialog.jsx` are
  unmodified; only new story wrapper files. Vitest is not installed in this repo (see XTF-7);
  visual correctness and timing determinism are covered by the Playwright E2E below.)

  **E2E:** `visual-review/storybook/specs/hook-components.visual.spec.ts` (new) — for each Toast
  variant, wait for the `play` function's `push()` call to render the toast then immediately
  assert `toHaveScreenshot` (well inside the 3s/6s TTL); for each ConfirmDialog variant, wait for
  the wrapper to mount and open the dialog then assert `toHaveScreenshot`; both at all three
  viewports (mobile 390×844, tablet 820×1180, desktop 1440×900). Run the Toast spec with
  `--repeat-each=5` and confirm 0 flakes (guards the timer race). First-run baselines are pending
  human approval (`npm run test:visual:storybook:update`, human reviews via the review app
  or direct diff, then commits) — not self-approved, per `guard-visual-update.sh`.

  **UAT:**
  1. Run `cd frontend && npm run storybook` and open the Toast story; confirm success/error/info
     variants render with real copy and the app's actual toast styling.
  2. Open the ConfirmDialog story; confirm the default and danger variants render open (no click
     needed) and match the in-app confirm dialog's appearance, including the danger styling.
  3. Run `cd frontend && npm run storybook:build && npm run test:visual:storybook:update`, review
     the generated baselines (via `node visual-review/review-app/server.mjs` at
     `http://localhost:4444` or by eye), and approve/commit them.
  4. Re-run `npm run test:visual:storybook --repeat-each=5` and confirm it passes with 0 flakes
     against the committed baselines.

  **Verify:** `cd frontend && npm run storybook:build` ·
  `cd frontend && npx playwright test --config=../visual-review/playwright.storybook.config.ts hook-components --repeat-each=5` ·
  `cd frontend && npm run build` (main app unaffected) ·
  `cd frontend && npm run test:e2e` (Tier 1 harness unaffected)
