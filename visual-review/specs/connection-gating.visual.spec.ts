import { test, expect, Page } from '@playwright/test';

/**
 * PUX-7 — Gate Fetch/Download on a confirmed connection; flip the sample-data
 * affordance.
 *
 * Visual half of `frontend/tests/e2e/connection-gating.spec.ts` (VIS-11
 * split): the functional/AC assertions stay there; this file carries ONLY the
 * extracted visual baselines — verbatim bodies + the minimal shared setup
 * they need — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * AC 7: visual baselines of the disabled (pre-connection) state and the
 * confirmed-working state, one per viewport; a human approves them.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CONFIG_YML = [
  'api:',
  '  platform: kobo',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

type TestResult = { ok: boolean; fields: number | null; status?: number; message?: string };

async function stubBootstrap(page: Page, probe: { result: TestResult }) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  await page.route('**/api/run/**', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/sample-data', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/sources/test', (r) => r.fulfill({ json: probe.result }));
}

async function gotoConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

const fetchBtn = (page: Page) =>
  page.getByRole('button', { name: /fetch questions/i });
const sampleBtn = (page: Page) =>
  page.locator('[data-testid="try-sample-data"]');
const testBtn = (page: Page) =>
  page.getByRole('button', { name: /^test connection$/i });

async function clickTestConnection(page: Page) {
  const resp = page.waitForResponse(
    (r) => r.url().includes('/api/sources/test') && r.request().method() === 'POST',
  );
  await testBtn(page).click();
  await resp;
}

async function hideTerminalBar(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

test.describe('PUX-7 — visual baselines of the connection gating states', () => {
  test('visual baseline — gated (pre-connection) state', async ({ page }) => {
    await stubBootstrap(page, { result: { ok: true, fields: 42 } });
    await gotoConnection(page);
    await expect(fetchBtn(page)).toBeDisabled();
    await expect(sampleBtn(page)).toBeEnabled();
    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux7-connection-gated.png');
  });

  test('visual baseline — confirmed-working state', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);
    await clickTestConnection(page);
    await expect(fetchBtn(page)).toBeEnabled();
    await expect(sampleBtn(page)).toBeDisabled();
    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux7-connection-confirmed.png');
  });
});
