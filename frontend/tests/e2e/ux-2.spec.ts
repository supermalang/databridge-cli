import { test, expect, Page } from '@playwright/test';

/**
 * UX-2 — Keyboard-accessible project switcher.
 *
 * Today the switcher is mouse-only and inaccessible:
 *   - the trigger `.project-switcher` is a <button> but exposes NO
 *     `aria-haspopup` and NO `aria-expanded` (App.jsx ~430-441);
 *   - the dropdown `.project-menu` is a plain <div> with no `role="menu"`;
 *   - the project rows `.project-menu__item` are `<div onClick>` with no
 *     `role`/`tabIndex`/keyboard handlers (App.jsx ~444-463);
 *   - nothing closes the menu on Escape (only the toggle button / a re-click).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA (not the implementation):
 *   AC1. Trigger exposes `aria-haspopup` (menu/true) and `aria-expanded` that
 *        reflects the open state ("false" closed → "true" open).
 *   AC2. The dropdown is `role="menu"` and project rows are keyboard-activatable
 *        — real <button>s OR `role="menuitem"` + tabIndex + Enter/Space handlers.
 *   AC3. Keyboard flow: Tab to trigger → Enter opens the menu (aria-expanded
 *        true) → ArrowDown moves focus to the first menu item → Enter on a
 *        project row activates/switches to that project.
 *   AC4. Escape with the menu open closes it (aria-expanded false) and returns
 *        focus to the trigger — matching the existing Modal focus/Escape contract.
 *
 * ----------------------------------------------------------------------------
 * SELECTOR / ROLE CONTRACT FOR THE IMPLEMENTER (what these tests pin):
 *   - Trigger:        `.project-switcher` (keep) — add `aria-haspopup="menu"`
 *                     (or "true") and `aria-expanded` = "true"|"false" bound to
 *                     the `projMenuOpen` state.
 *   - Dropdown:       `.project-menu` (keep) — add `role="menu"`.
 *   - Project rows:   `.project-menu__item` (keep) — make each row either a real
 *                     <button> OR add `role="menuitem"` + `tabIndex` + Enter/Space
 *                     activation that calls `switchProject(p.id)`.
 *   - ArrowDown:      from the trigger (or open menu), ArrowDown moves focus to
 *                     the first menu item (roving focus).
 *   - Escape:         closes the menu and returns focus to the `.project-switcher`
 *                     trigger (mirror Modal.jsx: Escape → onClose + restore focus).
 *   The avatar/label selectors added by UX-1 (`.project-menu__avatar`,
 *   `.project-menu__label`) are preserved and must keep rendering.
 * ----------------------------------------------------------------------------
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1 / a11y-* / pux-*): the Vite
 * dev server serves the real SPA; every /api/** is intercepted with page.route(),
 * so no FastAPI backend is required. We use >=2 projects so ArrowDown navigation
 * between rows and an actual project switch are both observable.
 */

const PROJECT_A = {
  id: 'proj-a',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#b91c1c',
  icon: '🌍',
};

const PROJECT_B = {
  id: 'proj-b',
  name: 'Field Survey',
  slug: 'field-survey',
  role: 'admin',
  is_archived: false,
  color: '#0f766e',
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

// Records the project id passed to POST /api/projects/{id}/activate so the
// keyboard-switch test can assert the right project was activated.
type Activations = { ids: string[] };

async function stubBootstrap(page: Page, activations: Activations) {
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: {
        active_id: PROJECT_A.id,
        is_superadmin: false,
        projects: [PROJECT_A, PROJECT_B],
      },
    }));
  // Capture which project gets activated by the keyboard flow.
  await page.route('**/api/projects/*/activate', (r) => {
    const m = r.request().url().match(/\/api\/projects\/([^/]+)\/activate/);
    if (m) activations.ids.push(decodeURIComponent(m[1]));
    r.fulfill({ json: { ok: true } });
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
const menuRow = (page: Page, name: RegExp) =>
  page.locator('.project-menu__item').filter({ hasText: name });

test.describe('UX-2 — switcher trigger ARIA (haspopup + expanded)', () => {
  let activations: Activations;
  test.beforeEach(async ({ page }) => {
    activations = { ids: [] };
    await stubBootstrap(page, activations);
  });

  // AC1: the trigger advertises that it controls a menu.
  test('trigger exposes aria-haspopup for a menu', async ({ page }) => {
    await gotoApp(page);
    const haspopup = await switcher(page).getAttribute('aria-haspopup');
    expect(haspopup, 'trigger must expose aria-haspopup="menu" (or "true")')
      .toMatch(/^(menu|true)$/);
  });

  // AC1: aria-expanded reflects the closed → open state transition.
  test('trigger aria-expanded reflects the open state (false → true)', async ({ page }) => {
    await gotoApp(page);

    expect(await switcher(page).getAttribute('aria-expanded'),
      'closed menu: trigger aria-expanded must be "false"').toBe('false');

    await switcher(page).click();
    await expect(menu(page)).toBeVisible();

    expect(await switcher(page).getAttribute('aria-expanded'),
      'open menu: trigger aria-expanded must be "true"').toBe('true');
  });
});

test.describe('UX-2 — menu + rows expose menu roles / are keyboard-activatable', () => {
  let activations: Activations;
  test.beforeEach(async ({ page }) => {
    activations = { ids: [] };
    await stubBootstrap(page, activations);
  });

  // AC2: the dropdown is a role="menu".
  test('the open dropdown is role="menu"', async ({ page }) => {
    await gotoApp(page);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();
    expect(await menu(page).getAttribute('role'),
      'the .project-menu dropdown must be role="menu"').toBe('menu');
  });

  // AC2: project rows are keyboard-activatable — either a real <button> or a
  // role="menuitem" element that is focusable (tabIndex present, not -1).
  test('project rows are keyboard-activatable (button or role=menuitem + focusable)', async ({ page }) => {
    await gotoApp(page);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();

    const row = menuRow(page, /Field Survey/);
    await expect(row).toBeVisible();

    const shape = await row.evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
    }));

    const isButton = shape.tag === 'button';
    const isMenuItem =
      shape.role === 'menuitem' && shape.tabindex !== null && shape.tabindex !== '-1';

    expect(
      isButton || isMenuItem,
      `project rows must be activatable: a real <button>, or role="menuitem" with a ` +
        `non-(-1) tabindex (got tag="${shape.tag}" role="${shape.role}" tabindex="${shape.tabindex}")`,
    ).toBe(true);
  });
});

test.describe('UX-2 — keyboard flow opens, navigates, and switches', () => {
  let activations: Activations;
  test.beforeEach(async ({ page }) => {
    activations = { ids: [] };
    await stubBootstrap(page, activations);
  });

  // AC3: Tab to the trigger → Enter opens (aria-expanded true) → ArrowDown moves
  // focus to the first menu item → Enter activates/switches to that project.
  test('Enter opens, ArrowDown focuses first item, Enter switches project', async ({ page }) => {
    await gotoApp(page);

    // Focus the trigger directly (Tab order is incidental; the AC is keyboard
    // operability of the switcher itself), then open with Enter.
    await switcher(page).focus();
    await expect(switcher(page)).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(menu(page)).toBeVisible();
    expect(await switcher(page).getAttribute('aria-expanded'),
      'Enter on the trigger must open the menu (aria-expanded true)').toBe('true');

    // ArrowDown moves focus into the menu, onto the first item.
    await page.keyboard.press('ArrowDown');
    const firstItem = page.locator('.project-menu__item').first();
    await expect(firstItem,
      'ArrowDown must move focus to the first menu item (roving focus)').toBeFocused();

    // Navigate to the non-active project's row and activate it with Enter.
    const targetRow = menuRow(page, /Field Survey/);
    await targetRow.focus();
    await expect(targetRow).toBeFocused();
    await page.keyboard.press('Enter');

    // The project must actually switch: POST /api/projects/proj-b/activate fires
    // and the switcher name updates to the new active project.
    await expect.poll(() => activations.ids,
      'Enter on the Field Survey row must activate proj-b').toContain(PROJECT_B.id);
    await expect(page.locator('.project-switcher__name'),
      'switcher must reflect the newly-activated project').toHaveText(/Field Survey/);
  });
});

test.describe('UX-2 — Escape closes the menu and returns focus to the trigger', () => {
  let activations: Activations;
  test.beforeEach(async ({ page }) => {
    activations = { ids: [] };
    await stubBootstrap(page, activations);
  });

  // AC4: Escape closes the open menu (aria-expanded false), focus returns to the
  // trigger, and no project switch happens (mirrors Modal.jsx Escape contract).
  test('Escape closes the menu, restores focus to the trigger, switches nothing', async ({ page }) => {
    await gotoApp(page);

    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(menu(page), 'Escape must close the dropdown').toHaveCount(0);
    expect(await switcher(page).getAttribute('aria-expanded'),
      'after Escape, aria-expanded must be "false"').toBe('false');
    await expect(switcher(page),
      'after Escape, focus must return to the trigger (matches Modal)').toBeFocused();
    expect(activations.ids,
      'Escape must not activate/switch any project').toEqual([]);
  });
});

test.describe('UX-2 — visual baseline (one per viewport via playwright.config.ts)', () => {
  let activations: Activations;
  test.beforeEach(async ({ page }) => {
    activations = { ids: [] };
    await stubBootstrap(page, activations);
  });

  // Visual baseline of the OPEN menu with the first item keyboard-focused. Gate
  // on the AC (aria-expanded true) so the baseline cannot pass vacuously against
  // the pre-fix mouse-only menu. Screenshot the .project-menu element directly;
  // hide the position:fixed terminal bar so it never intrudes.
  test('visual baseline of the keyboard-opened menu (first item focused)', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });

    await switcher(page).focus();
    await page.keyboard.press('Enter');
    await expect(menu(page)).toBeVisible();
    expect(await switcher(page).getAttribute('aria-expanded'),
      'menu must be open (aria-expanded true) before the baseline is captured').toBe('true');

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.project-menu__item').first(),
      'first menu item must be focused before the baseline is captured').toBeFocused();

    await expect(menu(page)).toHaveScreenshot('project-menu-keyboard.png');
  });
});
