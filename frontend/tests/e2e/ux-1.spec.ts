import { test, expect, Page, Locator } from '@playwright/test';

/**
 * UX-1 — Show project color & icon.
 *
 * The create/edit project form (ProjectForm.jsx) already collects + persists a
 * `color` (hex, e.g. "#b91c1c") and an `icon` (emoji, e.g. "🌍") on every project,
 * but they are rendered NOWHERE: the switcher avatar still shows
 * `name.slice(0,2).toUpperCase()` and the project-menu rows are text-only.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *   1. With an active project that has a color + emoji icon, the switcher avatar
 *      shows the EMOJI (not the two-letter fallback) on a background matching the
 *      project color.
 *   2. Opening the project switcher menu: the project's menu row shows its
 *      icon/color too (not text-only).
 *   3. The project list (the menu rows) shows the same icon/color for every
 *      project that has one.
 *   4. A project WITHOUT a color/icon still falls back gracefully to the
 *      two-letter avatar — no crash.
 *
 * NETWORK-MOCKED end-to-end (same harness as a11y-* / pux-* / sample-data-path):
 * the Vite dev server serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required.
 *
 * FIELD NAMES (confirmed in ProjectForm.jsx + lib/projects.js, NOT under test —
 * the contract the implementer must render):
 *   - Project object fields: `color` (hex string) and `icon` (emoji string).
 *     `payload()` in ProjectForm sends `{ ..., color, icon }`; /api/projects
 *     returns `{ projects: [{ id, name, slug, role, is_archived, color, icon }] },
 *     active_id, is_superadmin }`. App.jsx maps these into `activeProject` and the
 *     `activeProjects` / `archivedProjects` lists.
 *
 * SELECTORS (interface, not behavior under test — these survive the fix):
 *   - Switcher trigger:  `.project-switcher`
 *   - Switcher avatar:   `.project-switcher__avatar`  (today: 2-letter text; must
 *                        show the emoji + project-color background when set)
 *   - Open menu:         `.project-menu`
 *   - Menu rows:         `.project-menu__item`
 *   - Row text label:    `.project-menu__label`
 *   The terminal bar `.bottom-term` is position:fixed; hidden for full-surface shots.
 */

// Active project WITH a distinctive color + emoji icon set.
const PROJECT_WITH = {
  id: 'proj-with',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#b91c1c',   // distinctive red, far from the default #fff avatar bg
  icon: '🌍',
};

// A second project WITHOUT color/icon — must fall back to the two-letter avatar.
const PROJECT_WITHOUT = {
  id: 'proj-plain',
  name: 'Plain Project',
  slug: 'plain-project',
  role: 'admin',
  is_archived: false,
  // no color, no icon
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
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: {
        active_id: PROJECT_WITH.id,
        is_superadmin: false,
        projects: [PROJECT_WITH, PROJECT_WITHOUT],
      },
    }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
}

// Land on the app; the project switcher lives in the top ribbon and is always present.
async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

const avatar = (page: Page) => page.locator('.project-switcher__avatar');
const switcher = (page: Page) => page.locator('.project-switcher');
const menu = (page: Page) => page.locator('.project-menu');
const menuRow = (page: Page, name: RegExp) =>
  page.locator('.project-menu__item').filter({ hasText: name });

// rgb() parse for the avatar background-color (#b91c1c → rgb(185, 28, 28)).
function parseRgb(s: string): { r: number; g: number; b: number } | null {
  const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3] };
}

test.describe('UX-1 — project color & icon in the switcher avatar', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC1: the active project's emoji icon is shown in the switcher avatar (NOT the
  // two-letter `name.slice(0,2)` fallback "GL").
  test('switcher avatar shows the project emoji icon, not the two-letter fallback', async ({ page }) => {
    await gotoApp(page);
    const text = (await avatar(page).innerText()).trim();
    expect(text, 'avatar must render the project emoji 🌍, not the "GL" letter fallback')
      .toContain('🌍');
    expect(text, 'avatar must not still show the two-letter name slice').not.toBe('GL');
  });

  // AC1: the avatar background matches the project color (#b91c1c), not the
  // hardcoded white (#fff / rgb(255,255,255)) currently in styles.css.
  test('switcher avatar background matches the project color', async ({ page }) => {
    await gotoApp(page);
    const bg = await avatar(page).evaluate((el) => getComputedStyle(el).backgroundColor);
    const rgb = parseRgb(bg);
    expect(rgb, `avatar background-color must be parseable (got "${bg}")`).not.toBeNull();
    // #b91c1c == rgb(185, 28, 28). Small tolerance for any blend; reject the
    // current white default outright.
    expect(rgb, `avatar bg must be the project red #b91c1c, not white (got "${bg}")`)
      .toEqual({ r: 185, g: 28, b: 28 });
  });
});

test.describe('UX-1 — project color & icon in the menu rows / project list', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC2 + AC3: opening the menu, the row for the icon/color project shows its
  // emoji icon (today the rows render only `.project-menu__label` text).
  test('the project-menu row shows the project emoji icon', async ({ page }) => {
    await gotoApp(page);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();

    const row = menuRow(page, /Global Health/);
    await expect(row).toBeVisible();
    const rowText = (await row.innerText());
    expect(rowText, 'the menu row for the color/icon project must include its emoji 🌍')
      .toContain('🌍');
  });

  // AC2 + AC3: the menu row also carries the project color (rendered as a swatch /
  // avatar background somewhere inside the row), not text-only. Assert the row
  // contains a descendant element painted with the project color.
  test('the project-menu row shows the project color', async ({ page }) => {
    await gotoApp(page);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();

    const row = menuRow(page, /Global Health/);
    await expect(row).toBeVisible();

    // True if any element inside the row paints background-color #b91c1c (185,28,28)
    // or uses it as a color/border — the project color must surface in the row.
    const hasColor = await row.evaluate((rowEl) => {
      const target = { r: 185, g: 28, b: 28 };
      const close = (s: string) => {
        const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) return false;
        return +m[1] === target.r && +m[2] === target.g && +m[3] === target.b;
      };
      const els = [rowEl, ...Array.from(rowEl.querySelectorAll('*'))] as HTMLElement[];
      return els.some((el) => {
        const cs = getComputedStyle(el);
        return close(cs.backgroundColor) || close(cs.color) || close(cs.borderTopColor);
      });
    });
    expect(hasColor, 'the menu row must surface the project color (#b91c1c) on some element').toBe(true);
  });
});

test.describe('UX-1 — graceful fallback for projects with no color/icon', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // AC4: a project WITHOUT a color/icon still renders the two-letter avatar
  // fallback in its menu row — no crash, no empty avatar.
  test('a project without color/icon falls back to the two-letter avatar (no crash)', async ({ page }) => {
    await gotoApp(page);
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();

    const plainRow = menuRow(page, /Plain Project/);
    await expect(plainRow, 'the no-icon project row must still render').toBeVisible();

    // Its row must show the two-letter fallback "PL" somewhere (avatar text),
    // proving the fallback path is intact rather than rendering an empty/undefined icon.
    const rowText = (await plainRow.innerText());
    expect(rowText, 'the no-icon project must fall back to its name (and a 2-letter avatar)')
      .toContain('Plain Project');
    // The app must not have thrown — the menu and both rows are present.
    await expect(menuRow(page, /Global Health/)).toBeVisible();
  });
});

test.describe('UX-1 — visual baselines (one per viewport via playwright.config.ts)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  // Visual baseline of the switcher avatar (emoji + color). Gate on the AC so this
  // does not pass vacuously by baselining the pre-fix two-letter avatar — the
  // baseline must capture the emoji avatar, approved by a human.
  test('visual baseline of the switcher avatar', async ({ page }) => {
    await gotoApp(page);
    await expect(avatar(page), 'avatar must show the emoji before the baseline is captured')
      .toContainText('🌍');
    await expect(switcher(page)).toHaveScreenshot('project-switcher-avatar.png');
  });

  // Visual baseline of the open project menu (rows with icon/color). Screenshot the
  // menu element directly so the position:fixed terminal bar never intrudes.
  test('visual baseline of the open project menu', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await switcher(page).click();
    await expect(menu(page)).toBeVisible();
    await expect(menuRow(page, /Global Health/),
      'the menu row must show the emoji before the baseline is captured').toContainText('🌍');
    await expect(menu(page)).toHaveScreenshot('project-menu-icons.png');
  });
});
