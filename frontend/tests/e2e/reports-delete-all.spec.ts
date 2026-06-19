import { test, expect, Page } from '@playwright/test';

/**
 * XTF-12 — Reports page: "Delete all reports" + bulk-delete endpoint.
 *
 * NETWORK-MOCKED end-to-end. The Vite dev server (playwright.config.ts → webServer)
 * serves the real SPA; every `/api/**` call is intercepted with `page.route()`, so
 * NO FastAPI backend is required. We stub:
 *   - the App.jsx bootstrap so the app renders logged-in with an active project as
 *     an EDITOR (so the `canEdit` gate allows the destructive control);
 *   - the Reports-tab loads: GET /api/reports (two reports), GET /api/data/sessions,
 *     GET /api/templates, GET /api/config, GET /api/periods;
 *   - the NEW bulk endpoint: DELETE /api/reports → {ok, deleted: 2}, after which the
 *     reports list is re-fetched and must come back empty (the page calls
 *     loadReports() after a delete).
 *
 * Contract the implementer must satisfy:
 *   - data-testid="reports-delete-all"  — the "Delete all reports" control, visible
 *     for editors/admins, hidden/disabled for viewers (existing `canEdit` gate),
 *     prompts a confirm (the app's useConfirm Modal) before deleting.
 *   - DELETE /api/reports (bulk, no filename) → {ok, deleted: N}; called exactly once.
 *   - After confirming, the report list empties and the empty-state copy shows.
 *
 * The confirm dialog is the shared useConfirm() Modal: a primary destructive button
 * (default label "Delete") in a footer; we click it by role/name to confirm.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'editor',          // editor → canEdit true → destructive control allowed
  is_archived: false,
};

const REPORTS_TWO = {
  files: [
    { name: 'annual_report.docx', size_kb: 42.1, modified: '2026-06-10 09:30' },
    { name: 'q2_report.docx', size_kb: 38.7, modified: '2026-06-12 14:05' },
  ],
};

const CONFIG_YML = 'form:\n  alias: test\n';

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below take precedence (Playwright
  // matches routes in REVERSE registration order — last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: true, has_ai: true } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
}

// Navigate Deliver → Reports.
async function gotoReports(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
}

test.describe('XTF-12 — Delete all reports', () => {
  test('shows "Delete all reports", confirms, calls bulk DELETE once, empties the list', async ({ page }) => {
    await stubBootstrap(page);

    // GET /api/reports returns two reports BEFORE the bulk delete, and an empty
    // list AFTER it (the page calls loadReports() once the delete resolves). A
    // single mutable flag flips the response so the same route serves both phases.
    const state = { deleted: false };
    let deleteCalls = 0;

    await page.route('**/api/reports', (route) => {
      const method = route.request().method();
      if (method === 'DELETE') {
        deleteCalls += 1;
        state.deleted = true;
        return route.fulfill({ json: { ok: true, deleted: 2 } });
      }
      // GET (list)
      return route.fulfill({ json: state.deleted ? { files: [] } : REPORTS_TWO });
    });

    await page.goto('http://localhost:51730/');

    // Sanity: the SPA mounted logged-in with the active project (so any later
    // failure is specifically the missing XTF-12 control — not a broken render).
    await expect(page.getByText('Test Project')).toBeVisible();
    await gotoReports(page);

    // Sanity: the Reports page rendered with its two reports listed.
    await expect(page.getByText('annual_report.docx')).toBeVisible();
    await expect(page.getByText('q2_report.docx')).toBeVisible();

    // The "Delete all reports" control is present + visible for an editor.
    const deleteAll = page.getByTestId('reports-delete-all');
    await expect(deleteAll).toBeVisible();

    // Visual baseline of the populated list with the "Delete all" button
    // (3 viewports via playwright.config.ts). Implementer produces the baselines.
    await expect(page).toHaveScreenshot('reports-delete-all.png');

    // Click it → a confirm dialog appears (the shared useConfirm Modal).
    await deleteAll.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Confirm: the destructive primary action in the dialog footer.
    await dialog.getByRole('button', { name: /delete/i }).click();

    // The bulk DELETE /api/reports was called exactly once.
    await expect.poll(() => deleteCalls).toBe(1);

    // The list empties and the empty-state copy shows.
    await expect(page.getByText('annual_report.docx')).toHaveCount(0);
    await expect(page.getByText('q2_report.docx')).toHaveCount(0);
    await expect(page.getByText(/no reports yet/i)).toBeVisible();
  });
});
