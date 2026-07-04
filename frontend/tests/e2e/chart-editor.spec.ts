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

  // Visual baseline of the chart editor modal with live preview: see
  // visual-review/specs/chart-editor.visual.spec.ts (VIS-12).
});

/**
 * PUX-12 — Chart editor preview: keep last image visible during re-fetch.
 *
 * Follow-up from PUX-11. Today `useChartPreview` unmounts the last successful
 * image and swaps in the loading skeleton on every debounced re-fetch, so a
 * previously-correct chart vanishes on every keystroke-triggered update. This
 * card requires the last-good image to STAY in the DOM (dimmed / corner
 * spinner) while a re-fetch is in flight, and only the very first load (no
 * prior image) to blank to the skeleton.
 *
 * RED-FIRST: derived from the PUX-12 Acceptance criteria, NOT the current
 * implementation. Expected to fail until the persist-last-image behaviour ships.
 *
 * Reuses the PUX-11 selector contract:
 *   - preview pane:      data-testid="chart-editor-preview"
 *   - preview <img>:     `chart-editor-preview img`
 *   - loading skeleton:  data-testid="chart-editor-preview-loading"
 */
test.describe('PUX-12 — chart editor preview persists last image during re-fetch', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1/AC2 — a debounced re-fetch keeps the last successful <img> in the DOM
  // (not replaced by the skeleton testid) while the request is in flight.
  test('AC1: previously-rendered preview image remains in the DOM during a re-fetch (not the skeleton)', async ({ page }) => {
    // Delay preview responses so the in-flight window is observable, but keep
    // the FIRST response fast enough that an initial image is rendered.
    let previewHits = 0;
    await page.route('**/api/charts/preview', async (r) => {
      previewHits += 1;
      // First call resolves quickly to establish a last-good image; later
      // (re-fetch) calls are held open so we can inspect the in-flight state.
      const delay = previewHits === 1 ? 0 : 1500;
      await new Promise((resolve) => setTimeout(resolve, delay));
      await r.fulfill({ json: { image: Buffer.from(`fake-png-${previewHits}`).toString('base64') } });
    });

    await openEditChartModal(page);

    // Establish the first successful preview image.
    await expect(previewImage(page)).toBeVisible({ timeout: 5000 });
    const srcBefore = await previewImage(page).getAttribute('src');
    expect(srcBefore, 'precondition: an initial preview image should be rendered').toBeTruthy();

    // Edit a field twice in quick succession to trigger a debounced re-fetch.
    const titleInput = editorDialog(page)
      .locator('input[name="title"], input#title, input[value="Age distribution"]')
      .first();
    await titleInput.fill('Age distribution v2');
    await titleInput.fill('Age distribution v3');

    // While the re-fetch is in flight, the last-good <img> must still be in the
    // DOM (dimmed / corner spinner), NOT unmounted and replaced by the skeleton.
    await expect(async () => {
      expect(previewHits).toBeGreaterThan(1);
    }).toPass({ timeout: 3000 });

    await expect(
      previewImage(page),
      'the last successful preview image must remain in the DOM during the re-fetch, not be unmounted',
    ).toBeVisible();
    const srcDuring = await previewImage(page).getAttribute('src');
    expect(srcDuring, 'the persisted image should still be the last-good src while re-fetching').toBe(srcBefore);
  });

  // Visual baseline of the dimmed / in-progress re-fetch state: see
  // visual-review/specs/chart-editor.visual.spec.ts (VIS-12).
});

/**
 * PUX-13 — Chart editor: link preview errors back to the offending field.
 *
 * Follow-up from PUX-11's /impeccable critique (finding 3 of 4). When
 * `/api/charts/preview` fails, the generic backend message in the preview pane
 * forces the user to mentally diff their Name/Title/Type/Columns/Options
 * against the failure to guess what to fix ("Memory Bridge" cognitive load).
 *
 * `CHART_REQS` already encodes each chart type's column requirement client-side,
 * so a type/column-count (or type/column-kind) mismatch is knowable WITHOUT the
 * backend round-trip. This card requires: when the preview error is such a
 * client-side-knowable mismatch, the Columns ModalField row is visually flagged
 * using the same rose error pattern the filter field already uses (in addition
 * to the generic pane message). When the error is a genuine backend/data error
 * NOT attributable to any client-side rule, ONLY the generic pane message shows
 * and no field is falsely flagged.
 *
 * RED-FIRST: derived from the PUX-13 Acceptance criteria, NOT the current
 * implementation. Today the Columns field carries no error flag on a preview
 * failure — only the generic `chart-editor-preview-error` pane message appears.
 * Every field-flag assertion below is expected to fail until PUX-13 ships.
 *
 * ── Selector contract for the implementer ──────────────────────────────────
 * Reuse the existing filter-error rose pattern: the Columns `ModalField` is
 * flagged by passing it an `error` (rendered as the shared `FieldError`,
 * `role="alert"`, rose color) sitting inside the SAME field row as the Chart
 * columns picker. So the test locates the Columns field row and asserts a
 * `role="alert"` error node appears inside it. Concretely, the implementer must
 * satisfy:
 *   - The Columns ModalField row (the one containing the picker with
 *     aria-label "Chart columns") gains a `role="alert"` error message when the
 *     preview failure is a CHART_REQS type/column mismatch.
 *   - No other field row gains such a flag, and no field is flagged when the
 *     failure is not client-side attributable.
 *   - The generic pane message (`chart-editor-preview-error`) still shows in
 *     both cases (the field flag is IN ADDITION to it).
 * ───────────────────────────────────────────────────────────────────────────
 */

// The ModalField row that wraps the Chart columns picker. We anchor on the
// stable `aria-label` of the picker input, then walk up to its field row.
const columnsFieldRow = (page: Page): Locator =>
  editorDialog(page)
    .locator('div', { has: page.getByLabel('Chart columns') })
    .filter({ has: page.getByLabel('Chart columns') })
    .last();

// Any field-level error flag inside the Columns row (the shared FieldError,
// role="alert"). This is the "rose-border pattern used for filter errors".
const columnsFieldError = (page: Page): Locator =>
  columnsFieldRow(page).getByRole('alert');

// Add a column to the (multi-select) Chart columns picker by typing + Enter,
// which commits it as a chip (matches the ColumnPicker commit-on-Enter path).
async function addColumn(page: Page, col: string) {
  const input = editorDialog(page).getByLabel('Chart columns');
  await input.click();
  await input.fill(col);
  await input.press('Enter');
}

async function setChartType(page: Page, type: string) {
  await editorDialog(page).getByLabel('Chart type').selectOption(type);
}

async function openAddChartModal(page: Page) {
  const card = chartsCard(page);
  await card.getByRole('button', { name: /add chart/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

test.describe('PUX-13 — preview errors are linked back to the offending field', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — a CHART_REQS type/column mismatch (histogram needs 1 numeric column,
  // a text/categorical column chosen instead) that trips a preview error must
  // visually flag the Columns field row, in addition to the generic pane error.
  test('AC1: a client-side-knowable type/column mismatch flags the Columns field', async ({ page }) => {
    // The preview endpoint fails for this (mismatched) config.
    previewShouldFail = true;

    await openAddChartModal(page);
    await setChartType(page, 'histogram');           // needs 1 numeric column
    await addColumn(page, 'region');                 // 'region' is a text/categorical column

    // The generic pane error still surfaces …
    await expect(previewError(page), 'the generic pane error must still be shown').toBeVisible();

    // … AND the Columns field row itself is flagged (rose FieldError, role=alert).
    await expect(
      columnsFieldError(page),
      'the Columns field must be visually flagged when the failure is a known CHART_REQS mismatch',
    ).toBeVisible({ timeout: 3000 });
    const flagText = (await columnsFieldError(page).first().textContent())?.trim() || '';
    expect(flagText.length, 'the field flag must carry a legible message, not be empty').toBeGreaterThan(0);
  });

  // AC2 — a genuine backend/data error that is NOT attributable to any
  // client-side CHART_REQS rule (config is client-side-valid: histogram + a
  // numeric column) must show ONLY the generic pane message; no field flagged.
  test('AC2: a non-CHART_REQS backend error flags no field, only the generic pane message', async ({ page }) => {
    // Stub an unrelated 500 for this otherwise client-side-valid config.
    await page.route('**/api/charts/preview', (r) =>
      r.fulfill({ status: 500, json: { detail: 'Upstream data source timed out while rendering' } }));

    await openAddChartModal(page);
    await setChartType(page, 'histogram');           // needs 1 numeric column …
    await addColumn(page, 'age');                    // … 'age' IS numeric → client-side valid

    // Generic pane error shows.
    await expect(previewError(page), 'the generic pane error must be shown for a backend error').toBeVisible();

    // But NO field is flagged — the error is not client-side attributable.
    await expect(
      editorDialog(page).getByRole('alert'),
      'no field may be flagged when the failure is not attributable to a known client-side rule',
    ).toHaveCount(0);
  });

  // Visual baseline of the flagged Columns field: see
  // visual-review/specs/chart-editor.visual.spec.ts (VIS-12).
});

/**
 * PUX-14 — Chart editor: surface the live preview above the fold on mobile.
 *
 * Follow-up from PUX-11's `/impeccable critique` (finding 4 of 4). On the
 * 390px stacked layout, the live preview (`data-testid="chart-editor-preview"`,
 * PUX-11) sits below all 4 form fields (Name/Title/Type/Columns/Options) — a
 * user must scroll past the whole form to see the result of an edit they just
 * made. This card requires that on mobile the user can see or reach the
 * preview (or a compact status indicator for it) without scrolling past the
 * whole form, WITHOUT regressing the existing two-column tablet/desktop
 * layout (`data-orientation="row"`, PUX-11 AC5).
 *
 * RED-FIRST: derived from the PUX-14 Acceptance criteria, NOT the current
 * implementation. Today, at mobile width, the stacked column places the
 * preview pane after all form fields, well below the initial viewport height
 * — every "reachable without scrolling past the whole form" assertion below
 * is expected to fail until PUX-14 ships.
 *
 * The AC allows either fix strategy (reorder the pane higher, or add a
 * tappable status indicator near the top that scrolls the pane into view), so
 * the test tolerates either: it looks first for a compact status indicator
 * (`data-testid="chart-editor-preview-status"`) and, if present, taps it and
 * asserts the preview pane scrolls into view; if absent, it asserts the
 * preview pane itself already sits at or above the bottom of the visible
 * viewport before any scrolling, i.e. above/at the fold.
 */

// A compact status indicator near the top of the stacked mobile layout that,
// on tap, scrolls the (reordered-lower or not) preview pane into view. This
// is OPTIONAL per the AC — the alternative fix is reordering the pane itself
// higher in the DOM/visual stack so no indicator is needed.
const previewStatusIndicator = (page: Page): Locator => page.getByTestId('chart-editor-preview-status');

test.describe('PUX-14 — live preview reachable above the fold on mobile', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — on mobile, the preview (or its status indicator) must be reachable
  // without scrolling past all 4 form fields (Name/Title/Type/Columns/Options).
  test('AC1: on mobile, the live preview is visible or reachable without scrolling past the whole form', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width >= 768, 'mobile-only assertion (< 768px)');

    await openEditChartModal(page);
    const dialog = editorDialog(page);
    await expect(dialog).toBeVisible();

    const indicator = previewStatusIndicator(page);
    const hasIndicator = (await indicator.count()) > 0;

    if (hasIndicator) {
      // Strategy B: a compact status indicator near the top. It must itself be
      // within the initial viewport (no scrolling needed to find/tap it) …
      await expect(indicator, 'the preview status indicator must be visible without scrolling').toBeVisible();
      const indicatorBox = await indicator.boundingBox();
      expect(indicatorBox, 'preview status indicator must have a bounding box').not.toBeNull();
      expect(
        indicatorBox!.y,
        'the preview status indicator must be within the initial viewport (above the fold)',
      ).toBeLessThanOrEqual(viewport!.height);

      // … and tapping it must scroll the preview pane into view.
      await indicator.click();
      await expect(previewPane(page)).toBeVisible();
      await expect(async () => {
        const paneBox = await previewPane(page).boundingBox();
        expect(paneBox, 'preview pane must have a bounding box after tapping the indicator').not.toBeNull();
        // "Scrolled into view" = the pane's box now intersects the viewport band.
        expect(paneBox!.y, 'tapping the indicator must scroll the preview pane into the viewport').toBeLessThan(viewport!.height);
        expect(paneBox!.y + paneBox!.height, 'the scrolled-to pane must not be entirely above the viewport').toBeGreaterThan(0);
      }).toPass({ timeout: 2000 });
    } else {
      // Strategy A: the pane itself is reordered higher in the stack, so
      // — WITHOUT scrolling the modal's own scroll container — the pane must
      // already be substantially visible (not merely clipped by a sliver).
      // Measure how much of the pane's height falls inside the scrollable
      // container's UNSCROLLED client area (the "fold" a user sees on open).
      await expect(previewPane(page), 'without a status indicator, the preview pane itself must be present').toBeVisible();

      const visibility = await previewPane(page).evaluate((el) => {
        const scrollParent = el.closest('.modal-body') || el.closest('[role="dialog"]') || document.body;
        const parentRect = (scrollParent as Element).getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const visibleTop = Math.max(elRect.top, parentRect.top);
        const visibleBottom = Math.min(elRect.bottom, parentRect.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        return { visibleHeight, elHeight: elRect.height };
      });

      expect(
        visibility.visibleHeight / visibility.elHeight,
        'the preview pane must be reordered so it is substantially (>=90%) visible without scrolling past the form — ' +
          `today it is mostly below the fold (only ${Math.round((visibility.visibleHeight / visibility.elHeight) * 100)}% visible)`,
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  // AC2 — the reordering/indicator must NOT regress the desktop/tablet
  // two-column layout: at those widths, the editor must still render
  // data-orientation="row" (PUX-11 AC5) and the preview pane's left edge must
  // sit to the right of the form fields (a genuine side-by-side column, not a
  // stacked column masquerading as "row").
  test('AC2: desktop/tablet keep the existing two-column layout (no regression)', async ({ page }) => {
    const viewport = page.viewportSize();
    test.skip(!viewport || viewport.width < 768, 'tablet/desktop-only regression guard');

    await openEditChartModal(page);
    const layout = page.getByTestId('chart-editor-layout');
    await expect(layout).toBeVisible();
    await expect(layout, 'tablet/desktop widths must keep the two-column ("row") layout').toHaveAttribute('data-orientation', 'row');

    // The preview pane and a form field (Title input) must sit side-by-side:
    // the pane's horizontal position must not be directly below the field
    // (i.e. this is genuinely a row layout, not a stacked one).
    const titleInput = editorDialog(page).locator('input[name="title"], input#title, input[value="Age distribution"]').first();
    const fieldBox = await titleInput.boundingBox();
    const paneBox = await previewPane(page).boundingBox();
    expect(fieldBox, 'title field must have a bounding box').not.toBeNull();
    expect(paneBox, 'preview pane must have a bounding box').not.toBeNull();
    // Side-by-side: the two boxes' vertical (y) ranges overlap substantially,
    // which would not be true if the pane were stacked below the whole form.
    const verticalOverlap =
      Math.min(fieldBox!.y + fieldBox!.height, paneBox!.y + paneBox!.height) - Math.max(fieldBox!.y, paneBox!.y);
    expect(verticalOverlap, 'preview pane must sit beside the form fields (row layout), not below all of them').toBeGreaterThan(0);
  });

  // Visual baselines (mobile / tablet / desktop preview position): see
  // visual-review/specs/chart-editor.visual.spec.ts (VIS-12).
});

/**
 * MNT-21 — Fix: bullet_list chart preview fails with a generic error.
 *
 * `POST /api/charts/preview` always attempted the matplotlib/image pipeline
 * (`generate_chart` -> `CHART_DISPATCH`) for every chart type, but `bullet_list`
 * is a text-injection render type with no `CHART_DISPATCH` entry (it is
 * special-cased in `builder.py` at report-build time instead). This left the
 * live preview endpoint returning a generic "Chart generation failed" error
 * for `bullet_list`, and even once the backend is fixed to return
 * `{"text": ...}`, the existing `previewImage &&` / `previewPane` render
 * guards in `Composition.jsx` only ever look for an `image` field — a
 * text-only response would render as a silently blank preview pane.
 *
 * RED-FIRST: derived from the MNT-21 Acceptance criteria, NOT the current
 * implementation. `/api/charts/preview` is mocked here to already return the
 * FIXED backend shape (`{"text": ...}`) for a `bullet_list` chart, isolating
 * these tests to the frontend render-branch gap: today the preview pane has
 * no code path that renders a `text` field, so it stays blank and every
 * `toContainText` assertion below is expected to fail until MNT-21 ships.
 */
test.describe('MNT-21 — bullet_list preview renders text', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — a bullet_list preview response ({"text": ...}) renders as visible
  // text content in the live editor preview pane, not a blank pane.
  test('AC1: bullet_list preview renders text content', async ({ page }) => {
    await page.route('**/api/charts/preview', async (r) => {
      await r.fulfill({ json: { text: '• Alpha\n• Beta\n• Gamma' } });
    });

    await openAddChartModal(page);
    await setChartType(page, 'bullet_list');
    await addColumn(page, 'region');

    const pane = previewPane(page);
    await expect(pane, 'the preview pane must be visible for a bullet_list chart').toBeVisible();
    await expect(pane, 'the bullet_list text must render inside the preview pane, not be blank').toContainText('Alpha');
    await expect(pane).toContainText('Beta');
    await expect(pane).toContainText('Gamma');
    // A bullet_list response is text, not an image — no <img> should appear.
    await expect(pane.locator('img'), 'a bullet_list preview must not attempt to render an <img>').toHaveCount(0);
  });

  // AC2/AC5 — regression guard: an ordinary image-producing chart type is
  // unaffected by the new text-rendering branch.
  test('AC2: image-based chart preview is unaffected (no regression)', async ({ page }) => {
    // stubBootstrap's default /api/charts/preview mock returns {image: ...} —
    // unrelated to the bullet_list branch under test.
    await openEditChartModal(page); // default seeded chart ("Age distribution") is type histogram
    await expect(previewImage(page), 'non-bullet_list charts must still render an <img> preview').toBeVisible({ timeout: 5000 });
  });

  // Empty-result guard (ux-review blocker) — build_bullet_list_text can
  // legitimately return "" when the chosen column has zero non-null values or
  // doesn't exist. A successful request with an empty body must surface an
  // explicit "no output" empty state, NOT the idle "Preview appears here"
  // placeholder (which is indistinguishable from "not configured yet").
  test('bullet_list preview with empty result shows an empty state, not the idle placeholder', async ({ page }) => {
    await page.route('**/api/charts/preview', async (r) => {
      await r.fulfill({ json: { text: '' } });
    });

    await openAddChartModal(page);
    await setChartType(page, 'bullet_list');
    await addColumn(page, 'region');

    const pane = previewPane(page);
    // Let the debounced preview fire and settle.
    await expect(pane.getByTestId('chart-editor-preview-empty')).toBeVisible({ timeout: 5000 });
    await expect(pane, 'a completed-but-empty preview must not fall back to the idle placeholder')
      .not.toContainText('Preview appears here');
    await expect(pane.locator('img'), 'an empty text preview must not attempt to render an <img>').toHaveCount(0);
  });

  // ── Visual baseline (per-viewport via the project config) ─────────────────
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
