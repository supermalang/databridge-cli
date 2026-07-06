import { test, expect, Page, Locator } from '@playwright/test';

/**
 * MNT-25 — Composition UI migration to a first-class Lists section.
 *
 * Visual half of `frontend/tests/e2e/composition-bullet-list.spec.ts` (VIS-11 split):
 * the functional/AC assertions stay there; this file carries ONLY the extracted visual
 * baselines — verbatim bodies + the minimal shared setup they need — run under the
 * dedicated Tier 1 visual config (`visual-review/playwright.visual.config.ts`).
 *
 * This replaces the old XTF-27 "chart type dropdown showing bullet_list" baseline
 * (`xtf27-composition-bullet-list-modal.png`, now retired along with bullet_list's
 * removal from the Chart type dropdown) with fresh baselines of the new Lists UI: the
 * Advanced region with the Lists card revealed, and the Add-list modal. A human must
 * approve these as new baselines (per MNT-25's card).
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
  'tables:',
  '  - name: by_region',
  '    questions: [region]',
  'lists:',
  '  - name: success_stories',
  '    title: Success stories',
  '    question: Story',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
    { kobo_key: 'group_a/story', label: 'Success story', export_label: 'Story', type: 'text', category: 'qualitative' },
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

const advancedToggle = (page: Page): Locator => page.getByTestId('composition-advanced-toggle');
const advancedRegion = (page: Page): Locator => page.getByTestId('composition-advanced');
const listsCard = (page: Page): Locator =>
  page.locator('.comp-card', { has: page.locator('.comp-card__title', { hasText: 'Lists' }) });

test.describe('MNT-25 — visual baseline of the Lists card (Advanced, revealed)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: Advanced region expanded showing the Lists card alongside Tables', async ({ page }) => {
    await advancedToggle(page).click();
    await expect(advancedRegion(page)).toBeVisible();
    await expect(listsCard(page)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('mnt25-composition-lists-advanced.png');
  });
});

test.describe('MNT-25 — visual baseline of the Add-list modal', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
    await advancedToggle(page).click();
    await expect(listsCard(page)).toBeVisible();
  });

  test('visual: Add-list modal with name/title/question/filter fields', async ({ page }) => {
    await listsCard(page).getByRole('button', { name: /add list/i }).click();
    const modal = page.locator('.modal[role="dialog"]');
    await expect(modal).toBeVisible();
    await modal.getByLabel('List name').fill('partner_list');
    await modal.getByLabel('List title').fill('Partner organizations');
    await modal.getByLabel('List question').fill('Story');
    await expect(modal).toHaveScreenshot('mnt25-composition-list-modal.png');
  });
});
