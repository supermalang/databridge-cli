import { test, expect, Page } from '@playwright/test';

/**
 * UX-3 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-3.spec.ts: the single screenshot
 * assertion — the OPEN project switcher menu showing the de-emphasized archived
 * row and its Unarchive affordance — plus the minimal duplicated setup it needs
 * (the bootstrap /api stubs with call tracking, the seeded active/archived
 * projects, and the app/menu navigation helpers). The functional tests remain in
 * the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const ACTIVE_PROJECT = {
  id: 'proj-active',
  name: 'Global Health',
  slug: 'global-health',
  role: 'admin',
  is_archived: false,
  color: '#0f766e',
  icon: '🌍',
};

const ARCHIVED_PROJECT = {
  id: 'proj-archived',
  name: 'Old Pilot',
  slug: 'old-pilot',
  role: 'admin',
  is_archived: true,
  color: '#b91c1c',
  icon: '📦',
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

// Records calls so the specs can assert which actions fired.
type Calls = { activates: string[]; unarchives: string[] };

async function stubBootstrap(page: Page, calls: Calls) {
  // Tracks whether the archived project has been unarchived yet, so /api/projects
  // returns it as active after the unarchive endpoint is hit.
  const state = { unarchived: false };

  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({
      json: {
        active_id: ACTIVE_PROJECT.id,
        is_superadmin: false,
        projects: [
          ACTIVE_PROJECT,
          { ...ARCHIVED_PROJECT, is_archived: !state.unarchived },
        ],
      },
    }));
  // Capture project switches (must NOT fire for archived rows).
  await page.route('**/api/projects/*/activate', (r) => {
    const m = r.request().url().match(/\/api\/projects\/([^/]+)\/activate/);
    if (m) calls.activates.push(decodeURIComponent(m[1]));
    r.fulfill({ json: { ok: true } });
  });
  // Capture unarchive and flip the archived project back to active.
  await page.route('**/api/projects/*/unarchive', (r) => {
    const m = r.request().url().match(/\/api\/projects\/([^/]+)\/unarchive/);
    if (m) calls.unarchives.push(decodeURIComponent(m[1]));
    state.unarchived = true;
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
const archivedRow = (page: Page) => page.locator('.project-menu__archived');

async function openMenu(page: Page) {
  await switcher(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(archivedRow(page)).toBeVisible();
}

test.describe('UX-3 — visual baseline (one per viewport via playwright.config.ts)', () => {
  let calls: Calls;
  test.beforeEach(async ({ page }) => {
    calls = { activates: [], unarchives: [] };
    await stubBootstrap(page, calls);
  });

  // Visual baseline of the OPEN menu showing the de-emphasized archived row and
  // its Unarchive affordance. Gate on AC2 (the Unarchive button is present)
  // before capture so the baseline cannot pass vacuously against pre-fix code.
  // Screenshot the .project-menu element directly; hide the position:fixed
  // terminal bar so it never intrudes. No mask.
  test('visual baseline of the open menu with the archived row + Unarchive', async ({ page }) => {
    await gotoApp(page);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await openMenu(page);

    await expect(
      archivedRow(page).getByRole('button', { name: /unarchive/i }),
      'Unarchive affordance must be present before the baseline is captured',
    ).toBeVisible();

    await expect(menu(page)).toHaveScreenshot('project-menu-archived.png');
  });
});
