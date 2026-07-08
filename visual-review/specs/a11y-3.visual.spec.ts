import { test, expect, Page, Locator } from '@playwright/test';

/**
 * A11Y-3 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-3.spec.ts: the two screenshot
 * assertions — the labeled Sources YAML field, and the labeled Questions
 * export-label rows — plus the minimal duplicated setup they need (the bootstrap
 * /api stubs and the app-boot + stage/sub navigation helpers). The
 * functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED: the Vite dev server serves the real SPA; every /api/** is
 * intercepted with page.route(), so no FastAPI backend is required.
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

// Two questions so per-row export-label inputs can be disambiguated by name.
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
  // Catch-all FIRST so the specific routes below win (Playwright matches routes in
  // REVERSE registration order — last registered wins).
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

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

// Navigate the primary + secondary nav by clicking the data-tab / sub-tab labels.
async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

// ---------------------------------------------------------------------------------------
// Sources — YAML textarea
// ---------------------------------------------------------------------------------------
test.describe('A11Y-3 — Sources YAML textarea has a programmatic label', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await gotoStage(page, 'extract');
    await gotoSub(page, 'Connection');
    // Reveal the YAML editor (default view is the form).
    await page.getByRole('button', { name: /YAML/ }).click();
  });

  test('visual baseline: labeled Sources YAML field', async ({ page }) => {
    const card = page.locator('.src-card');
    await expect(card.locator('textarea')).toBeVisible();
    await expect(card).toHaveScreenshot('a11y3-sources-yaml-field.png');
  });
});

// ---------------------------------------------------------------------------------------
// Questions — per-row export-label inputs
// ---------------------------------------------------------------------------------------
test.describe('A11Y-3 — Questions per-row export-label inputs are labeled + row-disambiguated', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await gotoStage(page, 'transform');
    await gotoSub(page, 'Questions');
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
  });

  test('visual baseline: labeled Questions export-label rows', async ({ page }) => {
    const table = page.locator('table.q-table, .q-table').first();
    await expect(table).toBeVisible();
    await expect(table).toHaveScreenshot('a11y3-questions-export-rows.png');
  });
});
