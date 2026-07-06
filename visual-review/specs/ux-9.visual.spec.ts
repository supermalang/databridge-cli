import { test, expect, Page } from '@playwright/test';

/**
 * UX-9 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-9.spec.ts: the single screenshot
 * assertion — the SWITCHING state with the in-flight switching indicator visible —
 * plus the minimal duplicated setup it needs (the two seeded switchable projects,
 * the gated /api stubs, the app-goto helper, and the switcher / menu / indicator /
 * openMenu / clickSwitchTo locators + helpers). The functional AC tests remain in
 * the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const PROJECT_A = {
  id: 'proj-a',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#0f766e',
  icon: '🌍',
};

const PROJECT_B = {
  id: 'proj-b',
  name: 'Field Survey',
  slug: 'field-survey',
  role: 'admin',
  is_archived: false,
  color: '#b91c1c',
  icon: '📋',
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

// A latch the test can use to hold the activate response in flight, then
// release it to let the switch resolve. Each call to gate() returns a fresh
// promise that activate awaits; resolveGate() releases the most recent one.
type Gate = {
  hold: () => void;        // make the NEXT activate hang until released
  release: () => void;     // let a held activate respond
  activates: string[];     // ids that have been requested
};

async function stubBootstrap(page: Page, gate: Gate) {
  // active_id starts on A and flips as the test switches (so a re-bootstrap is consistent).
  const state = { activeId: PROJECT_A.id, holding: false };
  let pending: (() => void) | null = null;

  gate.hold = () => { state.holding = true; };
  gate.release = () => { state.holding = false; pending?.(); pending = null; };

  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: {
        active_id: state.activeId,
        is_superadmin: false,
        projects: [PROJECT_A, PROJECT_B],
      },
    }));
  // Project switch — optionally held in flight so the switching window is observable.
  await page.route('**/api/projects/*/activate', async (r) => {
    const m = r.request().url().match(/\/api\/projects\/([^/]+)\/activate/);
    const id = m ? decodeURIComponent(m[1]) : '';
    gate.activates.push(id);
    state.activeId = id;
    if (state.holding) {
      await new Promise<void>((resolve) => { pending = resolve; });
    }
    await r.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

const switcher = (page: Page) => page.locator('.project-switcher');
const menu = (page: Page) => page.locator('.project-menu');
const indicator = (page: Page) => page.locator('[data-testid="project-switching"]');

async function openMenu(page: Page) {
  await switcher(page).click();
  await expect(menu(page)).toBeVisible();
}

// Click the row for the OTHER project (Field Survey) to trigger a switch.
async function clickSwitchTo(page: Page, name: RegExp) {
  await menu(page)
    .locator('.project-menu__item:not(.project-menu__archived)')
    .filter({ hasText: name })
    .click();
}

test.describe('UX-9 — visual baseline (one per viewport via playwright.config.ts)', () => {
  let gate: Gate;
  test.beforeEach(async ({ page }) => {
    gate = { hold: () => {}, release: () => {}, activates: [] };
    await stubBootstrap(page, gate);
  });

  // Visual baseline of the SWITCHING state (indicator visible). Gate on AC1 (the
  // indicator is shown) before capture so the baseline cannot pass vacuously
  // against pre-fix code. Hide the position:fixed terminal bar so it never
  // intrudes; screenshot the indicator element directly (no mask).
  test('visual baseline of the switching indicator', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });

    gate.hold();
    await openMenu(page);
    await clickSwitchTo(page, /Field Survey/);

    await expect(
      indicator(page),
      'switching indicator must be present before the baseline is captured',
    ).toBeVisible();

    await expect(indicator(page)).toHaveScreenshot('project-switching.png');

    gate.release();
  });
});
