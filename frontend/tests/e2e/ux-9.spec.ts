import { test, expect, Page } from '@playwright/test';

/**
 * UX-9 — Global "switching…" feedback.
 *
 * Switching projects (App.jsx `switchProject(id)`, ~198-210) does:
 *   await activateProject(id)  // POST /api/projects/{id}/activate
 *   setActiveProjectId(id)     // flips activeProject → switcher name updates
 *   dispatch('databridge:data-changed')  // remounts the keep-alive panes (hydrate)
 * Today there is NO visible feedback during the in-flight activate + hydrate
 * window, so a slow switch looks like a frozen UI.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *   AC1. A visible loading indicator (spinner / progress bar / overlay) appears
 *        DURING a project switch — i.e. while POST /api/projects/{id}/activate is
 *        in flight and the workspace is hydrating. RED today (no indicator).
 *   AC2. The indicator DISAPPEARS once the switch resolves and the workspace is
 *        ready (the switcher now shows the target project).
 *   AC3. No double-hydration / flicker when switching rapidly — triggering two
 *        switches in quick succession must never leave two overlays stacked, and
 *        the single indicator must still clear (never stuck on).
 *
 * ----------------------------------------------------------------------------
 * SELECTOR / CONTRACT FOR THE IMPLEMENTER (what these tests pin):
 *   - Switching indicator: a stable hook `data-testid="project-switching"`,
 *     present in the DOM only while a switch is in flight (activate + hydrate),
 *     removed once the workspace is ready.
 *   - Accessible live-region cue: the indicator (or an element it contains)
 *     carries `role="status"` and accessible text matching /switching/i, so
 *     screen-reader users are told the app is busy.
 *   - Exactly ONE indicator at a time: even under rapid double-switch, the count
 *     of `[data-testid="project-switching"]` is never > 1, and it returns to 0
 *     when the workspace settles.
 *   These survive the fix; the tests prefer the testid + role/text contract.
 * ----------------------------------------------------------------------------
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1 / ux-2 / ux-3 / pux-*): the
 * Vite dev server serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. We seed TWO active,
 * switchable projects. The /api/projects/{id}/activate stub can be held
 * in-flight (gated by a server-side promise we release from the test) so the
 * brief switching window is observable; on switch the /api/projects stub also
 * flips active_id so a re-bootstrap would reflect the new active project.
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

test.describe('UX-9 — switching indicator appears during a switch', () => {
  let gate: Gate;
  test.beforeEach(async ({ page }) => {
    gate = { hold: () => {}, release: () => {}, activates: [] };
    await stubBootstrap(page, gate);
  });

  // AC1: while the activate is in flight (and the workspace hydrates), a visible
  // loading indicator appears with a stable hook + an accessible live-region cue.
  test('a visible switching indicator appears while the switch is in flight', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('.project-switcher__name')).toHaveText(/Global Health/);

    // Hold the activate response so the in-flight window stays open.
    gate.hold();
    await openMenu(page);
    await clickSwitchTo(page, /Field Survey/);

    // The activate request fired (we are mid-switch)…
    await expect.poll(() => gate.activates, 'switch must POST /api/projects/proj-b/activate')
      .toContain(PROJECT_B.id);

    // …and a visible switching indicator must be shown during this window.
    await expect(
      indicator(page),
      'a visible switching indicator (data-testid="project-switching") must appear during the switch',
    ).toBeVisible();

    // It must expose an accessible live-region cue: role="status" + /switching/i text.
    const liveCue = page.getByRole('status').filter({ hasText: /switching/i });
    await expect(
      liveCue,
      'switching indicator must include an accessible role="status" cue with text /switching/i',
    ).toBeVisible();

    // Release so the test exits cleanly.
    gate.release();
  });

  // AC2: once the switch resolves and the workspace is ready, the indicator clears.
  test('the indicator disappears once the workspace is ready', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('.project-switcher__name')).toHaveText(/Global Health/);

    gate.hold();
    await openMenu(page);
    await clickSwitchTo(page, /Field Survey/);

    await expect(indicator(page), 'indicator visible mid-switch').toBeVisible();

    // Release the activate → switch resolves, workspace becomes ready.
    gate.release();

    // The switcher now reflects the target project (switch completed)…
    await expect(page.locator('.project-switcher__name')).toHaveText(/Field Survey/);
    // …and the indicator is gone.
    await expect(
      indicator(page),
      'switching indicator must disappear once the workspace is ready',
    ).toHaveCount(0);
  });

  // AC3: rapid switching must not stack overlays or get stuck. At no point may
  // more than one indicator be mounted, and it must clear once settled.
  test('rapid switching never stacks two indicators and clears when settled', async ({ page }) => {
    await gotoApp(page);
    await expect(page.locator('.project-switcher__name')).toHaveText(/Global Health/);

    gate.hold();
    await openMenu(page);

    // Two switches in quick succession while the first activate is still held.
    // The first switch is in-flight (its activate is awaited before the menu
    // closes), so the menu stays open and the second row is clickable without
    // reopening — this is precisely the rapid-switch race UX-9 must absorb.
    await clickSwitchTo(page, /Field Survey/);
    // The held first switch keeps the menu open (setProjMenuOpen(false) runs only
    // after activate resolves), so the second row is reachable without reopening.
    await expect(menu(page)).toBeVisible();
    await clickSwitchTo(page, /Global Health/);

    // While in flight there must be AT MOST one indicator (never a stacked pair).
    await expect(
      indicator(page),
      'rapid switching must never mount two switching indicators at once',
    ).toHaveCount(1);

    // Release everything and let the app settle.
    gate.release();
    gate.release();

    // The indicator must clear (never get stuck on) once the workspace is ready.
    await expect(
      indicator(page),
      'switching indicator must clear after rapid switching settles (never stuck on)',
    ).toHaveCount(0);
  });
});

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
