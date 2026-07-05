import { test, expect, Page } from '@playwright/test';

/**
 * PUX-4 — In-app contextual help per stage.
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/stage-help.spec.ts.
 * Minimal duplicated setup (bootstrap stub + navigation + StageHelp selector
 * helpers) needed to reach the opened help panel on Home and Composition.
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
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/indicators/preview', (r) => r.fulfill({ json: { value: 0 } }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string | RegExp) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

const helpToggle = (page: Page) =>
  page.locator('.tab-content:visible').getByTestId('stage-help-toggle');
const helpPanel = (page: Page) =>
  page.locator('.tab-content:visible').getByTestId('stage-help-panel');

test.describe('PUX-4 — in-app contextual help visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
  });

  test('visual: opened help panel on Home', async ({ page }) => {
    await gotoStage(page, 'home');
    await expect(page.locator('.home-head__title')).toBeVisible();
    await helpToggle(page).click();
    const panel = helpPanel(page);
    await expect(panel).toBeVisible();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveScreenshot('pux4-home-help-panel.png');
  });

  test('visual: opened help panel on Composition', async ({ page }) => {
    await gotoStage(page, 'analyze');
    await gotoSub(page, /charts & indicators/i);
    await expect(page.locator('.tab-content:visible .page-header').first()).toBeVisible();
    await helpToggle(page).click();
    const panel = helpPanel(page);
    await expect(panel).toBeVisible();
    await expect(helpToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toHaveScreenshot('pux4-composition-help-panel.png');
  });
});
