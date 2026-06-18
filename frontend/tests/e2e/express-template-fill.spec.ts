import { test, expect, Page } from '@playwright/test';

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
