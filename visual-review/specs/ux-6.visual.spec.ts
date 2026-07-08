import { test, expect, Page } from '@playwright/test';

/**
 * UX-6 — visual baseline of the invalid (empty-name) create form (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-6.spec.ts: the single screenshot
 * assertion — the create form in its INVALID state (empty name, inline error
 * shown, submit disabled) — plus the minimal duplicated setup it needs (the
 * bootstrap /api stubs, the gotoApp + openCreateForm navigation helpers, and the
 * nameError / submitBtn locators). The functional tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const PROJECT = {
  id: 'proj-edit',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',          // admin → create + gear controls shown
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
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: { active_id: PROJECT.id, is_superadmin: false, projects: [PROJECT] },
    }));
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

// Open the project switcher → click "+ New project" → ProjectForm (create mode,
// empty + clean name).
async function openCreateForm(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
  await page.locator('.project-menu__add').click();
  await expect(page.locator('.project-form')).toBeVisible();
  // Create mode shows the "New project" title (not "Project settings").
  await expect(page.locator('.project-form__title')).toContainText(/new project/i);
}

// The primary action button — "Create" in create mode.
const submitBtn = (page: Page) =>
  page.locator('.project-form .btn-primary');

// The inline error beneath the name field — the A11Y-5 FieldError (role="alert").
const nameError = (page: Page) =>
  page.locator('.project-form .profile-field', { hasText: 'Name' })
      .getByRole('alert');

test.describe('UX-6 — visual baseline of the invalid (empty-name) create form', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the create form in its INVALID state: empty name, inline
  // error shown, submit disabled. Gate on the AC so the baseline cannot pass
  // vacuously before the inline error exists. Screenshot the form element; hide
  // the position:fixed terminal bar (no mask).
  test('visual baseline of the empty-name create form (error shown, submit disabled)', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await openCreateForm(page);

    await expect(nameError(page), 'inline error must be shown before the baseline is captured')
      .toBeVisible();
    await expect(submitBtn(page), 'submit must be disabled before the baseline is captured')
      .toBeDisabled();

    await expect(page.locator('.project-form')).toHaveScreenshot('ux-6-empty-name-invalid.png');
  });
});
