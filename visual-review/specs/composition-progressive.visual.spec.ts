import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-3 — Reduce Composition cognitive load via progressive disclosure.
 *
 * Visual half of `frontend/tests/e2e/composition-progressive.spec.ts`
 * (VIS-11 split): the functional/AC assertions stay there; this file carries
 * ONLY the extracted visual baselines — verbatim bodies + the minimal shared
 * setup they need — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * Visual baselines of the collapsed (starter) and expanded (Advanced) states,
 * one per viewport.
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
  'charts:',
  '  - name: age_hist',
  '    title: Age distribution',
  '    type: histogram',
  '    questions: [age]',
  'indicators:',
  '  - name: total_hh',
  '    stat: count',
  '    question: age',
  'tables:',
  '  - name: by_region',
  '    questions: [region]',
  'summaries:',
  '  - name: overview',
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

const starterPath = (page: Page): Locator => page.getByTestId('composition-starter-path');
const advancedToggle = (page: Page): Locator => page.getByTestId('composition-advanced-toggle');
const advancedRegion = (page: Page): Locator => page.getByTestId('composition-advanced');

test.describe('PUX-3 — visual baselines of Composition progressive disclosure', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: collapsed (starter) state', async ({ page }) => {
    await expect(starterPath(page)).toBeVisible();
    await expect(advancedToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('pux3-composition-collapsed.png');
  });

  test('visual: expanded (Advanced) state', async ({ page }) => {
    await advancedToggle(page).click();
    await expect(advancedRegion(page)).toBeVisible();
    await expect(advancedToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('pux3-composition-expanded.png');
  });
});
