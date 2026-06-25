import { test, expect, Page } from '@playwright/test';

/**
 * UX-3 — Archived rows look clickable but do nothing.
 *
 * Today archived project rows reuse the active-row container class
 * (`.project-menu__item project-menu__archived`, App.jsx ~512-514). They get the
 * same hover highlight as switchable rows, but they carry NO row `onClick` /
 * `role="menuitem"` / keyboard handler — only the gear works. So they *read* as
 * clickable/switchable while doing nothing, and there is no way to bring an
 * archived project back from inside the switcher.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *   AC1. Archived rows are visually de-emphasized and do NOT carry the
 *        active-row switchable affordance that UX-2 gave active rows
 *        (`role="menuitem"` + focusable tabIndex). They must read as
 *        non-switchable.
 *   AC2. Each archived row exposes an explicit Unarchive affordance — a real
 *        <button> with an accessible name matching /unarchive/i. Clicking it
 *        triggers the unarchive action (POST /api/projects/{id}/unarchive) and
 *        the project returns to the active list.
 *   AC3. Clicking the archived row BODY does not switch project (no
 *        POST /api/projects/{id}/activate fires).
 *
 * ----------------------------------------------------------------------------
 * SELECTOR / CONTRACT FOR THE IMPLEMENTER (what these tests pin):
 *   - Archived row:     `.project-menu__archived` (keep) — must be visually
 *                       de-emphasized AND must NOT be a switchable row: it must
 *                       NOT expose `role="menuitem"` and must NOT be focusable
 *                       (no non-(-1) tabindex) the way UX-2 active rows are, and
 *                       clicking its body must not call switchProject/activate.
 *   - Unarchive button: a real <button> inside the archived row with an
 *                       accessible name matching /unarchive/i. A stable hook is
 *                       provided via data-testid="project-unarchive" (the test
 *                       prefers the accessible name; the testid is a courtesy
 *                       anchor for the implementer — either resolves AC2).
 *   - Unarchive action: lib/projects.js `archiveProject(id, false)` →
 *                       POST /api/projects/{id}/unarchive, followed by
 *                       refreshProjects() (re-GET /api/projects). The project
 *                       then appears in the active list.
 * ----------------------------------------------------------------------------
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1 / ux-2 / a11y-* / pux-*): the
 * Vite dev server serves the real SPA; every /api/** is intercepted with
 * page.route(), so no FastAPI backend is required. We seed ONE active project and
 * ONE archived project. After the unarchive endpoint fires, the /api/projects
 * stub flips the archived project to is_archived:false so the post-unarchive
 * refresh reflects the project returning to active.
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

test.describe('UX-3 — archived rows are not switchable affordances', () => {
  let calls: Calls;
  test.beforeEach(async ({ page }) => {
    calls = { activates: [], unarchives: [] };
    await stubBootstrap(page, calls);
  });

  // AC1: the archived row must NOT carry the active-row switchable affordance
  // UX-2 gave active rows (role="menuitem" + focusable tabIndex). It must read
  // as non-switchable, distinguishing it from active rows.
  test('archived row does not expose the active-row switchable affordance', async ({ page }) => {
    await gotoApp(page);
    await openMenu(page);

    // Sanity: an active row DOES carry the UX-2 switchable affordance, proving
    // the distinction is meaningful (and the harness is wired correctly).
    const activeRow = page
      .locator('.project-menu__item:not(.project-menu__archived)')
      .filter({ hasText: /Global Health/ });
    const activeShape = await activeRow.evaluate((el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
    }));
    expect(
      activeShape.role === 'menuitem' && activeShape.tabindex !== null && activeShape.tabindex !== '-1',
      'active rows must remain switchable (role=menuitem + focusable) — UX-2 contract',
    ).toBe(true);

    // The archived row must NOT be a switchable menuitem the way active rows are.
    const archShape = await archivedRow(page).evaluate((el) => ({
      role: el.getAttribute('role'),
      tabindex: el.getAttribute('tabindex'),
    }));
    const archIsSwitchable =
      archShape.role === 'menuitem' && archShape.tabindex !== null && archShape.tabindex !== '-1';
    expect(
      archIsSwitchable,
      `archived row must NOT read as switchable like active rows ` +
        `(got role="${archShape.role}" tabindex="${archShape.tabindex}")`,
    ).toBe(false);
  });

  // AC3: clicking the archived row BODY must not switch project.
  test('clicking the archived row body does not switch project', async ({ page }) => {
    await gotoApp(page);
    await openMenu(page);

    // Click the row label area (the body), avoiding the gear/unarchive controls.
    await archivedRow(page).locator('.project-menu__label').click();

    // Give any (erroneous) activate handler a chance to fire, then assert none did.
    await page.waitForTimeout(150);
    expect(
      calls.activates,
      'clicking an archived row body must NOT activate/switch a project',
    ).toEqual([]);
    // The active project must remain unchanged.
    await expect(page.locator('.project-switcher__name')).toHaveText(/Global Health/);
  });
});

test.describe('UX-3 — explicit Unarchive affordance', () => {
  let calls: Calls;
  test.beforeEach(async ({ page }) => {
    calls = { activates: [], unarchives: [] };
    await stubBootstrap(page, calls);
  });

  // AC2: the archived row exposes a real <button> named /unarchive/i; clicking it
  // fires the unarchive endpoint and the project returns to the active list.
  test('Unarchive button fires the unarchive action and restores the project', async ({ page }) => {
    await gotoApp(page);
    await openMenu(page);

    const unarchiveBtn = archivedRow(page).getByRole('button', { name: /unarchive/i });
    await expect(
      unarchiveBtn,
      'archived row must expose a real <button> with an accessible name /unarchive/i',
    ).toBeVisible();

    await unarchiveBtn.click();

    // The unarchive endpoint must fire for the archived project.
    await expect
      .poll(() => calls.unarchives, 'clicking Unarchive must POST /api/projects/proj-archived/unarchive')
      .toContain(ARCHIVED_PROJECT.id);

    // After unarchive + refresh, the project returns to the active list and is no
    // longer rendered as an archived row.
    await expect(archivedRow(page), 'unarchived project must leave the Archived group').toHaveCount(0);
    await expect(
      page.locator('.project-menu__item:not(.project-menu__archived)').filter({ hasText: /Old Pilot/ }),
      'unarchived project must appear as an active, switchable row',
    ).toBeVisible();
  });
});

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
