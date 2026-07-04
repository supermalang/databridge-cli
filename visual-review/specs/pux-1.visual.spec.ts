import { test, expect, Page } from '@playwright/test';

/**
 * PUX-1 — Plain-language relabeling of data-engineering vocabulary.
 *
 * Visual half of `frontend/tests/e2e/pux-1.spec.ts` (VIS-11 split): the
 * functional/AC assertions stay there; this file carries ONLY the extracted
 * visual baselines — verbatim bodies + the minimal shared setup they need —
 * run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * AC 5: visual baselines of the relabeled Home cards and the relabeled
 * Questions row, one per viewport.
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
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region of residence', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
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
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
}

async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.home-card').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string | RegExp) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

const FORBIDDEN_THIRD_CARD = [/\bmodel\b/i, /virtual tables?/i, /joins?\s+and\s+aggregates?/i];

test.describe('PUX-1 — visual baseline of the relabeled Home stage cards', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
  });

  test('visual baseline of the relabeled Home stage cards', async ({ page }) => {
    const third = page.locator('.home-card').nth(2);
    const text = ((await third.innerText()) || '').trim();
    for (const pattern of FORBIDDEN_THIRD_CARD) {
      expect(text, 'Home cards must be relabeled before the baseline is captured').not.toMatch(pattern);
    }
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux1-home-stage-cards.png');
  });
});

test.describe('PUX-1 — visual baseline of the relabeled Questions row', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await gotoStage(page, 'transform');
    await gotoSub(page, /questions/i);
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
  });

  test('visual baseline of the relabeled Questions row', async ({ page }) => {
    const table = page.locator('.q-table').first();
    await expect(table).toBeVisible();
    const tableText = ((await table.innerText()) || '').trim();
    expect(tableText, 'Questions field labels must be relabeled before the baseline is captured')
      .not.toMatch(/export[\s_]?label|kobo_key/i);
    await expect(table).toHaveScreenshot('pux1-questions-row.png');
  });
});
