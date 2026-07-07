import { test, expect, Page } from '@playwright/test';

/**
 * UX-7 — visual baseline of the read-only email field with helper text (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-7.spec.ts: the single screenshot
 * assertion — the disabled Profile email field group with its "Managed by your
 * sign-in provider" helper text — plus the minimal duplicated setup it needs (the
 * bootstrap /api stubs with a non-dev user, the app + Profile navigation helpers,
 * and the profile-form / email-group locators). The functional/a11y tests remain
 * in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 * /api/me returns a NON-dev user so the avatar dropdown renders and the email
 * value is present on the profile form.
 */

const PROJECT = {
  id: 'proj-a',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#0f766e',
  icon: '🌍',
};

const USER_EMAIL = 'officer@example.test';

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
    r.fulfill({
      json: {
        sub: 'zitadel-123',          // non-dev → full account menu (Profile + Sign out)
        email: USER_EMAIL,
        name: 'Field Officer',
        given_name: 'Field',
        family_name: 'Officer',
      },
    }));
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

const profileForm = (page: Page) => page.locator('.project-form');
// The "Email" field group and its disabled input inside the profile form.
const emailGroup = (page: Page) =>
  page.locator('.profile-field').filter({ hasText: 'Email' });
const emailInput = (page: Page) => emailGroup(page).locator('input');

// Open the top-ribbon user avatar → "Profile" to mount the ProfileForm overlay.
async function openProfile(page: Page) {
  await gotoApp(page);
  await page.locator('.user-avatar').click();
  // Scope to the avatar dropdown — a "Profile" button also exists in the Home tab.
  await page.locator('.user-menu__dropdown').getByRole('button', { name: 'Profile' }).click();
  await expect(profileForm(page)).toBeVisible();
  // Sanity: the disabled email field shows the stubbed address.
  await expect(emailInput(page)).toHaveValue(USER_EMAIL);
}

test.describe('UX-7 — visual baseline (one per viewport via playwright.config.ts)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the email field + its helper text. Gate on AC2 (the helper
  // text is visible) before capture so the baseline cannot pass vacuously against
  // pre-fix code. Hide the position:fixed terminal bar so it never intrudes;
  // screenshot the email field group directly (no mask).
  test('visual baseline of the read-only email field with helper text', async ({ page }) => {
    await openProfile(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });

    await expect(
      emailGroup(page).getByText(/sign-in provider|managed by/i),
      'helper text must be present before the baseline is captured',
    ).toBeVisible();

    await expect(emailGroup(page)).toHaveScreenshot('profile-email-readonly.png');
  });
});
