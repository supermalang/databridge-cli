import { test, expect, Page } from '@playwright/test';

/**
 * XTF-27 — Express Fill: bullet_list render type for column-value lists.
 *
 * Acceptance criterion covered here:
 *   "bullet_list appears as a selectable type in the Composition tab's chart
 *    type dropdown."
 *
 * The Composition surface (Analyze → "Charts & indicators",
 * `frontend/src/pages/Composition.jsx`) lets a user add a chart via the
 * "+ Add chart" control, which opens a modal with a "Chart type" <select>
 * populated from the CHART_TYPES list. `bullet_list` must be one of the
 * selectable <option> values.
 *
 * NETWORK-MOCKED: Vite serves the real SPA; every /api/** call is
 * intercepted with page.route(), so no FastAPI backend is required. Same
 * harness pattern as composition-progressive.spec.ts.
 *
 * RED-FIRST: `bullet_list` is not in the current CHART_TYPES list in
 * Composition.jsx, so the "option is present" assertions below are expected
 * to fail until XTF-27 ships.
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

test.describe('XTF-27 — bullet_list chart type', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('AC3: bullet_list is a selectable option in the chart type dropdown', async ({ page }) => {
    const chartsCard = page.locator('.comp-card', {
      has: page.locator('.comp-card__title', { hasText: 'Charts' }),
    });
    const addChart = chartsCard.getByRole('button', { name: /add chart/i });
    await expect(addChart).toBeVisible();
    await addChart.click();

    const modal = page.locator('.modal[role="dialog"]');
    await expect(modal).toBeVisible();

    const typeSelect = modal.getByRole('combobox', { name: /chart type/i });
    await expect(typeSelect, 'Composition modal must expose a "Chart type" dropdown').toBeVisible();

    const option = typeSelect.locator('option[value="bullet_list"]');
    await expect(
      option,
      'bullet_list must be a selectable <option> in the Chart type dropdown',
    ).toHaveCount(1);

    // It must actually be selectable (not disabled) and settable via the select.
    await typeSelect.selectOption('bullet_list');
    await expect(typeSelect).toHaveValue('bullet_list');
  });

  // ── Visual baseline (per-viewport via the project config) ─────────────────
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
    // Guard against a vacuous baseline — bullet_list must actually be selectable
    // before we snapshot the modal.
    await typeSelect.selectOption('bullet_list');
    await expect(typeSelect).toHaveValue('bullet_list');

    await expect(modal).toHaveScreenshot('xtf27-composition-bullet-list-modal.png');
  });
});
