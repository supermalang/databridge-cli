import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-5 — Reduce setup-before-value friction (no-credentials sample-data path).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. With NO credentials configured, the Sources page (Extract → Connection)
 *      offers a no-credentials "Try with sample data" affordance that does NOT
 *      require a Kobo/Ona token or an AI key — and it is keyboard-operable.
 *   2. Invoking it loads the bundled sample dataset into the active project so the
 *      app advances into a DATA-PRESENT state — /api/state flips has_data true and
 *      the downstream stages (Questions / Composition) now show sample columns.
 *   3. The normal connect flow (platform picker + token field + AI-key field) is
 *      still present and unchanged alongside the sample affordance.
 *   4. Visual baselines of the Sources sample-data affordance and the resulting
 *      data-present state, one per viewport via playwright.config.ts (a human
 *      approves them).
 *
 * NETWORK-MOCKED end-to-end (same harness as pux-1 / pux-2 / a11y-*): the Vite dev
 * server serves the real SPA; every /api/** is intercepted with page.route(), so
 * no FastAPI backend is required. The NEW sample-dataset endpoint
 * (POST /api/sample-data) is mocked to succeed; /api/state + /api/questions are
 * STATEFUL — they reflect the data-present sample state only AFTER the sample POST
 * has fired (mirrors the `switched` flag pattern in pux-2's PUX-6 suite).
 *
 * CONTRACT (for the implementer — tests only; do NOT implement here):
 *   - Endpoint:   POST /api/sample-data — editor-gated, loads the bundled sample
 *                 dataset into the active project workspace (no credentials).
 *   - Affordance: a real, keyboard-operable <button> on Sources → Connection with
 *                 data-testid="try-sample-data" and an accessible name matching
 *                 /sample data|try.*sample/i. Clicking it POSTs /api/sample-data
 *                 and, on success, advances the app to the data-present state
 *                 (e.g. by dispatching the existing `databridge:data-changed`
 *                 event that App.jsx listens on to refetch /api/state).
 *
 * SELECTORS (interface, not behavior under test):
 *   - Primary nav stages: `.tabs-bar [data-tab="<stageId>"]` (Extract id `extract`,
 *     Transform id `transform`). Active: `.tab.active`.
 *   - Sub-tabs: `.subtabs-bar .subtab` (Connection / Questions).
 *   - Sources platform picker: `.platform-card`; token field: aria-label "API token".
 *   - Questions table: `.q-table`.
 *   - The position:fixed terminal bar: `.bottom-term` (hidden for full-surface shots).
 * These structural hooks pre-date this card and survive the affordance addition.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Credential-free config: NO api.token, NO ai key — the no-credentials starting point.
const CONFIG_YML = [
  'api:',
  '  platform: kobo',
  '  url: https://kf.kobotoolbox.org/api/v2',
  'form:',
  '  alias: sample',
  '',
].join('\n');

// The bundled sample's questions — only surfaced AFTER the sample load.
const SAMPLE_QUESTIONS = {
  questions: [
    { kobo_key: 'demographics/region', label: 'Region', export_label: 'Region', type: 'select_one', category: 'categorical' },
    { kobo_key: 'demographics/age', label: 'Age', export_label: 'Age', type: 'integer', category: 'quantitative' },
  ],
};

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

// Stateful bootstrap: `state.loaded` flips to true once POST /api/sample-data fires,
// after which /api/state reports data present and /api/questions returns the sample
// columns. Catch-all FIRST (Playwright matches routes in REVERSE registration order —
// last registered wins).
async function stubBootstrap(page: Page, state: { loaded: boolean }) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));

  // Questions: empty until the sample is loaded, then the sample columns.
  await page.route('**/api/questions', (r) =>
    r.fulfill({ json: state.loaded ? SAMPLE_QUESTIONS : { questions: [] } }));

  // Readiness: has_data flips true once the sample is loaded.
  await page.route('**/api/state', (r) =>
    r.fulfill({
      json: {
        has_questions: state.loaded,
        has_data: state.loaded,
        has_templates: false,
        has_ai: false,
      },
    }));

  // The NEW sample-dataset endpoint — mocked to succeed; marks the workspace loaded.
  await page.route('**/api/sample-data', (r) => {
    state.loaded = true;
    return r.fulfill({ json: { ok: true } });
  });
}

async function gotoConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  // Boot signal that does not depend on Home's readiness render: the project switcher.
  await expect(page.locator('.project-switcher')).toBeVisible();
  // Navigate Home → Extract → Connection (the Sources "setup" section).
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  // The platform picker is the proof we are on Sources → Connection.
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

// The no-credentials sample affordance — by its agreed testid, falling back to its
// accessible name so the contract is robust to the exact element.
const sampleAffordance = (page: Page) =>
  page.locator('[data-testid="try-sample-data"]')
    .or(page.getByRole('button', { name: /sample data|try.*sample/i }));

// Tab from body until `target` is the focused element (keyboard-operability).
async function tabUntilFocused(page: Page, target: Locator, maxTabs = 40): Promise<boolean> {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const handle = await target.elementHandle();
  if (!handle) return false;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate((el) => el === document.activeElement, handle).catch(() => false);
    if (focused) return true;
  }
  return false;
}

// Hide the position:fixed terminal bar before full-surface screenshots so it does
// not paint a band across the shot (the card forbids masking it — masking paints an
// ugly box; hiding removes it cleanly).
async function hideTerminalBar(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

test.describe('PUX-5 — no-credentials "Try with sample data" path', () => {
  test('Sources offers a keyboard-operable "Try with sample data" affordance with no credentials', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    const affordance = sampleAffordance(page);
    await expect(
      affordance,
      'Sources → Connection must offer a no-credentials "Try with sample data" affordance',
    ).toBeVisible();

    // It is a real, focusable control (button or link), not a div.
    const tag = await affordance.evaluate((el) => el.tagName.toLowerCase());
    expect(['button', 'a'], `the affordance must be a real <button>/<a> (got <${tag}>)`).toContain(tag);

    // It has an accessible name matching the agreed phrasing.
    const name = (await affordance.evaluate(
      (el) => (el.textContent || el.getAttribute('aria-label') || '').trim(),
    )) || '';
    expect(name, 'the affordance must have an accessible name').toMatch(/sample data|try.*sample/i);

    // Keyboard-operable: reachable in the tab order.
    const reached = await tabUntilFocused(page, affordance);
    expect(reached, 'the "Try with sample data" affordance must be reachable by keyboard (Tab)').toBe(true);
  });

  test('clicking "Try with sample data" advances the app to a data-present state', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    // Click the no-credentials affordance → POST /api/sample-data (mocked success).
    const postPromise = page.waitForRequest(
      (req) => req.url().includes('/api/sample-data') && req.method() === 'POST',
    );
    await sampleAffordance(page).click();
    await postPromise; // the affordance actually calls the sample-dataset endpoint

    // The app advances into a data-present state: the sample columns now appear on
    // Questions. Navigate Transform → Questions and assert the sample columns render.
    await page.locator('.tabs-bar [data-tab="transform"]').click();
    await page.locator('.subtabs-bar .subtab', { hasText: /questions/i }).click();

    const qTable = page.locator('.q-table');
    await expect(qTable, 'after the sample load the Questions table must render').toBeVisible();
    await expect(
      qTable,
      'after the sample load the Questions stage must show the sample columns (real columns + rows)',
    ).toContainText(/Region/i);
    await expect(qTable).toContainText(/Age/i);
  });

  test('the normal connect flow (token + AI key) is still present and unchanged', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    // The sample affordance does not replace the connect flow — both coexist.
    await expect(sampleAffordance(page)).toBeVisible();

    // Platform picker (Kobo / Ona / INFORM) is still present.
    await expect(page.locator('.platform-card').first()).toBeVisible();

    // The real API-token input is still present (the normal connect flow).
    await expect(
      page.getByLabel(/API token/i),
      'the normal connect flow must keep its API-token input',
    ).toBeVisible();

    // The AI-key affordance is still reachable: the AI configuration sub-tab.
    await expect(
      page.locator('.subtabs-bar .subtab', { hasText: /ai/i }),
      'the AI-key configuration sub-tab must remain present',
    ).toBeVisible();
  });

  test('visual baseline of the Sources sample-data affordance (no credentials)', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    // Gate on the AC so the baseline is not captured before the affordance exists.
    await expect(sampleAffordance(page)).toBeVisible();

    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux5-sources-sample-affordance.png');
  });

  test('visual baseline of the resulting data-present Questions state', async ({ page }) => {
    const state = { loaded: false };
    await stubBootstrap(page, state);
    await gotoConnection(page);

    await sampleAffordance(page).click();
    await page.waitForRequest(
      (req) => req.url().includes('/api/sample-data') && req.method() === 'POST',
    );

    await page.locator('.tabs-bar [data-tab="transform"]').click();
    await page.locator('.subtabs-bar .subtab', { hasText: /questions/i }).click();

    // Gate on the AC so the baseline captures the data-present state, not the empty one.
    const qTable = page.locator('.q-table');
    await expect(qTable).toBeVisible();
    await expect(qTable).toContainText(/Region/i);

    await hideTerminalBar(page);
    await expect(page.locator('main')).toHaveScreenshot('pux5-data-present-questions.png');
  });
});
