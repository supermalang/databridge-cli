import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-5 — Accessible form-validation messaging.
 *
 * NETWORK-MOCKED end-to-end. The Vite dev server (playwright.config.ts → webServer)
 * serves the real SPA; every `/api/**` call is intercepted with `page.route()`, so
 * NO FastAPI backend is required.
 *
 * This spec is the requirement, not a re-read of the implementation. Per the card's
 * Acceptance criteria, when a field in a Composition modal is invalid the input must:
 *   - set `aria-invalid="true"`, and
 *   - set `aria-describedby` referencing the id of its error-message element, whose
 *     text is the visible error;
 * and when the field becomes valid again `aria-invalid` must clear (removed/`false`)
 * and the describedby link to the (now-gone) error must be cleared. The error element
 * carries a stable id and is associated with EXACTLY its field. An axe audit of the
 * invalid-state modal must report no `aria-valid-attr` / `aria-describedby`-target
 * violations.
 *
 * Driving selectors (NOT assertions): the Composition "Add chart" modal exposes a
 * Name <input> (placeholder "satisfaction_overview"); submitting it empty triggers a
 * required-field validation error containing the word "required".
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Minimal config the app yaml-parses on boot (App.jsx reads form.alias). A couple of
// questions so the Composition page has column options, but no charts (so the only
// chart modal we open is the fresh "Add chart" one).
const CONFIG_YML = [
  'form:',
  '  alias: test',
  'questions:',
  '  - {kobo_key: q_region, label: Region, export_label: Region, type: select_one}',
  '  - {kobo_key: q_age, label: Age, export_label: Age, type: integer}',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below take precedence (Playwright matches
  // routes in REVERSE registration order — last registered wins). /api/projects must
  // NOT fall through to {} (App.jsx would setProjects(undefined) and crash).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/base-tables', (r) => r.fulfill({ json: { tables: [] } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

// Navigate to Analyze → "Charts & indicators" and open the "Add chart" modal.
async function openAddChartModal(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Analyze' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Charts & indicators' }).click();
  await page.getByRole('button', { name: '+ Add chart' }).click();

  const modal = page.locator('.modal[role="dialog"]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
  return modal;
}

test.describe('A11Y-5 — Composition modal field errors are programmatically linked', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('invalid field sets aria-invalid + aria-describedby to its error text; valid clears it', async ({ page }) => {
    // SANITY: the real SPA mounted logged-in with the active project, so any later
    // failure is the missing A11Y-5 wiring — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');
    await expect(nameInput).toBeVisible();

    // Trigger the required-field validation by saving with an empty Name.
    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();

    // The visible error must appear (sanity — proves validation fired, so a later
    // aria failure is the missing linkage, not a missing error).
    const errorText = modal.getByText(/required/i).first();
    await expect(errorText).toBeVisible();

    // AC: the invalid input is marked aria-invalid="true".
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');

    // AC: aria-describedby references the id of the error-message element.
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby').toBeTruthy();

    // AC: the referenced element exists, has that exact (stable, non-empty) id, and
    // its text is the error message reachable by assistive tech.
    const ids = (describedBy as string).split(/\s+/).filter(Boolean);
    expect(ids.length, 'aria-describedby must reference at least one id').toBeGreaterThan(0);
    let matched = false;
    for (const id of ids) {
      const target = modal.locator(`#${CSS.escape(id)}`);
      if ((await target.count()) === 0) continue;
      const txt = (await target.first().innerText()).trim();
      if (/required/i.test(txt)) matched = true;
    }
    expect(
      matched,
      'an aria-describedby target of the Name input must contain the "required" error text',
    ).toBeTruthy();

    // Visual baseline of the modal in its invalid (error-shown) state (3 viewports
    // via playwright.config.ts). The implementer produces the baselines for approval.
    await expect(page).toHaveScreenshot('composition-modal-invalid.png');

    // AC: correcting the field clears the invalid state. aria-invalid is removed or
    // "false", and the describedby no longer points at a (now-gone) error element.
    await nameInput.fill('satisfaction_overview');

    await expect
      .poll(async () => {
        const v = await nameInput.getAttribute('aria-invalid');
        return v === null || v === 'false';
      }, { message: 'aria-invalid must be removed or set to "false" once the field is valid' })
      .toBe(true);

    await expect
      .poll(async () => {
        const db = await nameInput.getAttribute('aria-describedby');
        if (!db) return true; // link cleared entirely
        // If a describedby remains, it must NOT point at a visible "required" error.
        for (const id of db.split(/\s+/).filter(Boolean)) {
          const target = modal.locator(`#${CSS.escape(id)}`);
          if ((await target.count()) > 0) {
            const txt = (await target.first().innerText()).trim();
            if (/required/i.test(txt)) return false;
          }
        }
        return true;
      }, { message: 'the describedby link to the error must be cleared once the field is valid' })
      .toBe(true);
  });

  test('error message element has a stable id (no ambiguous/duplicate ids in the modal)', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');

    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByText(/required/i).first()).toBeVisible();

    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby').toBeTruthy();

    // AC: the error is associated with EXACTLY its field — the referenced id resolves
    // to a single unique element in the document (no shared/ambiguous ids).
    for (const id of (describedBy as string).split(/\s+/).filter(Boolean)) {
      const count = await page.locator(`#${CSS.escape(id)}`).count();
      expect(count, `aria-describedby target id "${id}" must be unique in the document`).toBe(1);
    }
  });

  test('axe audit of the invalid-state modal: no aria-valid-attr / aria-describedby violations', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');

    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByText(/required/i).first()).toBeVisible();

    // PRECONDITION (makes the axe check non-vacuous): the AC's required wiring must be
    // PRESENT in the invalid state. axe rules below only fault BROKEN aria — a modal
    // with no aria wiring at all would pass axe trivially, so we first assert the
    // field is actually wired (aria-invalid + a resolvable aria-describedby target).
    // Today there is no wiring, so this fails red for the right reason; once the
    // implementer adds it, the axe audit then proves the wiring is well-formed.
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby for the axe audit to be meaningful').toBeTruthy();
    for (const id of (describedBy as string).split(/\s+/).filter(Boolean)) {
      await expect(modal.locator(`#${CSS.escape(id)}`), `aria-describedby target #${id} must exist`).toHaveCount(1);
    }

    // AC: a Playwright axe audit on the modal in an invalid state reports no
    // aria-valid-attr / aria-describedby-target violations.
    const results = await new AxeBuilder({ page })
      .include('.modal[role="dialog"]')
      .withRules(['aria-valid-attr', 'aria-valid-attr-value'])
      .analyze();

    expect(
      results.violations,
      `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  });
});
