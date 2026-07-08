import { test, expect, Page } from '@playwright/test';

/**
 * A11Y-5 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-5.spec.ts: the screenshot
 * assertion of the Composition "Add chart" modal in its invalid (error-shown)
 * state — plus the minimal duplicated setup it needs (the bootstrap /api stubs,
 * the openAddChartModal helper, and the steps that drive the modal into its
 * invalid state). The functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
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

  test('visual baseline of the invalid-state Composition modal', async ({ page }) => {
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

    // Visual baseline of the modal in its invalid (error-shown) state (3 viewports
    // via playwright.config.ts). The implementer produces the baselines for approval.
    await expect(page).toHaveScreenshot('composition-modal-invalid.png');
  });
});
