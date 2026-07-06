import { test, expect, Page } from '@playwright/test';

/**
 * A11Y-2 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-2.spec.ts: the two screenshot
 * assertions — the primary tablist with the second tab active, and the ProjectForm
 * tablist with the second tab active — plus the minimal duplicated setup they need
 * (the bootstrap /api stubs, the bootApp navigation helper, and the openProjectForm
 * helper). The functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED: the Vite dev server serves the real SPA; every /api/** is
 * intercepted with page.route(), so no FastAPI backend is required.
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

// ---------------------------------------------------------------------------------------
// Primary six-tab nav (App.jsx .tabs-bar)
// ---------------------------------------------------------------------------------------
test.describe('A11Y-2 — primary tab nav: ARIA roles + roving keyboard nav', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
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
