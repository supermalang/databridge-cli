import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-2 — ARIA roles + roving keyboard nav on tab interfaces.
 *
 * The app's tab strips (primary six-tab nav, secondary sub-tab strip, ProjectForm
 * tabs, profile-form tabs) must follow the ARIA Authoring Practices tabs pattern:
 *   - container role="tablist"
 *   - each tab role="tab" + aria-selected (true on active) + aria-controls → its panel id
 *   - each panel role="tabpanel" with id referenced by its tab's aria-controls
 *   - roving tabindex: only the active tab is tabindex=0; Left/Right + Home/End arrow
 *     keys move selection (focus + aria-selected) between tabs
 *   - keyboard switching shows the same panel as a mouse click
 *
 * NETWORK-MOCKED: the Vite dev server serves the real SPA; every /api/** is
 * intercepted with page.route(), so no FastAPI backend is required. Same harness as
 * build-options.spec.ts.
 *
 * NOTE: these assertions are derived strictly from the A11Y-2 Acceptance criteria, not
 * from any current implementation. The current strips render plain <div>/<button>s with
 * no roles, so every role/aria/roving assertion below is expected RED until A11Y-2 ships.
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
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (Playwright matches routes in
  // REVERSE registration order — last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

// Resolve the id a tab points at via aria-controls, and assert that panel exists,
// has role="tabpanel", and is the visible panel.
async function expectControlledPanelShown(page: Page, tab: Locator) {
  const panelId = await tab.getAttribute('aria-controls');
  expect(panelId, 'tab must have aria-controls').toBeTruthy();
  const panel = page.locator(`#${panelId}`);
  await expect(panel).toHaveAttribute('role', 'tabpanel');
  await expect(panel).toBeVisible();
}

// ---------------------------------------------------------------------------------------
// Primary six-tab nav (App.jsx .tabs-bar)
// ---------------------------------------------------------------------------------------
test.describe('A11Y-2 — primary tab nav: ARIA roles + roving keyboard nav', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
  });

  test('container exposes role="tablist" and each tab is role="tab" with aria-selected', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    await expect(tablist).toHaveAttribute('role', 'tablist');

    const tabs = tablist.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Exactly one tab is aria-selected="true"; the rest are "false".
    const selected = tablist.locator('[role="tab"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    const notSelected = tablist.locator('[role="tab"][aria-selected="false"]');
    await expect(notSelected).toHaveCount(count - 1);
  });

  test('active tab points at a role="tabpanel" via aria-controls', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    const active = tablist.locator('[role="tab"][aria-selected="true"]');
    await expectControlledPanelShown(page, active);
  });

  test('roving tabindex: only the active tab is in Tab order (tabindex=0)', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    // The single tabindex=0 tab is the selected one.
    await expect(tablist.locator('[role="tab"][aria-selected="true"][tabindex="0"]')).toHaveCount(1);
    // Every other tab is removed from the Tab order.
    const total = await tablist.getByRole('tab').count();
    await expect(tablist.locator('[role="tab"][tabindex="-1"]')).toHaveCount(total - 1);
  });

  test('ArrowRight moves selection + focus to the next tab and shows its panel', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    const tabs = tablist.getByRole('tab');
    const first = tabs.nth(0);
    const second = tabs.nth(1);

    await first.focus();
    await page.keyboard.press('ArrowRight');

    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expectControlledPanelShown(page, second);
  });

  test('Home/End jump to the first/last tab', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    const tabs = tablist.getByRole('tab');
    const first = tabs.nth(0);
    const last = tabs.nth((await tabs.count()) - 1);

    await first.focus();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-selected', 'true');
  });

  test('keyboard switching shows the same panel as a mouse click (no regression)', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    const tabs = tablist.getByRole('tab');
    const second = tabs.nth(1);

    // Mouse click → record the controlled panel id.
    await second.click();
    const clickedPanelId = await second.getAttribute('aria-controls');
    expect(clickedPanelId).toBeTruthy();

    // Reset to first via Home, then keyboard back to the second tab.
    await tabs.nth(0).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');

    const kbPanelId = await second.getAttribute('aria-controls');
    expect(kbPanelId).toBe(clickedPanelId);
    await expectControlledPanelShown(page, second);
  });

  test('axe: no ARIA tab violations on the primary tabbed view', async ({ page }) => {
    // Guard against a vacuous pass: a real tablist with tabs must exist before the axe
    // scan, otherwise "no tab violations" would be trivially true on a plain <div> nav.
    const tablist = page.locator('.tabs-bar');
    await expect(tablist).toHaveAttribute('role', 'tablist');
    await expect(tablist.getByRole('tab').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.tabs-bar')
      .withTags(['wcag2a', 'wcag21a', 'wcag412'])
      .analyze();
    const tabViolations = results.violations.filter((v) =>
      ['aria-required-children', 'aria-required-parent', 'aria-valid-attr-value',
       'aria-allowed-attr', 'aria-roles', 'tabindex'].includes(v.id));
    expect(tabViolations, JSON.stringify(tabViolations, null, 2)).toEqual([]);
  });

  test('visual baseline: primary tablist with the second tab active', async ({ page }) => {
    const tablist = page.locator('.tabs-bar');
    const tabs = tablist.getByRole('tab');
    await tabs.nth(0).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tablist).toHaveScreenshot('a11y-primary-tablist-second-active.png');
  });
});

// ---------------------------------------------------------------------------------------
// ProjectForm tabs (ProjectForm.jsx .project-form__tabs)
// ---------------------------------------------------------------------------------------
async function openProjectForm(page: Page) {
  await page.locator('.project-switcher').click();
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form__tabs')).toBeVisible();
}

test.describe('A11Y-2 — ProjectForm tabs: ARIA roles + roving keyboard nav', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openProjectForm(page);
  });

  test('container exposes role="tablist" and each tab is role="tab" with aria-selected', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    await expect(tablist).toHaveAttribute('role', 'tablist');

    const tabs = tablist.getByRole('tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  });

  test('active tab points at a role="tabpanel" via aria-controls', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    const active = tablist.locator('[role="tab"][aria-selected="true"]');
    await expectControlledPanelShown(page, active);
  });

  test('roving tabindex: only the active ProjectForm tab is tabindex=0', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    await expect(tablist.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
    await expect(tablist.locator('[role="tab"][aria-selected="true"][tabindex="0"]')).toHaveCount(1);
  });

  test('ArrowRight moves selection + focus to the next ProjectForm tab and shows its panel', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    const tabs = tablist.getByRole('tab');
    const first = tabs.nth(0);
    const second = tabs.nth(1);

    await first.focus();
    await page.keyboard.press('ArrowRight');

    await expect(second).toBeFocused();
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expectControlledPanelShown(page, second);
  });

  test('Home/End jump to the first/last ProjectForm tab', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    const tabs = tablist.getByRole('tab');
    const first = tabs.nth(0);
    const last = tabs.nth((await tabs.count()) - 1);

    await first.focus();
    await page.keyboard.press('End');
    await expect(last).toBeFocused();
    await expect(last).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('aria-selected', 'true');
  });

  test('axe: no ARIA tab violations on the ProjectForm tabbed view', async ({ page }) => {
    // Guard against a vacuous pass (see primary-nav axe test).
    const tablist = page.locator('.project-form__tabs');
    await expect(tablist).toHaveAttribute('role', 'tablist');
    await expect(tablist.getByRole('tab').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.project-form__tabs')
      .withTags(['wcag2a', 'wcag21a', 'wcag412'])
      .analyze();
    const tabViolations = results.violations.filter((v) =>
      ['aria-required-children', 'aria-required-parent', 'aria-valid-attr-value',
       'aria-allowed-attr', 'aria-roles', 'tabindex'].includes(v.id));
    expect(tabViolations, JSON.stringify(tabViolations, null, 2)).toEqual([]);
  });

  test('visual baseline: ProjectForm tablist with the second tab active', async ({ page }) => {
    const tablist = page.locator('.project-form__tabs');
    await expect(tablist).toHaveAttribute('role', 'tablist');
    const tabs = tablist.getByRole('tab');
    await tabs.nth(0).focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(tablist).toHaveScreenshot('a11y-projectform-tablist-second-active.png');
  });
});
