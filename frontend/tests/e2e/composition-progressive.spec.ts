import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-3 — Reduce Composition cognitive load via progressive disclosure.
 *
 * The Composition / Analyze surface (Analyze → "Charts & indicators",
 * `frontend/src/pages/Composition.jsx`, mounted with
 * ANALYZE_SECTIONS = ['charts','indicators','tables','summaries','pii'] — though
 * 'pii' renders no block today and is OUT OF SCOPE here) renders its constructs
 * as a flat wall of cards — exactly the step non-experts most need scaffolding
 * (fails *Make the safe path the default*).
 *
 * PUX-3 asks the surface to:
 *   (a) lead with a recommended STARTER PATH — the Ask entry point + a
 *       starter-charts affordance (reusing the existing `--auto-charts`
 *       capability) — presented as the suggested way to begin;
 *   (b) keep CHARTS + INDICATORS as the primary, always-visible constructs;
 *   (c) collapse the less-common constructs — TABLES and SUMMARIES — behind a
 *       keyboard-operable, progressive-disclosure "Advanced" affordance
 *       (collapsed by default), with no construct removed.
 *
 * NOTE on scope (corrected card): views + framework are NOT on this surface —
 * views lives under Model → Views. This spec must not reference them.
 *
 * NETWORK-MOCKED: Vite serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. Same harness pattern as
 * a11y-3.spec.ts / build-options.spec.ts.
 *
 * RED-FIRST: these assertions are derived from the PUX-3 Acceptance criteria,
 * NOT from the current implementation. The current Composition surface has no
 * starter-path container, no "Advanced" disclosure button, and renders its
 * tables / summaries expanded by default. Every
 * "PUX-3 affordance" assertion below is expected to fail until PUX-3 ships; the
 * charts/indicators "no-regression" assertions are expected to stay green.
 *
 * ── Selector contract for the implementer ──────────────────────────────────
 * Match these so the spec turns green without edits to the spec:
 *   - Starter-path container:  data-testid="composition-starter-path"
 *       · Ask affordance inside it: a real <a>/<button> with accessible name
 *         matching /ask/i (reuses the existing Ask entry point — links to /
 *         opens the Analyze → Ask flow).
 *       · Starter-charts affordance inside it: a real <a>/<button> with
 *         data-testid="composition-starter-charts" and an accessible name
 *         matching /starter chart|auto.?chart|suggest.*chart/i
 *         (reuses the existing --auto-charts / suggest-charts capability).
 *   - PRIMARY constructs (NOT behind Advanced): the existing Charts card
 *       (`.comp-card` with title "Charts", "+ Add chart" control) and the
 *       Indicators card (title "Indicators") stay visible on first view.
 *   - Advanced disclosure control: a real <button> with
 *       data-testid="composition-advanced-toggle", an accessible name matching
 *       /advanced/i, and an `aria-expanded` attribute that is "false" when
 *       collapsed and flips to "true" when expanded. Keyboard-operable
 *       (focusable; Enter toggles).
 *   - Advanced region (revealed on expand): data-testid="composition-advanced"
 *       containing the Tables card (title "Tables", "+ Add table") and the
 *       Summaries card (title "Summaries", "+ Add summary") only. The region is
 *       hidden when collapsed.
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
  // Pre-seed each construct so its card renders a row and we can prove the
  // PRIMARY constructs stay editable (no regression) and the ADVANCED ones keep
  // their full controls once revealed.
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
  // AI configured + verified so the Ask / starter-charts starter path is in its
  // ready, recommended state (not AI-locked).
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  // Preview endpoints touched by cards on mount — keep them benign.
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

// Open the Composition surface (Analyze → "Charts & indicators") and wait for a
// primary construct card to render so the page is settled before we assert.
async function openComposition(page: Page) {
  await gotoStage(page, 'analyze');
  await gotoSub(page, 'Charts & indicators');
  // Charts card is a primary construct and always present on this surface.
  await expect(page.locator('.comp-card').first()).toBeVisible();
}

// Locators for the intended PUX-3 affordances (see selector contract above).
const starterPath = (page: Page): Locator => page.getByTestId('composition-starter-path');
const starterCharts = (page: Page): Locator => page.getByTestId('composition-starter-charts');
const advancedToggle = (page: Page): Locator => page.getByTestId('composition-advanced-toggle');
const advancedRegion = (page: Page): Locator => page.getByTestId('composition-advanced');

// A construct card located by its visible "comp-card__title" heading.
const cardByTitle = (page: Page, title: string): Locator =>
  page.locator('.comp-card', { has: page.locator('.comp-card__title', { hasText: title }) });

test.describe('PUX-3 — Composition progressive disclosure', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — recommended starter path (Ask + starter charts) leads the surface.
  test('AC1: a recommended starter path with Ask + starter-charts is visible on first view', async ({ page }) => {
    const path = starterPath(page);
    await expect(path, 'starter-path container must be present on first view').toBeVisible();

    // The Ask entry point is reused as part of the recommended starting point.
    const askEntry = path.getByRole('link', { name: /ask/i })
      .or(path.getByRole('button', { name: /ask/i }));
    await expect(askEntry, 'starter path must surface the Ask entry point').toBeVisible();

    // The starter-charts affordance leverages the existing --auto-charts capability.
    await expect(starterCharts(page), 'starter path must surface a starter-charts affordance').toBeVisible();
    const name = await starterCharts(page).evaluate(
      (el) => (el.getAttribute('aria-label') || el.textContent || '').trim());
    expect(name, 'starter-charts affordance name must mention starter/auto/suggest charts')
      .toMatch(/starter chart|auto.?chart|suggest.*chart/i);
  });

  // AC2 — charts + indicators stay PRIMARY (visible on first view, not collapsed).
  test('AC2: charts + indicators remain primary and visible on first view (not behind Advanced)', async ({ page }) => {
    const chartsCard = cardByTitle(page, 'Charts');
    const indicatorsCard = cardByTitle(page, 'Indicators');
    await expect(chartsCard, 'Charts card must be visible on first view').toBeVisible();
    await expect(indicatorsCard, 'Indicators card must be visible on first view').toBeVisible();

    // They must NOT be nested inside the Advanced region.
    await expect(
      advancedRegion(page).locator('.comp-card__title', { hasText: 'Charts' }),
      'Charts must not live inside the Advanced region',
    ).toHaveCount(0);
    await expect(
      advancedRegion(page).locator('.comp-card__title', { hasText: 'Indicators' }),
      'Indicators must not live inside the Advanced region',
    ).toHaveCount(0);
  });

  // AC3 — tables and summaries are NOT expanded by default; an Advanced
  // disclosure exists, is collapsed, and hides them.
  test('AC3: tables + summaries are collapsed by default behind Advanced (hidden, aria-expanded=false)', async ({ page }) => {
    const toggle = advancedToggle(page);
    await expect(toggle, 'an Advanced disclosure control must exist').toBeVisible();
    await expect(toggle, 'Advanced disclosure must be collapsed by default').toHaveAttribute('aria-expanded', 'false');

    // The advanced region and the constructs within it must be hidden.
    await expect(advancedRegion(page), 'advanced region must be hidden when collapsed').toBeHidden();
    await expect(cardByTitle(page, 'Tables'), 'Tables card must not be visible by default').toBeHidden();
    await expect(cardByTitle(page, 'Summaries'), 'Summaries card must not be visible by default').toBeHidden();
  });

  // AC4 — disclosure control is a real, keyboard-operable button with an
  // accessible name and exposes its state to AT.
  test('AC4: Advanced disclosure is a real keyboard-operable <button> with an accessible name', async ({ page }) => {
    const toggle = advancedToggle(page);
    await expect(toggle).toBeVisible();

    // Real native <button> (not a div with onClick).
    const tag = await toggle.evaluate((el) => el.tagName.toLowerCase());
    expect(tag, 'Advanced disclosure must be a native <button>').toBe('button');

    // Accessible name mentioning "advanced".
    const name = await toggle.evaluate((el) => (el.getAttribute('aria-label') || el.textContent || '').trim());
    expect(name, 'Advanced disclosure must have an accessible name matching /advanced/i').toMatch(/advanced/i);

    // Keyboard-operable: focus it and toggle with the keyboard.
    await toggle.focus();
    await expect(toggle, 'Advanced disclosure must be focusable').toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Enter');
    await expect(toggle, 'Enter must expand the disclosure').toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Enter');
    await expect(toggle, 'Enter must collapse the disclosure again').toHaveAttribute('aria-expanded', 'false');
  });

  // AC5 — expanding Advanced reveals tables + summaries and flips state.
  test('AC5: clicking Advanced reveals tables + summaries and flips aria-expanded to true', async ({ page }) => {
    const toggle = advancedToggle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle, 'aria-expanded must flip to true on expand').toHaveAttribute('aria-expanded', 'true');

    const region = advancedRegion(page);
    await expect(region, 'advanced region must become visible on expand').toBeVisible();
    await expect(region.locator('.comp-card__title', { hasText: 'Tables' }), 'Tables card must be revealed').toBeVisible();
    await expect(region.locator('.comp-card__title', { hasText: 'Summaries' }), 'Summaries card must be revealed').toBeVisible();
  });

  // AC6 (no construct removed) — revealed advanced constructs keep their full
  // existing controls.
  test('AC6: revealed tables + summaries keep their full existing controls', async ({ page }) => {
    await advancedToggle(page).click();
    const region = advancedRegion(page);
    await expect(region).toBeVisible();

    // Tables card keeps its "+ Add table" affordance and seeded row.
    const tablesCard = region.locator('.comp-card', {
      has: page.locator('.comp-card__title', { hasText: 'Tables' }),
    });
    await expect(tablesCard.getByRole('button', { name: /add table/i }), 'Tables card must keep "+ Add table"').toBeVisible();
    await expect(tablesCard.getByText('by_region'), 'seeded table row must render').toBeVisible();

    // Summaries card keeps its "+ Add summary" affordance and seeded row.
    const summariesCard = region.locator('.comp-card', {
      has: page.locator('.comp-card__title', { hasText: 'Summaries' }),
    });
    await expect(summariesCard.getByRole('button', { name: /add summary/i }), 'Summaries card must keep "+ Add summary"').toBeVisible();
    await expect(summariesCard.getByText('overview'), 'seeded summary row must render').toBeVisible();
  });

  // AC7 — primary constructs (charts/indicators) remain editable as today.
  test('AC7: primary Charts construct remains editable (+ Add chart opens the editor)', async ({ page }) => {
    const chartsCard = cardByTitle(page, 'Charts');
    await expect(chartsCard).toBeVisible();

    // "+ Add chart" affordance present and clickable → opens the chart editor modal.
    const addChart = chartsCard.getByRole('button', { name: /add chart/i });
    await expect(addChart, 'primary Charts construct must keep its "+ Add chart" control').toBeVisible();
    await addChart.click();
    await expect(page.locator('.modal[role="dialog"]'), 'chart editor must still open').toBeVisible();
  });

  // ── Visual baselines (per-viewport via the project config) ────────────────
  test('visual: collapsed (starter) state', async ({ page }) => {
    // Guard against a vacuous baseline — the starter path must actually render.
    await expect(starterPath(page)).toBeVisible();
    await expect(advancedToggle(page)).toHaveAttribute('aria-expanded', 'false');
    // Deterministic scroll anchor so the full-page stitch is stable across runs.
    await page.evaluate(() => window.scrollTo(0, 0));
    // App.jsx keeps inactive panes mounted-but-hidden (display:none), so multiple
    // `.page` nodes exist; target the VISIBLE Composition pane only. The Composition
    // surface is taller than the mobile viewport, so the shot is stitched; the
    // position:fixed terminal bar (.bottom-term) would otherwise ghost across the
    // stitched frames, so mask it for a stable baseline.
    await expect(page.locator('.page:visible')).toHaveScreenshot('pux3-composition-collapsed.png', {
      mask: [page.locator('.bottom-term')],
    });
  });

  test('visual: expanded (Advanced) state', async ({ page }) => {
    await advancedToggle(page).click();
    await expect(advancedRegion(page)).toBeVisible();
    await expect(advancedToggle(page)).toHaveAttribute('aria-expanded', 'true');
    // Deterministic scroll anchor so the full-page stitch is stable across runs.
    await page.evaluate(() => window.scrollTo(0, 0));
    // App.jsx keeps inactive panes mounted-but-hidden (display:none), so multiple
    // `.page` nodes exist; target the VISIBLE Composition pane only. The Composition
    // surface is taller than the mobile viewport, so the shot is stitched; the
    // position:fixed terminal bar (.bottom-term) would otherwise ghost across the
    // stitched frames, so mask it for a stable baseline.
    await expect(page.locator('.page:visible')).toHaveScreenshot('pux3-composition-expanded.png', {
      mask: [page.locator('.bottom-term')],
    });
  });
});
