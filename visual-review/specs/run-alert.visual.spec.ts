import { test, expect, Page } from '@playwright/test';

/**
 * XTF-14 — Reposition the run alert in-page (below the title, content width) + icon Stop.
 *
 * VIS-12: visual baseline extracted from frontend/tests/e2e/run-alert.spec.ts. Minimal
 * duplicated setup (bootstrap stub + the long-lived controllable SSE stream) needed to
 * drive the in-page run alert into view for the screenshot. The functional/behavioral
 * assertions stay in the functional spec; only the visual capture is here.
 */

const RUN_ID = 'run-xtf14-abc123';

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CONFIG_YML =
  'api:\n  url: https://kobo.example.test\n  token: t\n' +
  'form:\n  alias: test\n' +
  'questions:\n  - kobo_key: Q1\n    label: Q1\n    type: text\n';

const RUN_STREAM_INIT = `
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

async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 'session 1', files: ['data.csv'] }] } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

async function triggerBuild(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
}

test.describe('XTF-14 — in-page run alert visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(RUN_STREAM_INIT);
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baseline of the in-page run alert', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();
    await triggerBuild(page);
    const buildBtn = page.getByTestId('build-run');
    await expect(buildBtn).toBeVisible();
    await buildBtn.click();
    await expect.poll(() => page.evaluate(() => (window as any).__buildTriggered === true)).toBe(true);

    await page.evaluate((runId) => {
      (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running', run_id: runId });
    }, RUN_ID);

    const alert = page.getByTestId('run-alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/building/i);

    // Visual baseline of the in-page run alert (3 viewports).
    await expect(page).toHaveScreenshot('run-alert.png');
  });
});
