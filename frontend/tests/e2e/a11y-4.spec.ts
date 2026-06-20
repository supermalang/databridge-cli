import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-4 — Valid interactive semantics & icon-button names (P1/P2).
 *
 * NETWORK-MOCKED end-to-end. The Vite dev server (playwright.config.ts → webServer)
 * serves the real SPA; every `/api/**` call is intercepted with `page.route()`, so
 * NO FastAPI backend is required.
 *
 * Acceptance criteria encoded here (all derived from the card, not the impl):
 *   1. The report download is a SINGLE `<a download href=…>` styled like a button —
 *      no `<button>` nested inside an `<a>` (no nested-interactive pair).
 *   2. The download link has an accessible name describing the action/target
 *      (e.g. "Download <report name>").
 *   3. Every icon-only button on Validate has an `aria-label` (a non-empty
 *      accessible name) — the Flag-as-PII and Hide-column buttons (~140–153).
 *   4. A Playwright axe audit reports zero `nested-interactive` and zero
 *      `button-name` violations on the Reports and Validate surfaces.
 *
 * Plus `toHaveScreenshot` baselines (3 viewports via playwright.config.ts) of the
 * Reports download control and the Validate icon-button row; a human approves them.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'editor', // editor → canEdit → action buttons enabled / resolvable by role
  is_archived: false,
};

const REPORT_NAME = 'annual_report.docx';

const REPORTS_ONE = {
  files: [{ name: REPORT_NAME, size_kb: 42.1, modified: '2026-06-10 09:30' }],
};

// A validation report whose finding column matches a question's export_label, so
// the per-finding icon buttons (Flag-as-PII / Hide-column) render ENABLED and are
// resolvable by accessible name.
const VALIDATE_REPORT = {
  n_rows: 100,
  n_columns: 3,
  checks: [
    {
      kind: 'missing',
      column: 'Age',
      severity: 'warning',
      message: 'Some rows are missing a value.',
      count: 5,
      pct: 0.05,
      examples: [],
    },
  ],
};

const QUESTIONS = {
  questions: [
    { kobo_key: 'age', label: 'Age', export_label: 'Age', type: 'integer', category: 'quantitative', group: '' },
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
  await page.route('**/api/reports', (r) => r.fulfill({ json: REPORTS_ONE }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: VALIDATE_REPORT }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
}

// Navigate Deliver → Reports.
async function gotoReports(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Deliver' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Reports' }).click();
}

// Navigate Transform → Validate.
async function gotoValidate(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Transform' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Validate' }).click();
}

test.describe('A11Y-4 — Reports download: single styled <a download>', () => {
  // AC#1 + AC#2: the download is a single <a download href> styled like a button —
  // no <button> nested inside an <a> — with an accessible name describing the
  // action/target ("Download <report name>") and a real href that downloads.
  //
  // NOTE on coverage: axe's `nested-interactive` rule does NOT reliably flag a
  // plain `<a href><button>…</button></a>` pair (it targets ARIA-role nesting), so
  // the STRUCTURAL assertions below — not axe — are the load-bearing guard for the
  // nested-interactive defect. The axe audit (next test) backstops button-name.
  test('download resolves as a single link with a descriptive name and no nested <button>', async ({ page }) => {
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');

    // Sanity: the SPA mounted logged-in with the active project.
    await expect(page.getByText('Test Project')).toBeVisible();
    await gotoReports(page);

    // Sanity: the Reports page rendered with the report listed.
    await expect(page.getByText(REPORT_NAME)).toBeVisible();

    // AC#2: the download control is a LINK whose accessible name describes the
    // action + target (e.g. "Download annual_report.docx").
    const downloadLink = page.getByRole('link', { name: new RegExp(`download.*${REPORT_NAME}`, 'i') });
    await expect(downloadLink).toBeVisible();

    // AC#2: it is a real <a download href=…> (single element, downloads the file).
    await expect(downloadLink).toHaveAttribute('href', /.+/);
    await expect(downloadLink).toHaveAttribute('download', /.*/);

    // AC#1: NO nested-interactive — the anchor has no <button> descendant.
    await expect(downloadLink.locator('button')).toHaveCount(0);

    // AC#1 (defensive): no <a> on the surface wraps a <button> (no nested pair).
    await expect(page.locator('.page a button')).toHaveCount(0);

    // AC#4: a Playwright axe audit reports no nested-interactive and no button-name
    // violations on the Reports surface. Scoped to `.page` so the always-present
    // global terminal bar (out of scope for this card) does not confound the result.
    // (Bundled with the structural checks above so this test is red on the current
    // nested-`<a><button>` markup — axe alone does not reliably flag that pair.)
    const results = await new AxeBuilder({ page })
      .include('.page')
      .withRules(['nested-interactive', 'button-name'])
      .analyze();
    expect(results.violations).toEqual([]);

    // Visual baseline of the download control (3 viewports). Human approves.
    await expect(downloadLink).toHaveScreenshot('reports-download-control.png');
  });
});

test.describe('A11Y-4 — Validate icon buttons: accessible names', () => {
  // AC#3: every icon-only button has an aria-label (a non-empty accessible name);
  // specifically the Validate Flag-as-PII and Hide-column icon buttons (~140–153).
  // The `title` may remain as a tooltip but must no longer be the ONLY name — so
  // we assert the aria-label attribute itself is present and non-empty.
  test('each icon-only button has a non-empty aria-label', async ({ page }) => {
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
    await expect(page.getByText('Test Project')).toBeVisible();
    await gotoValidate(page);

    // Sanity: the validation finding rendered (its column shows in the row), so the
    // per-finding icon buttons are present and enabled.
    await expect(page.locator('.validate-finding__column', { hasText: 'Age' })).toBeVisible();

    // The two icon-only action buttons in the finding row.
    const iconBtns = page.locator('.validate-finding__actions button');
    await expect(iconBtns).toHaveCount(2);

    // AC#3: each icon-only button carries a non-empty aria-label.
    const count = await iconBtns.count();
    for (let i = 0; i < count; i++) {
      const label = await iconBtns.nth(i).getAttribute('aria-label');
      expect((label || '').trim().length).toBeGreaterThan(0);
    }

    // AC#3: each is also resolvable by role + accessible name (Flag PII / Hide column).
    await expect(page.getByRole('button', { name: /flag.*pii/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /hide.*column/i })).toBeVisible();

    // AC#4: axe audit on the Validate surface — zero nested-interactive and
    // button-name violations. Scoped to `.page` (excludes the global terminal bar).
    const results = await new AxeBuilder({ page })
      .include('.page')
      .withRules(['nested-interactive', 'button-name'])
      .analyze();
    expect(results.violations).toEqual([]);

    // Visual baseline of the icon-button row (3 viewports). Human approves.
    await expect(page.locator('.validate-finding__actions').first()).toHaveScreenshot('validate-icon-buttons.png');
  });
});
