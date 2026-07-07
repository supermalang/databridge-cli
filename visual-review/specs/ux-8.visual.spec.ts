import { test, expect, Page } from '@playwright/test';

/**
 * UX-8 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-8.spec.ts: the single screenshot
 * assertion — the accessible color + icon picker rows in the ProjectForm Details
 * panel — plus the minimal duplicated setup it needs (the bootstrap /api stubs,
 * the app + create-form navigation helpers, the swatch locator, and the COLORS /
 * PROJECT / CONFIG_YML constants). The functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const COLORS = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#64748B'];

const PROJECT = {
  id: 'proj-edit',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#0F766E',
  icon: '🌍',
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
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: PROJECT.id, is_superadmin: false, projects: [PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

// Open the project switcher → "+ New project" → ProjectForm (create mode, clean).
async function openCreateForm(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
  await page.locator('.project-menu__add').click();
  await expect(page.locator('.project-form')).toBeVisible();
  await expect(page.locator('.project-form__title')).toContainText(/new project/i);
}

const swatches = (page: Page) => page.locator('.project-form .pf-swatches .pf-swatch');

test.describe('UX-8 — visual baseline of the color + icon picker row', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the accessible picker rows. Gate on the AC so the baseline
  // cannot pass vacuously before the labels/pressed-state exist: the first swatch
  // must carry a non-empty aria-label and be pressed. Screenshot the Details panel
  // region containing both rows; hide the position:fixed terminal bar (no mask).
  //
  // Emoji may render as tofu in headless Linux (no emoji font) — a known
  // pre-existing env artifact; the aria assertions above are the load-bearing checks.
  test('visual baseline of the picker rows (first swatch selected)', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await openCreateForm(page);

    const firstSwatch = swatches(page).first();
    await expect(firstSwatch).toBeVisible();
    const label = await firstSwatch.getAttribute('aria-label');
    expect(
      label && label.trim().length > 0,
      'first swatch must have a non-empty aria-label before the baseline is captured',
    ).toBeTruthy();
    await expect(firstSwatch, 'first swatch must be pressed before the baseline is captured')
      .toHaveAttribute('aria-pressed', 'true');

    await expect(page.locator('.project-form__body')).toHaveScreenshot('ux-8-pickers.png');
  });
});
