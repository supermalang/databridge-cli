import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * UX-8 — Accessible labels on color swatches / icon buttons (ProjectForm).
 *
 * The project form's Details tab offers a color picker and an emoji/icon picker.
 * Today (frontend/src/pages/ProjectForm.jsx ~186-199) both rows render bare
 * <button> elements that convey their meaning by color/emoji ALONE:
 *
 *     COLORS.map(c => (
 *       <button className={`pf-swatch ${color === c ? 'sel' : ''}`}
 *               style={{ background: c }} onClick={() => setColor(c)} />   // ← no text, no aria-label, no aria-pressed
 *     ))
 *     ICONS.map(ic => (
 *       <button className={`pf-icon ${icon === ic ? 'sel' : ''}`}
 *               onClick={() => setIcon(ic)}>{ic}</button>                  // ← emoji only, no aria-label/aria-pressed
 *     ))
 *
 * The color swatches have NO accessible name at all (empty button); the icon
 * buttons' only name is an emoji glyph and neither row exposes a pressed state.
 *
 * The card requires:
 *   - each color swatch to carry a descriptive `aria-label` (e.g. aria-label="Red"),
 *   - the currently selected swatch to be `aria-pressed="true"` and all others
 *     `aria-pressed="false"`,
 *   - the icon buttons to follow the same pattern.
 *
 * CONTRACT under test (interface the implementer must satisfy — derived from the
 * AC, NOT from current code):
 *
 *   Color swatches — one `.pf-swatch` per COLORS entry, in order:
 *     COLORS = ['#0EA5E9','#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#14B8A6','#64748B']
 *     - every `.pf-swatch` has a NON-EMPTY `aria-label` (descriptive color name,
 *       e.g. "Sky" / "Blue" / "Red"); the accessible name is non-empty.
 *     - exactly the selected swatch is `aria-pressed="true"`; all others
 *       `aria-pressed="false"`. Default selection is COLORS[0] (the first swatch).
 *     - clicking a different swatch moves `aria-pressed="true"` onto it and the
 *       previous one becomes `aria-pressed="false"`.
 *
 *   Icon buttons — one `.pf-icon` per ICONS entry, in order:
 *     ICONS = ['📊','🩺','🌍','🎓','🚰','🌱','🏥','📦']
 *     - every `.pf-icon` has a NON-EMPTY `aria-label` describing the emoji; the
 *       accessible name is non-empty (NOT relying on the emoji glyph alone, which
 *       renders as tofu / has no semantic name).
 *     - exactly the selected icon is `aria-pressed="true"`; all others
 *       `aria-pressed="false"`. Default selection is ICONS[0] (the first icon).
 *     - clicking a different icon moves the pressed state.
 *
 * NOTE on emoji: headless Linux has no emoji font, so the glyphs render as tofu
 * boxes in the screenshot — a known, pre-existing environment artifact. The
 * load-bearing checks are the aria/role assertions; the screenshot is supplementary.
 *
 * We use the CREATE form (+ New project) so the form starts EMPTY and CLEAN
 * (same harness as ux-1/4/6). An empty create form is not dirty, so the UX-4
 * unsaved-changes guard does not interfere.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 *
 * SELECTORS (interface, not behavior under test — they survive the fix):
 *   - Switcher trigger:    `.project-switcher`
 *   - Open menu:           `.project-menu`
 *   - + New project:       `.project-menu__add` (text "+ New project")
 *   - ProjectForm root:    `.project-form`
 *   - Color swatch row:    `.pf-swatches` → `.pf-swatch` buttons
 *   - Icon row:            `.pf-icons` → `.pf-icon` buttons
 *   The terminal bar `.bottom-term` is position:fixed; hidden for the baseline.
 */

const COLORS = ['#0EA5E9', '#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#14B8A6', '#64748B'];
const ICONS = ['📊', '🩺', '🌍', '🎓', '🚰', '🌱', '🏥', '📦'];

const PROJECT = {
  id: 'proj-edit',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#0F766E',
  icon: '🌍',
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: PROJECT.id, is_superadmin: false, projects: [PROJECT] } }));
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

// Open the project switcher → "+ New project" → ProjectForm (create mode, clean).
async function openCreateForm(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
  await page.locator('.project-menu__add').click();
  await expect(page.locator('.project-form')).toBeVisible();
  await expect(page.locator('.project-form__title')).toContainText(/new project/i);
}

const swatches = (page: Page) => page.locator('.project-form .pf-swatches .pf-swatch');
const icons = (page: Page) => page.locator('.project-form .pf-icons .pf-icon');

test.describe('UX-8 — accessible color swatches', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC1: each color swatch has a NON-EMPTY descriptive aria-label.
  // RED today: swatches are empty buttons with no aria-label → no accessible name.
  test('every color swatch has a non-empty descriptive aria-label', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    const sw = swatches(page);
    await expect(sw, 'one swatch per COLORS entry').toHaveCount(COLORS.length);

    for (let i = 0; i < COLORS.length; i++) {
      const label = await sw.nth(i).getAttribute('aria-label');
      expect(
        label && label.trim().length > 0,
        `color swatch ${i} (${COLORS[i]}) must have a non-empty aria-label, got ${JSON.stringify(label)}`,
      ).toBeTruthy();
    }
  });

  // AC2: the selected swatch is aria-pressed="true"; all others "false". Selecting
  // a different swatch moves the pressed state.
  // RED today: no aria-pressed attribute on any swatch.
  test('aria-pressed reflects the selected color and moves on selection', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    const sw = swatches(page);

    // Default selection is COLORS[0] (the `.sel` swatch).
    await expect(sw.nth(0), 'the default-selected swatch is pressed')
      .toHaveAttribute('aria-pressed', 'true');
    for (let i = 1; i < COLORS.length; i++) {
      await expect(sw.nth(i), `unselected swatch ${i} is not pressed`)
        .toHaveAttribute('aria-pressed', 'false');
    }

    // Select a different swatch → pressed state moves to it.
    await sw.nth(4).click();
    await expect(sw.nth(4), 'the newly selected swatch becomes pressed')
      .toHaveAttribute('aria-pressed', 'true');
    await expect(sw.nth(0), 'the previously selected swatch is released')
      .toHaveAttribute('aria-pressed', 'false');
    // Exactly one pressed swatch at a time.
    await expect(
      page.locator('.project-form .pf-swatches .pf-swatch[aria-pressed="true"]'),
      'exactly one color swatch is pressed',
    ).toHaveCount(1);
  });
});

test.describe('UX-8 — accessible icon buttons', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC3 (label half): each icon button has a NON-EMPTY aria-label.
  // RED today: icon buttons expose only the emoji glyph and no aria-label.
  test('every icon button has a non-empty aria-label', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    const ic = icons(page);
    await expect(ic, 'one icon button per ICONS entry').toHaveCount(ICONS.length);

    for (let i = 0; i < ICONS.length; i++) {
      const label = await ic.nth(i).getAttribute('aria-label');
      expect(
        label && label.trim().length > 0,
        `icon button ${i} (${ICONS[i]}) must have a non-empty aria-label, got ${JSON.stringify(label)}`,
      ).toBeTruthy();
    }
  });

  // AC3 (pressed half): the selected icon is aria-pressed="true"; others "false";
  // selection moves the pressed state.
  // RED today: no aria-pressed attribute on any icon button.
  test('aria-pressed reflects the selected icon and moves on selection', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    const ic = icons(page);

    // Default selection is ICONS[0] (the `.sel` icon).
    await expect(ic.nth(0), 'the default-selected icon is pressed')
      .toHaveAttribute('aria-pressed', 'true');
    for (let i = 1; i < ICONS.length; i++) {
      await expect(ic.nth(i), `unselected icon ${i} is not pressed`)
        .toHaveAttribute('aria-pressed', 'false');
    }

    // Select a different icon → pressed state moves to it.
    await ic.nth(3).click();
    await expect(ic.nth(3), 'the newly selected icon becomes pressed')
      .toHaveAttribute('aria-pressed', 'true');
    await expect(ic.nth(0), 'the previously selected icon is released')
      .toHaveAttribute('aria-pressed', 'false');
    await expect(
      page.locator('.project-form .pf-icons .pf-icon[aria-pressed="true"]'),
      'exactly one icon is pressed',
    ).toHaveCount(1);
  });
});

test.describe('UX-8 — axe audit of the swatch / icon controls', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC4: an axe audit scoped to the picker rows reports no discernible-name
  // violations on these controls.
  // RED today: the empty color-swatch buttons (and emoji-only icon buttons) have no
  // accessible name → `button-name` violation.
  test('no button-name / aria violations on the color + icon pickers', async ({ page }) => {
    await gotoApp(page);
    await openCreateForm(page);

    await expect(swatches(page).first()).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.project-form .pf-swatches')
      .include('.project-form .pf-icons')
      .withRules(['button-name', 'aria-allowed-attr', 'aria-valid-attr', 'aria-valid-attr-value'])
      .analyze();

    expect(
      results.violations,
      `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  });
});

test.describe('UX-8 — visual baseline of the color + icon picker row', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the accessible picker rows. Gate on the AC so the baseline
  // cannot pass vacuously before the labels/pressed-state exist: the first swatch
  // must carry a non-empty aria-label and be pressed. Screenshot the Details panel
  // region containing both rows; hide the position:fixed terminal bar (no mask).
  //
  // Emoji may render as tofu in headless Linux (no emoji font) — a known
  // pre-existing env artifact; the aria assertions above are the load-bearing checks.
  test('visual baseline of the picker rows (first swatch selected)', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await openCreateForm(page);

    const firstSwatch = swatches(page).first();
    await expect(firstSwatch).toBeVisible();
    const label = await firstSwatch.getAttribute('aria-label');
    expect(
      label && label.trim().length > 0,
      'first swatch must have a non-empty aria-label before the baseline is captured',
    ).toBeTruthy();
    await expect(firstSwatch, 'first swatch must be pressed before the baseline is captured')
      .toHaveAttribute('aria-pressed', 'true');

    await expect(page.locator('.project-form__body')).toHaveScreenshot('ux-8-pickers.png');
  });
});
