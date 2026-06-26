import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * PERF-3 — Per-page skeleton loaders for the data-driven tabs (perceived performance).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation.
 *
 * The five data-driven tabs (Questions, Sources, Profile, Reports, Validate) today render a
 * single centred grey "Loading…" line (`.empty-state`) on first mount while their mount fetch is
 * in flight. This card replaces that plain text with a reusable, layout-matched <Skeleton>
 * placeholder. Acceptance criteria encoded here:
 *
 *   1. A reusable Skeleton component exists with a shimmer animation; its CONTAINER exposes
 *      `aria-busy="true"` and a visually-hidden text label (e.g. "Loading"), and the decorative
 *      shimmer blocks are `aria-hidden="true"` so AT announces a SINGLE loading state.
 *      (Interface hook: the container carries `data-testid="skeleton"`.)
 *   2. Each mount-loading tab renders a layout-matched skeleton IN PLACE OF the current plain
 *      "Loading…" text while its mount fetch is in flight — explicitly proven for Questions
 *      (`/api/questions`) and Profile (`/api/profile`): the skeleton is visible while the request
 *      is pending and the plain "Loading…" `.empty-state` text is gone.
 *   3. Once the data arrives, the skeleton is fully replaced by the real content (no skeleton
 *      left stuck on screen).
 *   4. The skeleton honours `prefers-reduced-motion: reduce` — NO shimmer animation under reduced
 *      motion (a static placeholder is shown instead).
 *   5. A returning user (tab already mounted, data cached via keep-alive) sees NO skeleton on tab
 *      switch — only the FIRST mount shows it.
 *   6. An axe audit on a skeleton state reports no new violations (the busy region is announced
 *      once; shimmer blocks are hidden).
 *   7. `toHaveScreenshot` baselines of a Questions skeleton and a Profile skeleton at all three
 *      viewports (mobile/tablet/desktop via playwright.config.ts); a human approves them.
 *
 * NETWORK-MOCKED end to end (same harness as the a11y / pux / i18n specs): Vite serves the real
 * SPA; every /api/** call is intercepted with page.route(), so no FastAPI backend is required.
 * To exercise the loading state deterministically we hold open the page's mount fetch with a
 * gate, assert the skeleton, then release the gate and assert the swap to real content.
 *
 * SELECTORS (interface, not behavior under test) — stable structural hooks reused from the
 * existing green specs, plus the one new contract this card introduces:
 *   - Primary nav stages: `.tabs-bar [data-tab="<stageId>"]`.
 *   - Sub-tabs: `.subtabs-bar .subtab` (Questions/Profile/Validate live under `transform`).
 *   - Plain loading text today: `.empty-state` (the line this card replaces).
 *   - NEW skeleton container: `[data-testid="skeleton"]` with `aria-busy="true"`.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

// Real-shaped payloads so that, once released, the skeleton swaps to genuine content.
const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative', group: 'group_a' },
    { kobo_key: 'group_a/region', label: 'Region of residence', export_label: 'region', type: 'select_one', category: 'categorical', group: 'group_a' },
  ],
};

// A minimal but plausible profile payload (per-column EDA). Exact shape is the page's concern;
// the spec only asserts the skeleton is gone and SOME real content rendered after release.
const PROFILE = {
  profiles: [
    {
      name: 'main',
      rows: 100,
      columns: [
        { name: 'age', role: 'quantitative', distinct: 50 },
        { name: 'region', role: 'categorical', distinct: 5 },
      ],
    },
  ],
};

/**
 * A controllable gate for a single endpoint: the route handler awaits `release()` before
 * fulfilling, so the page's mount fetch stays "in flight" until the test releases it. This lets
 * the spec deterministically observe the loading (skeleton) state, then the loaded state.
 */
function makeGate() {
  let release!: () => void;
  const opened = new Promise<void>((res) => { release = res; });
  return { opened, release };
}

/**
 * Stub the bootstrap network. `gates` optionally holds open a specific endpoint's response.
 * The catch-all is registered FIRST because Playwright matches routes in REVERSE registration
 * order (last registered wins).
 */
async function stubBootstrap(
  page: Page,
  gates: { questions?: Promise<void>; profile?: Promise<void> } = {},
) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: { n_rows: 0, n_columns: 0, checks: [] } }));
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));

  // Gated endpoints last so they win. When a gate is supplied the response is held until
  // released, keeping the page's mount fetch in flight (the loading/skeleton state).
  await page.route('**/api/questions', async (r) => {
    if (gates.questions) await gates.questions;
    await r.fulfill({ json: QUESTIONS });
  });
  await page.route('**/api/profile', async (r) => {
    if (gates.profile) await gates.profile;
    await r.fulfill({ json: PROFILE });
  });
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  // App-ready wait on the primary nav (same as the green i18n/pux specs).
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

// Open the Transform stage (where Questions / Profile / Validate live), then a sub-tab by label.
async function openTransformSub(page: Page, sub: RegExp) {
  await page.locator('.tabs-bar [data-tab="transform"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: sub }).click();
}

const skeleton = (page: Page) => page.locator('[data-testid="skeleton"]');
// The plain "Loading…" line this card replaces.
const plainLoading = (page: Page) => page.locator('.empty-state', { hasText: /loading|loading…|chargement/i });

// Hide the always-present sticky terminal drawer before screenshots (memory: container baselines).
async function hideTerminal(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

test.describe('PERF-3 — skeleton replaces the plain "Loading…" while a mount fetch is in flight', () => {
  // AC#2 + AC#3 (Questions): while /api/questions is pending the skeleton shows and the plain
  // "Loading…" text is gone; once the response is released the skeleton is removed and the real
  // Questions content renders. Encodes the core "in place of … then swapped" requirement.
  test('Questions shows a skeleton (not plain "Loading…") while pending, then swaps to content', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // While the fetch is in flight: a skeleton placeholder is visible…
    await expect(skeleton(page).first(), 'a skeleton must render while /api/questions is pending').toBeVisible();
    // …and the old plain "Loading…" text branch is gone.
    await expect(plainLoading(page), 'the plain "Loading…" text must be replaced by the skeleton').toHaveCount(0);

    // Release the response → the skeleton is fully replaced by the real content.
    gate.release();
    await expect(page.locator('input.q-export-input').first(), 'real Questions content must render after load').toBeVisible();
    await expect(skeleton(page), 'the skeleton must be fully removed once data arrives').toHaveCount(0);
  });

  // AC#2 + AC#3 (Profile): same contract for the Profile EDA tab via /api/profile.
  test('Profile shows a skeleton (not plain "Loading…") while pending, then swaps to content', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { profile: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /^profile$/i);

    await expect(skeleton(page).first(), 'a skeleton must render while /api/profile is pending').toBeVisible();
    await expect(plainLoading(page), 'the plain "Loading…" text must be replaced by the skeleton').toHaveCount(0);

    gate.release();
    // After release the skeleton is gone; SOME real profile content has rendered. The `main`
    // table leaf starts collapsed (column names live behind it), so we assert on content that is
    // visible WITHOUT manual expansion: the table name and its row/column meta rendered by
    // Profile.jsx's `tableMeta`. This fails if the page shows the "Nothing to profile yet" empty
    // state and passes only when a real profile renders.
    await expect(skeleton(page), 'the skeleton must be fully removed once data arrives').toHaveCount(0);
    const profilePage = page.locator('.page:visible');
    await expect(profilePage).toContainText(/100 rows · 2 columns/i);
    await expect(profilePage).not.toContainText(/nothing to profile yet/i);
  });
});

test.describe('PERF-3 — Skeleton component a11y contract', () => {
  // AC#1: the skeleton CONTAINER exposes aria-busy="true" and a visually-hidden text label
  // ("Loading"), and the decorative shimmer blocks are aria-hidden="true" — so AT announces a
  // single loading state, not noise.
  test('the skeleton container is aria-busy with a visually-hidden label and aria-hidden blocks', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    const sk = skeleton(page).first();
    await expect(sk, 'the skeleton container must be present while pending').toBeVisible();

    // aria-busy="true" on the container.
    await expect(sk, 'the skeleton container must expose aria-busy="true"').toHaveAttribute('aria-busy', 'true');

    // A visually-hidden text label is present and announces "Loading" (EN default mock).
    const accText = await sk.evaluate((el) => (el.textContent || '').toLowerCase());
    expect(accText, 'the skeleton must carry a (visually-hidden) loading label').toMatch(/loading|chargement/);

    // The decorative shimmer blocks are aria-hidden so AT does not read each one out. At least one
    // aria-hidden block exists inside the container.
    const hiddenBlocks = sk.locator('[aria-hidden="true"]');
    expect(await hiddenBlocks.count(), 'shimmer blocks must be aria-hidden="true"').toBeGreaterThan(0);

    gate.release();
  });

  // AC#6: an axe audit on the skeleton state reports no violations — the busy region is
  // announced once, shimmer blocks are hidden, no orphaned roles.
  test('axe audit on the Questions skeleton state reports no violations', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);
    await expect(skeleton(page).first()).toBeVisible();

    const results = await new AxeBuilder({ page }).include('.page').analyze();
    expect(results.violations, `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`).toEqual([]);

    gate.release();
  });
});

test.describe('PERF-3 — prefers-reduced-motion: reduce → static placeholder (no shimmer)', () => {
  // AC#4: under reduced motion the skeleton shows no running shimmer animation.
  test.use({ colorScheme: 'light' });

  test('no shimmer animation is applied under reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    const sk = skeleton(page).first();
    await expect(sk).toBeVisible();

    // No element within the skeleton runs a non-"none" animation under reduced motion. We inspect
    // the container and its descendants (the shimmer is driven by an animation on the blocks).
    const anyAnimated = await sk.evaluate((root) => {
      const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
      return nodes.some((n) => {
        const cs = getComputedStyle(n as Element);
        const name = (cs.animationName || '').trim();
        const dur = (cs.animationDuration || '0s').trim();
        const running = name && name !== 'none' && dur !== '0s' && dur !== '0ms';
        return Boolean(running);
      });
    });
    expect(anyAnimated, 'no shimmer animation may run under prefers-reduced-motion: reduce').toBe(false);

    gate.release();
  });
});

test.describe('PERF-3 — keep-alive: returning to an already-loaded tab shows no skeleton', () => {
  // AC#5: a returning user (tab already mounted + data cached via keep-alive) sees NO skeleton on
  // tab switch — only the first mount shows it. No behaviour change to the keep-alive panes.
  test('switching away from a loaded tab and back shows no skeleton', async ({ page }) => {
    // No gate: questions resolves immediately, so the first mount completes and caches.
    await stubBootstrap(page);
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    // First mount fully loaded the real content.
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
    await expect(skeleton(page)).toHaveCount(0);

    // Switch away (Validate) then back to Questions.
    await page.locator('.subtabs-bar .subtab', { hasText: /validate/i }).click();
    await page.locator('.subtabs-bar .subtab', { hasText: /questions/i }).click();

    // Keep-alive: content is shown instantly, with NO skeleton on the return.
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
    await expect(skeleton(page), 'no skeleton may appear when returning to an already-loaded tab').toHaveCount(0);
  });
});

test.describe('PERF-3 — visual baselines of the skeleton states (3 viewports)', () => {
  // AC#7: capture a Questions skeleton baseline. Gate on the skeleton being present (and the plain
  // "Loading…" text gone) so the baseline is not captured vacuously from the pre-fix markup.
  test('visual baseline — Questions skeleton', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    await expect(skeleton(page).first()).toBeVisible();
    await expect(plainLoading(page)).toHaveCount(0);
    await hideTerminal(page);
    await expect(page.locator('.page:visible')).toHaveScreenshot('perf3-questions-skeleton.png');

    gate.release();
  });

  // AC#7: capture a Profile skeleton baseline.
  test('visual baseline — Profile skeleton', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { profile: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /^profile$/i);

    await expect(skeleton(page).first()).toBeVisible();
    await expect(plainLoading(page)).toHaveCount(0);
    await hideTerminal(page);
    await expect(page.locator('.page:visible')).toHaveScreenshot('perf3-profile-skeleton.png');

    gate.release();
  });
});
