import { test, expect, Page } from '@playwright/test';

/**
 * UX-4 — Unsaved-changes guard on the project form.
 *
 * ProjectForm.jsx (the full-screen create/edit project form) has NO dirty
 * tracking today: editing the Details fields then clicking `← Back` discards the
 * edits silently — `onClick={() => onDone?.(proj?.id || null)}` closes the form
 * with no prompt.
 *
 * The card requires wiring ProjectForm into the SAME unsaved-changes guard the
 * shell already uses for project switching:
 *   - `dirtyRef` / `DirtyProvider` (frontend/src/lib/dirty.js) — the shared
 *     mutable ref the active page writes to via `useUnsavedGuard(dirty)`
 *     (frontend/src/hooks/useUnsavedGuard.js). Sources.jsx already does
 *     `useUnsavedGuard(!!dirty)`.
 *   - The confirmation surface is the shared `useConfirm()` Modal
 *     (frontend/src/components/ConfirmDialog.jsx → Modal.jsx): an accessible
 *     dialog with `role="dialog"` + `aria-modal="true"`, a title `<h3>`, a footer
 *     with a "Cancel" button (keep editing) and a primary action button whose
 *     label commits the navigation (e.g. "Discard" — matching the project-switch
 *     guard's "…& discard" wording and the card's UAT "Discard"/"Cancel").
 *
 * ACCEPTANCE CRITERIA (encoded below, NOT the implementation):
 *   AC1. Editing the name (making the form dirty) then clicking `← Back` prompts a
 *        confirmation dialog warning of unsaved changes.  RED today: Back closes
 *        the form silently with no dialog.
 *   AC2. Confirming ("Discard") proceeds — the form closes (edit discarded).
 *   AC3. Cancelling ("Cancel"/keep editing) leaves the form open with the edited
 *        value intact.
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1/2/3 / a11y-* / pux-*): the Vite
 * dev server serves the real SPA; every /api/** is intercepted with page.route(),
 * so no FastAPI backend is required.
 *
 * SELECTORS (interface, not behavior under test — they survive the fix):
 *   - Switcher trigger:    `.project-switcher`
 *   - Open menu:           `.project-menu`
 *   - Per-project gear:    `.project-menu__gear` (opens ProjectForm in edit mode)
 *   - ProjectForm root:    `.project-form`
 *   - Back button:         text `← Back` inside `.project-form__bar`
 *   - Name field:          the Details input (label "Name *")
 *   - Confirm dialog:      role="dialog" (the shared useConfirm Modal)
 *   The terminal bar `.bottom-term` is position:fixed; hidden for the baseline.
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

test.describe('UX-4 — unsaved-changes guard on the project form', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC1: editing the name makes the form dirty; clicking Back must prompt a
  // confirmation dialog. RED today — Back calls onDone() and the form closes
  // silently (no dialog ever appears).
  test('editing the name then clicking Back prompts an unsaved-changes confirmation', async ({ page }) => {
    await gotoApp(page);
    await openProjectForm(page);

    await nameField(page).fill('Global Health (edited)');
    await backBtn(page).click();

    // A confirmation dialog must appear warning of unsaved changes.
    await expect(dialog(page), 'clicking Back with unsaved edits must open a confirmation dialog')
      .toBeVisible();
    await expect(dialog(page)).toContainText(/unsaved|discard/i);

    // The form must NOT have navigated away yet — it is still mounted behind the dialog.
    await expect(page.locator('.project-form')).toBeVisible();
  });

  // AC2: confirming ("Discard") proceeds — the form closes (the edit is discarded).
  test('confirming Discard closes the form (navigation proceeds)', async ({ page }) => {
    await gotoApp(page);
    await openProjectForm(page);

    await nameField(page).fill('Global Health (edited)');
    await backBtn(page).click();
    await expect(dialog(page)).toBeVisible();

    // The primary action in the dialog footer discards & proceeds.
    await dialog(page).getByRole('button', { name: /discard/i }).click();

    // Navigation proceeds: the dialog and the form are both gone.
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.project-form')).toHaveCount(0);
  });

  // AC3: cancelling ("Cancel" / keep editing) leaves the form open with the edited
  // value intact.
  test('cancelling keeps the form open with the edited value intact', async ({ page }) => {
    await gotoApp(page);
    await openProjectForm(page);

    await nameField(page).fill('Global Health (edited)');
    await backBtn(page).click();
    await expect(dialog(page)).toBeVisible();

    // Cancel == keep editing.
    await dialog(page).getByRole('button', { name: /cancel/i }).click();

    // The dialog closes but the form stays, and the edit is preserved.
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.project-form')).toBeVisible();
    await expect(nameField(page)).toHaveValue('Global Health (edited)');
  });
});

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
