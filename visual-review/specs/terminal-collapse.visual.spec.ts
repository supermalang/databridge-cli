import { test, expect, Page } from '@playwright/test';

/**
 * XTF-11 — Terminal: show ~5s during a build then auto-collapse; auto-expand on error.
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/terminal-collapse.spec.ts.
 * Minimal duplicated setup (bootstrap stub + the controllable long-lived SSE stream +
 * overridable auto-collapse delay) needed to reach the two captured states: collapsed
 * during a still-running build, and auto-expanded after an error.
 */

const RUN_ID = 'run-xtf11-abc123';
const COLLAPSE_MS = 50;

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

const COLLAPSE_DELAY_INIT = `window.__TERM_COLLAPSE_MS = ${COLLAPSE_MS};`;

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

async function startBuild(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
  const buildBtn = page.getByTestId('build-run');
  await expect(buildBtn).toBeVisible();
  await buildBtn.click();
  await expect.poll(() => page.evaluate(() => (window as any).__buildTriggered === true)).toBe(true);
}

async function emitRunning(page: Page) {
  await page.evaluate((runId) => {
    (window as any).__runStream.push({ event: 'log', line: 'building report', level: 'info' });
    (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'running', run_id: runId });
  }, RUN_ID);
}

const term = (page: Page) => page.locator('.bottom-term');

test.describe('XTF-11 — terminal auto-collapse visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(COLLAPSE_DELAY_INIT);
    await page.addInitScript(RUN_STREAM_INIT);
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('visual baselines of collapsed-during-run and auto-expanded-on-error states', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    await startBuild(page);
    await emitRunning(page);

    await expect(term(page)).toHaveAttribute('data-open', 'true');
    await expect(term(page)).toHaveAttribute('data-open', 'false');

    // Visual baseline of the collapsed-during-run state (3 viewports via config).
    await expect(page).toHaveScreenshot('terminal-collapsed.png');

    await page.evaluate(() => {
      (window as any).__runStream.push({ event: 'log', line: 'build failed', level: 'error' });
      (window as any).__runStream.push({ event: 'status', command: 'build-report', status: 'error' });
      (window as any).__runStream.close();
    });
    await expect(term(page)).toHaveAttribute('data-open', 'true');

    // Visual baseline of the auto-expanded error state (3 viewports via config).
    await expect(page).toHaveScreenshot('terminal-error-expanded.png');
  });
});
