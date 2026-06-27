import { test, expect, Page } from '@playwright/test';

/**
 * PUX-10 — Fetch/Download auto-save the connection first.
 *
 * Test connection probes the in-form values, but Fetch/Download run the CLI
 * against the SAVED config. A tested-but-unsaved connection therefore enables
 * the buttons but runs stale config. This spec asserts Fetch first saves
 * (POST /api/config) THEN runs (POST /api/run/<cmd>), and that a failed save
 * aborts the run.
 *
 * Network-mocked, same harness as connection-gating.spec.ts.
 */

const ACTIVE_PROJECT = { id: 'proj-1', name: 'Test Project', slug: 'test-project', role: 'admin', is_archived: false };
const CONFIG_YML = [
  'api:', '  platform: ona', '  url: https://data.inform.unicef.org/api/v1', '  token: env:INFORM_TOKEN',
  'form:', '  uid: "9909"', '  alias: test', '',
].join('\n');
const MEMBERS = { members: [{ user_id: 'u-1', email: 'o@e.test', role: 'admin', is_owner: true }], invitations: [], my_role: 'admin' };

async function stub(page: Page, opts: { saveStatus?: number } = {}) {
  const calls: string[] = [];
  (page as any)._calls = calls;
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => r.fulfill({ json: { sub: 'dev', email: 'dev@e.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) => r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) => r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  await page.route('**/api/sources/test', (r) => r.fulfill({ json: { ok: true, fields: 42 } }));

  // GET config returns the saved baseline; POST records the save (configurable status).
  await page.route('**/api/config', (r) => {
    if (r.request().method() === 'POST') {
      calls.push('save');
      const st = opts.saveStatus ?? 200;
      return r.fulfill({ status: st, json: st >= 400 ? { detail: 'Save failed' } : { ok: true } });
    }
    return r.fulfill({ json: { content: CONFIG_YML } });
  });

  // The run endpoint records that a run started.
  await page.route('**/api/run/**', (r) => { calls.push('run'); return r.fulfill({ json: { ok: true } }); });
}

async function gotoConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

// Make the config dirty (change Form UID) then re-confirm via Test so Fetch enables.
async function dirtyThenConfirm(page: Page) {
  await page.getByLabel(/form uid/i).fill('10702');
  const resp = page.waitForResponse((r) => r.url().includes('/api/sources/test') && r.request().method() === 'POST');
  await page.getByRole('button', { name: /^test connection$/i }).click();
  await resp;
}

test('Fetch auto-saves the config before running (save precedes run)', async ({ page }) => {
  await stub(page);
  await gotoConnection(page);
  await dirtyThenConfirm(page);

  const fetchBtn = page.getByRole('button', { name: /fetch questions/i });
  await expect(fetchBtn).toBeEnabled();
  await fetchBtn.click();

  await expect.poll(() => (page as any)._calls.join(',')).toContain('run');
  const calls: string[] = (page as any)._calls;
  expect(calls.indexOf('save'), 'a save must occur').toBeGreaterThanOrEqual(0);
  expect(calls.indexOf('save'), 'save must precede run').toBeLessThan(calls.indexOf('run'));
});

test('a failed auto-save aborts the run', async ({ page }) => {
  await stub(page, { saveStatus: 400 });
  await gotoConnection(page);
  await dirtyThenConfirm(page);

  await page.getByRole('button', { name: /fetch questions/i }).click();
  // Give the app a moment; the run must NOT be issued after a failed save.
  await page.waitForTimeout(1000);
  const calls: string[] = (page as any)._calls;
  expect(calls).toContain('save');
  expect(calls, 'run must not start when the save failed').not.toContain('run');
});
