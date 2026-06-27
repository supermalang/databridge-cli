import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-8 — Home-card subtext contrast + ProjectForm picker focus ring.
 *
 * Two deferred WCAG 2.1 AA gaps:
 *
 *   AC1 — `.home-card__sub` pill buttons must pass WCAG 4.5:1 color-contrast.
 *     An axe `color-contrast` audit on the Home page reports no violation on the
 *     stage-card subtext pills.
 *
 *   AC2 — `.pf-swatch` (color picker) and `.pf-icon` (emoji picker) in the
 *     ProjectForm must show the app's teal `:focus-visible` ring on keyboard focus.
 *     Mouse behavior is unchanged.
 *
 * NETWORK-MOCKED end-to-end: Vite serves the real SPA; every /api/** call is
 * intercepted with page.route(), so no FastAPI backend is required.
 */

const PROJECT = {
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
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page, opts: { hasData?: boolean } = {}) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@e.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: PROJECT.id, is_superadmin: false, projects: [PROJECT] } }));
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  // has_questions+has_data=true puts the app in normal operating mode (no first-run dimming)
  // so the axe contrast check sees production-representative colors.
  const hasData = opts.hasData ?? false;
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: hasData, has_data: hasData, has_templates: false, has_ai: false } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
}

async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

async function openCreateForm(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
  await page.locator('.project-menu__add').click();
  await expect(page.locator('.project-form')).toBeVisible();
}

// ─────────────────────────────────────────────────────────────────────────────
// AC1 — .home-card__sub contrast
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A11Y-8 — home-card subtext contrast', () => {
  test('axe color-contrast: no violation on .home-card__sub pills', async ({ page }) => {
    // hasData:true → app is in "data loaded" mode: no first-run dimming, all stage
    // cards render at full opacity. This is the production-representative state where
    // contrast actually matters.
    await stubBootstrap(page, { hasData: true });
    await gotoHome(page);

    // Confirm the stage cards rendered (precondition — a vacuous pass on an empty
    // page would hide a real missing-element bug).
    await expect(page.locator('.home-card').first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.home-cards')
      .withRules(['color-contrast'])
      .analyze();

    expect(
      results.violations,
      `axe color-contrast violations: ${JSON.stringify(results.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.html),
      })))}`,
    ).toEqual([]);
  });

  test('visual baseline — Home stage cards at all viewports', async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await expect(page.locator('.home-card').first()).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('a11y-8-home.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC2 — .pf-swatch / .pf-icon focus-visible ring
// ─────────────────────────────────────────────────────────────────────────────
test.describe('A11Y-8 — ProjectForm picker focus-visible ring', () => {
  test('keyboard-focused .pf-swatch shows a non-none, non-zero outline', async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await openCreateForm(page);

    const swatch = page.locator('.project-form .pf-swatches .pf-swatch').first();
    await expect(swatch).toBeVisible();

    // Press Tab once to establish keyboard-navigation context in the browser so
    // :focus-visible is honoured when we then programmatically focus the swatch.
    await page.keyboard.press('Tab');
    await swatch.focus();

    const outlineStyle = await swatch.evaluate((el) =>
      window.getComputedStyle(el, null).getPropertyValue('outline-style'));
    const outlineWidth = await swatch.evaluate((el) =>
      window.getComputedStyle(el, null).getPropertyValue('outline-width'));

    expect(
      outlineStyle,
      '.pf-swatch outline-style must not be "none" when keyboard-focused',
    ).not.toBe('none');
    expect(
      parseFloat(outlineWidth),
      '.pf-swatch outline-width must be > 0 when keyboard-focused',
    ).toBeGreaterThan(0);
  });

  test('keyboard-focused .pf-icon shows a non-none, non-zero outline', async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await openCreateForm(page);

    const icon = page.locator('.project-form .pf-icons .pf-icon').first();
    await expect(icon).toBeVisible();

    await page.keyboard.press('Tab');
    await icon.focus();

    const outlineStyle = await icon.evaluate((el) =>
      window.getComputedStyle(el, null).getPropertyValue('outline-style'));
    const outlineWidth = await icon.evaluate((el) =>
      window.getComputedStyle(el, null).getPropertyValue('outline-width'));

    expect(
      outlineStyle,
      '.pf-icon outline-style must not be "none" when keyboard-focused',
    ).not.toBe('none');
    expect(
      parseFloat(outlineWidth),
      '.pf-icon outline-width must be > 0 when keyboard-focused',
    ).toBeGreaterThan(0);
  });

  test('visual baseline — ProjectForm (create mode) at all viewports', async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await openCreateForm(page);
    await expect(page.locator('.project-form')).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('a11y-8-project-form.png');
  });
});
