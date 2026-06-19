import { test, expect, Page } from '@playwright/test';

// XTF-7 — Mirror of the AI-lock copy in frontend/src/lib/aiStatus.js (AI_LOCK_TIP).
// Duplicated here on purpose: the spec is the requirement, not a re-read of the impl.
const AI_LOCK_TIP = 'Test the AI connection first — Extract → AI configuration';

// A minimal .docx the express upload accepts (so `!file` is satisfied; the Infer
// gate must come from aiReady, not from a missing file).
const FAKE_DOCX = {
  name: 'report.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from('PK fake docx'),
};

/**
 * XTF-5 — Express Template Fill: web review/approve panel + discoverability.
 *
 * NETWORK-MOCKED end-to-end. The Vite dev server (playwright.config.ts → webServer)
 * serves the real SPA; every `/api/**` call is intercepted with `page.route()`, so
 * NO FastAPI backend is required. We stub:
 *   - the App.jsx bootstrap calls so the app renders logged-in with an active
 *     project: GET /api/me, /api/projects, /api/periods, /api/config, /api/ai/status;
 *   - the Templates-tab loads: GET /api/templates, /api/templates/active;
 *   - the express endpoints: POST /api/template/infer → fixture proposals (one
 *     `needs_attention` + some `ok`), POST /api/template/apply → {ok, template,
 *     n_written}; and POST /api/run/build-report → an SSE `status: success` frame.
 *
 * The spec carries the Apply&build GATING assertion (Vitest is not installed):
 * Apply & build is DISABLED while any row is needs_attention, and ENABLES once the
 * flagged row is resolved/dropped.
 *
 * Selector contract the implementer must satisfy (data-testid):
 *   - express-banner            — discoverability banner/button (Home + Templates)
 *   - express-upload            — the .docx file input inside the express flow
 *   - express-infer             — the "Infer" action button
 *   - express-review-panel      — the review/approve panel container
 *   - express-row               — one row per placeholder (data-status="ok"|"needs_attention")
 *   - express-row-reason        — the visible reason on a needs_attention row
 *   - express-row-drop          — the "drop this row" control
 *   - express-row-kind          — editable kind <select> (resolving sets status ok)
 *   - express-apply-build       — the "Apply & build" button
 *   - express-success           — the post-build success / download affordance
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const PROPOSALS = [
  {
    token_index: 0,
    kind: 'chart',
    name: 'by_region',
    spec: { name: 'by_region', title: 'By region', type: 'bar', questions: ['Region'] },
    confidence: 0.92,
    reason: '',
    status: 'ok',
  },
  {
    token_index: 1,
    kind: 'indicator',
    name: 'avg_age',
    spec: { name: 'avg_age', stat: 'mean', question: 'Age' },
    confidence: 0.88,
    reason: '',
    status: 'ok',
  },
  {
    token_index: 2,
    kind: 'chart',
    name: 'income_by_zone',
    spec: { name: 'income_by_zone', title: 'Income by zone', type: 'scatter', questions: ['Income'] },
    confidence: 0.31,
    reason: 'scatter needs ≥2 quantitative columns; only 1 found',
    status: 'needs_attention',
  },
];

// Minimal config the app yaml-parses on boot (App.jsx reads form.alias).
const CONFIG_YML = 'form:\n  alias: test\n';

// One SSE body with a terminal success status frame (useCommand reads res.body).
const BUILD_SSE =
  'event: log\ndata: {"line":"building report","level":"info"}\n\n' +
  'event: status\ndata: {"command":"build-report","status":"success"}\n\n';

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below take precedence (Playwright
  // matches routes in REVERSE registration order — last registered wins). This
  // guards against an unstubbed call 404-ing the app into a broken render; in
  // particular /api/projects must NOT fall through to {} (App.jsx would then
  // setProjects(undefined) and crash on `projects.find`).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  // /api/state readiness flags (web/main.py GET /api/state). Default to READY so
  // the existing banner-opens-the-flow tests keep working once XTF-9 gates the
  // banner on has_questions && has_data; the XTF-9 "not ready" test re-registers
  // this route AFTER beforeEach (last-registered wins) to flip it false.
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

// XTF-6 contract: infer PERSISTS the upload and returns a resolvable `template`
// ref alongside the proposals; the panel then carries THAT ref into apply (never
// the bare client file.name). This server-assigned ref differs from the uploaded
// file name on purpose so the assertion proves the ref — not file.name — is sent.
const INFER_TEMPLATE_REF = 'express_8f3c1a2b.docx';
const RESOLVED_TEMPLATE = 'templates/express_8f3c1a2b.resolved.docx';

async function stubExpress(page: Page, appliedBody?: { value: any }) {
  await page.route('**/api/template/infer', (r) =>
    r.fulfill({ json: { proposals: PROPOSALS, message: null, template: INFER_TEMPLATE_REF } }));
  await page.route('**/api/template/apply', (r) => {
    if (appliedBody) {
      try { appliedBody.value = JSON.parse(r.request().postData() || '{}'); }
      catch { appliedBody.value = null; }
    }
    return r.fulfill({ json: { ok: true, template: RESOLVED_TEMPLATE, n_written: 3 } });
  });
  await page.route('**/api/run/build-report', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: BUILD_SSE }));
}

test.describe('Express Template Fill review/approve panel', () => {
  test.beforeEach(async ({ page }) => {
    // stubBootstrap registers the catch-all first, then the specific routes that
    // must win (Playwright matches last-registered first).
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('banner → upload → infer → review panel gates Apply & build until resolved', async ({ page }) => {
    // Sanity: the real SPA mounted logged-in with the active project (proves the
    // bootstrap mocks are sound, so any later failure is specifically the missing
    // XTF-5 UI — not a broken render).
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(page.locator('.tabs-bar .tab', { hasText: 'Deliver' })).toBeVisible();

    // 1. Discoverability banner opens the express flow.
    const banner = page.getByTestId('express-banner').first();
    await expect(banner).toBeVisible();
    await banner.click();

    // 2. Upload a template + run infer.
    await page.getByTestId('express-upload').setInputFiles({
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    // 3. Review panel shows the placeholder → kind/name mapping; flagged row highlighted.
    const panel = page.getByTestId('express-review-panel');
    await expect(panel).toBeVisible();
    const rows = page.getByTestId('express-row');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByText('by_region')).toBeVisible();
    await expect(panel.getByText('avg_age')).toBeVisible();

    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await expect(flagged).toHaveCount(1);
    await expect(flagged.getByTestId('express-row-reason')).toContainText('quantitative');

    // 4. Apply & build is DISABLED while a row is needs_attention.
    const applyBtn = page.getByTestId('express-apply-build');
    await expect(applyBtn).toBeDisabled();

    // Visual baseline of the review panel in the flagged state (3 viewports).
    await expect(page).toHaveScreenshot('review-panel.png');

    // 5. Resolve the flagged row (drop it) → Apply & build ENABLES.
    await flagged.getByTestId('express-row-drop').click();
    await expect(page.locator('[data-testid="express-row"][data-status="needs_attention"]')).toHaveCount(0);
    await expect(applyBtn).toBeEnabled();

    // 6. Apply & build → success / download path.
    await applyBtn.click();
    await expect(page.getByTestId('express-success')).toBeVisible();
  });

  test('apply carries the infer-returned template ref and reaches the success state', async ({ page }) => {
    // Re-register the express stubs with an apply-body capture. Playwright matches
    // the LAST-registered route first, so this overrides the beforeEach stubs.
    const applied: { value: any } = { value: undefined };
    await stubExpress(page, applied);

    await expect(page.getByText('Test Project')).toBeVisible();

    // Open the express flow + upload a template whose name differs from the
    // server-assigned ref (so we can prove the ref — not file.name — is sent).
    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles({
      name: 'my_local_template.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    // Resolve the flagged row so Apply & build enables.
    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await flagged.getByTestId('express-row-drop').click();
    const applyBtn = page.getByTestId('express-apply-build');
    await expect(applyBtn).toBeEnabled();

    // Apply & build → the request must carry the INFER-returned ref, not file.name.
    await applyBtn.click();
    const success = page.getByTestId('express-success');
    await expect(success).toBeVisible();

    // The XTF-6 frontend contract: apply body.template === the infer-returned ref.
    expect(applied.value, 'apply request body should have been captured').toBeTruthy();
    expect(applied.value.template).toBe(INFER_TEMPLATE_REF);
    expect(applied.value.template).not.toBe('my_local_template.docx');

    // Success state shows the resolved template name.
    await expect(success).toContainText('express_8f3c1a2b.resolved');

    // New visual baseline of the SUCCESS state (3 viewports via playwright.config.ts).
    await expect(page).toHaveScreenshot('express-success.png');
  });
});

/**
 * XTF-7 — Gate the Express "Infer" button on AI-tested status.
 *
 * Parity with every other interactive AI control (e.g. Composition's Suggest
 * buttons): Infer must stay DISABLED with the AI_LOCK_TIP tooltip until the AI
 * connection is configured AND verified (`useAiStatus().aiReady`), even when a
 * file is chosen. Choosing a `.docx` satisfies `!file`, so any remaining
 * disabled state is the aiReady gate — that's the behavior under test.
 *
 * The beforeEach calls stubBootstrap() (which registers the catch-all FIRST,
 * then the specific routes including a verified /api/ai/status). Each test below
 * re-registers /api/ai/status AFTER beforeEach, so — Playwright matching
 * last-registered-first — the per-test status mock wins without disturbing the
 * rest of the bootstrap ordering the app needs to render.
 */
test.describe('XTF-7 — Express Infer button is gated on AI-tested status', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('AI not verified → Infer stays disabled with the AI_LOCK_TIP even with a file chosen', async ({ page }) => {
    // Override status AFTER beforeEach so this wins: configured but NOT verified.
    await page.route('**/api/ai/status', (r) =>
      r.fulfill({ json: { configured: true, verified: false, aiReady: false } }));

    // App mounted logged-in (proves the bootstrap mocks are sound).
    await expect(page.getByText('Test Project')).toBeVisible();

    // Open the express flow and choose a .docx so `!file` no longer gates Infer.
    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles(FAKE_DOCX);

    // The file is registered (so the only remaining gate is aiReady).
    await expect(page.locator('.express-filename')).toContainText('report.docx');

    // Infer must be DISABLED and expose the lock tooltip.
    const infer = page.getByTestId('express-infer');
    await expect(infer).toBeDisabled();
    await expect(infer).toHaveAttribute('title', AI_LOCK_TIP);

    // Visual baseline of the locked state (3 viewports via playwright.config.ts).
    // The implementer produces the baselines for human approval.
    await expect(page).toHaveScreenshot('express-infer-locked.png');
  });

  test('AI verified → Infer enables once a file is chosen', async ({ page }) => {
    // Override status AFTER beforeEach: fully ready.
    await page.route('**/api/ai/status', (r) =>
      r.fulfill({ json: { configured: true, verified: true, aiReady: true } }));

    await expect(page.getByText('Test Project')).toBeVisible();

    await page.getByTestId('express-banner').first().click();

    // Before a file is chosen, Infer is disabled regardless of AI status.
    const infer = page.getByTestId('express-infer');
    await expect(infer).toBeDisabled();

    // Choosing a .docx with AI ready enables it.
    await page.getByTestId('express-upload').setInputFiles(FAKE_DOCX);
    await expect(infer).toBeEnabled();
  });

  test('discoverability banner still opens the flow when AI is unverified (no AI call gated)', async ({ page }) => {
    await page.route('**/api/ai/status', (r) =>
      r.fulfill({ json: { configured: true, verified: false, aiReady: false } }));

    await expect(page.getByText('Test Project')).toBeVisible();

    // The banner opens the express flow regardless of AI status — only Infer is
    // gated. The flow renders its visible controls (the upload input is a hidden
    // <input> behind a styled label, so we assert the visible Infer button + the
    // upload control is present in the DOM).
    await page.getByTestId('express-banner').first().click();
    await expect(page.getByTestId('express-infer')).toBeVisible();
    await expect(page.getByTestId('express-upload')).toBeAttached();
  });
});

/**
 * XTF-9 — Gate the "In a hurry?" Express banner on questions + data.
 *
 * The ExpressBanner currently renders ALWAYS enabled (Templates.jsx ~14,
 * Home.jsx ~55), but inference can't validate proposals without real columns —
 * `/api/template/infer` returns the EXPRESS_NO_DATA_MESSAGE precondition when no
 * data is downloaded. The banner must consume `GET /api/state`'s readiness flags
 * and stay DISABLED + non-actionable, with an accessible hint, until BOTH
 * `has_questions` AND `has_data` are true.
 *
 * Contract pinned here (the implementer must match):
 *   - The banner reads `/api/state` → `has_questions && has_data`.
 *   - When not both true: rendered disabled (`disabled` OR `aria-disabled="true"`),
 *     a hint with `data-testid="express-hint"` is visible, and clicking the banner
 *     does NOT open the express flow (no `express-upload` / `express-infer`).
 *   - When both true: enabled, and clicking opens the flow exactly as today.
 *   - `data-testid="express-banner"` is preserved on the banner element.
 *
 * `/api/state` is NOT mocked by stubBootstrap (it falls through to the catch-all
 * `{}`), so each test below registers its own `/api/state` route AFTER beforeEach
 * — Playwright matches last-registered-first, so the per-test mock wins without
 * disturbing the rest of the bootstrap ordering the app needs to render.
 *
 * The full readiness shape returned by web/main.py GET /api/state (~1790–1821) is
 * `{has_questions, has_data, has_templates, has_ai}`; we send all four so the mock
 * matches the real contract even though only the first two gate the banner.
 */

// What the implementer is expected to render for the unmet-precondition hint.
// The card's AC gives this as an example ("Download data and configure questions
// before using Express fill"); we assert on the load-bearing keywords only so the
// exact wording stays the implementer's to choose.
const HINT_KEYWORDS = /download data|configure questions/i;

test.describe('XTF-9 — Express banner is gated on questions + data', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('not ready (no questions, no data) → banner disabled, hint shown, click does NOT open the flow', async ({ page }) => {
    // Override /api/state AFTER beforeEach so this wins: neither precondition met.
    await page.route('**/api/state', (r) =>
      r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: true } }));

    // App mounted logged-in with the active project (proves the bootstrap mocks
    // are sound, so any failure below is the missing XTF-9 gate — not a bad mock).
    await expect(page.getByText('Test Project')).toBeVisible();

    const banner = page.getByTestId('express-banner').first();
    await expect(banner).toBeVisible();

    // The banner is disabled / non-actionable: either a disabled <button> or
    // aria-disabled="true". Accept either so the implementer picks the markup.
    const isDisabled = await banner.isDisabled().catch(() => false);
    const ariaDisabled = await banner.getAttribute('aria-disabled');
    expect(
      isDisabled || ariaDisabled === 'true',
      'banner should be disabled (disabled attr or aria-disabled="true") when not ready',
    ).toBeTruthy();

    // An accessible hint explains what's needed first.
    const hint = page.getByTestId('express-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT_KEYWORDS);

    // Clicking the disabled banner must NOT open the express flow. `force` bypasses
    // Playwright's actionability checks so we exercise the click even on a disabled
    // control — the gate must come from the banner, not from Playwright refusing.
    await banner.click({ force: true });
    await expect(page.getByTestId('express-upload')).toHaveCount(0);
    await expect(page.getByTestId('express-infer')).toHaveCount(0);

    // Visual baseline of the gated (disabled + hint) state (3 viewports via
    // playwright.config.ts). The implementer produces the baselines for approval.
    await expect(page).toHaveScreenshot('express-banner-gated.png');
  });

  test('ready (questions + data) → banner enabled and opens the express flow on click', async ({ page }) => {
    // Override /api/state AFTER beforeEach so this wins: both preconditions met.
    await page.route('**/api/state', (r) =>
      r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));

    await expect(page.getByText('Test Project')).toBeVisible();

    const banner = page.getByTestId('express-banner').first();
    await expect(banner).toBeVisible();

    // Enabled: not a disabled <button> and not aria-disabled.
    await expect(banner).toBeEnabled();
    const ariaDisabled = await banner.getAttribute('aria-disabled');
    expect(ariaDisabled === 'true', 'banner must not be aria-disabled when ready').toBeFalsy();

    // No gating hint in the ready state.
    await expect(page.getByTestId('express-hint')).toHaveCount(0);

    // Clicking opens the express flow exactly as today.
    await banner.click();
    await expect(page.getByTestId('express-infer')).toBeVisible();
    await expect(page.getByTestId('express-upload')).toBeAttached();
  });
});

/**
 * XTF-21 — Fix: the Express "Split by" combobox menu must NOT be clipped by the
 * review panel after Infer.
 *
 * Bug (spec issue ③): `.express-review-panel { overflow: hidden }`
 * (frontend/src/styles.css ~925) clips the absolutely-positioned `.build-combo__list`
 * (`position:absolute; z-index:30`, styles.css ~1014–1020). When the split-by dropdown
 * opens, its options are clipped/hidden by the panel's clip bound. The fix (NOT
 * implemented here) lets the menu escape the panel (preferred: drop `overflow: hidden`
 * from `.express-review-panel`; keep its rounded corners).
 *
 * Reaching the combobox: BuildOptions only renders when NO row is needs_attention
 * (Templates.jsx ~255 `{!flagged && <BuildOptions ... />}`), so we drop the one flagged
 * row from the shared PROPOSALS first. BuildOptions populates the "Split by" listbox from
 * `config.questions` (main-table columns = no `repeat_group`, with an `export_label`), so
 * this block overrides `/api/config` AFTER beforeEach (Playwright matches last-registered
 * first) with a config that carries several such questions — enough that the open list is
 * tall and would visibly overrun the panel's lower edge when not clipped.
 *
 * RED assertions (today, with the bug present):
 *   (a) Deterministic: the open listbox's clipping ancestor `.express-review-panel` has
 *       computed `overflow: hidden` — the fix removes that, so this goes green only once
 *       the menu can escape. This is the clean, viewport-independent red.
 *   (b) Geometric best-effort: with `overflow: hidden`, the painted/box bottom of the list
 *       cannot extend past the panel's clip bound; after the fix the full list renders and
 *       its bottom can extend below the panel bottom. We assert the list is allowed to
 *       overrun the panel (NOT clamped to the panel bottom).
 *   (c) Visual: `toHaveScreenshot('express-split-by-open.png')` of the open-dropdown state
 *       at all three viewports (mobile/tablet/desktop) — the PRIMARY human-approved gate
 *       per the card. Baselines are produced/approved by a human during implementation.
 *
 * Config with main-table split-by columns (each has an `export_label`, none has a
 * `repeat_group`) so the "Split by" listbox is well-populated.
 */
const CONFIG_YML_WITH_QUESTIONS = [
  'form:',
  '  alias: test',
  'questions:',
  '  - {kobo_key: q_region, label: Region, export_label: Region, type: select_one}',
  '  - {kobo_key: q_commune, label: Commune, export_label: Commune, type: select_one}',
  '  - {kobo_key: q_district, label: District, export_label: District, type: select_one}',
  '  - {kobo_key: q_village, label: Village, export_label: Village, type: select_one}',
  '  - {kobo_key: q_site, label: Site, export_label: Site, type: select_one}',
  '  - {kobo_key: q_zone, label: Zone, export_label: Zone, type: select_one}',
  '  - {kobo_key: q_sector, label: Sector, export_label: Sector, type: select_one}',
  '  - {kobo_key: q_ward, label: Ward, export_label: Ward, type: select_one}',
  '',
].join('\n');

// Drive banner → upload → infer → drop the flagged row so BuildOptions (with the
// "Split by" combobox) renders inside the review panel. Returns once the combobox input
// is present.
async function driveExpressToBuildOptions(page: Page) {
  await page.getByTestId('express-banner').first().click();
  await page.getByTestId('express-upload').setInputFiles({
    name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK fake docx'),
  });
  await page.getByTestId('express-infer').click();

  const panel = page.getByTestId('express-review-panel');
  await expect(panel).toBeVisible();

  // BuildOptions only renders when no row is needs_attention — drop the flagged row.
  const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
  await flagged.getByTestId('express-row-drop').click();
  await expect(page.locator('[data-testid="express-row"][data-status="needs_attention"]')).toHaveCount(0);

  // The split-by combobox now renders inside the panel.
  await expect(page.getByTestId('build-split-by')).toBeVisible();
}

test.describe('XTF-21 — Express split-by dropdown is not clipped by the review panel', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    // Override /api/config AFTER the bootstrap stub so this wins (last-registered first):
    // a config carrying several main-table split-by columns so the listbox is populated.
    await page.route('**/api/config', (r) =>
      r.fulfill({ json: { content: CONFIG_YML_WITH_QUESTIONS } }));
    await page.goto('http://localhost:51730/');
  });

  test('opening "Split by" shows the full listbox, not clipped by the review panel', async ({ page }) => {
    // SANITY: the real SPA mounted logged-in with the active project, so any failure
    // below is the XTF-21 clipping bug — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();

    await driveExpressToBuildOptions(page);

    // Open the split-by combobox (opens on focus/click).
    const input = page.getByTestId('build-split-by');
    await input.click();

    const listbox = page.locator('#build-split-by-listbox');
    await expect(listbox).toBeVisible();
    // The mocked config columns populate the list (plus the leading "No split" option).
    await expect(page.getByTestId('build-split-option').first()).toBeVisible();

    // --- (a) Deterministic RED: the clipping ancestor must not clip the menu. -----------
    // With the bug, `.express-review-panel` has `overflow: hidden`, which clips the
    // absolutely-positioned listbox. The fix removes that clip (keeping rounded corners
    // via a different mechanism). Assert the panel does NOT clip its overflow.
    const panelOverflow = await page.getByTestId('express-review-panel').evaluate(
      (el) => getComputedStyle(el as Element).overflow,
    );
    expect(
      panelOverflow,
      'the .express-review-panel must not have overflow:hidden — it clips the open split-by listbox',
    ).not.toContain('hidden');

    // --- (b) Geometric best-effort RED: the listbox must be free to overrun the panel. --
    // Measure the open listbox box and the panel's clip box. With overflow:hidden the
    // listbox cannot render below the panel's bottom edge; the fix lets the full list
    // extend past it when the list is taller than the remaining panel space.
    const boxes = await page.evaluate(() => {
      const list = document.querySelector('#build-split-by-listbox');
      const panel = document.querySelector('[data-testid="express-review-panel"]');
      if (!list || !panel) return null;
      const lr = list.getBoundingClientRect();
      const pr = panel.getBoundingClientRect();
      return { listBottom: lr.bottom, listTop: lr.top, panelBottom: pr.bottom };
    });
    expect(boxes, 'both the listbox and the review panel must be in the DOM').not.toBeNull();
    // The list opens downward (top:100%+4px) and is the tallest content near the panel's
    // foot, so a non-clipped menu extends below the panel's lower edge. With the bug the
    // panel clips it, so its box bottom is bounded by the panel bottom.
    const EPS = 1;
    expect(
      boxes!.listBottom,
      'the open split-by listbox should extend below the review panel bottom (not clamped/clipped by it)',
    ).toBeGreaterThan(boxes!.panelBottom + EPS);

    // --- (c) Visual baseline of the OPEN-dropdown state (3 viewports). ------------------
    // PRIMARY gate per the card; a human approves the baselines during implementation.
    await expect(page).toHaveScreenshot('express-split-by-open.png');
  });
});

/**
 * XTF-18 — Fix: the express **Apply & build** flow must auto-collapse the terminal
 * on the SAME ~5s timing as the regular build (XTF-11), and still auto-expand on error.
 *
 * The regular-build collapse is asserted in terminal-collapse.spec.ts: App.jsx
 * `onStatus` opens the BottomTerminal on a `running` status, then after
 * `window.__TERM_COLLAPSE_MS ?? 5000` ms auto-collapses it to the bar WHILE the run
 * keeps streaming (App.jsx ~184-199 + the `userOverrodeTermRef` guard ~119-123).
 *
 * The bug under test: when the build is launched from the express **Apply & build**
 * flow (Templates.jsx `applyAndBuild` ~129-150 → `await fetch('/api/template/apply')`
 * then `await run('build-report', buildOpts)`), the terminal opens but does NOT
 * collapse after the delay — it stays `data-open="true"` past the configured delay.
 *
 * Technique (combines the two existing harnesses):
 *   - the express mocks from stubBootstrap()/stubExpress() drive upload→infer→approve
 *     →Apply&build, EXCEPT we override `/api/run/build-report` with the controllable,
 *     long-lived SSE stream pattern from terminal-collapse.spec.ts so the build stays
 *     `running` (we never close the stream) across the collapse delay;
 *   - `window.__TERM_COLLAPSE_MS` is pinned tiny (50 ms) via addInitScript BEFORE boot
 *     so the E2E never waits the real ~5s.
 *
 * The build run's SSE body is served by a fetch monkeypatch (addInitScript) parked on
 * `window.__runStream` — the stream stays open until the test calls `.close()`. The
 * express infer/apply routes still go through `page.route` (the wrapper delegates every
 * non-build URL to the real fetch, which Playwright routing then intercepts), so the
 * approve→Apply&build path is unchanged from the XTF-5/6 tests above.
 */
const EXPRESS_COLLAPSE_MS = 50;

// Init: monkeypatch fetch so /api/run/build-report returns a controllable long-lived
// SSE stream (parked on window.__runStream); every other URL delegates to the real
// fetch (and thus to the page.route express mocks). Mirrors terminal-collapse.spec.ts.
const EXPRESS_RUN_STREAM_INIT = `
  (() => {
    const enc = new TextEncoder();
    let controller = null;
    const stream = new ReadableStream({ start(c) { controller = c; } });
    window.__runStream = {
      push(obj) {
        const ev = obj.event || 'message';
        const data = JSON.stringify(obj);
        controller.enqueue(enc.encode('event: ' + ev + '\\ndata: ' + data + '\\n\\n'));
      },
      close() { try { controller.close(); } catch (e) {} },
    };
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/run/build-report')) {
        window.__buildTriggered = true;
        return Promise.resolve(new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }));
      }
      return realFetch(input, init);
    };
  })();
`;

const EXPRESS_COLLAPSE_DELAY_INIT = `window.__TERM_COLLAPSE_MS = ${EXPRESS_COLLAPSE_MS};`;

const term = (page: Page) => page.locator('.bottom-term');

// Drive upload → infer → resolve the flagged row → Apply & build. Returns once the
// chained `run('build-report')` has fired (the long-lived SSE mock is wired).
async function driveExpressApplyAndBuild(page: Page) {
  await page.getByTestId('express-banner').first().click();
  await page.getByTestId('express-upload').setInputFiles({
    name: 'report.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK fake docx'),
  });
  await page.getByTestId('express-infer').click();

  // Resolve the flagged row so Apply & build enables.
  const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
  await flagged.getByTestId('express-row-drop').click();
  const applyBtn = page.getByTestId('express-apply-build');
  await expect(applyBtn).toBeEnabled();

  // Apply & build → POST /api/template/apply (mocked ok) then chained run('build-report').
  await applyBtn.click();

  // SANITY: the express build actually started — so a later "did not collapse" red is
  // about the missing auto-collapse, NOT a build that never ran. Both the apply success
  // affordance and the long-lived build SSE mock must be wired.
  await expect(page.getByTestId('express-success')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__buildTriggered === true))
    .toBe(true);
}

test.describe('XTF-18 — express Apply & build auto-collapses the terminal like the regular build', () => {
  test.beforeEach(async ({ page }) => {
    // Pin the overridable collapse delay + install the controllable build SSE BEFORE boot.
    await page.addInitScript(EXPRESS_COLLAPSE_DELAY_INIT);
    await page.addInitScript(EXPRESS_RUN_STREAM_INIT);
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('terminal opens on the express build, then auto-collapses to the bar while still running, and auto-expands on error', async ({ page }) => {
    // SANITY: the real SPA mounted logged-in with the active project, so a later
    // failure is the missing XTF-18 timing — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();

    // The terminal starts collapsed.
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Drive upload → infer → resolve → Apply & build. `applyAndBuild` awaits
    // /api/template/apply then chains `run('build-report')`; that run synchronously
    // emits a `running` status into App.onStatus, opening the terminal + arming the
    // auto-collapse timer (window.__TERM_COLLAPSE_MS = 50 ms here).
    await driveExpressApplyAndBuild(page);

    // Mirror terminal-collapse.spec.ts exactly: push a `running` status frame over the
    // (held-open) build SSE so the running state is unambiguous and re-arms the timer
    // right before we sample — otherwise the 50 ms timer can collapse the terminal
    // before Playwright's first poll, hiding the transient open.
    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running' });
    });

    // SANITY (correct-red guard): the terminal OPENS on the express build's `running`.
    // If this fails the express run never reached App.onStatus — not the bug under test.
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // AC: after the configured (tiny test) delay it auto-collapses to the bar EVEN
    // THOUGH the build is still streaming (the SSE stream is held open) — the SAME
    // behavior as the regular build (terminal-collapse.spec.ts).
    //   This is the assertion that must FAIL if the reported bug is present: the express
    //   Apply & build opens the terminal but it stays data-open="true" past the delay.
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Visual baseline of the express-build collapsed-during-run state (3 viewports).
    await expect(page).toHaveScreenshot('express-terminal-collapsed.png');

    // AC: the express build subsequently ends in error — the terminal auto-expands so
    // the failure log is visible. Stream stays open through the error frame.
    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'build failed', level: 'error' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'error' });
      (window as any).__runStream.close();
    });
    await expect(term(page)).toHaveAttribute('data-open', 'true');
  });

  test('manual open during an express build is not auto-collapsed', async ({ page }) => {
    // Use a comfortably long collapse delay so the assertion is about the user override
    // winning over the timer, not a race between the timer and the manual clicks.
    await page.addInitScript('window.__TERM_COLLAPSE_MS = 4000;');
    // Re-navigate so the larger delay (added after beforeEach's goto) takes effect.
    await page.goto('http://localhost:51730/');

    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    await driveExpressApplyAndBuild(page);

    // Terminal opened on the express build's `running`.
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // The user collapses then re-opens the terminal by hand — taking manual control.
    // App.setTermOpenManual sets userOverrodeTermRef = true, which must CANCEL the
    // pending auto-collapse. (Two clicks: collapse, then re-open → ends user-opened.)
    await page.locator('.bottom-term__bar').click();
    await expect(term(page)).toHaveAttribute('data-open', 'false');
    await page.locator('.bottom-term__bar').click();
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // AC: a user-opened terminal is NOT auto-collapsed during an express build. With the
    // 4 s delay, if the override were ignored it would still collapse; assert it does not
    // by re-checking after a window comfortably past any (50 ms) default-ish timer.
    await expect(term(page)).toHaveAttribute('data-open', 'true');
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    await page.evaluate(() => { (window as any).__runStream.close(); });
  });
});
