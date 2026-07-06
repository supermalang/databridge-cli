import { test, expect, Page, Locator } from '@playwright/test';

/**
 * A11Y-1 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-1.spec.ts: the two screenshot
 * assertions — the keyboard-focused Sources platform card, and the Home stage
 * cards — plus the minimal duplicated setup they need (the bootstrap /api stubs,
 * the Home + Sources-Connection navigation helpers, and the platform-card /
 * tab-until-focused locators). The functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
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
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

// Land on Home (the default stage). The greeting cards live here.
async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  // Wait on the actual surface under test, not chrome text — the greeting cards.
  await expect(page.locator('.home-card').first()).toBeVisible();
}

// Navigate to the Sources "Connection" surface (Extract stage → Connection subtab),
// where the platform cards (Kobo / Ona) render.
async function gotoSourcesConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab', { hasText: /extract/i }).first()).toBeVisible();
  await page.locator('.tabs-bar .tab', { hasText: /extract/i }).first().click();
  // Connection is the default subtab of Extract; click it explicitly to be safe.
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  // Sanity: the platform picker rendered, so any later failure is the missing A11Y-1
  // behavior — not a broken bootstrap/render.
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

const platformCard = (page: Page, name: RegExp) =>
  page.locator('.platform-card').filter({ hasText: name });

// Tab from the document body until `target` is the focused element, or give up.
// Returns true if it became focused within `maxTabs` presses.
async function tabUntilFocused(page: Page, target: Locator, maxTabs = 25): Promise<boolean> {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const handle = await target.elementHandle();
  if (!handle) return false;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate((el) => el === document.activeElement, handle).catch(() => false);
    if (focused) return true;
  }
  return false;
}

test.describe('A11Y-1 — Sources platform cards: keyboard operable', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the keyboard-focused platform card (one assertion → one
  // baseline per viewport via the visual config; a human approves them).
  test('visual baseline of the focused platform card', async ({ page }) => {
    await gotoSourcesConnection(page);
    const kobo = platformCard(page, /Kobo/);
    const reached = await tabUntilFocused(page, kobo);
    expect(reached).toBe(true);
    await expect(kobo).toHaveScreenshot('platform-card-focused.png');
  });
});

test.describe('A11Y-1 — Home stage cards: real buttons, keyboard operable', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the Home stage cards (one assertion → one baseline per viewport).
  // Gate the screenshot on the AC (cards are real <button>s) so this does not pass
  // vacuously on current code by auto-writing a baseline of the pre-fix <div> markup —
  // the baseline must capture the corrected button markup, approved by a human.
  test('visual baseline of the Home stage cards', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('button.home-card').first(),
      'stage cards must be <button>s before the baseline is captured').toBeVisible();
    await expect(page.locator('.home-cards')).toHaveScreenshot('home-stage-cards.png');
  });
});
