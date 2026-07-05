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

- [x] **VIS-12 — Split Tier 1 specs into functional + visual, Shard C: build/report/misc (10 files) (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  Third and final shard of the mechanical split described in VIS-10 (`harness-smoke.spec.ts` was
  already migrated as VIS-9's pilot and is not part of this shard).

  **Accepted exception, not fixed by this card:** 26 of the migrated visual assertions
  (`express-template-fill`, `reports-delete-all`, `run-alert`, `terminal-collapse`) fail against
  their moved, pixel-identical baselines — confirmed **pre-existing on `develop`**: the same 26
  failures reproduce running the still-colocated, un-migrated versions of these specs directly on
  a clean `develop` checkout, before this card's migration ever touches them. Same accepted-drift
  pattern as VIS-11. Additionally, `vis-3-worker-cap.spec.ts`'s two functional assertions fail on
  both this branch and `develop` — that spec's `isSmallCap()` helper requires `workers <= 2`, but
  `frontend/playwright.config.ts` still hardcodes `workers: 4` (VIS-8, still open, is exactly the
  card that fixes this). Functional suite otherwise: 231/231 passing.

  **Type:** Feature

  **Files:** same per-file pattern as VIS-10, applied to: `express-template-fill.spec.ts`,
  `build-options.spec.ts`, `chart-editor.spec.ts`, `run-alert.spec.ts`,
  `reports-delete-all.spec.ts`, `sample-data-path.spec.ts`, `stage-help.spec.ts`,
  `terminal-collapse.spec.ts`, `validate-thresholds.spec.ts`, `vis-3-worker-cap.spec.ts`.

  **Config/schema impact:** None — test-file reorganization only.

  **Acceptance criteria** (identical bar to VIS-10, applied to this shard's 10 files)
  - Each file is split: functional remainder has zero screenshot assertions; behaviorally
    identical otherwise
  - `visual-review/specs/<name>.visual.spec.ts` exists per file with the extracted visual
    test(s) + minimal duplicated setup
  - `visual-review/baselines/<name>.visual.spec.ts/` reproduces the old three-viewport baselines,
    renamed to the new filename template
  - `cd frontend && npm run test:visual` passes clean for all 10 against moved baselines, no
    recapture (except any animation-affected spec, called out + re-approved individually)
  - `cd frontend && npm run test:e2e` green for all 10, unchanged pass/fail behavior
  - No file remains in the old snapshots directories for this shard
  - This shard completes the 41-file split: **all** of the old `frontend/tests/e2e/*-snapshots/`
    directories no longer exist anywhere in the repo after VIS-10+VIS-11+VIS-12 (only the 3
    non-visual files listed in VIS-10 remain untouched, and they never had a snapshots directory)

  **Unit tests:** N/A (frontend-only test-file reorg; Vitest not installed — see VIS-10).

  **E2E:** the 10 new `visual-review/specs/*.visual.spec.ts` files above, all three viewports,
  against moved baselines; the 10 retained functional files unchanged.

  **UAT:** N/A (test-infra reorganization — same posture as VIS-10).

  **Verify:** `cd frontend && npx playwright test express-template-fill build-options chart-editor run-alert reports-delete-all sample-data-path stage-help terminal-collapse validate-thresholds vis-3-worker-cap`
  (functional) · `cd frontend && npm run test:visual -- express-template-fill build-options chart-editor run-alert reports-delete-all sample-data-path stage-help terminal-collapse validate-thresholds vis-3-worker-cap`
  (visual) · a directory search under `frontend/tests/e2e` for any remaining snapshots directory
  returns nothing

  **Depends on:** VIS-9.

---

- [x] **VIS-11 — Split Tier 1 specs into functional + visual, Shard B: i18n / product-UX / composition (15 files) (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  Second shard of the same mechanical split described in VIS-10 (see VIS-10 for the exclusion
  note on the 3 non-visual files, and the full transformation recipe — not repeated here).

  **Accepted exception, not fixed by this card:** 25 of the migrated visual assertions (across
  `composition-progressive`, `connection-gating`, `copy-placeholder`, `i18n-coverage`,
  `i18n-remaining`, `project-language`, `pux-1`, `pux-2`) fail against their moved, pixel-identical
  baselines — confirmed **pre-existing on `develop`** (identical failures reproduce running the
  same specs' still-colocated, un-migrated baselines directly on a clean `develop` checkout,
  before this card's migration ever touches them). Root cause: the baselines were last refreshed
  at PUX-4 and have drifted from several unrelated rendering changes since (e.g. I18N-2's string
  externalization) — a pre-existing gap this card's mechanical split neither introduces nor is
  scoped to fix. Functional suite: 387/387 passing. Tracked as a separate follow-up (baseline
  refresh requires human re-approval per `guard-visual-update.sh` and is out of scope for a
  test-file-reorganization card).

  **Type:** Feature

  **Files:** same per-file pattern as VIS-10, applied to: `i18n-coverage.spec.ts`,
  `i18n-remaining.spec.ts`, `i18n-subtabs.spec.ts`, `i18n-switch.spec.ts`, `nav-labels.spec.ts`,
  `project-language.spec.ts`, `perf-3-skeleton.spec.ts`, `pux-1.spec.ts`, `pux-2.spec.ts`,
  `composition-progressive.spec.ts`, `composition-bullet-list.spec.ts`,
  `composition-chart-title-required.spec.ts`, `connection-gating.spec.ts`,
  `copy-placeholder.spec.ts`, `client-cache.spec.ts`.

  **Config/schema impact:** None — test-file reorganization only.

  **Acceptance criteria** (identical bar to VIS-10, applied to this shard's 15 files)
  - Each file is split: functional remainder at `frontend/tests/e2e/<name>.spec.ts` has zero
    screenshot assertions; behaviorally identical otherwise
  - `visual-review/specs/<name>.visual.spec.ts` exists per file with the extracted visual
    test(s) + minimal duplicated setup
  - `visual-review/baselines/<name>.visual.spec.ts/` reproduces the old three-viewport baselines,
    renamed to the new filename template
  - `cd frontend && npm run test:visual` passes clean for all 15 against moved baselines, no
    recapture (except any animation-affected spec, called out + re-approved individually)
  - `cd frontend && npm run test:e2e` green for all 15, unchanged pass/fail behavior
  - No file remains in the old snapshots directories for this shard

  **Unit tests:** N/A (frontend-only test-file reorg; Vitest not installed — see VIS-10).

  **E2E:** the 15 new `visual-review/specs/*.visual.spec.ts` files above, all three viewports,
  against moved baselines; the 15 retained functional files unchanged.

  **UAT:** N/A (test-infra reorganization — same posture as VIS-10).

  **Verify:** `cd frontend && npx playwright test i18n-coverage i18n-remaining i18n-subtabs i18n-switch nav-labels project-language perf-3-skeleton pux-1 pux-2 composition-progressive composition-bullet-list composition-chart-title-required connection-gating copy-placeholder client-cache`
  (functional) · `cd frontend && npm run test:visual -- i18n-coverage i18n-remaining i18n-subtabs i18n-switch nav-labels project-language perf-3-skeleton pux-1 pux-2 composition-progressive composition-bullet-list composition-chart-title-required connection-gating copy-placeholder client-cache`
  (visual)

  **Depends on:** VIS-9.

---

- [x] **VIS-9 — Scaffold the visual-review root directory + dedicated Tier 1 visual config + relocate the Tier 3 review app + ledger (P2)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  Foundational card for aligning with the upstream `ai-augmented-coding` template. Stands up the
  target directory contract, relocates the Tier 3 review app + approvals ledger into it, creates
  the new dedicated Tier 1 visual-only Playwright config, and proves the whole pipeline
  end-to-end by migrating exactly one already-trivial spec (`harness-smoke.spec.ts`) as a pilot —
  before the 41-file bulk split (VIS-10/11/12) and the Tier 2 relocation (VIS-13) build on top of
  it. **Depends on VIS-7**: this card introduces new npm scripts capable of self-baselining, and
  VIS-7's hook fix is what actually guards the new Tier 1 update script from agent
  self-approval — landing VIS-9 first would open a real self-approval window.

  ```
  visual-review/
    playwright.visual.config.ts       # Tier 1 dedicated visual-only config (THIS CARD)
    playwright.storybook.config.ts    # Tier 2 config — relocated by VIS-13
    specs/                            # Tier 1 visual-only specs, mirrors frontend/tests/e2e/ subpaths
    baselines/                        # Tier 1 baselines; snapshotPathTemplate mirrors specs/
    results/                          # gitignored — actual/diff/report (Tier 1: results/output)
    uat/                              # gitignored — qa-tester review shots
    storybook/                        # Tier 2 config/stories/specs/baselines — populated by VIS-13
    review-app/                       # Tier 3 review app (THIS CARD)
    visual-approvals.json             # ledger (THIS CARD)
  ```

  **Accepted tradeoff, not fixed by this card:** the approvals ledger's existing entries are
  keyed by baseline-relative path (e.g. `e2e/chart-editor.spec.ts-snapshots/...`). Once VIS-10-13
  move baselines to new paths, those pre-migration ledger entries become orphaned/unmatchable —
  this card does not rewrite existing ledger keys. Pre-migration approval history is accepted as
  lost; going forward, entries are created fresh under the new paths as baselines are
  approved/re-approved post-migration.

  **Type:** Feature

  **Files:**
  - NEW `visual-review/playwright.visual.config.ts` — modeled on `frontend/playwright.config.ts`
    (3 viewport projects; `fullyParallel: true`; `retries: CI?1:0`; worker count
    `process.env.CI ? 1 : '50%'` per VIS-8; `webServer: { command: 'npm run dev', url:
    'http://localhost:51730', ... }`, invoked via `cd frontend && npx playwright test
    --config=../visual-review/playwright.visual.config.ts`; imports the existing polyfill via
    `import '../frontend/tests/e2e/css-escape-polyfill'`, not duplicated) but with
    `testDir: './specs'`, `snapshotDir: 'baselines'`, and a custom `snapshotPathTemplate`
    following the pattern `{snapshotDir}/{testFilePath}/{arg}-{projectName}-{platform}{ext}`
    (must include the project-name token — omitting it collapses all three viewport projects'
    baselines onto the same filename, since the platform token alone is constant across projects
    on one machine; confirmed via the actual committed baselines, which currently disambiguate
    viewports via Playwright's own default project-name token), `outputDir: 'results/output'`,
    `reporter: [['html', {outputFolder: 'results/report'}], ['list']]`,
    `expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 } }` (adds the
    currently-missing animation-freezing option)
  - `frontend/package.json` — add a Tier 1 dedicated-config visual-run script (pointing at
    `../visual-review/playwright.visual.config.ts`), its update variant (same + the snapshot
    update flag), and a report-viewer script (`playwright show-report ../visual-review/results/report`)
  - MOVE `frontend/scripts/visual-review-app/server.mjs` → `visual-review/review-app/server.mjs`,
    **and edit it**: the `ROOT` constant's relative-path climb (`join(HERE, '..', '..', '..')`)
    → `join(HERE, '..', '..')` (the relocated file is now 2 directories below repo root, not 3 —
    using the old depth would climb one level above the repo root); update the three env-var
    defaults: baselines-dir default `'frontend/tests'` → `'visual-review/baselines'`;
    output-dir default `'frontend/test-results'` → `'visual-review/results/output'`;
    approvals-file default `'visual-approvals.json'` → `'visual-review/visual-approvals.json'`
  - MOVE `frontend/scripts/visual-review-app/lib.mjs` → `visual-review/review-app/lib.mjs` (no
    logic change — paths are passed in as parameters)
  - MOVE `frontend/scripts/visual-review-app/test.mjs` → `visual-review/review-app/test.mjs`
    (update its relative import of `lib.mjs`; assertions unchanged)
  - MOVE `frontend/scripts/visual-review-app/index.html` → `visual-review/review-app/index.html`
  - MOVE `frontend/scripts/visual-review-app/README.md` → `visual-review/review-app/README.md`
    (update documented run command + default paths; note Tier 2 coverage under
    `visual-review/storybook/baselines/` is added by VIS-13)
  - MOVE the root approvals-ledger JSON file → `visual-review/visual-approvals.json` (content
    unchanged — see the accepted-tradeoff note above)
  - `.claude/hooks/guard-visual-update.sh` — update header-comment example paths only (cosmetic;
    VIS-7's denylist is already path-agnostic)
  - `.gitignore` — add `visual-review/results/` and `visual-review/uat/` (do **not** remove the
    old `frontend/playwright-report/` / `frontend/blob-report/` / `frontend/test-results/` /
    `frontend/.playwright/` lines yet — VIS-14's cutover retires those once nothing writes there)
  - **Pilot migration** (proves the new contract end-to-end):
    - `frontend/tests/e2e/harness-smoke.spec.ts` — remove its one screenshot assertion + its
      doc-comment claim of being the visual-harness proof; keep
      `await expect(page.locator('main.card')).toBeVisible();` as a minimal functional check
    - NEW `visual-review/specs/harness-smoke.visual.spec.ts` — same inline fixture HTML + the
      screenshot assertion, now run under `playwright.visual.config.ts`
    - `git mv` the 3 baseline PNGs from `frontend/tests/e2e/harness-smoke.spec.ts-snapshots/` to
      `visual-review/baselines/harness-smoke.visual.spec.ts/`, renamed to match the new template
      (pixel-identical, filename only)
    - delete the now-empty `frontend/tests/e2e/harness-smoke.spec.ts-snapshots/`

  **Config/schema impact:** New root-level directory tree + one new root-level Playwright config;
  no `config.yml` or DB schema surface. The approvals ledger's JSON schema is unchanged, only its
  filesystem location moves (see accepted-tradeoff note re: existing keys).

  **Acceptance criteria**
  - `visual-review/{specs,baselines,results,uat,storybook,review-app}/` all exist; `results/`,
    `uat/`, and `storybook/` (until VIS-13) have no tracked content yet
  - `visual-review/playwright.visual.config.ts` exists with the settings above, including the
    project-name token in `snapshotPathTemplate`
  - `cd frontend && npm run test:visual` runs `harness-smoke.visual.spec.ts` against the moved
    baselines and passes clean (no diff) at all three viewports **independently** (mobile/tablet/
    desktop each produce their own distinct baseline file, verified by checking three separate
    PNGs exist, not one shared file), with **no recapture**
  - `frontend/tests/e2e/harness-smoke.spec.ts` still exists, asserts no screenshot, and still
    passes as part of `npm run test:e2e`
  - `node visual-review/review-app/server.mjs` starts, serves `/`, and `/api/diffs` reads from
    the new default paths with no env vars set
  - `node visual-review/review-app/test.mjs` passes unmodified in assertions (only import/path
    changes)
  - `frontend/scripts/visual-review-app/` and the root approvals-ledger file no longer exist
  - `cd frontend && npm run build`, `npm run test:e2e` (minus the one dropped screenshot line),
    and `npm run test:visual:storybook` (untouched by this card) remain green

  **Unit tests:** `visual-review/review-app/test.mjs` (relocated, no assertion changes). Run:
  `node visual-review/review-app/test.mjs`.

  **E2E:** `visual-review/specs/harness-smoke.visual.spec.ts` (new) — the pilot migration
  validating the snapshot-directory/template/output-directory settings end-to-end on a
  deterministic `page.setContent` fixture, and specifically validating the project-name-token fix
  keeps the three viewports' baselines distinct. Impeccable audit/critique N/A (throwaway
  fixture, no product UI, same as its VIS-1 precedent); the baselines are pixel-identical
  git-renames, verified by a clean run with no diff — no human re-approval required.

  **UAT:** N/A (test-infra scaffolding, no product UI surface — the pilot spec's green run + PR
  review are the human gate, same posture as VIS-1/VIS-3).

  **Verify:** `cd frontend && npm run test:visual` · `node visual-review/review-app/test.mjs` ·
  `node visual-review/review-app/server.mjs` (starts; the diffs endpoint returns an empty list on
  a clean tree) · `cd frontend && npm run test:e2e` · `cd frontend && npm run build`

---

- [x] **VIS-7 — Fix: guard-visual-update.sh false-positive blocks unrelated commands + silent jq-missing fail-open (P1)**

  **Created:** 2026-07-04 · **Completed:** 2026-07-04

  `.claude/hooks/guard-visual-update.sh` matched a bare `\bplaywright\b` substring anywhere in
  the command text (not the actual `playwright test` subcommand), which incorrectly denied
  `git push -u origin chore/playwright-workers-4` this session — the branch name merely
  *contained* "playwright"; no `playwright test` was ever invoked. The Tier 2 baseline-update npm
  script (shipped with VIS-4) was also already unguarded, a live self-approval gap.

  **Scope grew substantially during Review** (3 rounds of security-audit + 1 perf-review, all
  adversarial and empirically-verified, not just regex-reading):
  - **perf-review** found the jq-free `extract_command()` decoder was O(n²) in command length
    (benchmarked: ~75s at 100KB) — this hook runs on every Bash tool call, and this repo's own
    heredoc-based commit/PR conventions routinely produce multi-KB commands. Fixed by preferring
    `jq` when present (fast path) and falling back to a single-pass `python3 -c` JSON parse (not
    a bash byte-loop) only when `jq` is genuinely absent — confirmed O(n) after the fix (0.093s
    at 50KB, down from 19.47s).
  - **security-audit round 1** empirically found the new command-position anchor omitted the
    backtick and `{` characters, so `` x=`playwright test --update-snapshots` `` and
    `{ npx playwright test -u; }` silently bypassed the gate. Fixed by adding both to the anchor
    class and widening the `-u` alias's trailing-boundary set.
  - **security-audit round 2** (adversarial fuzzing beyond the reported bypasses) found the same
    anchor didn't cover bash keyword-introduced command positions: `!` negation, and `then`/`do`/
    `else`/`elif`/`time`. Fixed for all of these (6 of 7 found bypasses). The 7th — a `case`
    pattern's closing `)` — was deliberately left as a **documented residual limitation**
    alongside the pre-existing `eval`-obfuscation limitation: a bare `)` is far too common in
    ordinary shell/text to anchor on safely, and exploiting it requires the unusual `case`/`esac`
    construct, putting it in the same tier as `eval`'s string-literal obfuscation rather than the
    easily-hit keyword class.
  - **security-audit round 3** (final confirmation pass) found one more real, easy-to-hit gap:
    the `-u` alias's terminator class omitted the closing backtick, so `` x=`npx playwright test -u` ``
    still bypassed. Fixed by adding it to the terminator set.
  - **roadmap-verifier** (adversarial DoD pass, going beyond re-running the suite) found the
    `deny()` helper still shelled out to `jq -n` unconditionally with no fallback — so on a host
    without `jq`, `extract_command()` correctly identified a denial-worthy command via its
    python3 fallback, but `deny()` then silently produced no output and exited 0 (ALLOW),
    reintroducing this exact card's own "silent jq-missing fail-open" bug, just relocated from
    the extraction step to the decision step, and on the worst-case commands (only fails open on
    genuine denials, not on benign ones). Fixed by switching `deny()` to stderr + `exit 2` — the
    same jq-free deny convention every other guard hook in this repo already uses — which needs
    no JSON parser at all. Added dedicated jq-free-PATH test coverage (deny + allow) that the
    original 56-case suite never exercised, plus a dedicated pin for the `eval` residual that the
    AC claimed was "pinned-by-test" but wasn't yet.

  **Type:** Fix

  **Files:** `.claude/hooks/guard-visual-update.sh` (full rewrite: `extract_command()` prefers
  `jq`, falls back to a single-pass `python3 -c` JSON parse — not a bash byte-loop — only when
  `jq` is absent; `deny()` signals via stderr + `exit 2` instead of a jq-built stdout JSON blob,
  so the decision step itself has no jq dependency; command-position anchor covers `;`/`&`/`|`/
  `(`/backtick/`{`/`!`/`then`/`do`/`else`/`elif`/`time`; `-u` alias terminator set includes the
  closing backtick; header comments document the `eval` and `case`-pattern residual limitations
  honestly) · `.claude/hooks/tests/guard-visual-update.test.sh` (extended; `is_deny`/
  `has_human_reason`/`run_hook` switched from parsing stdout JSON to checking exit code + stderr
  to match the `deny()` contract change; added `run_hook_with_path`/`assert_deny_no_jq`/
  `assert_allow_no_jq` fixtures backed by a jq-scrubbed PATH scratch dir)

  **Config/schema impact:** None — hook script only.

  **Acceptance criteria**
  - `git push -u origin chore/playwright-workers-4` is **allowed**
  - Still **denied**: the existing Tier-1-update npm script; `npx playwright test` with the
    snapshot-update flag; `playwright test` with the short update flag; a `cd frontend &&`-prefixed
    invocation of the same with extra grep args
  - Newly **denied**: the Tier 2 storybook-update npm script and the new Tier 1 dedicated-config
    update npm script VIS-9 introduces — matched at command position, not as a bare substring, so
    free-text mentions (e.g. in a commit message) are **allowed**
  - `git commit -m "fix playwright config regression"` and any command where "playwright" or an
    npm-update script name occurs only inside a free-text argument — not as the actual invocation
    — is **allowed**
  - Command extraction prefers `jq`; when genuinely absent, falls back to a `python3`-based
    parse (O(n), not the O(n²) bash byte-loop) that survives escaped quotes/backslashes
  - The deny decision itself does not depend on `jq` either: with `jq` scrubbed from `PATH`, a
    genuine denial-worthy command is still **denied** (exit 2 + human-approval reason on stderr),
    and an unrelated/free-text command is still **allowed** — closing the relocated fail-open gap
    the verify pass found
  - Fail-safe-open contract preserved: empty/genuinely unparseable stdin still results in ALLOW
  - A 100KB synthetic command extracts and evaluates in well under 1 second (regression guard
    against the O(n²) hazard recurring)
  - Command-position anchor denies genuine invocations following `;`, `&`, `|`, `(`, backtick,
    `{`, `!` negation, and the keywords `then`/`do`/`else`/`elif`/`time` — verified via crafted
    payloads actually run through the live hook, not just regex inspection
  - `eval "..."` and a `case`-pattern `)` command position are documented, pinned-by-test residual
    limitations (not silently unhandled) — exploiting either requires an unusual construct,
    unlike the fixed classes above
  - All pre-existing MNT-16 cases in `guard-visual-update.test.sh` continue to pass

  **Unit tests:** `.claude/hooks/tests/guard-visual-update.test.sh` — grew from 13 to 61 cases
  across all rounds: the original incident regression + two npm-script cases (RED phase); 6 cases
  covering the npm-script/playwright free-text exemption fix; 4 cases covering the backtick/brace
  anchor fix; a 100KB bounded-time perf regression guard; 19 cases covering the keyword/negation
  anchor fix (8 deny + 11 allow proving no new false positives, one per keyword); 2 cases covering
  the final backtick-terminator fix; 1 case pinning the `eval` residual; 4 cases (2 deny + 2
  allow) run against a jq-scrubbed `PATH` proving the deny path is jq-independent. Run:
  `bash .claude/hooks/tests/guard-visual-update.test.sh`.

  **E2E:** N/A (bash PreToolUse hook, not a UI surface — covered by the bash test suite above,
  same posture as this hook's originating card MNT-16).

  **UAT:** N/A (dev-tooling/hook fix, no product UI surface — the bash test suite + PR review are
  the human gate, same posture as MNT-16).

  **Verify:** `bash .claude/hooks/tests/guard-visual-update.test.sh` (61 passed) · manually replay
  the incident command (`git push -u origin chore/playwright-workers-4` against a real branch)
  via the Bash tool and confirm it is no longer denied.

---

- [x] **VIS-4 — Adopt Storybook (Tier 2) + local review app (Tier 3) + visual-approval ledger (P2)**

  **Created:** 2026-07-03 · **Completed:** 2026-07-03

  Ports the ai-augmented-coding template's tiered visual-testing system (VBR-1/4/5), adapted
  to this repo. Template's Tier 1 (containerized full-route Playwright screenshots) was
  **not** adopted — it would duplicate the more mature, already-integrated VIS-1 harness
  (`frontend/tests/e2e/`, no Docker, CI installs Chromium directly per
  `.github/workflows/visual.yml`) with a competing, redundant one. What's genuinely additive:
  Tier 2 (Storybook component-isolation baselines) and Tier 3 (a local human
  Approve/Reject review app backed by an approval ledger), both layered on top of the
  existing VIS-1 harness rather than replacing it. `guard-visual-update.sh` (MNT-16, already
  shipped) already blocks agents from self-approving baselines via Bash; this card adds the
  human-facing approval loop and the machine-readable record of it.

  **Type:** Feature

  **Files:** `frontend/.storybook/main.js` + `preview.js` (new) ·
  `frontend/tests/storybook/Example.stories.jsx` + `example.visual.spec.ts` (new) ·
  `frontend/playwright.storybook.config.ts` (new) · `frontend/package.json` (+`storybook`,
  `@storybook/react-vite`, `http-server` devDeps; +4 npm scripts) ·
  `frontend/scripts/visual-review-app/{lib,server,test}.mjs` + `index.html` + `README.md`
  (new) · `visual-approvals.json` (new, repo root) · `.claude/agents/visual-review.md` (new) ·
  `.claude/skills/visual-review/SKILL.md` (new) · `.claude/agents/roadmap-verifier.md` (edit —
  visual DoD check now consults `/visual-review` instead of just checking a PNG exists) ·
  `.claude/context.md` + `CLAUDE.md` (document the three tiers) · `.gitignore`
  (`frontend/storybook-static/`, `frontend/playwright-report-storybook/`)

  **Config/schema impact:** New root-level `visual-approvals.json` ledger (seeded `{}`) — pure
  harness/process state, not `config.yml` or DB schema. Schema: `{ "<baseline-id>": {
  "decision": "approved"|"rejected", "task": "<ID>"|null, "capturedImage": "<path>" (approved
  only), "at": "<ISO8601>" } }`, keyed by the baseline PNG's path relative to `frontend/tests/`.

  **Acceptance criteria**
  - `cd frontend && npm run storybook:build` produces a working static build from
    `frontend/tests/storybook/Example.stories.jsx` (verified: build succeeds, emits an
    `Example.stories-*.js` chunk)
  - `cd frontend && npm run test:visual:storybook` (against the built Storybook) navigates to
    each story via `/iframe.html?id=...` and asserts `toHaveScreenshot` — verified: on a clean
    run it correctly reports "no baseline yet, writing actual" for both example stories
    (first-run behavior, not a bug) and writes real `-actual.png` candidates
  - `.claude/hooks/guard-visual-update.sh` blocks `--update-snapshots` for the new Storybook
    config exactly as it does for the main config — verified live: attempting
    `npx playwright test --config=playwright.storybook.config.ts --update-snapshots` was
    denied with the human-approval message
  - `node frontend/scripts/visual-review-app/server.mjs` starts, serves `/`, and `/api/diffs`
    correctly finds real Playwright `-actual.png` candidates when a matching baseline exists,
    and correctly skips a brand-new candidate with no committed baseline (not a "diff to
    review" — that's a first-baseline case, not an approval case)
  - Approve (in the review app) copies the candidate over the baseline (file copy, not a
    `--update-snapshots` shell call) and writes `{decision:"approved", task, capturedImage,
    at}` to `visual-approvals.json`; Reject writes `{decision:"rejected", ...}` without
    touching the baseline
  - `.claude/agents/roadmap-verifier.md`'s visual DoD check now requires `/visual-review`'s
    verdict to be `clear` for a card's own baselines specifically — a `pending` or `rejected`
    entry is a named FAIL even if the PNG is committed on disk
  - The main app build (`npm run build`) and the existing Tier 1 E2E harness
    (`playwright.config.ts`, `frontend/tests/e2e/`) are unaffected — new Storybook deps and
    config are fully additive

  **Unit tests:** `frontend/scripts/visual-review-app/test.mjs` (new, Node built-ins only) — 11
  assertions: `findDiffs` correlates a candidate to its baseline by stem (tolerating the
  `{platform}` filename suffix) and pairs the `-diff.png`; `approve` re-baselines via file copy
  and records `decision/task/capturedImage/at`; `reject` records without re-baselining;
  `baselineId` returns a relative POSIX path; a brand-new candidate with no committed baseline
  is correctly excluded from the diff set (not misreported as a pending review item).

  **E2E:** `frontend/tests/storybook/example.visual.spec.ts` (new) — screenshots the two
  example Storybook stories (`example-button--primary`, `example-button--disabled`) at all
  three viewports (mobile 390×844, tablet 820×1180, desktop 1440×900) via the static
  Storybook build; first-run baselines are pending human approval (`npm run
  test:visual:storybook:update`, then a human reviews + commits) — not blessed as part of this
  card, per the same human-approval rule this card's own tooling exists to enforce.

  **UAT:**
  1. Run `cd frontend && npm run storybook` and confirm the Storybook workbench opens at
     `http://localhost:6006` showing the Example/Button story with Primary/Disabled variants.
  2. Run `cd frontend && npm run storybook:build && npm run test:visual:storybook:update`
     (human-run — approves the first baselines), then re-run
     `npm run test:visual:storybook` and confirm it passes against the now-committed baselines.
  3. Make a trivial visual change to `frontend/tests/storybook/Example.stories.jsx` (e.g.
     change the button's padding), re-run the Storybook visual suite, confirm it fails with a
     diff, then run `node frontend/scripts/visual-review-app/server.mjs`, open
     `http://localhost:4444`, and confirm the changed screenshot appears with Approve/Reject
     controls; click Approve and confirm `visual-approvals.json` gets a new `"approved"` entry
     and the baseline PNG updates to the new pixels.

  **Verify:** `node frontend/scripts/visual-review-app/test.mjs` ·
  `cd frontend && npm run build` (main app unaffected) ·
  `cd frontend && npm run storybook:build` ·
  `cd frontend && npm run test:e2e` (Tier 1 harness unaffected)

---

