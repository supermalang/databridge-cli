import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * PUX-9 — Copy-placeholder buttons for charts / indicators / summaries / tables
 * on the Analyze tab.
 *
 * Every chart / indicator / summary / table the user defines on
 * Analyze → "Charts & indicators" (`frontend/src/pages/Composition.jsx`) maps to
 * a docxtpl placeholder they must place in their Word template by hand:
 *   {{ chart_<name> }} · {{ ind_<name> }} (+ {{ ind_<name>_table }} /
 *   {{ ind_<name>_breakdown }} when disaggregate_by is set) · {{ summary_<name> }}
 *   · {{ table_<name> }}
 * where <name> is the item's `name` verbatim. PUX-9 adds a per-row copy button
 * that copies the EXACT {{ … }} token to the clipboard with visible confirmation.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation. The
 * current Composition rows have no copy-placeholder control, so every PUX-9
 * assertion below is expected to FAIL (red) until PUX-9 ships.
 *
 * NETWORK-MOCKED: Vite serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. Same harness as
 * composition-progressive.spec.ts / i18n-switch.spec.ts.
 *
 * ── Selector / interface contract for the implementer ──────────────────────────
 * Match these so the spec turns green without edits to the spec:
 *   - Each construct row (chart `.comp-row`, indicator `.ind-row`, table /
 *     summary row) exposes a copy-placeholder control that is a real <button>
 *     whose ACCESSIBLE NAME matches /copy placeholder for <item name>/i
 *     (e.g. "Copy placeholder for sites"). This is the A11Y-4 icon-button
 *     convention (aria-label on an icon-only button).
 *   - For an indicator that has `disaggregate_by` set, the row ALSO exposes a
 *     control whose accessible name matches /copy.*table placeholder for <name>/i
 *     (and/or a _breakdown variant) so the user can copy {{ ind_<name>_table }}.
 *   - Clicking a copy control writes the EXACT token (with the {{ }} delimiters
 *     and a single inner space) to the clipboard AND shows visible confirmation:
 *       · either a transient checkmark / "copied" state on the button — its
 *         accessible name or surrounding row text matches /copied/i after click,
 *       · or a toast/status element with role="status" (or class .toast) whose
 *         text matches /copied/i.
 *   - A brief inline note / tooltip on the surface explains that chart + table
 *     placeholders must live in a generate-template-produced template (binary
 *     image data) while indicator + summary tokens paste anywhere. It is
 *     addressable by data-testid="placeholder-caveat" and mentions
 *     generate-template.
 * ───────────────────────────────────────────────────────────────────────────────
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Item names used throughout — the tokens are derived verbatim from these.
const CHART_NAME = 'sites';
const IND_PLAIN = 'completion';      // no disaggregate_by → {{ ind_completion }}
const IND_DISAGG = 'reach';          // disaggregate_by set → also {{ ind_reach_table }}
const SUMMARY_NAME = 'overview';
const TABLE_NAME = 'by_region';

const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  'charts:',
  `  - name: ${CHART_NAME}`,
  '    title: Sites covered',
  '    type: bar',
  '    questions: [region]',
  'indicators:',
  `  - name: ${IND_PLAIN}`,
  '    stat: count',
  '    question: age',
  `  - name: ${IND_DISAGG}`,
  '    stat: count',
  '    question: age',
  '    disaggregate_by: region',
  'tables:',
  `  - name: ${TABLE_NAME}`,
  '    questions: [region]',
  'summaries:',
  `  - name: ${SUMMARY_NAME}`,
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
  // Catch-all FIRST (Playwright matches routes in REVERSE registration order).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
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
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

// Open Analyze → "Charts & indicators" and reveal the Advanced region so tables +
// summaries rows are present (PUX-3 collapses them by default).
async function openComposition(page: Page) {
  await gotoStage(page, 'analyze');
  await gotoSub(page, 'Charts & indicators');
  await expect(page.locator('.comp-card').first()).toBeVisible();
  // Tables + Summaries live behind the "Advanced" disclosure (PUX-3). Reveal it
  // if present so those rows render; the toggle is keyboard-operable per PUX-3.
  const advanced = page.getByTestId('composition-advanced-toggle');
  if (await advanced.count()) {
    if ((await advanced.getAttribute('aria-expanded')) === 'false') {
      await advanced.click();
    }
  }
}

// The copy-placeholder button for a given item, located by its accessible name
// "Copy placeholder for <name>" (A11Y-4 icon-button convention). Implementation-
// agnostic: works whether the row is a .comp-row or .ind-row.
const copyBtn = (page: Page, name: string): Locator =>
  page.getByRole('button', { name: new RegExp(`copy\\s+placeholder\\s+for\\s+${name}`, 'i') });

// Read the clipboard text (requires clipboard-read permission, granted below).
async function clipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('PUX-9 — copy-placeholder controls', () => {
  test.beforeEach(async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await stubBootstrap(page);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — each chart row copies the exact {{ chart_<name> }} token.
  test('AC1: a chart row copies {{ chart_<name> }} exactly', async ({ page }) => {
    const btn = copyBtn(page, CHART_NAME);
    await expect(btn, 'chart row must expose a copy-placeholder button').toBeVisible();
    await btn.click();
    await expect
      .poll(() => clipboard(page), 'clipboard must hold the exact chart token')
      .toBe(`{{ chart_${CHART_NAME} }}`);
  });

  // AC2a — each indicator row copies {{ ind_<name> }}.
  test('AC2a: an indicator row copies {{ ind_<name> }} exactly', async ({ page }) => {
    const btn = copyBtn(page, IND_PLAIN);
    await expect(btn, 'indicator row must expose a copy-placeholder button').toBeVisible();
    await btn.click();
    await expect
      .poll(() => clipboard(page), 'clipboard must hold the exact indicator token')
      .toBe(`{{ ind_${IND_PLAIN} }}`);
  });

  // AC2b — a disaggregated indicator additionally offers the _table variant.
  test('AC2b: a disaggregated indicator can additionally copy {{ ind_<name>_table }}', async ({ page }) => {
    // The plain {{ ind_<name> }} control is still present for the disaggregated one.
    await expect(copyBtn(page, IND_DISAGG), 'disaggregated indicator keeps the plain copy control').toBeVisible();

    // The _table variant control, located by an accessible name mentioning "table".
    const tableVariant = page.getByRole('button', {
      name: new RegExp(`copy.*table\\s+placeholder\\s+for\\s+${IND_DISAGG}`, 'i'),
    });
    await expect(tableVariant, 'disaggregated indicator must offer a _table copy control').toBeVisible();
    await tableVariant.click();
    await expect
      .poll(() => clipboard(page), 'clipboard must hold the exact _table token')
      .toBe(`{{ ind_${IND_DISAGG}_table }}`);
  });

  // AC3a — each summary row copies {{ summary_<name> }}.
  test('AC3a: a summary row copies {{ summary_<name> }} exactly', async ({ page }) => {
    const btn = copyBtn(page, SUMMARY_NAME);
    await expect(btn, 'summary row must expose a copy-placeholder button').toBeVisible();
    await btn.click();
    await expect
      .poll(() => clipboard(page), 'clipboard must hold the exact summary token')
      .toBe(`{{ summary_${SUMMARY_NAME} }}`);
  });

  // AC3b — each table row copies {{ table_<name> }}.
  test('AC3b: a table row copies {{ table_<name> }} exactly', async ({ page }) => {
    const btn = copyBtn(page, TABLE_NAME);
    await expect(btn, 'table row must expose a copy-placeholder button').toBeVisible();
    await btn.click();
    await expect
      .poll(() => clipboard(page), 'clipboard must hold the exact table token')
      .toBe(`{{ table_${TABLE_NAME} }}`);
  });

  // AC4 — the copied string includes the {{ }} delimiters with a single inner
  // space (ready to paste). Asserted strictly above via the exact .toBe() tokens;
  // here we additionally guard against the common defects (no braces / no inner
  // space / extra whitespace).
  test('AC4: the copied token has the {{ }} delimiters and a single inner space', async ({ page }) => {
    await copyBtn(page, CHART_NAME).click();
    await expect.poll(() => clipboard(page)).toMatch(/^\{\{ \S.*\S \}\}$/);
    const text = await clipboard(page);
    expect(text, 'no leading/trailing whitespace around the token').toBe(text.trim());
    expect(text, 'exactly one space after {{ and before }}').toBe(`{{ chart_${CHART_NAME} }}`);
  });

  // AC5 — copying gives visible confirmation (transient checkmark on the button OR
  // a toast/status with "copied").
  test('AC5: copying shows visible confirmation', async ({ page }) => {
    const btn = copyBtn(page, CHART_NAME);
    await btn.click();
    // Either the button enters a "copied" state (its accessible name / text), or a
    // status/toast element announces it. Accept either as visible confirmation.
    const confirmed = page
      .getByRole('status').filter({ hasText: /copied|copié/i })
      .or(page.locator('.toast', { hasText: /copied|copié/i }))
      .or(page.getByRole('button', { name: /copied/i }));
    await expect(confirmed, 'a visible "copied" confirmation must appear after clicking').toBeVisible();
  });

  // AC6 — an inline caveat note explains chart + table placeholders need a
  // generate-template-produced template; indicator + summary tokens paste anywhere.
  test('AC6: an inline caveat about generate-template is surfaced', async ({ page }) => {
    const caveat = page.getByTestId('placeholder-caveat');
    await expect(caveat, 'a placeholder caveat note must be present on the surface').toBeVisible();
    await expect(caveat, 'caveat must mention generate-template').toContainText(/generate.?template/i);
  });

  // AC7 — copy control is keyboard-operable with an accessible name; no raw
  // translation key leaks.
  test('AC7: copy control is a keyboard-operable button with an accessible name', async ({ page }) => {
    const btn = copyBtn(page, CHART_NAME);
    await expect(btn).toBeVisible();

    // Real native <button>.
    const tag = await btn.evaluate((el) => el.tagName.toLowerCase());
    expect(tag, 'copy control must be a native <button>').toBe('button');

    // Non-empty accessible name (aria-label or text), and NOT a raw i18n key.
    const accName = await btn.evaluate((el) => (el.getAttribute('aria-label') || el.textContent || '').trim());
    expect(accName.length, 'copy control must have a non-empty accessible name').toBeGreaterThan(0);
    expect(accName, 'accessible name must not leak a raw translation key').not.toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);

    // Keyboard-operable: focus, then activate with Enter; confirmation appears.
    await btn.focus();
    await expect(btn, 'copy control must be keyboard-focusable').toBeFocused();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => clipboard(page), 'Enter must trigger the copy')
      .toBe(`{{ chart_${CHART_NAME} }}`);
  });

  // AC7 (no leaked keys, surface-wide) — none of the copy-related strings render
  // as a bare dotted translation key (e.g. "composition.copyPlaceholder").
  test('AC7b: no raw translation key text leaks in the copy controls', async ({ page }) => {
    const btn = copyBtn(page, CHART_NAME);
    await expect(btn).toBeVisible();
    const names = await page
      .getByRole('button', { name: /copy/i })
      .evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()));
    expect(names.length, 'at least one copy control must exist').toBeGreaterThan(0);
    for (const n of names) {
      expect(n, `copy control name "${n}" must not be a raw i18n key`).not.toMatch(/^[a-z]+(\.[a-zA-Z]+)+$/);
    }
  });

  // AC (axe) — each copy button has a non-empty accessible name; the surface has
  // no button-name / nested-interactive violations.
  test('axe: copy controls have accessible names and no button-name violations', async ({ page }) => {
    await expect(copyBtn(page, CHART_NAME)).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('.page')
      .withRules(['button-name', 'nested-interactive'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  // ── Visual baselines (per-viewport via the project config). Human approves. ──
  test('visual: chart row with the copy button (default state)', async ({ page }) => {
    const row = page.locator('.comp-row', { hasText: CHART_NAME }).first();
    await expect(copyBtn(page, CHART_NAME)).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(row).toHaveScreenshot('pux9-chart-row.png');
  });

  test('visual: chart row in its "copied" confirmation state', async ({ page }) => {
    const row = page.locator('.comp-row', { hasText: CHART_NAME }).first();
    await copyBtn(page, CHART_NAME).click();
    const confirmed = page
      .getByRole('status').filter({ hasText: /copied|copié/i })
      .or(page.locator('.toast', { hasText: /copied|copié/i }))
      .or(page.getByRole('button', { name: /copied/i }));
    await expect(confirmed).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(row).toHaveScreenshot('pux9-chart-row-copied.png');
  });
});
