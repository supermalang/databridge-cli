# Visual / E2E harness — archived (delivered) cards

> Full history also in git. Live roadmap keeps only the ledger row.

- [x] **VIS-3 — Cap Playwright workers to stop parallel-worker browser crashes in the E2E suite (P1)**

  **Created:** 2026-07-02 · **Started:** 2026-07-02 · **Completed:** 2026-07-03

  **Type:** Fix

  `frontend/playwright.config.ts` sets `fullyParallel: true` with no `workers` cap, so Playwright
  runs the three viewport projects (mobile/tablet/desktop) concurrently against a single shared
  Vite dev server (`webServer`). Under that contention the headless-chromium workers crash
  mid-test — surfacing as `Page crashed` / `Target page, context or browser has been closed`
  failures rather than assertion diffs. This stalled the `/ship-task open` batch for ~19 min on
  PUX-12: `chart-editor.spec.ts` crashed on the tablet project in the full parallel run but passed
  **33/33** across all three viewports when re-run with `--workers=1`. Fix: cap the worker count
  so specs that pass in isolation also pass in the full suite. A stalled
  `fix/ci-playwright-worker-contention` branch already drafted `workers: CI ? 1 : undefined` —
  finish and verify it (its own commit note flags it INCOMPLETE / NOT-YET-SUFFICIENT), capping
  locally too since this dev container hits the same contention.

  **Out of scope (separate concern):** genuinely drifted screenshot baselines (e.g. A11Y-1, PUX-1,
  PUX-3) that fail as pixel-diff mismatches even at `workers:1` — those are a baseline
  reconciliation task (cf. VIS-2), NOT a contention crash, and must not be folded into this fix.

  **Files:** `frontend/playwright.config.ts`

  **Config/schema impact:** None — test-harness config only; no app config or DB change.

  **Acceptance criteria**
  - `playwright.config.ts` caps the Playwright worker count (e.g. `workers: 1`, or a small fixed
    cap) so the three viewport projects no longer overwhelm the shared Vite dev server
  - The full `npm run test:e2e` suite runs with **zero crash-class failures** — no `Page crashed`
    / `Target ... closed` / worker-timeout errors (screenshot pixel-diff mismatches from
    pre-existing baseline drift are explicitly excluded from this criterion)
  - A spec that passes in isolation (`chart-editor.spec.ts` → 33/33) also passes as part of the
    full suite, on all three viewports
  - The cap applies both in CI (`process.env.CI`) and locally, since both share one dev server

  **Unit tests:** N/A (Playwright harness config change — no isolable application logic; the E2E
  harness itself is what changes).

  **E2E:** Validated by the E2E harness itself — `cd frontend && npm run test:e2e` completes with
  no crash-class failures across mobile/tablet/desktop. No new spec or `toHaveScreenshot` baseline
  is added (this card changes runner config, not UI).

  **UAT:** N/A (test-infra/CI change; no user-facing surface — PR review + a green CI run are the
  human gate).

  **Verify:** `cd frontend && npm run test:e2e` (full suite; assert no `Page crashed` / `Target closed` / worker-timeout failures) · `CI=true npx playwright test chart-editor.spec.ts` from `frontend/`

---

- [x] **VIS-2 — Reconcile drifted visual baselines (A11Y-1/-2/-3, PUX-1)**

  **Created:** 2026-06-21 · **Completed:** 2026-06-22

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

- [x] **VIS-1 — Playwright visual harness (mobile/tablet/desktop)**

  **Created:** 2026-06-18 · **Completed:** 2026-06-18

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

