import { test, expect, Page } from '@playwright/test';

/**
 * UX-2 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-2.spec.ts: the single screenshot
 * assertion — the keyboard-opened project switcher menu with the first item
 * focused — plus the minimal duplicated setup it needs (the bootstrap /api stubs,
 * the gotoApp navigation helper, and the switcher / menu / menuRow locators). The
 * functional/ARIA/keyboard-flow/Escape tests remain in the e2e file.
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
