import { test, expect, Page } from '@playwright/test';

/**
 * XTF-27 — Express Fill: bullet_list render type for column-value lists.
 *
 * Visual half of `frontend/tests/e2e/composition-bullet-list.spec.ts`
 * (VIS-11 split): the functional/AC assertions stay there; this file carries
 * ONLY the extracted visual baseline — verbatim body + the minimal shared
 * setup it needs — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * Visual baseline of the chart type dropdown showing the bullet_list option.
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
    { kobo_key: 'group_a/village', label: 'Village', export_label: 'Village', type: 'text', category: 'qualitative' },
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
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

async function openComposition(page: Page) {
  await gotoStage(page, 'analyze');
  await gotoSub(page, 'Charts & indicators');
  await expect(page.locator('.comp-card').first()).toBeVisible();
}

test.describe('XTF-27 — visual baseline of the bullet_list chart type', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart type dropdown showing bullet_list option', async ({ page }) => {
    const chartsCard = page.locator('.comp-card', {
      has: page.locator('.comp-card__title', { hasText: 'Charts' }),
    });
    const addChart = chartsCard.getByRole('button', { name: /add chart/i });
    await addChart.click();

    const modal = page.locator('.modal[role="dialog"]');
    await expect(modal).toBeVisible();

    const typeSelect = modal.getByRole('combobox', { name: /chart type/i });
    await expect(typeSelect).toBeVisible();
    await typeSelect.selectOption('bullet_list');
    await expect(typeSelect).toHaveValue('bullet_list');

    await expect(modal).toHaveScreenshot('xtf27-composition-bullet-list-modal.png');
  });
});
