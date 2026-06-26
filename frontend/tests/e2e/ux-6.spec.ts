import { test, expect, Page } from '@playwright/test';

/**
 * UX-6 — Inline validation for required name (ProjectForm).
 *
 * ProjectForm.jsx (the full-screen create/edit project form) today validates the
 * required Name field with a TOAST only:
 *
 *     const submit = async () => {
 *       if (!name.trim()) { toast('Name is required', 'err'); return; }   // ← toast, no inline error
 *       ...
 *     };
 *     <button className="btn btn-primary" disabled={busy} onClick={submit}>  // ← disabled only while busy
 *
 * The card requires:
 *   - an INLINE error beneath the name field when it is empty, and
 *   - the submit (Create) button DISABLED until the name has at least one character.
 *
 * The intended a11y wiring reuses the A11Y-5 pattern already used in the
 * Composition modals (frontend/src/lib/fieldError.js → useFieldErrors + the
 * <FieldError role="alert"> element):
 *   - the name <input> carries `aria-invalid="true"` while empty and
 *     `aria-invalid="false"` once it has content,
 *   - an inline error element with `role="alert"` and text /name is required/i is
 *     rendered beneath the input and referenced by the input's `aria-describedby`,
 *   - the primary action button (label "Create" in create mode) is `disabled`
 *     until the trimmed name is non-empty.
 *
 * CONTRACT under test (interface the implementer must satisfy — assertions are
 * derived from the AC, not from current code):
 *   - Inline error element: role="alert", text matching /name is required/i,
 *     located inside the Name `.profile-field` (beneath the input). Reachable via
 *     the name input's `aria-describedby`.
 *   - Name input: `aria-invalid="true"` when empty, `aria-invalid="false"` (or no
 *     invalid state) once non-empty.
 *   - Submit button (`.project-form .btn-primary`, label "Create"): `disabled`
 *     while the name is empty; enabled once non-empty.
 *
 * ACCEPTANCE CRITERIA (encoded below):
 *   AC1. With an empty name the submit button is DISABLED.
 *        RED today: disabled only on `busy`, so empty-name → enabled.
 *   AC2. An inline error message is visible beneath the name field when empty.
 *        RED today: there is no inline error element (toast only).
 *   AC3. Typing a character enables submit and clears the inline error
 *        (aria-invalid cleared). RED today: no inline error to clear and the
 *        disabled state never depended on the name.
 *   AC4. Submitting a valid name succeeds with NO toast error.
 *
 * We use the CREATE form (+ New project) so the name starts EMPTY and CLEAN —
 * this also keeps the UX-4 unsaved-changes guard (just shipped on this branch)
 * from interfering: an empty create form is not dirty.
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1/2/3/4): the Vite dev server
 * serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * SELECTORS (interface, not behavior under test — they survive the fix):
 *   - Switcher trigger:    `.project-switcher`
 *   - Open menu:           `.project-menu`
 *   - + New project:       `.project-menu__add` (text "+ New project")
 *   - ProjectForm root:    `.project-form`
 *   - Name field:          the Details input (label "Name *")
 *   - Submit button:       `.project-form .btn-primary` (label "Create")
 *   The terminal bar `.bottom-term` is position:fixed; hidden for the baseline.
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

const nameField = (page: Page) =>
  page.locator('.project-form .profile-field', { hasText: 'Name' }).locator('input');

// The primary action button — "Create" in create mode.
const submitBtn = (page: Page) =>
  page.locator('.project-form .btn-primary');

// The inline error beneath the name field — the A11Y-5 FieldError (role="alert").
const nameError = (page: Page) =>
  page.locator('.project-form .profile-field', { hasText: 'Name' })
      .getByRole('alert');

test.describe('UX-6 — inline validation for the required project name', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC1: empty name → submit disabled.
  // RED today: the Create button is `disabled={busy}` only, so with an empty,
  // non-busy form it is ENABLED.
  test('the submit button is disabled while the name is empty', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    await expect(nameField(page), 'create form starts with an empty name').toHaveValue('');
    await expect(
      submitBtn(page),
      'submit must be disabled until the name has at least one character',
    ).toBeDisabled();
  });

  // AC2: empty name → an inline error is visible beneath the name field.
  // RED today: validation is a toast only; there is no inline error element.
  test('an inline error appears beneath the name field when it is empty', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    // A real inline error element (not a toast) lives inside the Name field.
    await expect(
      nameError(page),
      'an inline error must be visible beneath the empty name field',
    ).toBeVisible();
    await expect(nameError(page)).toHaveText(/name is required/i);

    // Consistent with A11Y-5: the empty input is marked invalid and described by
    // the error element.
    await expect(nameField(page)).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await nameField(page).getAttribute('aria-describedby');
    expect(describedBy, 'name input must be described by its inline error element').toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toHaveText(/name is required/i);
  });

  // AC3: typing a character enables submit and clears the inline error.
  // RED today: no inline error to clear; submit's disabled state never tracked the
  // name.
  test('typing a character enables submit and clears the inline error', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    await nameField(page).fill('Q3 Monitoring');

    await expect(submitBtn(page), 'a non-empty name must enable submit').toBeEnabled();
    await expect(nameError(page), 'the inline error must disappear once the name is valid')
      .toHaveCount(0);
    await expect(nameField(page)).toHaveAttribute('aria-invalid', 'false');
  });

  // AC4: submitting a valid name succeeds with NO toast error.
  test('submitting a valid name succeeds with no error toast', async ({ page }) => {
    // createProject() POSTs to /api/projects; GET is the project list.
    await page.route('**/api/projects', (r) => {
      if (r.request().method() === 'POST') {
        return r.fulfill({ json: { id: 'proj-new', name: 'Q3 Monitoring', slug: 'q3-monitoring', role: 'admin' } });
      }
      return r.fulfill({ json: { active_id: PROJECT.id, is_superadmin: false, projects: [PROJECT] } });
    });

    await gotoApp(page);
    await openCreateForm(page);

    await nameField(page).fill('Q3 Monitoring');
    await submitBtn(page).click();

    // No error toast must surface. The success toast says "created"; the failure
    // path would say "is required" / "failed".
    await expect(
      page.locator('.toast.err, .toast--err, [data-toast="err"]'),
      'a valid submit must not raise an error toast',
    ).toHaveCount(0);
    // The form advances past create (the Members tab unlocks on success).
    await expect(page.locator('.project-form')).toBeVisible();
  });
});

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
