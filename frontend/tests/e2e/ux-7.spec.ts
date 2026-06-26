import { test, expect, Page } from '@playwright/test';

/**
 * UX-7 — Explain read-only email (ProfileForm).
 *
 * The Profile page (frontend/src/pages/ProfileForm.jsx, reached from the
 * top-ribbon user avatar → "Profile") renders the signed-in user's email as a
 * DISABLED input — the email is Zitadel-owned and cannot be edited here. Today
 * the disabled field carries NO explanation, so it can look broken.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *   AC1. The email field remains non-editable (disabled or readonly). This may
 *        already pass against current code — it is the GUARD that the fix must
 *        not regress.
 *   AC2. Helper text "Managed by your sign-in provider" (or text matching
 *        /sign-in provider|managed by/i) is VISIBLE beneath the disabled email
 *        field. RED today (no helper text is rendered anywhere on the form).
 *   AC3 (a11y nicety). The helper text is programmatically associated with the
 *        email input via aria-describedby, so screen-reader users hear the
 *        explanation when they reach the field. RED today.
 *
 * ----------------------------------------------------------------------------
 * SELECTOR / CONTRACT FOR THE IMPLEMENTER (what these tests pin):
 *   - File:               frontend/src/pages/ProfileForm.jsx
 *   - Email field group:  the `.profile-field` block whose <label> reads "Email"
 *                         (the 3rd profile-field, after First name / Last name).
 *   - Email input:        the disabled <input> inside that group — pinned here as
 *                         `.profile-field` (has-text "Email") >> input[disabled],
 *                         and equivalently the only disabled input on the form.
 *   - Helper text string: "Managed by your sign-in provider" (the tests accept
 *                         any text matching /sign-in provider|managed by/i), shown
 *                         beneath the email input within the same field group.
 *   - Association:        the email <input> gets aria-describedby pointing at the
 *                         helper text element's id (so the cue is announced).
 *   The email input must stay `disabled` (or become `readonly`) — never editable.
 * ----------------------------------------------------------------------------
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1 / ux-9 / pux-*): the Vite dev
 * server serves the real SPA; every /api/** is intercepted with page.route(), so
 * no FastAPI backend is required. /api/me returns a NON-dev user so the avatar
 * dropdown renders and the email value is present on the profile form.
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

test.describe('UX-7 — read-only email is explained on the Profile page', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC1 (guard): the email field is non-editable — disabled or readonly.
  test('the email field is non-editable', async ({ page }) => {
    await openProfile(page);
    await expect(emailInput(page)).not.toBeEditable();
    const state = await emailInput(page).evaluate((el: HTMLInputElement) => ({
      disabled: el.disabled,
      readOnly: el.readOnly,
    }));
    expect(
      state.disabled || state.readOnly,
      'email input must be disabled or readonly (managed by the sign-in provider)',
    ).toBeTruthy();
  });

  // AC2: helper text explaining the field is externally managed is VISIBLE
  // beneath the disabled email field. RED today (no such text exists).
  test('helper text "Managed by your sign-in provider" appears beneath the email field', async ({ page }) => {
    await openProfile(page);
    const helper = emailGroup(page).getByText(/sign-in provider|managed by/i);
    await expect(
      helper,
      'a visible helper text (e.g. "Managed by your sign-in provider") must appear beneath the disabled email field',
    ).toBeVisible();
  });

  // AC3 (a11y nicety): the helper text is associated with the email input via
  // aria-describedby so it is announced. RED today (no aria-describedby).
  test('the helper text is associated with the email input via aria-describedby', async ({ page }) => {
    await openProfile(page);
    const describedBy = await emailInput(page).getAttribute('aria-describedby');
    expect(
      describedBy,
      'email input should reference its helper text via aria-describedby',
    ).toBeTruthy();
    const helper = profileForm(page).locator(`#${describedBy}`);
    await expect(
      helper,
      'aria-describedby must point at a visible element containing the explanation',
    ).toBeVisible();
    await expect(helper).toHaveText(/sign-in provider|managed by/i);
  });
});

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
