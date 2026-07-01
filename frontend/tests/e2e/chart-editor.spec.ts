import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-11 — Inline live preview in the chart editor modal.
 *
 * Today the chart editor (`ChartModal`) and the chart preview are two separate
 * modals — users configure blind, then close and open a second modal to see
 * the result. This card merges them: the chart editor modal gains a live
 * preview pane (right column on desktop, below fields on mobile) that calls
 * `/api/charts/preview` with the current form state, debounced ~600ms, and
 * re-renders the chart image as the user types. The standalone preview modal
 * (and its "Preview" trigger button) is removed — all chart interaction goes
 * through the unified editor.
 *
 * NETWORK-MOCKED: Vite serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. Same harness pattern as
 * composition-progressive.spec.ts / a11y-3.spec.ts.
 *
 * RED-FIRST: derived from the PUX-11 Acceptance criteria, NOT the current
 * implementation. Today: the editor modal has no preview pane at all, a
 * separate "Preview" ghost button + separate preview Modal exist, and there is
 * no responsive two-column/stacked layout for a preview pane (because there is
 * no preview pane). Every assertion below is expected to fail until PUX-11
 * ships.
 *
 * ── Selector contract for the implementer ──────────────────────────────────
 * Match these so the spec turns green without edits to the spec:
 *   - The chart editor dialog keeps using `.modal[role="dialog"]` (the shared
 *     `Modal` component) — no change there.
 *   - Live preview pane (inside the SAME dialog as the editor's form fields):
 *       data-testid="chart-editor-preview"
 *   - Preview image: an <img> inside the preview pane (`chart-editor-preview
 *     img`) whose `src` changes when the underlying chart config changes.
 *   - Loading indicator while a preview request is in flight:
 *       data-testid="chart-editor-preview-loading"
 *   - Inline error message on a failed preview request (legible text, not a
 *     blank pane):
 *       data-testid="chart-editor-preview-error"
 *   - The standalone "Preview" button (ghost button on each chart row, i18n
 *     key `composition.preview`) and the separate preview `Modal` (i18n key
 *     `composition.previewTitle`) are REMOVED from the Composition tab.
 *   - Responsive layout: the editor dialog carries
 *       data-testid="chart-editor-layout"
 *     with `data-orientation="row"` at tablet/desktop widths (two columns) and
 *     `data-orientation="column"` at mobile width (stacked).
 * ───────────────────────────────────────────────────────────────────────────
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

  // Catch-all FIRST so the specific routes below win (Playwright matches
  // routes in REVERSE registration order — last registered wins).
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

  // The endpoint under test — the live preview pane inside the chart editor.
  await page.route('**/api/charts/preview', async (r) => {
    previewCallCount += 1;
    if (previewShouldFail) {
      await r.fulfill({ status: 500, json: { detail: 'Could not render chart preview' } });
      return;
    }
    // Return a distinguishable 1x1 PNG payload per call so a changed src is observable.
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

test.describe('PUX-11 — inline live preview in the chart editor modal', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — opening the editor (edit) shows the preview pane alongside the fields.
  test('AC1: opening the chart editor (edit) shows the preview pane inside the same dialog', async ({ page }) => {
    await openEditChartModal(page);
    const dialog = editorDialog(page);
    const pane = previewPane(page);
    await expect(pane, 'preview pane must be visible when the editor opens').toBeVisible();
    // It must live INSIDE the editor dialog, not a second dialog.
    await expect(dialog.locator('[data-testid="chart-editor-preview"]')).toHaveCount(1);
    await expect(page.locator('.modal[role="dialog"]')).toHaveCount(1, 'only one dialog should be open — no separate preview modal');
  });

  // AC1b — opening the editor via "Add chart" also shows the preview pane.
  test('AC1b: opening the chart editor (add) shows the preview pane', async ({ page }) => {
    const card = chartsCard(page);
    await card.getByRole('button', { name: /add chart/i }).click();
    await expect(editorDialog(page)).toBeVisible();
    await expect(previewPane(page), 'preview pane must also appear when adding a new chart').toBeVisible();
  });

  // AC2 — the preview re-fetches within ~600ms of a field change, no separate button click.
  test('AC2: changing the chart title re-fetches the preview within ~600ms without an extra click', async ({ page }) => {
    await openEditChartModal(page);
    await expect(previewImage(page)).toBeVisible({ timeout: 5000 });
    const srcBefore = await previewImage(page).getAttribute('src');
    const callsBefore = previewCallCount;

    const titleInput = editorDialog(page).locator('input[name="title"], input#title, input[value="Age distribution"]').first();
    await titleInput.fill('Age distribution (updated)');

    // Do NOT click any "Preview" button — the update must happen automatically.
    await expect(async () => {
      expect(previewCallCount).toBeGreaterThan(callsBefore);
    }).toPass({ timeout: 2000 });

    await expect(async () => {
      const srcAfter = await previewImage(page).getAttribute('src');
      expect(srcAfter).not.toBe(srcBefore);
    }).toPass({ timeout: 2000 });
  });

  // AC3 — loading state shown while the preview request is in flight.
  test('AC3: a skeleton/spinner is shown while the preview is loading', async ({ page }) => {
    // Delay the preview response so the loading state is observable.
    await page.route('**/api/charts/preview', async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await r.fulfill({ json: { image: Buffer.from('fake-png-delayed').toString('base64') } });
    });
    await openEditChartModal(page);
    await expect(previewLoading(page), 'a loading indicator must be shown while the preview request is pending').toBeVisible();
  });

  // AC3b — inline, legible error message on a failed preview request (not a blank pane).
  test('AC3b: a failed preview request shows a legible inline error, not a blank pane', async ({ page }) => {
    previewShouldFail = true;
    await openEditChartModal(page);
    const err = previewError(page);
    await expect(err, 'an inline error message must be shown when the preview request fails').toBeVisible();
    const text = (await err.textContent())?.trim() || '';
    expect(text.length, 'the error message must contain legible text, not be empty').toBeGreaterThan(0);
    // The pane must not be blank/empty while erroring — no successful image lingers.
    await expect(previewImage(page)).toHaveCount(0);
  });

  // AC4 — the standalone "Preview" button and separate preview modal are removed.
  test('AC4: the standalone Preview button and separate preview modal no longer exist', async ({ page }) => {
    const card = chartsCard(page);
    await expect(
      card.getByRole('button', { name: /^preview$/i }),
      'a standalone "Preview" trigger button must no longer exist on chart rows',
    ).toHaveCount(0);

    // Clicking Edit must not surface a second, separate preview dialog either.
    await openEditChartModal(page);
    await expect(page.locator('.modal[role="dialog"]')).toHaveCount(1);
  });

  // AC5 — responsive layout: two-column at tablet/desktop, stacked at mobile.
  test('AC5: layout is two-column at tablet/desktop and stacked at mobile', async ({ page }) => {
    await openEditChartModal(page);
    const layout = page.getByTestId('chart-editor-layout');
    await expect(layout).toBeVisible();

    const viewport = page.viewportSize();
    const orientation = await layout.getAttribute('data-orientation');
    if (viewport && viewport.width <= 480) {
      expect(orientation, 'mobile width must render a single (stacked) column').toBe('column');
    } else {
      expect(orientation, 'tablet/desktop widths must render a two-column layout').toBe('row');
    }
  });

  // AC6 — existing Composition tab behavior (Add chart flow) is unaffected.
  test('AC6: existing "+ Add chart" flow still works (no regression)', async ({ page }) => {
    const card = chartsCard(page);
    const addChart = card.getByRole('button', { name: /add chart/i });
    await expect(addChart).toBeVisible();
    await addChart.click();
    await expect(editorDialog(page)).toBeVisible();
  });

  // ── Visual baseline (per-viewport via the project config) ─────────────────
  test('visual: chart editor modal with live preview', async ({ page }) => {
    await openEditChartModal(page);
    await expect(previewPane(page)).toBeVisible();
    // Let the debounced preview settle so the baseline is deterministic.
    await page.waitForTimeout(700);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('chart-editor-modal.png');
  });
});
