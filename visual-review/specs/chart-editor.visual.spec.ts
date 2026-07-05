import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-11/12/13/14 — Inline live preview in the chart editor modal.
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/chart-editor.spec.ts.
 * Minimal duplicated setup (bootstrap stub + navigation + editor-modal helpers)
 * needed to reach the six captured states: the base editor with live preview, the
 * dimmed re-fetch state, the flagged Columns field, and the mobile/tablet/desktop
 * preview-position states.
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
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

let previewCallCount = 0;
let previewShouldFail = false;

async function stubBootstrap(page: Page) {
  previewCallCount = 0;
  previewShouldFail = false;

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

  await page.route('**/api/charts/preview', async (r) => {
    previewCallCount += 1;
    if (previewShouldFail) {
      await r.fulfill({ status: 500, json: { detail: 'Could not render chart preview' } });
      return;
    }
    await r.fulfill({ json: { image: Buffer.from(`fake-png-${previewCallCount}`).toString('base64') } });
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
const previewPane = (page: Page): Locator => page.getByTestId('chart-editor-preview');
const previewLoading = (page: Page): Locator => page.getByTestId('chart-editor-preview-loading');
const previewError = (page: Page): Locator => page.getByTestId('chart-editor-preview-error');
const previewImage = (page: Page): Locator => previewPane(page).locator('img');

async function openEditChartModal(page: Page) {
  const card = chartsCard(page);
  await card.locator('.icon-btn[title="Edit"]').first().click();
  await expect(editorDialog(page)).toBeVisible();
}

async function openAddChartModal(page: Page) {
  const card = chartsCard(page);
  await card.getByRole('button', { name: /add chart/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

const columnsFieldRow = (page: Page): Locator =>
  editorDialog(page)
    .locator('div', { has: page.getByLabel('Chart columns') })
    .filter({ has: page.getByLabel('Chart columns') })
    .last();

const columnsFieldError = (page: Page): Locator =>
  columnsFieldRow(page).getByRole('alert');

async function addColumn(page: Page, col: string) {
  const input = editorDialog(page).getByLabel('Chart columns');
  await input.click();
  await input.fill(col);
  await input.press('Enter');
}

async function setChartType(page: Page, type: string) {
  await editorDialog(page).getByLabel('Chart type').selectOption(type);
}

test.describe('PUX-11 — chart editor live preview visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor modal with live preview', async ({ page }) => {
    await openEditChartModal(page);
    await expect(previewPane(page)).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal.png');
  });
});

test.describe('PUX-12 — chart editor preview dimmed re-fetch visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor preview in the dimmed re-fetch state', async ({ page }) => {
    await page.route('**/api/charts/preview', async (r) => {
      const held = (previewCallCount += 1) > 1;
      if (held) await new Promise((resolve) => setTimeout(resolve, 2000));
      await r.fulfill({ json: { image: Buffer.from('fake-png-stable').toString('base64') } });
    });

    await openEditChartModal(page);
    await expect(previewImage(page)).toBeVisible({ timeout: 5000 });

    const titleInput = editorDialog(page)
      .locator('input[name="title"], input#title, input[value="Age distribution"]')
      .first();
    await titleInput.fill('Age distribution (re-fetch)');

    await expect(previewLoading(page)).toBeVisible({ timeout: 3000 });
    await expect(previewImage(page)).toBeVisible();

    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-refetch.png');
  });
});

test.describe('PUX-13 — chart editor field-error visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor modal with the Columns field flagged', async ({ page }) => {
    previewShouldFail = true;
    await openAddChartModal(page);
    await setChartType(page, 'histogram');
    await addColumn(page, 'region');
    await expect(previewError(page)).toBeVisible();
    await expect(columnsFieldError(page)).toBeVisible({ timeout: 3000 });
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-field-error.png');
  });
});

test.describe('PUX-14 — live preview reachable above the fold visual baselines', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor modal preview position — mobile', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 768, 'mobile-only baseline');
    await openEditChartModal(page);
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-mobile-preview-position.png');
  });

  test('visual: chart editor modal preview position — tablet', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < 768 || viewport.width >= 1200, 'tablet-only baseline');
    await openEditChartModal(page);
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-tablet-preview-position.png');
  });

  test('visual: chart editor modal preview position — desktop', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < 1200, 'desktop-only baseline');
    await openEditChartModal(page);
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-desktop-preview-position.png');
  });
});

test.describe('MNT-21 — bullet_list chart preview visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  test('visual: chart editor preview — bullet_list', async ({ page }) => {
    await page.route('**/api/charts/preview', async (r) => {
      await r.fulfill({ json: { text: '• Alpha\n• Beta\n• Gamma' } });
    });

    await openAddChartModal(page);
    await setChartType(page, 'bullet_list');
    await addColumn(page, 'region');
    await expect(previewPane(page)).toContainText('Alpha');
    // Let the debounced preview settle so the baseline is deterministic.
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal-bullet-list.png');
  });
});
