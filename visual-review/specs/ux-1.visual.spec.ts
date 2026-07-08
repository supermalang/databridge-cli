import { test, expect, Page } from '@playwright/test';

/**
 * UX-1 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-1.spec.ts: the two screenshot
 * assertions — the switcher avatar (emoji + color) and the open project menu
 * (rows with icon/color) — plus the minimal duplicated setup they need (the
 * bootstrap /api stubs with a color/icon project + a plain fallback project, the
 * gotoApp navigation helper, and the avatar / switcher / menu / menuRow
 * locators). The functional tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

// Active project WITH a distinctive color + emoji icon set.
const PROJECT_WITH = {
  id: 'proj-with',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#b91c1c',   // distinctive red, far from the default #fff avatar bg
  icon: '🌍',
};

// A second project WITHOUT color/icon — must fall back to the two-letter avatar.
const PROJECT_WITHOUT = {
  id: 'proj-plain',
  name: 'Plain Project',
  slug: 'plain-project',
  role: 'admin',
  is_archived: false,
  // no color, no icon
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: {
        active_id: PROJECT_WITH.id,
        is_superadmin: false,
        projects: [PROJECT_WITH, PROJECT_WITHOUT],
      },
    }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

// Land on the app; the project switcher lives in the top ribbon and is always present.
async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

const avatar = (page: Page) => page.locator('.project-switcher__avatar');
const switcher = (page: Page) => page.locator('.project-switcher');
const menu = (page: Page) => page.locator('.project-menu');
const menuRow = (page: Page, name: RegExp) =>
  page.locator('.project-menu__item').filter({ hasText: name });

test.describe('UX-1 — visual baselines (one per viewport via playwright.config.ts)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the switcher avatar (emoji + color). Gate on the AC so this
  // does not pass vacuously by baselining the pre-fix two-letter avatar — the
  // baseline must capture the emoji avatar, approved by a human.
  test('visual baseline of the switcher avatar', async ({ page }) => {
    await gotoApp(page);
    await expect(avatar(page), 'avatar must show the emoji before the baseline is captured')
      .toContainText('🌍');
    await expect(switcher(page)).toHaveScreenshot('project-switcher-avatar.png');
  });

  // Visual baseline of the open project menu (rows with icon/color). Screenshot the
  // menu element directly so the position:fixed terminal bar never intrudes.
  test('visual baseline of the open project menu', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menuRow(page, /Global Health/),
      'the menu row must show the emoji before the baseline is captured').toContainText('🌍');
    await expect(menu(page)).toHaveScreenshot('project-menu-icons.png');
  });
});
