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
