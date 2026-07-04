import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-9 — Copy-placeholder buttons for charts / indicators / summaries / tables
 * on the Analyze tab.
 *
 * Visual half of `frontend/tests/e2e/copy-placeholder.spec.ts` (VIS-11
 * split): the functional/AC assertions stay there; this file carries ONLY the
 * extracted visual baselines — verbatim bodies + the minimal shared setup
 * they need — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * Visual baselines of the chart row's copy button in its default state and
 * its "copied" confirmation state.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CHART_NAME = 'sites';
const IND_PLAIN = 'completion';
const IND_DISAGG = 'reach';
const SUMMARY_NAME = 'overview';
const TABLE_NAME = 'by_region';

const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  'charts:',
  `  - name: ${CHART_NAME}`,
  '    title: Sites covered',
  '    type: bar',
  '    questions: [region]',
  'indicators:',
  `  - name: ${IND_PLAIN}`,
  '    stat: count',
  '    question: age',
  `  - name: ${IND_DISAGG}`,
  '    stat: count',
  '    question: age',
  '    disaggregate_by: region',
  'tables:',
  `  - name: ${TABLE_NAME}`,
  '    questions: [region]',
  'summaries:',
  `  - name: ${SUMMARY_NAME}`,
  '    stat: distribution',
  '    questions: [region]',
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
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
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
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
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
  const advanced = page.getByTestId('composition-advanced-toggle');
  if (await advanced.count()) {
    if ((await advanced.getAttribute('aria-expanded')) === 'false') {
      await advanced.click();
    }
  }
}

const copyBtn = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: new RegExp(`copy\\s+placeholder\\s+for\\s+${name}`, 'i') });

test.describe('PUX-9 — visual baselines of the copy-placeholder controls', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart row with the copy button (default state)', async ({ page }) => {
    const row = page.locator('.comp-row', { hasText: CHART_NAME }).first();
    await expect(copyBtn(page, CHART_NAME)).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(row).toHaveScreenshot('pux9-chart-row.png');
  });

  test('visual: chart row in its "copied" confirmation state', async ({ page }) => {
    const row = page.locator('.comp-row', { hasText: CHART_NAME }).first();
    await copyBtn(page, CHART_NAME).click();
    const confirmed = page
      .getByRole('status').filter({ hasText: /copied|copié/i })
      .or(page.locator('.toast', { hasText: /copied|copié/i }))
      .or(page.getByRole('button', { name: /copied/i }));
    await expect(confirmed).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(row).toHaveScreenshot('pux9-chart-row-copied.png');
  });
});
