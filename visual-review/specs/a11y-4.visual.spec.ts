import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-4 — visual baselines (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/a11y-4.spec.ts: the two screenshot
 * assertions — the Reports download control, and the Validate icon-button row —
 * each captured after the same crash-resilient boot + axe audit the functional
 * tests use. The functional/axe tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 *
 * DUPLICATED SETUP: the memory-pressure launch flags / timeout, the crash-recovery
 * helpers (isInfraFlake, bootWithRecovery, auditPageWithRecovery), the bootstrap
 * /api stubs + constants, and the Reports/Validate navigation helpers are copied
 * verbatim from the e2e file — the two visual tests reference all of them.
 */

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
  // Renderer/tab death + navigation/wait timeouts, AND the boot-sanity assertion
  // timeout that surfaces when /api/projects' stub loses the race on a starved
  // boot (page shows "No project" → `getByText('Test Project')` times out). All are
  // transient under this container's memory pressure; a fresh-page re-boot (which
  // re-registers the route stubs) recovers. A genuine app regression still fails on
  // all retries, so broadening this only costs retry latency on real failures.
  /Target crashed|crashed|Target closed|page\.goto|Timeout .* exceeded|exceeded while waiting|toBeVisible|element\(s\) not found|Timeout:\s*\d+\s*ms/i
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

// Navigate Clean & check (formerly "Transform") → Validate.
async function gotoValidate(page: Page) {
  await page.locator('.tabs-bar [data-tab="transform"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Validate' }).click();
}

test.describe('A11Y-4 — Reports download: single styled <a download>', () => {
  test('visual baseline of the Reports download control', async ({ page }) => {
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
    page = await auditPageWithRecovery(page, openReports);

    // Visual baseline of the download control (3 viewports). Human approves.
    await expect(page.getByRole('link', { name: new RegExp(`download.*${REPORT_NAME}`, 'i') }))
      .toHaveScreenshot('reports-download-control.png');
  });
});

test.describe('A11Y-4 — Validate icon buttons: accessible names', () => {
  test('visual baseline of the Validate icon-button row', async ({ page }) => {
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
    page = await auditPageWithRecovery(page, openValidate);

    // Visual baseline of the icon-button row (3 viewports). Human approves.
    await expect(page.locator('.validate-finding__actions').first()).toHaveScreenshot('validate-icon-buttons.png');
  });
});
