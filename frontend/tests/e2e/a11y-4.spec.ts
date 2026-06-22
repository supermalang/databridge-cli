import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// A11Y-7: this spec boots the full keep-alive SPA and then runs the axe-core
// engine (a heavy in-page evaluate) on the Reports / Validate surfaces. Under
// `--repeat-each` the parallel viewport workers contend for memory in a
// constrained container (default /dev/shm is only 64 MB) and the renderer
// intermittently dies with "Target crashed" mid-`axe.analyze()`. These launch
// flags route shared memory to /tmp and drop the GPU process so a single boot is
// far leaner; the crash-recovery helper (auditPageWithRecovery) deterministically
// handles the rare residual crash by rebuilding the surface on a fresh page.
// Scoped to this spec so the rest of the visual suite is unaffected.
test.use({ launchOptions: { args: ['--disable-dev-shm-usage', '--disable-gpu', '--no-sandbox'] } });

// Under `--repeat-each` the three parallel viewport workers boot the heavy SPA
// and run axe concurrently in a memory-constrained container, so each step can be
// slow AND a renderer can transiently die. Give the recovery paths room to
// re-boot on a fresh page without tripping the default 30s per-test budget.
test.setTimeout(90_000);

// True when an error is the container-memory-pressure failure mode (a crashed /
// closed renderer, or a boot too slow to satisfy a sanity wait) — as opposed to a
// real assertion failure we must surface. Under `--repeat-each` the three parallel
// viewport workers contend for memory and any heavy app boot or axe scan can hit
// one of these transiently; the app behaviour itself is deterministic.
const isInfraFlake = (e: unknown) =>
  /Target crashed|crashed|Target closed|page\.goto|Timeout .* exceeded|exceeded while waiting/i
    .test(String((e as Error)?.message || e));

// Boot the surface via `rebuild(page)`, retrying on a fresh page if the boot dies
// or stalls under memory pressure. The browser CONTEXT survives a tab crash, so a
// fresh page recovers cleanly. Returns the live page.
async function bootWithRecovery(page: Page, rebuild: (p: Page) => Promise<void>): Promise<Page> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rebuild(page);
      return page;
    } catch (e) {
      if (attempt >= 2 || !isInfraFlake(e)) throw e;
      try { await page.close(); } catch { /* already gone */ }
      page = await page.context().newPage();
    }
  }
}

// Run the scoped axe audit, recovering from a "Target crashed" renderer death
// (the documented axe-core failure mode under memory pressure). When the tab
// crashes the page is unusable, but the browser CONTEXT survives — so we open a
// fresh page, let the caller re-establish the surface via `rebuild(page)`, and
// retry. Returns the live page (possibly the new one) so callers keep using it
// for any follow-up assertions/screenshots. The app-level finding-visibility race
// is fixed in GroupTree.jsx; this only absorbs the infra crash.
async function auditPageWithRecovery(
  page: Page,
  rebuild: (p: Page) => Promise<void>,
): Promise<Page> {
  for (let attempt = 0; ; attempt++) {
    try {
      const results = await new AxeBuilder({ page })
        .include('.page')
        .withRules(['nested-interactive', 'button-name'])
        .analyze();
      expect(results.violations).toEqual([]);
      return page;
    } catch (e) {
      if (attempt >= 2 || !isInfraFlake(e)) throw e;
      try { await page.close(); } catch { /* already gone */ }
      page = await page.context().newPage();
      await rebuild(page);
    }
  }
}

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
    // Establish (or re-establish, after a renderer crash) the Reports surface.
    const openReports = async (p: Page) => {
      await stubBootstrap(p);
      await p.goto('http://localhost:51730/');
      // Sanity: the SPA mounted logged-in with the active project.
      await expect(p.getByText('Test Project')).toBeVisible();
      await gotoReports(p);
      // Sanity: the Reports page rendered with the report listed.
      await expect(p.getByText(REPORT_NAME)).toBeVisible();
    };
    page = await bootWithRecovery(page, openReports);

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
    // Recovers from a "Target crashed" renderer death under memory pressure (A11Y-7).
    page = await auditPageWithRecovery(page, openReports);

    // Visual baseline of the download control (3 viewports). Human approves.
    await expect(page.getByRole('link', { name: new RegExp(`download.*${REPORT_NAME}`, 'i') }))
      .toHaveScreenshot('reports-download-control.png');
  });
});

test.describe('A11Y-4 — Validate icon buttons: accessible names', () => {
  // AC#3: every icon-only button has an aria-label (a non-empty accessible name);
  // specifically the Validate Flag-as-PII and Hide-column icon buttons (~140–153).
  // The `title` may remain as a tooltip but must no longer be the ONLY name — so
  // we assert the aria-label attribute itself is present and non-empty.
  test('each icon-only button has a non-empty aria-label', async ({ page }) => {
    // Establish (or re-establish, after a renderer crash) the Validate surface
    // and wait for the finding row to be VISIBLE — the row only mounts once both
    // /api/validate and /api/questions have resolved and the finding's group node
    // is expanded (fixed deterministically in GroupTree.jsx for A11Y-7).
    const openValidate = async (p: Page) => {
      await stubBootstrap(p);
      await p.goto('http://localhost:51730/');
      await expect(p.getByText('Test Project')).toBeVisible();
      await gotoValidate(p);
      // Sanity: the validation finding rendered (its column shows in the row), so
      // the per-finding icon buttons are present, visible, and enabled.
      await expect(p.locator('.validate-finding__column', { hasText: 'Age' })).toBeVisible();
    };
    page = await bootWithRecovery(page, openValidate);

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
    // Recovers from a "Target crashed" renderer death under memory pressure (A11Y-7).
    page = await auditPageWithRecovery(page, openValidate);

    // Visual baseline of the icon-button row (3 viewports). Human approves.
    await expect(page.locator('.validate-finding__actions').first()).toHaveScreenshot('validate-icon-buttons.png');
  });
});
