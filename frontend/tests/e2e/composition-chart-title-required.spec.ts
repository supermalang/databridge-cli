import { test, expect, Page, Locator } from '@playwright/test';

/**
 * MNT-15 — Fix: manually-created charts can ship with a blank title.
 *
 * Today the Composition tab's ChartModal validates only `name` as required;
 * `title` has no such check, so a chart hand-created with the Title field left
 * blank saves `title: ""` into the config and ships a blank chart header.
 *
 * This spec drives the user flow from the MNT-15 Acceptance criteria:
 *   - Submitting the ChartModal with an empty Title field shows a
 *     required-field validation error (same pattern as the existing `name`
 *     check) and does NOT call onSave — i.e. the modal stays open.
 *   - A non-empty Title is accepted (the guard blocks only the blank case).
 *
 * RED-FIRST: derived from the MNT-15 Acceptance criteria, NOT the current
 * implementation. Today the Title field has no required guard and no
 * `aria-invalid`/`role="alert"` error is set for it, so clicking Save with a
 * blank Title closes the modal (calls onSave). Every assertion below is
 * expected to fail until the Title-required guard ships.
 *
 * NETWORK-MOCKED: same harness pattern as chart-editor.spec.ts — Vite serves
 * the real SPA; every /api/** is intercepted with page.route(), so no FastAPI
 * backend is required.
 *
 * ── Selector contract for the implementer ──────────────────────────────────
 *   - The chart editor dialog uses `.modal[role="dialog"]` (shared Modal).
 *   - Name field:  aria-label = "Chart name" (i18n composition.chartName).
 *   - Title field: input#title / input[name="title"] (aria-label "Chart title").
 *   - Save button: the primary footer button (`.modal-body`'s footer .btn-primary).
 *   - The Title-required error must render the SAME way the Name error does:
 *     via ModalField's FieldError (`role="alert"`) and by marking the Title
 *     input `aria-invalid="true"` (i.e. wire `fe.fieldProps('title')` +
 *     `error={fe.errorFor('title')}` exactly as the `name` field already is).
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
  'charts: []',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (Playwright matches routes
  // in REVERSE registration order — last registered wins).
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
  // Live preview pane endpoint (PUX-11) — return a stable fake PNG so the modal renders.
  await page.route('**/api/charts/preview', (r) =>
    r.fulfill({ json: { image: Buffer.from('fake-png').toString('base64') } }));
  // Saving config back — accept it so a successful save resolves.
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
const titleInput = (page: Page): Locator =>
  editorDialog(page).locator('input#title, input[name="title"]').first();
const saveButton = (page: Page): Locator =>
  editorDialog(page).locator('.btn-primary');

async function openAddChartModal(page: Page) {
  const card = chartsCard(page);
  await card.getByRole('button', { name: /add chart/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

test.describe('MNT-15 — Title is required in the chart editor modal', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC — submitting with a blank Title shows a required-field validation error
  // (same pattern as the existing `name` check) and does not call onSave.
  test('AC: saving with a Name but a blank Title shows a required error and keeps the modal open', async ({ page }) => {
    await openAddChartModal(page);

    // Provide a valid Name so the *name* guard passes — isolate the Title guard.
    await nameInput(page).fill('region_overview');
    // Leave Title blank.
    await expect(titleInput(page)).toHaveValue('');

    await saveButton(page).click();

    // The modal must stay open (onSave not called → parent does not close it).
    await expect(
      editorDialog(page),
      'the chart editor must stay open when Title is blank (onSave must not fire)',
    ).toBeVisible();

    // A required-field validation error must be shown, the same way the Name
    // error surfaces: via role="alert" text.
    await expect(
      editorDialog(page).locator('[role="alert"]'),
      'a required-field validation error must be shown when Title is left blank',
    ).toHaveCount(1);
    const errText = (await editorDialog(page).locator('[role="alert"]').first().textContent())?.trim() || '';
    expect(errText.length, 'the Title-required error must contain legible text, not be empty').toBeGreaterThan(0);

    // Same pattern as the Name field: the invalid Title input is marked aria-invalid.
    await expect(
      titleInput(page),
      'the Title input must be marked aria-invalid="true" when blank, mirroring the Name field',
    ).toHaveAttribute('aria-invalid', 'true');
  });

  // AC — a non-empty Title is accepted (the guard blocks ONLY the blank case).
  test('AC: saving with both Name and a non-empty Title closes the modal (onSave fires)', async ({ page }) => {
    await openAddChartModal(page);

    await nameInput(page).fill('region_overview');
    await titleInput(page).fill('Respondents by Region');

    await saveButton(page).click();

    // With a real Title, onSave fires and the parent closes the modal — no
    // required error is shown. Proves the guard is scoped to the blank case only.
    await expect(
      editorDialog(page),
      'the chart editor must close when both Name and Title are provided',
    ).toHaveCount(0);
  });

  // ── Visual baseline (per-viewport via the project config) ─────────────────
  // Captures the modal in its Title-required error state at mobile/tablet/desktop.
  test('visual: chart editor modal with the Title-required error', async ({ page }) => {
    await openAddChartModal(page);
    await nameInput(page).fill('region_overview');
    await saveButton(page).click();
    await expect(editorDialog(page)).toBeVisible();
    await expect(editorDialog(page).locator('[role="alert"]')).toHaveCount(1);
    await expect(page.locator('.modal[role="dialog"]')).toHaveScreenshot('composition-chart-title-required.png');
  });
});
