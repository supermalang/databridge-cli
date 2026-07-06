import { test, expect, Page } from '@playwright/test';

/**
 * UX-4 — visual baseline of the unsaved-changes confirmation dialog (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-4.spec.ts: the single screenshot
 * assertion — the unsaved-changes confirmation dialog shown when clicking `← Back`
 * on a dirty ProjectForm — plus the minimal duplicated setup it needs (the bootstrap
 * /api stubs, the gotoApp + openProjectForm navigation helpers, and the nameField /
 * backBtn / dialog locators). The functional tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const PROJECT = {
  id: 'proj-edit',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',          // admin → the gear (edit) control is shown
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

// Open the project switcher → click the per-project gear → ProjectForm (edit mode).
async function openProjectForm(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form')).toBeVisible();
}

const nameField = (page: Page) =>
  page.locator('.project-form .profile-field', { hasText: 'Name' }).locator('input');

const backBtn = (page: Page) =>
  page.locator('.project-form__bar').getByRole('button', { name: /back/i });

// The shared useConfirm() Modal — role="dialog".
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('UX-4 — visual baseline of the unsaved-changes dialog (one per viewport)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the confirmation dialog. Gate on the AC (dialog visible +
  // warns of unsaved changes) so it cannot pass vacuously before the guard exists.
  // Screenshot the dialog element directly; hide the position:fixed terminal bar.
  test('visual baseline of the unsaved-changes confirmation dialog', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await openProjectForm(page);

    await nameField(page).fill('Global Health (edited)');
    await backBtn(page).click();

    const d = dialog(page);
    await expect(d, 'the confirmation dialog must be visible before the baseline is captured')
      .toBeVisible();
    await expect(d).toContainText(/unsaved|discard/i);
    await expect(d).toHaveScreenshot('ux-4-unsaved-changes-dialog.png');
  });
});
