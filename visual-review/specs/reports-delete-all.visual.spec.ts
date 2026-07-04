import { test, expect, Page } from '@playwright/test';

/**
 * XTF-12 — Reports page: "Delete all reports" + bulk-delete endpoint.
 *
 * VIS-12: visual baseline extracted from frontend/tests/e2e/reports-delete-all.spec.ts.
 * Minimal duplicated setup needed to reach the populated Reports list with the
 * "Delete all reports" control visible for the screenshot.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'editor',
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
  await page.route('**/api/reports', (r) => r.fulfill({ json: REPORTS_TWO }));
}

async function gotoReports(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
}

test.describe('XTF-12 — Delete all reports visual baseline', () => {
  test('visual baseline of the populated list with the "Delete all" button', async ({ page }) => {
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');

    await expect(page.getByText('Test Project')).toBeVisible();
    await gotoReports(page);

    await expect(page.getByText('annual_report.docx')).toBeVisible();
    await expect(page.getByText('q2_report.docx')).toBeVisible();

    const deleteAll = page.getByTestId('reports-delete-all');
    await expect(deleteAll).toBeVisible();

    await expect(page).toHaveScreenshot('reports-delete-all.png');
  });
});
