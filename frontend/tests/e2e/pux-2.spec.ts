import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * PUX-2 — First-run / empty-state onboarding with a single recommended next action.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. When /api/state readiness is "empty" (has_questions:false, has_data:false),
 *      Home shows a first-run state with exactly ONE primary recommended next action
 *      ("Connect your form →") that navigates to Extract → Connection.
 *   2. In that first-run state the remaining stage cards are visibly de-emphasized
 *      (carry a dimmed / secondary class) and the recommended action is the single
 *      focal point — exactly one primary CTA.
 *   3. Once prerequisites are met (has_questions:true, has_data:true) Home shows the
 *      normal full five-card view with NO first-run overlay (returning-user path).
 *   4. The de-emphasized cards remain reachable (not removed, not disabled); the
 *      primary CTA is a real <button>/link with an accessible name + visible focus ring.
 *   5. Visual baselines of BOTH the first-run state and the returning-user state, one
 *      per viewport via playwright.config.ts (a human approves them).
 *
 * NETWORK-MOCKED end-to-end (same harness as a11y-1 / pux-1): the Vite dev server
 * serves the real SPA; every /api/** is intercepted with page.route(), so no FastAPI
 * backend is required. /api/state is stubbed PER TEST to drive first-run vs returning.
 *
 * SELECTORS (interface, not behavior under test):
 *   - Home stage cards: `.home-card` (container `.home-cards`); five stage cards.
 *   - Primary nav stages: `.tabs-bar .tab` (active: `.tab.active`); Extract carries
 *     text /extract/i.
 *   - Sub-tabs: `.subtabs-bar .subtab`; the Connection subtab carries /connection/i.
 *   - Sources platform picker: `.platform-card` (renders on Extract → Connection).
 * These structural hooks pre-date this card and survive the first-run-state addition.
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
  '  alias: test',
  '',
].join('\n');

type Readiness = { has_questions: boolean; has_data: boolean };

// Stub the whole bootstrap; `readiness` drives the /api/state response so the same
// fixtures cover both first-run (empty) and returning-user (ready) paths.
async function stubBootstrap(page: Page, readiness: Readiness) {
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({
      json: {
        has_questions: readiness.has_questions,
        has_data: readiness.has_data,
        has_templates: false,
        has_ai: false,
      },
    }));
}

async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  // Wait on the actual surface under test — a stage card (present in both states).
  await expect(page.locator('.home-card').first()).toBeVisible();
}

// The single primary recommended next action: an accessible-name match of the
// "Connect your form" CTA. AC names it exactly "Connect your form →"; we match the
// core phrase (arrow / casing tolerant) by accessible role.
const connectCta = (page: Page) =>
  page.getByRole('button', { name: /connect your form/i })
    .or(page.getByRole('link', { name: /connect your form/i }));

// Tab from body until `target` is the focused element (focus-ring / reachability).
async function tabUntilFocused(page: Page, target: Locator, maxTabs = 25): Promise<boolean> {
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

// Computed outline of the focused element (the teal :focus-visible ring is a solid,
// non-zero outline — `outline: 2px solid var(--accent)`).
async function focusedOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth };
  });
}

test.describe('PUX-2 — first-run / empty state (no form, no data)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, { has_questions: false, has_data: false });
    await gotoHome(page);
  });

  // AC: when the project has no connected form / no downloaded data, Home shows a
  // first-run state with ONE primary recommended next action "Connect your form →".
  test('shows a single "Connect your form" primary recommended action', async ({ page }) => {
    const cta = connectCta(page);
    await expect(cta, 'first-run state must surface a "Connect your form" recommended action').toBeVisible();
    await expect(cta).toHaveCount(1);
  });

  // AC: exactly one primary CTA — the recommended action is the clear focal point.
  // A "primary" CTA is one carrying the primary affordance (btn-primary / primary
  // class / data-cta="primary"). There must be exactly one across the Home surface.
  test('renders exactly one primary CTA on Home', async ({ page }) => {
    const primaries = page.locator(
      '.home-cards button.btn-primary, .home-cards a.btn-primary, ' +
      '.home-cards [data-cta="primary"], .home-cards .home-cta--primary, ' +
      'main button.btn-primary, main a.btn-primary, ' +
      'main [data-cta="primary"], main .home-cta--primary',
    );
    await expect(primaries, 'first-run state must have exactly one primary CTA').toHaveCount(1);
    // And it is the Connect-your-form action.
    await expect(primaries.first()).toHaveText(/connect your form/i);
  });

  // AC: the primary CTA is a real <button>/link with an accessible name.
  test('the primary CTA is a real button/link with an accessible name', async ({ page }) => {
    const cta = connectCta(page);
    const tag = await cta.evaluate((el) => el.tagName.toLowerCase());
    expect(['button', 'a'], `the CTA must be a real <button> or <a> (got <${tag}>)`).toContain(tag);
    const name = (await cta.evaluate((el) => (el.textContent || el.getAttribute('aria-label') || '').trim())) || '';
    expect(name.length, 'the CTA must have a non-empty accessible name').toBeGreaterThan(0);
    expect(name).toMatch(/connect your form/i);
  });

  // AC: the primary CTA shows a visible focus ring on keyboard focus.
  test('the primary CTA is keyboard reachable and shows a visible focus ring', async ({ page }) => {
    const cta = connectCta(page);
    const reached = await tabUntilFocused(page, cta);
    expect(reached, 'the primary CTA must be reachable in keyboard tab order').toBe(true);
    const outline = await focusedOutline(page);
    expect(outline, 'focused CTA has a computed outline').not.toBeNull();
    expect(outline!.style).not.toBe('none');
    expect(outline!.width).not.toBe('0px');
  });

  // AC: clicking the recommended action navigates to the Extract → Connection sub-page.
  test('clicking the CTA navigates to Extract → Connection', async ({ page }) => {
    await connectCta(page).click();
    // Extract stage becomes active.
    await expect(page.locator('.tabs-bar .tab.active', { hasText: /extract/i })).toBeVisible();
    // Connection sub-tab is active and the platform picker rendered.
    await expect(page.locator('.subtabs-bar .subtab.active', { hasText: /connection/i })).toBeVisible();
    await expect(page.locator('.platform-card').first()).toBeVisible();
  });

  // AC: the remaining stage cards are visibly de-emphasized (dimmed / secondary).
  test('the remaining stage cards carry a de-emphasized class', async ({ page }) => {
    const cards = page.locator('.home-card');
    const n = await cards.count();
    expect(n, 'first-run state must still render the stage cards').toBeGreaterThan(0);
    const dimmed = page.locator(
      '.home-card.is-dimmed, .home-card.is-disabled, .home-card.home-card--muted, ' +
      '.home-card.is-deemphasized, .home-card[data-dimmed="true"], .home-card[aria-disabled="true"]',
    );
    // At least the not-yet-actionable cards (all but the recommended Extract path) are dimmed.
    const dimmedCount = await dimmed.count();
    expect(
      dimmedCount,
      'in the first-run state the not-yet-actionable stage cards must be visibly de-emphasized',
    ).toBeGreaterThan(0);
  });

  // AC: the de-emphasized cards remain REACHABLE — not removed, not hard-disabled to
  // inaccessibility (guide, don't gate). A dimmed card must still be in the DOM and
  // keyboard-reachable (focusable), even if styled secondary.
  test('de-emphasized cards remain reachable (not removed / not made inaccessible)', async ({ page }) => {
    const cards = page.locator('.home-card');
    await expect(cards.first()).toBeVisible();
    // A de-emphasized card must remain focusable: real <button> (focusable by default)
    // or carry a non-negative tabindex. tabindex="-1" or display:none would gate it out.
    const dimmed = page.locator(
      '.home-card.is-dimmed, .home-card.is-disabled, .home-card.home-card--muted, ' +
      '.home-card.is-deemphasized, .home-card[data-dimmed="true"], .home-card[aria-disabled="true"]',
    ).first();
    await expect(dimmed, 'at least one de-emphasized card is present').toBeVisible();
    const reachable = await dimmed.evaluate((el) => {
      const ti = el.getAttribute('tabindex');
      const focusableTag = el.tagName.toLowerCase() === 'button' || el.tagName.toLowerCase() === 'a';
      const notRemovedFromTabOrder = ti === null ? focusableTag : Number(ti) >= 0;
      return notRemovedFromTabOrder;
    });
    expect(reachable, 'de-emphasized cards must remain keyboard reachable (guide, don\'t gate)').toBe(true);
  });

  // A11Y-6 — Full-opacity focus ring on de-emphasized Home stage cards.
  //
  // The dimmed stage cards de-emphasize via `.home-card-wrap.is-dimmed{opacity:.55}`.
  // Opacity on the WRAP establishes an opacity group, so a `:focus-visible` opacity
  // restore on the inner `.home-card` button cannot un-dim the ring — the focus ring
  // would render at 55% opacity (WCAG 2.4.7). The fix must raise the WRAP opacity on
  // focus (`:focus-within`), mirroring the existing `:hover` rule on the wrap.
  //
  // AC: when a dimmed card receives keyboard focus, the card WRAP renders at full
  // opacity (1, not .55) while the inner card shows its teal focus outline; the dim
  // returns once focus leaves.
  test('a focused dimmed card un-dims its wrap to full opacity (focus ring at full strength)', async ({ page }) => {
    // The dimmed wrap and its inner focusable button (the real keyboard-focus target).
    const dimmedWrap = page.locator('.home-card-wrap.is-dimmed').first();
    await expect(dimmedWrap, 'first-run state must render at least one de-emphasized stage card').toBeVisible();
    const innerCard = dimmedWrap.locator('.home-card').first();

    // Baseline: before focus the wrap is dimmed to ~0.55.
    const opacityBefore = await dimmedWrap.evaluate((el) => getComputedStyle(el).opacity);
    expect(Number(opacityBefore), 'a de-emphasized card wrap starts dimmed (~0.55)').toBeCloseTo(0.55, 2);

    // Keyboard-focus the inner card (same helper the rest of the spec uses).
    const reached = await tabUntilFocused(page, innerCard);
    expect(reached, 'the dimmed stage card must be reachable in keyboard tab order').toBe(true);

    // The focus ring (teal :focus-visible outline) must be present on the focused card...
    const outline = await focusedOutline(page);
    expect(outline, 'focused dimmed card has a computed outline').not.toBeNull();
    expect(outline!.style, 'focused dimmed card shows a solid focus outline').not.toBe('none');
    expect(outline!.width, 'focused dimmed card focus outline has non-zero width').not.toBe('0px');

    // ...and the WRAP must render at full opacity so that ring is shown at full
    // strength — NOT at the dimmed 0.55 (the bug). This is the load-bearing assertion.
    const opacityFocused = await dimmedWrap.evaluate((el) => getComputedStyle(el).opacity);
    expect(
      Number(opacityFocused),
      'a keyboard-focused dimmed card must un-dim its wrap to full opacity (1, not 0.55) so the focus ring is not washed out (WCAG 2.4.7)',
    ).toBeCloseTo(1, 2);
  });

  // AC: the dim (opacity .55) returns once focus leaves the card.
  test('the dimmed card wrap returns to ~0.55 opacity after focus leaves', async ({ page }) => {
    const dimmedWrap = page.locator('.home-card-wrap.is-dimmed').first();
    await expect(dimmedWrap).toBeVisible();
    const innerCard = dimmedWrap.locator('.home-card').first();

    const reached = await tabUntilFocused(page, innerCard);
    expect(reached, 'the dimmed stage card must be reachable in keyboard tab order').toBe(true);

    // Blur: move focus off the card entirely.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    const opacityAfter = await dimmedWrap.evaluate((el) => getComputedStyle(el).opacity);
    expect(
      Number(opacityAfter),
      'once focus leaves, the de-emphasized card wrap returns to its dimmed ~0.55 opacity',
    ).toBeCloseTo(0.55, 2);
  });

  // A11Y-6 AC4 — a Playwright axe audit on the first-run Home reports no NEW
  // violations. The fix is CSS-only (un-dim the WRAP on :focus-within, drop the dead
  // .home-card.is-dimmed:focus-visible rule) and must introduce no accessibility
  // violations on exactly the surface PUX-2 added. We focus a dimmed card first so the
  // audit runs over the focused (un-dimmed) state the fix targets — then scope the scan
  // to the Home surface `.page` (NOT the global terminal bar) and assert zero
  // violations for the focus/interactive rules the rest of Home is audited against
  // (button-name / aria-command-name / nested-interactive — the same set as
  // a11y-1.spec.ts ~line 305 and a11y-4.spec.ts ~line 67; color-contrast is NOT
  // included here because the dimmed secondary text fails it independently of this
  // CSS-only focus-ring change, so it is not a "new" violation under AC4's scope).
  test('first-run Home reports no axe violations (focus/interactive rules) with a dimmed card focused', async ({ page }) => {
    // Hold until /api/state resolves (cards rendered) so the scan is deterministic.
    const dimmedWrap = page.locator('.home-card-wrap.is-dimmed').first();
    await expect(dimmedWrap, 'first-run state must render at least one de-emphasized stage card').toBeVisible();

    // Exercise the focus state the AC is about: keyboard-focus a dimmed card so the
    // wrap un-dims and the teal :focus-visible ring is present during the audit.
    const innerCard = dimmedWrap.locator('.home-card').first();
    const reached = await tabUntilFocused(page, innerCard);
    expect(reached, 'the dimmed stage card must be reachable in keyboard tab order').toBe(true);

    const results = await new AxeBuilder({ page })
      .include('.page')
      .withRules(['button-name', 'aria-command-name', 'nested-interactive'])
      .analyze();

    expect(
      results.violations,
      `first-run Home must report no axe violations on the focus/interactive rules\n${JSON.stringify(results.violations, null, 2)}`,
    ).toEqual([]);
  });

  // Visual baseline of a focused dimmed card at all three viewports — gate on the AC
  // (the wrap is un-dimmed under focus) so the baseline captures the fixed state.
  test('visual baseline of a focused dimmed stage card', async ({ page }) => {
    const dimmedWrap = page.locator('.home-card-wrap.is-dimmed').first();
    await expect(dimmedWrap).toBeVisible();
    const innerCard = dimmedWrap.locator('.home-card').first();
    const reached = await tabUntilFocused(page, innerCard);
    expect(reached, 'the dimmed stage card must be reachable in keyboard tab order').toBe(true);
    await expect(Number(await dimmedWrap.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeCloseTo(1, 2);
    await expect(dimmedWrap).toHaveScreenshot('a11y6-focused-dimmed-card.png');
  });

  // Visual baseline of the first-run state. Gate on the AC (the single CTA is present)
  // so the baseline is not captured vacuously from the pre-fix five-equal-cards view.
  test('visual baseline of the first-run state', async ({ page }) => {
    await expect(connectCta(page), 'first-run CTA must exist before the baseline is captured').toBeVisible();
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux2-firstrun-home.png');
  });
});

test.describe('PUX-2 — returning user (form connected + data present)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, { has_questions: true, has_data: true });
    await gotoHome(page);
  });

  // AC: once prerequisites are met, Home shows the normal full five-card view.
  test('renders the normal five equal stage cards', async ({ page }) => {
    await expect(page.locator('.home-card')).toHaveCount(5);
  });

  // AC: no first-run overlay / no first-run primary CTA for returning users.
  test('shows no first-run "Connect your form" overlay/CTA', async ({ page }) => {
    await expect(
      connectCta(page),
      'returning users must not see the first-run "Connect your form" recommended action',
    ).toHaveCount(0);
  });

  // AC: returning-user path unchanged — the stage cards are NOT de-emphasized.
  test('no stage card is de-emphasized for returning users', async ({ page }) => {
    const dimmed = page.locator(
      '.home-card.is-dimmed, .home-card.is-disabled, .home-card.home-card--muted, ' +
      '.home-card.is-deemphasized, .home-card[data-dimmed="true"], .home-card[aria-disabled="true"]',
    );
    await expect(dimmed, 'returning-user Home must present all five stages normally (no dimming)').toHaveCount(0);
  });

  // Visual baseline of the returning-user state (one assertion → one baseline per viewport).
  test('visual baseline of the returning-user state', async ({ page }) => {
    await expect(page.locator('.home-card')).toHaveCount(5);
    await expect(connectCta(page), 'returning-user view must have no first-run CTA before baseline').toHaveCount(0);
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux2-returning-home.png');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// PUX-6 — Harden Home first-run readiness fetch (error + project-switch).
//
// Extends the PUX-2 suite. Two robustness gaps in the /api/state readiness
// effect (App.jsx ~300-311):
//
//   (a) The fetch does NOT check response.ok, so a non-OK response whose JSON
//       body lacks `has_questions` (a 500 {"detail":...} or a 401) coerces to
//       ready=false → a RETURNING user is shown the first-run "Connect your
//       form" empty state on a transient/auth error. The fix: a non-OK (4xx/5xx)
//       or parse-error response must leave readiness UNKNOWN (null) → cards HELD,
//       never the first-run state.
//
//   (b) `homeReady` is NOT reset to null when `activeProjectId` changes, so
//       switching from a ready project to a not-yet-resolved one keeps the
//       previous project's full five-card view on screen until the new fetch
//       resolves. The fix: readiness resets to null on switch → cards held
//       (no five-card flash) until the new /api/state answers.
//
// THE HELD STATE (the AC's "cards held"): Home renders neither the first-run
// CTA / `[data-testid="home-firstrun"]` NOR any `.home-card`. The `.home-cards`
// container itself is absent while readiness is unknown. We assert on that
// observable contract, not on the `homeReady` variable.
// ───────────────────────────────────────────────────────────────────────────

// Like stubBootstrap, but lets a test control the /api/state response (status +
// body) so we can drive a non-OK error response. Catch-all FIRST; specific
// routes registered after win (last registered wins).
async function stubBootstrapWithStateHandler(
  page: Page,
  stateHandler: (route: import('@playwright/test').Route) => unknown,
) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) => stateHandler(r));
}

// The first-run empty state, by its two observable surfaces (testid + CTA).
const firstRunPanel = (page: Page) => page.locator('[data-testid="home-firstrun"]');

// Go to Home WITHOUT waiting on a stage card — the held / error states render no
// `.home-card`. We wait on the app chrome (the project switcher) instead so the
// SPA has booted and the readiness effect has had its chance to run.
async function gotoHomeNoCards(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

test.describe('PUX-6 — /api/state error must not show a returning user the first-run state', () => {
  // AC: the /api/state fetch checks response.ok; a non-OK response does NOT set
  // ready=false — readiness stays null (cards held), so a returning user is
  // never shown the first-run empty state on a transient error.
  //
  // RED on current code: the fetch ignores response.ok and parses the 500 body
  // {"detail":...}, which lacks has_questions → !!(undefined && undefined) ===
  // false → homeReady=false → the first-run "Connect your form" panel renders.
  test('a 500 response does not render the first-run "Connect your form" state', async ({ page }) => {
    await stubBootstrapWithStateHandler(page, (r) =>
      r.fulfill({ status: 500, json: { detail: 'internal error' } }));
    await gotoHomeNoCards(page);

    // Give the readiness fetch + any render time to settle.
    await page.waitForTimeout(500);

    await expect(
      firstRunPanel(page),
      'a 500 from /api/state must NOT surface the first-run onboarding panel to a (possibly returning) user',
    ).toHaveCount(0);
    await expect(
      connectCta(page),
      'a 500 from /api/state must NOT surface the first-run "Connect your form" CTA',
    ).toHaveCount(0);
  });

  // AC (companion): on a non-OK response the five-card returning view is also not
  // shown — readiness is unknown, so cards are HELD (no .home-card rendered).
  test('a 500 response holds the cards (renders neither first-run nor the five-card view)', async ({ page }) => {
    await stubBootstrapWithStateHandler(page, (r) =>
      r.fulfill({ status: 500, json: { detail: 'internal error' } }));
    await gotoHomeNoCards(page);
    await page.waitForTimeout(500);

    await expect(
      page.locator('.home-card'),
      'an unresolved/error readiness must hold the stage cards (none rendered) — not the first-run state',
    ).toHaveCount(0);
  });

  // AC: same guarantee for the 401 now that /api/state is auth-gated.
  //
  // RED on current code: 401 body {"detail":"..."} lacks has_questions →
  // homeReady=false → first-run panel renders for a returning user.
  test('a 401 response does not render the first-run "Connect your form" state', async ({ page }) => {
    await stubBootstrapWithStateHandler(page, (r) =>
      r.fulfill({ status: 401, json: { detail: 'unauthorized' } }));
    await gotoHomeNoCards(page);
    await page.waitForTimeout(500);

    await expect(
      firstRunPanel(page),
      'a 401 from /api/state must NOT surface the first-run onboarding panel',
    ).toHaveCount(0);
    await expect(
      connectCta(page),
      'a 401 from /api/state must NOT surface the first-run "Connect your form" CTA',
    ).toHaveCount(0);
  });

  // AC: a malformed / parse-error response is likewise treated as unknown
  // (held), not ready=false.
  //
  // RED on current code: a 200 with a non-JSON body throws in .json(); the catch
  // leaves homeReady at its previous value. But a non-OK malformed body is the
  // real risk — here we serve a 500 with invalid JSON so .ok is false AND .json()
  // would throw; readiness must stay null (held), not become false.
  test('a non-OK malformed (non-JSON) response holds the cards, not the first-run state', async ({ page }) => {
    await stubBootstrapWithStateHandler(page, (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: 'not-json{' }));
    await gotoHomeNoCards(page);
    await page.waitForTimeout(500);

    await expect(
      firstRunPanel(page),
      'a malformed error response must NOT surface the first-run onboarding panel',
    ).toHaveCount(0);
    await expect(
      page.locator('.home-card'),
      'a malformed error response must hold the stage cards (none rendered)',
    ).toHaveCount(0);
  });
});

test.describe('PUX-6 — readiness resets to null on project switch (no stale-state flash)', () => {
  // Names chosen to NOT collide with the menu's "+ New project" add-item.
  const READY_PROJECT = { id: 'proj-ready', name: 'Alpha Project', slug: 'alpha', role: 'admin', is_archived: false };
  const OTHER_PROJECT = { id: 'proj-other', name: 'Bravo Project', slug: 'bravo', role: 'admin', is_archived: false };

  // Exact-text match on the project label inside the active items only — avoids
  // the strict-mode collision with the "+ New project" add row.
  const projectMenuItem = (page: Page, name: string) =>
    page.locator('.project-menu__item:not(.project-menu__add) .project-menu__label', { hasText: name });

  // Shared bootstrap with TWO active projects; proj-ready is active initially.
  // `stateHandler` controls the per-call /api/state behavior. The readiness
  // effect runs on mount with activeProjectId=null (before refreshProjects sets
  // it) AND again after the id resolves, so /api/state can be hit more than once
  // during initial boot; we therefore gate the "held" behavior on the project
  // switch having happened (an /activate POST), not on a brittle call counter.
  async function bootstrapTwoProjects(
    page: Page,
    stateHandler: (route: import('@playwright/test').Route) => Promise<void> | void,
  ) {
    await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
    await page.route('**/api/me', (r) =>
      r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
    await page.route('**/api/projects', (r) =>
      r.fulfill({ json: { active_id: READY_PROJECT.id, is_superadmin: false, projects: [READY_PROJECT, OTHER_PROJECT] } }));
    await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
    await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
    await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
    await page.route('**/api/state', (r) => stateHandler(r));
  }

  // AC: on activeProjectId change, homeReady resets to null (cards held) before
  // the new /api/state resolves, so neither Home state from the previous project
  // flashes during a switch.
  //
  // We start on a READY project (5 cards). We HOLD the post-switch /api/state
  // response open. During that window the fix must have cleared readiness to
  // null → the five-card view must be GONE (cards held). The bug leaves
  // homeReady=true (no reset on activeProjectId change) → the five cards persist
  // until the new fetch resolves.
  test('switching from a ready project to a not-ready one does not keep the five-card view on screen', async ({ page }) => {
    let switched = false;
    let releaseHeld: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { releaseHeld = resolve; });

    await bootstrapTwoProjects(page, async (r) => {
      if (switched) {
        // Post-switch readiness: held open so we can observe the in-flight window.
        await held;
        await r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } });
      } else {
        // Pre-switch (ready project): resolves immediately ready.
        await r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } });
      }
    });
    // Mark the switch the moment the activate POST fires — anything after is the
    // new project's (held) readiness fetch.
    await page.route('**/api/projects/*/activate', (r) => { switched = true; return r.fulfill({ json: { ok: true } }); });

    await page.goto('http://localhost:51730/');
    // Starting state: the ready project shows the full five-card view.
    await expect(page.locator('.home-card')).toHaveCount(5);

    // Switch to the other project via the existing project switcher.
    await page.locator('.project-switcher').click();
    await projectMenuItem(page, OTHER_PROJECT.name).click();

    // The post-switch /api/state is still in flight (held). During this window
    // the five-card view must NOT remain on screen — readiness reset to null
    // holds the cards. Load-bearing assertion (RED on the un-reset bug: the five
    // cards from the ready project persist).
    await expect(
      page.locator('.home-card'),
      'on switch to a not-yet-resolved project, the previous project’s five-card view must not remain/flash (readiness resets to null → cards held)',
    ).toHaveCount(0, { timeout: 1500 });

    // Release the held response so the test can exit cleanly.
    releaseHeld?.();
  });

  // AC (companion): once the new project's readiness resolves NOT-ready, Home
  // settles on the first-run state — confirming the reset clears to the correct
  // new-project state (not a stale five-card view).
  test('after the switch resolves not-ready, Home settles on the first-run state', async ({ page }) => {
    let switched = false;

    await bootstrapTwoProjects(page, async (r) => {
      const ready = !switched;
      await r.fulfill({ json: { has_questions: ready, has_data: ready, has_templates: false, has_ai: false } });
    });
    await page.route('**/api/projects/*/activate', (r) => { switched = true; return r.fulfill({ json: { ok: true } }); });

    await page.goto('http://localhost:51730/');
    await expect(page.locator('.home-card')).toHaveCount(5);

    await page.locator('.project-switcher').click();
    await projectMenuItem(page, OTHER_PROJECT.name).click();

    // The new project is not ready → first-run state appears.
    await expect(
      firstRunPanel(page),
      'after switching to a not-ready project the first-run onboarding state must appear',
    ).toBeVisible();
    await expect(connectCta(page)).toHaveCount(1);
  });
});
