import { test, expect, Page } from '@playwright/test';

/**
 * XTF-5/6/7/9/18/21 + MNT-7 — Express Template Fill review/approve panel.
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/express-template-fill.spec.ts.
 * Minimal duplicated setup (bootstrap + express-flow stubs + the long-lived
 * controllable SSE stream used by the XTF-18 timing baseline) needed to reach each
 * of the 7 captured states: the flagged review panel, the success state, the
 * AI-locked Infer state, the gated banner, the clipped-fix split-by-open state,
 * the express-build collapsed-during-run state, and the infer-error state.
 */

const AI_LOCK_TIP = 'Test the AI connection first — Extract → AI configuration';

const FAKE_DOCX = {
  name: 'report.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: Buffer.from('PK fake docx'),
};

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

const CONFIG_YML = 'form:\n  alias: test\n';

const BUILD_SSE =
  'event: log\ndata: {"line":"building report","level":"info"}\n\n' +
  'event: status\ndata: {"command":"build-report","status":"success"}\n\n';

async function stubBootstrap(page: Page) {
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
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

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

test.describe('Express Template Fill review/approve panel — visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the review panel in the flagged state', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    const banner = page.getByTestId('express-banner').first();
    await expect(banner).toBeVisible();
    await banner.click();

    await page.getByTestId('express-upload').setInputFiles({
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    const panel = page.getByTestId('express-review-panel');
    await expect(panel).toBeVisible();
    const rows = page.getByTestId('express-row');
    await expect(rows).toHaveCount(3);

    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await expect(flagged).toHaveCount(1);

    const applyBtn = page.getByTestId('express-apply-build');
    await expect(applyBtn).toBeDisabled();

    // Visual baseline of the review panel in the flagged state (3 viewports).
    await expect(page).toHaveScreenshot('review-panel.png');
  });

  test('visual baseline of the success state', async ({ page }) => {
    const applied: { value: any } = { value: undefined };
    await stubExpress(page, applied);

    await expect(page.getByText('Test Project')).toBeVisible();

    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles({
      name: 'my_local_template.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await flagged.getByTestId('express-row-drop').click();
    const applyBtn = page.getByTestId('express-apply-build');
    await expect(applyBtn).toBeEnabled();

    await applyBtn.click();
    const success = page.getByTestId('express-success');
    await expect(success).toBeVisible();
    await expect(success).toContainText('express_8f3c1a2b.resolved');

    // New visual baseline of the SUCCESS state (3 viewports via playwright.config.ts).
    await expect(page).toHaveScreenshot('express-success.png');
  });
});

test.describe('XTF-7 — Express Infer AI-lock visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the AI-locked Infer state', async ({ page }) => {
    await page.route('**/api/ai/status', (r) =>
      r.fulfill({ json: { configured: true, verified: false, aiReady: false } }));

    await expect(page.getByText('Test Project')).toBeVisible();

    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles(FAKE_DOCX);

    await expect(page.locator('.express-filename')).toContainText('report.docx');

    const infer = page.getByTestId('express-infer');
    await expect(infer).toBeDisabled();
    await expect(infer).toHaveAttribute('title', AI_LOCK_TIP);

    // Visual baseline of the locked state (3 viewports via playwright.config.ts).
    await expect(page).toHaveScreenshot('express-infer-locked.png');
  });
});

test.describe('XTF-9 — Express banner gated visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the gated (disabled + hint) state', async ({ page }) => {
    await page.route('**/api/state', (r) =>
      r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: true } }));

    await expect(page.getByText('Test Project')).toBeVisible();

    const banner = page.getByTestId('express-banner').first();
    await expect(banner).toBeVisible();

    const hint = page.getByTestId('express-hint');
    await expect(hint).toBeVisible();

    // Visual baseline of the gated (disabled + hint) state (3 viewports via
    // playwright.config.ts).
    await expect(page).toHaveScreenshot('express-banner-gated.png');
  });
});

test.describe('XTF-21 — Express split-by dropdown not clipped visual baseline', () => {
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

  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.route('**/api/config', (r) =>
      r.fulfill({ json: { content: CONFIG_YML_WITH_QUESTIONS } }));
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the open, non-clipped split-by dropdown', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles({
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    const panel = page.getByTestId('express-review-panel');
    await expect(panel).toBeVisible();

    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await flagged.getByTestId('express-row-drop').click();
    await expect(page.locator('[data-testid="express-row"][data-status="needs_attention"]')).toHaveCount(0);

    await expect(page.getByTestId('build-split-by')).toBeVisible();

    const input = page.getByTestId('build-split-by');
    await input.click();

    const listbox = page.locator('#build-split-by-listbox');
    await expect(listbox).toBeVisible();
    await expect(page.getByTestId('build-split-option').first()).toBeVisible();

    // Visual baseline of the OPEN-dropdown state (3 viewports).
    await expect(page).toHaveScreenshot('express-split-by-open.png');
  });
});

test.describe('XTF-18 — express Apply & build terminal-collapse visual baseline', () => {
  const EXPRESS_COLLAPSE_MS = 50;

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

  async function driveExpressApplyAndBuild(page: Page) {
    await page.getByTestId('express-banner').first().click();
    await page.getByTestId('express-upload').setInputFiles({
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });
    await page.getByTestId('express-infer').click();

    const flagged = page.locator('[data-testid="express-row"][data-status="needs_attention"]');
    await flagged.getByTestId('express-row-drop').click();
    const applyBtn = page.getByTestId('express-apply-build');
    await expect(applyBtn).toBeEnabled();

    await applyBtn.click();

    await expect(page.getByTestId('express-success')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).__buildTriggered === true))
      .toBe(true);
  }

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(EXPRESS_COLLAPSE_DELAY_INIT);
    await page.addInitScript(EXPRESS_RUN_STREAM_INIT);
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the express-build collapsed-during-run state', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    await driveExpressApplyAndBuild(page);

    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running' });
    });

    await expect(term(page)).toHaveAttribute('data-open', 'true');
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Visual baseline of the express-build collapsed-during-run state (3 viewports).
    await expect(page).toHaveScreenshot('express-terminal-collapsed.png');

    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'build failed', level: 'error' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'error' });
      (window as any).__runStream.close();
    });
    await expect(term(page)).toHaveAttribute('data-open', 'true');
  });
});

test.describe('MNT-7 — Express infer error visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await stubExpress(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the error state', async ({ page }) => {
    await page.route('**/api/template/infer', (r) =>
      r.fulfill({
        status: 500,
        json: { detail: 'infer failed: LLM response did not return a proposals list' },
      }));

    await expect(page.getByText('Test Project')).toBeVisible();

    await page.getByTestId('express-banner').first().click();

    await page.getByTestId('express-upload').setInputFiles({
      name: 'report.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('PK fake docx'),
    });

    await page.getByTestId('express-infer').click();

    const errorEl = page.locator('.express-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('infer failed');

    // Visual baseline of the error state (3 viewports via playwright.config.ts).
    await expect(page).toHaveScreenshot('express-infer-error.png');
  });
});
