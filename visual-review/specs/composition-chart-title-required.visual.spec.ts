import { test, expect, Page, Locator } from '@playwright/test';

/**
 * MNT-15 — Fix: manually-created charts can ship with a blank title.
 *
 * Visual half of `frontend/tests/e2e/composition-chart-title-required.spec.ts`
 * (VIS-11 split): the functional/AC assertions stay there; this file carries
 * ONLY the extracted visual baseline — verbatim body + the minimal shared
 * setup it needs — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * Visual baseline of the chart editor modal in its Title-required error state.
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
  'charts: []',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
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
  await page.route('**/api/charts/preview', (r) =>
    r.fulfill({ json: { image: Buffer.from('fake-png').toString('base64') } }));
  await page.route('**/api/config', (r) => {
    if (r.request().method() === 'PUT' || r.request().method() === 'POST') {
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { content: CONFIG_YML } });
  });
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

async function openComposition(page: Page) {
  await gotoStage(page, 'analyze');
  await gotoSub(page, 'Charts & indicators');
  await expect(page.locator('.comp-card').first()).toBeVisible();
}

const chartsCard = (page: Page): Locator =>
  page.locator('.comp-card', { has: page.locator('.comp-card__title', { hasText: 'Charts' }) });

const editorDialog = (page: Page): Locator => page.locator('.modal[role="dialog"]');
const nameInput = (page: Page): Locator => editorDialog(page).getByLabel('Chart name', { exact: true });
const saveButton = (page: Page): Locator =>
  editorDialog(page).locator('.btn-primary');

async function openAddChartModal(page: Page) {
  const card = chartsCard(page);
  await card.getByRole('button', { name: /add chart/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

test.describe('MNT-15 — visual baseline of the chart editor Title-required error', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor modal with the Title-required error', async ({ page }) => {
    await openAddChartModal(page);
    await nameInput(page).fill('region_overview');
    await saveButton(page).click();
    await expect(editorDialog(page)).toBeVisible();
    await expect(editorDialog(page).locator('[role="alert"]')).toHaveCount(1);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('composition-chart-title-required.png');
  });
});
