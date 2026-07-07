import { test, expect, Page } from '@playwright/test';

/**
 * A11Y-8 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-8.spec.ts: the two screenshot
 * assertions — the Home stage cards, and the ProjectForm (create mode) — plus the
 * minimal duplicated setup they need (the bootstrap /api stubs, the Home
 * navigation helper, and the create-form opener). The functional axe / focus-ring
 * tests remain in the e2e file.
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
  test('visual baseline — ProjectForm (create mode) at all viewports', async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await openCreateForm(page);
    await expect(page.locator('.project-form')).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term { display: none !important; }' });
    await expect(page.locator('.page:visible')).toHaveScreenshot('a11y-8-project-form.png');
  });
});
