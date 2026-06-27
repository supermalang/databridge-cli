import { test, expect, Page } from '@playwright/test';

/**
 * PUX-7 — Gate Fetch/Download on a confirmed connection; flip the sample-data
 * affordance.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. On the Connection tab with NO confirmed-working connection in the current
 *      session, Fetch questions + Download data are DISABLED and Try with sample
 *      data is ENABLED (editor; not running).
 *   2. When the connection is CONFIRMED WORKING (POST /api/sources/test returned
 *      ok === true AND a positive `fields` count for the supplied Form UID),
 *      Fetch questions + Download data become ENABLED and Try with sample data
 *      becomes DISABLED.
 *   3. A successful TOKEN-ONLY test (ok === true but fields null/0 — no/invalid
 *      Form UID) does NOT enable Fetch/Download; they stay disabled.
 *   4. Editing any connection field (platform, API URL, API token, Form UID)
 *      CLEARS the confirmed status: Fetch/Download re-disable, Try-with-sample
 *      re-enables, until Test connection is re-run successfully.
 *   5. Each disabled action button conveys WHY it is disabled by a means other
 *      than styling alone (a non-empty `title`/tooltip distinct from the
 *      enabled-state help, telling the user to test the connection first).
 *   6. No new axe violations in either the gated or the confirmed state.
 *   7. Visual baselines of the disabled (pre-connection) state and the
 *      confirmed-working state, one per viewport via playwright.config.ts (a
 *      human approves them).
 *
 * NETWORK-MOCKED end-to-end (same harness as pux-1 / sample-data-path / a11y-*):
 * the Vite dev server serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. POST /api/sources/test is
 * STATEFUL — its mocked response is swapped per scenario via a mutable holder so
 * one helper can return a confirmed / token-only / failed result on demand.
 *
 * INTERFACE CONTRACT (selectors / endpoints — how to call, NOT what to assert):
 *   - Connection tab reached via Extract stage → Connection sub-tab.
 *   - Fetch questions  : <button> with visible text "Fetch questions".
 *   - Download data    : <button> with visible text "Download data".
 *   - Try with sample  : <button data-testid="try-sample-data">.
 *   - Test connection  : <button> with visible text "Test connection".
 *   - Connection fields: API token / API base URL / Form UID (aria-label),
 *                        platform picker `.platform-card`.
 *   - Backend probe    : POST /api/sources/test → { ok, fields, status, message }.
 *   These structural hooks pre-date this card and survive the gating addition.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// A connection-ready config (platform + url + token + form uid) so Test
// connection has something to probe — the gating is about the *test result*, not
// missing fields.
const CONFIG_YML = [
  'api:',
  '  platform: kobo',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

// Editor (admin → canEdit true) so the existing !canEdit rule never confounds
// the gating under test.
const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

type TestResult = { ok: boolean; fields: number | null; status?: number; message?: string };

// Mutable holder so a single /api/sources/test route can return different
// results across a test (confirmed → token-only, etc.).
async function stubBootstrap(page: Page, probe: { result: TestResult }) {
  // Catch-all FIRST (Playwright matches routes in REVERSE registration order —
  // last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  // Run + sample endpoints mocked benign so the enabled handlers never error.
  await page.route('**/api/run/**', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/sample-data', (r) => r.fulfill({ json: { ok: true } }));

  // The connection probe — returns whatever the holder currently carries.
  await page.route('**/api/sources/test', (r) =>
    r.fulfill({ json: probe.result }));
}

async function gotoConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  // App-ready wait that does not depend on Home's readiness render.
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  // The platform picker is the proof we are on Sources → Connection.
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

const fetchBtn = (page: Page) =>
  page.getByRole('button', { name: /fetch questions/i });
const downloadBtn = (page: Page) =>
  page.getByRole('button', { name: /download data/i });
const sampleBtn = (page: Page) =>
  page.locator('[data-testid="try-sample-data"]');
const testBtn = (page: Page) =>
  page.getByRole('button', { name: /^test connection$/i });

// Run Test connection and wait for the probe response so the resulting
// confirmed/unconfirmed state has settled before assertions.
async function clickTestConnection(page: Page) {
  const resp = page.waitForResponse(
    (r) => r.url().includes('/api/sources/test') && r.request().method() === 'POST',
  );
  await testBtn(page).click();
  await resp;
}

async function hideTerminalBar(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

// Inject axe-core from the CDN and run a focused interactive-role / button-name
// audit (same pattern + ruleset as the known-green a11y-*.spec.ts).
async function runAxe(page: Page) {
  await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js' });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected on window by the script tag.
    const results = await window.axe.run(document.querySelector('main') || document, {
      runOnly: {
        type: 'rule',
        values: ['button-name', 'aria-command-name', 'nested-interactive'],
      },
    });
    return results.violations.map((v: any) => ({ id: v.id, nodes: v.nodes.length }));
  });
}

test.describe('PUX-7 — Fetch/Download gated on a confirmed connection', () => {
  // AC 1: no confirmed connection → Fetch + Download disabled, Try-sample enabled.
  test('no confirmed connection: Fetch + Download disabled, Try with sample enabled', async ({ page }) => {
    await stubBootstrap(page, { result: { ok: true, fields: 42 } });
    await gotoConnection(page);

    await expect(
      fetchBtn(page),
      'with no successful test yet, Fetch questions must be disabled',
    ).toBeDisabled();
    await expect(
      downloadBtn(page),
      'with no successful test yet, Download data must be disabled',
    ).toBeDisabled();
    await expect(
      sampleBtn(page),
      'with no confirmed connection, Try with sample data must be enabled',
    ).toBeEnabled();
  });

  // AC 2: confirmed working (ok + positive fields) → Fetch + Download enabled,
  // Try-sample disabled.
  test('confirmed working connection: Fetch + Download enabled, Try with sample disabled', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);

    await clickTestConnection(page);

    await expect(
      fetchBtn(page),
      'after a confirmed-working test (ok + fields>0) Fetch questions must enable',
    ).toBeEnabled();
    await expect(
      downloadBtn(page),
      'after a confirmed-working test (ok + fields>0) Download data must enable',
    ).toBeEnabled();
    await expect(
      sampleBtn(page),
      'once a real connection is confirmed, Try with sample data must disable',
    ).toBeDisabled();
  });

  // AC 3: token-only success (ok but fields null/0) does NOT enable Fetch/Download.
  test('token-only test (ok but no positive field count) keeps Fetch + Download disabled', async ({ page }) => {
    const probe = { result: { ok: true, fields: null } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);

    await clickTestConnection(page);

    await expect(
      fetchBtn(page),
      'a token-valid-but-no-form test must NOT enable Fetch questions',
    ).toBeDisabled();
    await expect(
      downloadBtn(page),
      'a token-valid-but-no-form test must NOT enable Download data',
    ).toBeDisabled();
    await expect(
      sampleBtn(page),
      'without a confirmed form, Try with sample data stays enabled',
    ).toBeEnabled();
  });

  // AC 4: editing a connection field clears the confirmed status — Fetch/Download
  // re-disable and Try-with-sample re-enables. (API base URL is a connection field
  // and always renders as a plain input.)
  test('editing the API base URL after a confirmed test re-disables Fetch + Download', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);

    await clickTestConnection(page);
    // Precondition: confirmed-working state reached.
    await expect(fetchBtn(page)).toBeEnabled();
    await expect(sampleBtn(page)).toBeDisabled();

    // Edit the API base URL (a connection field) — this must stale the confirmation.
    await page.getByLabel(/API base URL/i).fill('https://example.test/api/v2/edited');

    await expect(
      fetchBtn(page),
      'editing a connection field must clear the confirmed status → Fetch re-disables',
    ).toBeDisabled();
    await expect(
      downloadBtn(page),
      'editing a connection field must clear the confirmed status → Download re-disables',
    ).toBeDisabled();
    await expect(
      sampleBtn(page),
      'editing a connection field must re-enable Try with sample data',
    ).toBeEnabled();
  });

  // AC 4 (Form UID variant): editing the Form UID also clears the confirmed status.
  test('editing the Form UID after a confirmed test re-disables Fetch + Download', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);

    await clickTestConnection(page);
    await expect(fetchBtn(page)).toBeEnabled();

    await page.getByLabel(/Form UID/i).fill('different-uid');

    await expect(
      fetchBtn(page),
      'editing the Form UID must clear the confirmed status → Fetch re-disables',
    ).toBeDisabled();
    await expect(
      downloadBtn(page),
      'editing the Form UID must clear the confirmed status → Download re-disables',
    ).toBeDisabled();
    await expect(sampleBtn(page)).toBeEnabled();
  });

  // AC 5: each disabled action conveys WHY by a non-styling means — a non-empty
  // title/tooltip distinct from the enabled-state help, pointing at "test the
  // connection first".
  test('disabled Fetch/Download convey why via a tooltip about testing the connection', async ({ page }) => {
    await stubBootstrap(page, { result: { ok: true, fields: 42 } });
    await gotoConnection(page);

    const fetchTitle = (await fetchBtn(page).getAttribute('title')) || '';
    const downloadTitle = (await downloadBtn(page).getAttribute('title')) || '';

    expect(
      fetchTitle.trim().length,
      'disabled Fetch questions must carry a non-empty tooltip explaining why',
    ).toBeGreaterThan(0);
    expect(
      downloadTitle.trim().length,
      'disabled Download data must carry a non-empty tooltip explaining why',
    ).toBeGreaterThan(0);

    // The disabled reason must point at testing the connection first — not the
    // existing enabled-state "pull the latest form schema" help text.
    expect(
      fetchTitle,
      `disabled Fetch tooltip must explain the connection must be tested; got ${JSON.stringify(fetchTitle)}`,
    ).toMatch(/test|connect/i);
    expect(
      downloadTitle,
      `disabled Download tooltip must explain the connection must be tested; got ${JSON.stringify(downloadTitle)}`,
    ).toMatch(/test|connect/i);
    expect(
      fetchTitle,
      'the disabled reason must differ from the enabled-state "pull the latest form schema" help',
    ).not.toMatch(/pull the latest form schema/i);
  });

  // AC 5 (sample side): once a real connection is confirmed and the sample button
  // is disabled, it too explains why by a non-styling means (a tooltip).
  test('once confirmed, the disabled Try-with-sample conveys why via a tooltip', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);

    await clickTestConnection(page);
    await expect(sampleBtn(page)).toBeDisabled();

    const sampleTitle = (await sampleBtn(page).getAttribute('title')) || '';
    expect(
      sampleTitle.trim().length,
      'the disabled Try-with-sample button must carry a non-empty explanatory tooltip',
    ).toBeGreaterThan(0);
  });

  // AC 6 (a11y): no new axe violations in the GATED (pre-connection) state.
  test('no axe violations in the gated (pre-connection) state', async ({ page }) => {
    await stubBootstrap(page, { result: { ok: true, fields: 42 } });
    await gotoConnection(page);
    await expect(fetchBtn(page)).toBeDisabled();

    const violations = await runAxe(page);
    expect(violations, `gated state axe violations: ${JSON.stringify(violations)}`).toEqual([]);
  });

  // AC 6 (a11y): no new axe violations in the CONFIRMED-working state.
  test('no axe violations in the confirmed-working state', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);
    await clickTestConnection(page);
    await expect(fetchBtn(page)).toBeEnabled();

    const violations = await runAxe(page);
    expect(violations, `confirmed state axe violations: ${JSON.stringify(violations)}`).toEqual([]);
  });

  // AC 7 visual: baseline of the disabled (pre-connection) state. Gate on the AC
  // so the baseline is not captured before the gating exists.
  test('visual baseline — gated (pre-connection) state', async ({ page }) => {
    await stubBootstrap(page, { result: { ok: true, fields: 42 } });
    await gotoConnection(page);
    await expect(fetchBtn(page)).toBeDisabled();
    await expect(sampleBtn(page)).toBeEnabled();
    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux7-connection-gated.png');
  });

  // AC 7 visual: baseline of the confirmed-working state.
  test('visual baseline — confirmed-working state', async ({ page }) => {
    const probe = { result: { ok: true, fields: 42 } as TestResult };
    await stubBootstrap(page, probe);
    await gotoConnection(page);
    await clickTestConnection(page);
    await expect(fetchBtn(page)).toBeEnabled();
    await expect(sampleBtn(page)).toBeDisabled();
    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux7-connection-confirmed.png');
  });
});
