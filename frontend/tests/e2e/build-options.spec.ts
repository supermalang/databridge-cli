import { test, expect, Page } from '@playwright/test';

/**
 * XTF-13 — Build options for Express & regular build:
 *   split-by (MAIN-table columns only) + sample preview (--split-sample).
 *
 * NETWORK-MOCKED end-to-end, same harness as express-template-fill.spec.ts: the Vite
 * dev server serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * SURFACE UNDER TEST: the REGULAR build (Reports tab → "Build report"), which drives
 * `useRun().run('build-report', opts)` directly. The card wires BOTH the Express
 * Apply&build chain and the regular Build; per the test author's note, one surface
 * exercising the contract is acceptable. The regular Reports build is the cleanest to
 * drive (no AI/infer/apply chain in front of it), so it is the surface here.
 *
 * COLUMN SOURCE the implementer must read (and that this spec mocks): the split-by
 * selector is populated from `config.questions[]` (GET /api/config → YAML), using
 * `export_label`, filtered to MAIN-table questions only — a question is main-table when
 * it has NO `repeat_group` (the repeat_group field is null/absent); a question WITH a
 * `repeat_group` is a repeat-group column and must be EXCLUDED.
 *
 * SELECTOR CONTRACT (data-testid) the implementer must satisfy:
 *   - build-options       — the build-options control container (screenshot target)
 *   - build-split-by      — the split-by <select> (options = main-table export_labels)
 *   - build-sample-mode   — the sample-preview mode <select>: "all" (default) | "first-n"
 *   - build-sample-n      — the N input, shown/used when mode = "first-n"
 *   - build-run           — the action that triggers run('build-report', {split_by, split_sample})
 *
 * PAYLOAD CONTRACT: choosing a split-by column + "First 2 groups" → the POST body to
 * /api/run/build-report carries { split_by: "<export_label>", split_sample: 2 }. Choosing
 * "Build all groups (default)" and no split-by → neither field present.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Config with ONE main-table column (Site, no repeat_group) and ONE repeat-group
// column (member_name, repeat_group: household_members). The split-by selector must
// list "Site" and must NOT list "member_name". A template + downloaded session also
// exist so the build action is enabled (Reports.jsx buildMissing gate).
const MAIN_LABEL = 'Site';
const REPEAT_LABEL = 'member_name';
const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  'report:',
  '  template: templates/report_template.docx',
  'questions:',
  '  - kobo_key: Site',
  `    label: ${MAIN_LABEL}`,
  '    type: select_one',
  '    category: categorical',
  `    export_label: ${MAIN_LABEL}`,
  '    repeat_group: null',
  '  - kobo_key: household_members/member_name',
  `    label: ${REPEAT_LABEL}`,
  '    type: text',
  '    category: qualitative',
  `    export_label: ${REPEAT_LABEL}`,
  '    repeat_group: household_members',
  '',
].join('\n');

// SSE body with a terminal success status frame (useCommand reads res.body).
const BUILD_SSE =
  'event: log\ndata: {"line":"building report","level":"info"}\n\n' +
  'event: status\ndata: {"command":"build-report","status":"success"}\n\n';

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
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: true, has_ai: true } }));
  // Reports-tab loads. A template matching report.template + one data session so the
  // regular Build action is enabled (Reports.jsx buildMissing = []).
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  // A downloaded session so buildMissing has no "data" gap. The Reports page's data-files
  // FileTable reads session.label / session.session_id / session.files[].length, so the
  // mocked session must carry that shape — an object missing `files` crashes the page
  // render (FileTable → s.files.length) before build-options can mount.
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 's1', created_at: '2026-06-01T00:00:00Z', files: [{ name: 'data.csv' }] }] } }));
}

// Capture the POST body sent to /api/run/build-report, then reply with a success SSE.
function stubRunCapture(page: Page, captured: { value: any }) {
  return page.route('**/api/run/build-report', (r) => {
    try { captured.value = JSON.parse(r.request().postData() || '{}'); }
    catch { captured.value = null; }
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: BUILD_SSE });
  });
}

// Navigate to the Reports ("Browse") tab. The exact tab label is the implementer's, so
// match the tab whose route renders the build action; fall back through likely labels.
async function gotoReports(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project')).toBeVisible();
  // Deliver stage's DEFAULT subtab is Output/Sources — build-options is rendered on the
  // Reports SUBTAB, so click the top-level Deliver tab THEN the Reports subtab (mirrors
  // the sibling XTF-12 spec reports-delete-all.spec.ts gotoReports navigation).
  await page.locator('.tabs-bar .tab', { hasText: /reports|browse|deliver/i }).first().click();
  await page.locator('.subtabs-bar .subtab', { hasText: /reports/i }).click();
  // Sanity: the build-options control rendered (proves the bootstrap mocks are sound,
  // so any later failure is the missing XTF-13 UI — not a broken render).
  await expect(page.getByTestId('build-options')).toBeVisible();
}

test.describe('XTF-13 — build options: split-by (main-table only) + sample preview', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('split-by lists main-table columns only and forwards split_by + split_sample', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // The split-by selector lists the MAIN-table column and EXCLUDES the repeat-group one.
    const splitBy = page.getByTestId('build-split-by');
    await expect(splitBy.locator('option', { hasText: MAIN_LABEL })).toHaveCount(1);
    await expect(splitBy.locator('option', { hasText: REPEAT_LABEL })).toHaveCount(0);

    // Choose the main-table column + "First N groups" with N = 2.
    await splitBy.selectOption({ label: MAIN_LABEL });
    await page.getByTestId('build-sample-mode').selectOption('first-n');
    await page.getByTestId('build-sample-n').fill('2');

    // Trigger the build → the captured request body must carry both fields.
    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by).toBe(MAIN_LABEL);
    expect(captured.value.split_sample).toBe(2);
  });

  test('build all (default) + no split-by → neither field in the request body', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // Leave split-by unset and sample-mode on the default ("Build all groups").
    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by ?? null).toBeNull();
    expect(captured.value.split_sample ?? null).toBeNull();
  });

  test('visual baseline of the build-options control', async ({ page }) => {
    await gotoReports(page);
    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    // One assertion → one baseline per viewport (mobile/tablet/desktop) via
    // playwright.config.ts. The implementer produces the baselines for human approval.
    await expect(control).toHaveScreenshot('build-options.png');
  });
});
