import { test, expect, Page } from '@playwright/test';

/**
 * PUX-5 — Reduce setup-before-value friction (no-credentials sample-data path).
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/sample-data-path.spec.ts.
 * Minimal duplicated setup (stateful bootstrap stub + navigation helpers) needed to
 * reach the two captured states: the Sources sample-data affordance, and the
 * resulting data-present Questions state.
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
  'form:',
  '  alias: sample',
  '',
].join('\n');

const SAMPLE_QUESTIONS = {
  questions: [
    { kobo_key: 'demographics/region', label: 'Region', export_label: 'Region', type: 'select_one', category: 'categorical' },
    { kobo_key: 'demographics/age', label: 'Age', export_label: 'Age', type: 'integer', category: 'quantitative' },
  ],
};

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

async function stubBootstrap(page: Page, state: { loaded: boolean }) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));

  await page.route('**/api/questions', (r) =>
    r.fulfill({ json: state.loaded ? SAMPLE_QUESTIONS : { questions: [] } }));

  await page.route('**/api/state', (r) =>
    r.fulfill({
      json: {
        has_questions: state.loaded,
        has_data: state.loaded,
        has_templates: false,
        has_ai: false,
      },
    }));

  await page.route('**/api/sample-data', (r) => {
    state.loaded = true;
    return r.fulfill({ json: { ok: true } });
  });
}

async function gotoConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

const sampleAffordance = (page: Page) =>
  page.locator('[data-testid="try-sample-data"]')
    .or(page.getByRole('button', { name: /sample data|try.*sample/i }));

async function hideTerminalBar(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

test.describe('PUX-5 — no-credentials "Try with sample data" path visual baselines', () => {
  test('visual baseline of the Sources sample-data affordance (no credentials)', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    await expect(sampleAffordance(page)).toBeVisible();

    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux5-sources-sample-affordance.png');
  });

  test('visual baseline of the resulting data-present Questions state', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    await sampleAffordance(page).click();
    await page.waitForRequest(
      (req) => req.url().includes('/api/sample-data') && req.method() === 'POST',
    );

    await page.locator('.tabs-bar [data-tab="transform"]').click();
    await page.locator('.subtabs-bar .subtab', { hasText: /questions/i }).click();

    const qTable = page.locator('.q-table');
    await expect(qTable).toBeVisible();
    await expect(qTable).toContainText(/Region/i);

    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux5-data-present-questions.png');
  });
});
