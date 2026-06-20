import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-5 — Accessible form-validation messaging.
 *
 * NETWORK-MOCKED end-to-end. The Vite dev server (playwright.config.ts → webServer)
 * serves the real SPA; every `/api/**` call is intercepted with `page.route()`, so
 * NO FastAPI backend is required.
 *
 * This spec is the requirement, not a re-read of the implementation. Per the card's
 * Acceptance criteria, when a field in a Composition modal is invalid the input must:
 *   - set `aria-invalid="true"`, and
 *   - set `aria-describedby` referencing the id of its error-message element, whose
 *     text is the visible error;
 * and when the field becomes valid again `aria-invalid` must clear (removed/`false`)
 * and the describedby link to the (now-gone) error must be cleared. The error element
 * carries a stable id and is associated with EXACTLY its field. An axe audit of the
 * invalid-state modal must report no `aria-valid-attr` / `aria-describedby`-target
 * violations.
 *
 * Driving selectors (NOT assertions): the Composition "Add chart" modal exposes a
 * Name <input> (placeholder "satisfaction_overview"); submitting it empty triggers a
 * required-field validation error containing the word "required".
import { test, expect, Page, Locator } from '@playwright/test';

/**
 * A11Y-1 — Keyboard-operable non-button controls (WCAG 2.1.1 / 4.1.2).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *   - Sources "platform cards" (Kobo / Ona) must be keyboard reachable + activatable
 *     (real <button>, or <div role="button" tabIndex={0} onKeyDown> handling BOTH
 *     Enter and Space). Keyboard activation selects the same platform as a click.
 *   - Home "stage cards" must be REAL <button> elements (not <div role="button">),
 *     reachable in tab order and activatable by keyboard (navigates on Enter).
 *   - Both controls show the existing teal :focus-visible ring when keyboard-focused.
 *   - No <div onClick> without keyboard support remains on these surfaces.
 *
 * NETWORK-MOCKED end-to-end (same harness as build-options.spec.ts): the Vite dev
 * server serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * SELECTORS (interface, not behavior under test):
 *   - Platform cards: `.platform-card`; the selected one carries data-selected="true";
 *     each shows its name ("Kobo Toolbox" / "Ona / INFORM") via .platform-card__name.
 *   - Home stage cards: `.home-card`.
 * These class hooks survive a div→button rewrite, so the spec stays valid for the fix.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Minimal config the app yaml-parses on boot (App.jsx reads form.alias). A couple of
// questions so the Composition page has column options, but no charts (so the only
// chart modal we open is the fresh "Add chart" one).
const CONFIG_YML = [
  'form:',
  '  alias: test',
  'questions:',
  '  - {kobo_key: q_region, label: Region, export_label: Region, type: select_one}',
  '  - {kobo_key: q_age, label: Age, export_label: Age, type: integer}',
const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below take precedence (Playwright matches
  // routes in REVERSE registration order — last registered wins). /api/projects must
  // NOT fall through to {} (App.jsx would setProjects(undefined) and crash).
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/base-tables', (r) => r.fulfill({ json: { tables: [] } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
}

// Navigate to Analyze → "Charts & indicators" and open the "Add chart" modal.
async function openAddChartModal(page: Page) {
  await page.locator('.tabs-bar .tab', { hasText: 'Analyze' }).click();
  await page.locator('.subtabs-bar .subtab', { hasText: 'Charts & indicators' }).click();
  await page.getByRole('button', { name: '+ Add chart' }).click();

  const modal = page.locator('.modal[role="dialog"]');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Save' })).toBeVisible();
  return modal;
}

test.describe('A11Y-5 — Composition modal field errors are programmatically linked', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await page.goto('http://localhost:51730/');
  });

  test('invalid field sets aria-invalid + aria-describedby to its error text; valid clears it', async ({ page }) => {
    // SANITY: the real SPA mounted logged-in with the active project, so any later
    // failure is the missing A11Y-5 wiring — not a broken render / bad mock.
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');
    await expect(nameInput).toBeVisible();

    // Trigger the required-field validation by saving with an empty Name.
    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();

    // The visible error must appear (sanity — proves validation fired, so a later
    // aria failure is the missing linkage, not a missing error).
    const errorText = modal.getByText(/required/i).first();
    await expect(errorText).toBeVisible();

    // AC: the invalid input is marked aria-invalid="true".
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');

    // AC: aria-describedby references the id of the error-message element.
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby').toBeTruthy();

    // AC: the referenced element exists, has that exact (stable, non-empty) id, and
    // its text is the error message reachable by assistive tech.
    const ids = (describedBy as string).split(/\s+/).filter(Boolean);
    expect(ids.length, 'aria-describedby must reference at least one id').toBeGreaterThan(0);
    let matched = false;
    for (const id of ids) {
      const target = modal.locator(`#${CSS.escape(id)}`);
      if ((await target.count()) === 0) continue;
      const txt = (await target.first().innerText()).trim();
      if (/required/i.test(txt)) matched = true;
    }
    expect(
      matched,
      'an aria-describedby target of the Name input must contain the "required" error text',
    ).toBeTruthy();

    // Visual baseline of the modal in its invalid (error-shown) state (3 viewports
    // via playwright.config.ts). The implementer produces the baselines for approval.
    await expect(page).toHaveScreenshot('composition-modal-invalid.png');

    // AC: correcting the field clears the invalid state. aria-invalid is removed or
    // "false", and the describedby no longer points at a (now-gone) error element.
    await nameInput.fill('satisfaction_overview');

    await expect
      .poll(async () => {
        const v = await nameInput.getAttribute('aria-invalid');
        return v === null || v === 'false';
      }, { message: 'aria-invalid must be removed or set to "false" once the field is valid' })
      .toBe(true);

    await expect
      .poll(async () => {
        const db = await nameInput.getAttribute('aria-describedby');
        if (!db) return true; // link cleared entirely
        // If a describedby remains, it must NOT point at a visible "required" error.
        for (const id of db.split(/\s+/).filter(Boolean)) {
          const target = modal.locator(`#${CSS.escape(id)}`);
          if ((await target.count()) > 0) {
            const txt = (await target.first().innerText()).trim();
            if (/required/i.test(txt)) return false;
          }
        }
        return true;
      }, { message: 'the describedby link to the error must be cleared once the field is valid' })
      .toBe(true);
  });

  test('error message element has a stable id (no ambiguous/duplicate ids in the modal)', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');

    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByText(/required/i).first()).toBeVisible();

    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby').toBeTruthy();

    // AC: the error is associated with EXACTLY its field — the referenced id resolves
    // to a single unique element in the document (no shared/ambiguous ids).
    for (const id of (describedBy as string).split(/\s+/).filter(Boolean)) {
      const count = await page.locator(`#${CSS.escape(id)}`).count();
      expect(count, `aria-describedby target id "${id}" must be unique in the document`).toBe(1);
    }
  });

  test('axe audit of the invalid-state modal: no aria-valid-attr / aria-describedby violations', async ({ page }) => {
    await expect(page.getByText('Test Project')).toBeVisible();

    const modal = await openAddChartModal(page);
    const nameInput = modal.locator('input[placeholder="satisfaction_overview"]');

    await nameInput.fill('');
    await modal.getByRole('button', { name: 'Save' }).click();
    await expect(modal.getByText(/required/i).first()).toBeVisible();

    // PRECONDITION (makes the axe check non-vacuous): the AC's required wiring must be
    // PRESENT in the invalid state. axe rules below only fault BROKEN aria — a modal
    // with no aria wiring at all would pass axe trivially, so we first assert the
    // field is actually wired (aria-invalid + a resolvable aria-describedby target).
    // Today there is no wiring, so this fails red for the right reason; once the
    // implementer adds it, the axe audit then proves the wiring is well-formed.
    await expect(nameInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await nameInput.getAttribute('aria-describedby');
    expect(describedBy, 'invalid Name input must have aria-describedby for the axe audit to be meaningful').toBeTruthy();
    for (const id of (describedBy as string).split(/\s+/).filter(Boolean)) {
      await expect(modal.locator(`#${CSS.escape(id)}`), `aria-describedby target #${id} must exist`).toHaveCount(1);
    }

    // AC: a Playwright axe audit on the modal in an invalid state reports no
    // aria-valid-attr / aria-describedby-target violations.
    const results = await new AxeBuilder({ page })
      .include('.modal[role="dialog"]')
      .withRules(['aria-valid-attr', 'aria-valid-attr-value'])
      .analyze();

    expect(
      results.violations,
      `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

// Land on Home (the default stage). The greeting cards live here.
async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  // Wait on the actual surface under test, not chrome text — the greeting cards.
  await expect(page.locator('.home-card').first()).toBeVisible();
}

// Navigate to the Sources "Connection" surface (Extract stage → Connection subtab),
// where the platform cards (Kobo / Ona) render.
async function gotoSourcesConnection(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab', { hasText: /extract/i }).first()).toBeVisible();
  await page.locator('.tabs-bar .tab', { hasText: /extract/i }).first().click();
  // Connection is the default subtab of Extract; click it explicitly to be safe.
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  // Sanity: the platform picker rendered, so any later failure is the missing A11Y-1
  // behavior — not a broken bootstrap/render.
  await expect(page.locator('.platform-card').first()).toBeVisible();
}

const platformCard = (page: Page, name: RegExp) =>
  page.locator('.platform-card').filter({ hasText: name });

// Tab from the document body until `target` is the focused element, or give up.
// Returns true if it became focused within `maxTabs` presses.
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

// The computed focus-ring outline of the focused element. The existing teal
// :focus-visible rule is `outline: 2px solid var(--accent)` (--accent #0F766E).
async function focusedOutline(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
  });
}

test.describe('A11Y-1 — Sources platform cards: keyboard operable', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC: platform cards are reachable by Tab and show the teal focus ring on keyboard focus.
  test('a platform card is reachable by Tab and shows the focus-visible ring', async ({ page }) => {
    await gotoSourcesConnection(page);

    const kobo = platformCard(page, /Kobo/);
    const reached = await tabUntilFocused(page, kobo);
    expect(reached, 'the Kobo platform card must be reachable in keyboard tab order').toBe(true);

    const outline = await focusedOutline(page);
    expect(outline, 'focused element has a computed outline').not.toBeNull();
    // The teal :focus-visible ring is a solid, non-zero outline.
    expect(outline!.style).not.toBe('none');
    expect(outline!.width).not.toBe('0px');
  });

  // AC: keyboard activation (Enter) selects the same platform a mouse click would.
  test('pressing Enter on a focused platform card selects that platform', async ({ page }) => {
    await gotoSourcesConnection(page);

    const ona = platformCard(page, /Ona/);
    // Start from a known state: Kobo selected (matches the seeded kobo URL).
    const kobo = platformCard(page, /Kobo/);
    await expect(kobo).toHaveAttribute('data-selected', 'true');

    const reached = await tabUntilFocused(page, ona);
    expect(reached, 'the Ona platform card must be reachable in keyboard tab order').toBe(true);

    await page.keyboard.press('Enter');
    await expect(ona, 'Enter must select the Ona platform').toHaveAttribute('data-selected', 'true');
    await expect(kobo, 'Kobo must no longer be selected').not.toHaveAttribute('data-selected', 'true');
  });

  // AC: keyboard activation handles BOTH Enter and Space — Space selects too.
  test('pressing Space on a focused platform card selects that platform', async ({ page }) => {
    await gotoSourcesConnection(page);

    const ona = platformCard(page, /Ona/);
    const kobo = platformCard(page, /Kobo/);

    const reached = await tabUntilFocused(page, ona);
    expect(reached, 'the Ona platform card must be reachable in keyboard tab order').toBe(true);

    await page.keyboard.press('Space');
    await expect(ona, 'Space must select the Ona platform').toHaveAttribute('data-selected', 'true');
    await expect(kobo).not.toHaveAttribute('data-selected', 'true');
  });

  // AC: keyboard activation matches mouse click (no behavior regression). A mouse click
  // selects; keyboard Enter must reach the SAME selected state.
  test('keyboard selection matches mouse-click selection', async ({ page }) => {
    await gotoSourcesConnection(page);
    const ona = platformCard(page, /Ona/);

    // Mouse path.
    await ona.click();
    await expect(ona).toHaveAttribute('data-selected', 'true');

    // Reset to Kobo via mouse, then reach the same state via keyboard.
    await platformCard(page, /Kobo/).click();
    await expect(ona).not.toHaveAttribute('data-selected', 'true');

    const reached = await tabUntilFocused(page, ona);
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect(ona, 'keyboard activation reaches the same selected state as a click')
      .toHaveAttribute('data-selected', 'true');
  });

  // AC: no <div onClick> without keyboard support remains on this surface. Every
  // platform card must either be a <button> or expose role="button" + tabindex + be
  // focusable (the union of the two allowed implementations).
  test('no platform card is a non-keyboard <div onClick>', async ({ page }) => {
    await gotoSourcesConnection(page);
    const cards = page.locator('.platform-card');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const info = await cards.nth(i).evaluate((el) => ({
        tag: el.tagName.toLowerCase(),
        role: el.getAttribute('role'),
        tabindex: el.getAttribute('tabindex'),
      }));
      const isButton = info.tag === 'button';
      const isAriaButton = info.role === 'button' && info.tabindex === '0';
      expect(
        isButton || isAriaButton,
        `platform card ${i} must be a <button> or role="button" + tabindex=0 (got ${JSON.stringify(info)})`,
      ).toBe(true);
    }
  });

  // Visual baseline of the keyboard-focused platform card (one assertion → one
  // baseline per viewport via playwright.config.ts; a human approves them).
  test('visual baseline of the focused platform card', async ({ page }) => {
    await gotoSourcesConnection(page);
    const kobo = platformCard(page, /Kobo/);
    const reached = await tabUntilFocused(page, kobo);
    expect(reached).toBe(true);
    await expect(kobo).toHaveScreenshot('platform-card-focused.png');
  });
});

test.describe('A11Y-1 — Home stage cards: real buttons, keyboard operable', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC: Home stage cards are REAL <button> elements (not <div role="button">).
  test('every Home stage card is a real <button> element', async ({ page }) => {
    await gotoHome(page);
    const cards = page.locator('.home-card');
    const n = await cards.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const tag = await cards.nth(i).evaluate((el) => el.tagName.toLowerCase());
      expect(tag, `Home stage card ${i} must be a <button>, not <${tag}>`).toBe('button');
    }
  });

  // AC: each stage card is reachable in tab order and exposed as a button by role.
  test('a Home stage card is reachable by Tab and exposed as role=button', async ({ page }) => {
    await gotoHome(page);
    // getByRole('button') only matches true buttons / role="button"; restrict to the
    // stage cards via the class hook.
    const card = page.locator('.home-card').getByRole('button').first()
      .or(page.locator('button.home-card').first());
    // The stage card itself must be the button (not just a nested sub-button).
    const stageButton = page.locator('button.home-card').first();
    await expect(stageButton, 'the stage card must itself be a <button>').toBeVisible();

    const reached = await tabUntilFocused(page, stageButton);
    expect(reached, 'the stage card button must be reachable in keyboard tab order').toBe(true);

    const outline = await focusedOutline(page);
    expect(outline).not.toBeNull();
    expect(outline!.style).not.toBe('none');
    expect(outline!.width).not.toBe('0px');
  });

  // AC: activating a Home stage card by keyboard navigates to the same destination.
  test('pressing Enter on a Home stage card navigates to its stage', async ({ page }) => {
    await gotoHome(page);

    // Target the Extract stage card; activating it must navigate to the Extract stage
    // (its tab becomes active and the platform picker renders).
    const extractCard = page.locator('button.home-card').filter({ hasText: /extract/i }).first();
    await expect(extractCard, 'the Extract stage card must be a <button>').toBeVisible();

    const reached = await tabUntilFocused(page, extractCard);
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');

    // Navigation happened: the Extract tab is active and the connection surface rendered.
    await expect(page.locator('.tabs-bar .tab.active', { hasText: /extract/i })).toBeVisible();
    await expect(page.locator('.platform-card').first()).toBeVisible();
  });

  // Visual baseline of the Home stage cards (one assertion → one baseline per viewport).
  // Gate the screenshot on the AC (cards are real <button>s) so this does not pass
  // vacuously on current code by auto-writing a baseline of the pre-fix <div> markup —
  // the baseline must capture the corrected button markup, approved by a human.
  test('visual baseline of the Home stage cards', async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator('button.home-card').first(),
      'stage cards must be <button>s before the baseline is captured').toBeVisible();
    await expect(page.locator('.home-cards')).toHaveScreenshot('home-stage-cards.png');
  });
});

test.describe('A11Y-1 — axe accessibility audit (no interactive-role / keyboard / name violations)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Inject axe-core from the CDN and run it against the page, returning violations.
  async function runAxe(page: Page) {
    await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js' });
    return page.evaluate(async () => {
      // @ts-expect-error axe is injected on window by the script tag.
      const results = await window.axe.run(document, {
        runOnly: {
          type: 'rule',
          values: ['button-name', 'aria-command-name', 'nested-interactive'],
        },
      });
      return results.violations.map((v: any) => ({ id: v.id, nodes: v.nodes.length }));
    });
  }

  test('Sources platform picker has no button-name / interactive-role violations', async ({ page }) => {
    await gotoSourcesConnection(page);
    const violations = await runAxe(page);
    expect(violations, `axe violations: ${JSON.stringify(violations)}`).toEqual([]);
  });

  test('Home stage cards have no button-name / interactive-role violations', async ({ page }) => {
    await gotoHome(page);
    const violations = await runAxe(page);
    expect(violations, `axe violations: ${JSON.stringify(violations)}`).toEqual([]);
  });
});
