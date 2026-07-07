import { test, expect, Page, Locator } from '@playwright/test';

/**
 * UX-5 — visual baseline (VIS-10, Shard A).
 *
 * Extracted verbatim from frontend/tests/e2e/ux-5.spec.ts: the single screenshot
 * assertion — the Members panel showing all three rows with human identifiers and
 * the "you" tag on the current user — plus the minimal duplicated setup it needs
 * (the bootstrap /api stubs incl. the members roster, the bootApp + openMembersPanel
 * navigation helpers, the memberRows locator, and the UUID_RE guard). The
 * functional tests remain in the e2e file.
 *
 * NETWORK-MOCKED end-to-end: the Vite dev server serves the real SPA; every
 * /api/** is intercepted with page.route(), so no FastAPI backend is required.
 */

const ME = { sub: 'dev', email: 'me@example.test', given_name: 'Me', family_name: 'User' };

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Field Survey',
  slug: 'field-survey',
  role: 'admin',
  is_archived: false,
  color: '#0f766e',
  icon: '📋',
};

// A UUID that must never appear as a visible label in the panel.
const BLANK_UUID = '85a96aa1-cac2-44cb-a04e-9c72b2054838';

// Three members: (1) the current user (email matches /api/me → "you" tag),
// (2) a member with an email, (3) a member with NO email and NO name — the
// exact gap the card calls out; the panel must still show a human identifier.
const MEMBERS = [
  { user_id: 'u-me', email: ME.email, name: 'Me User', role: 'admin', is_owner: true, is_superadmin: false },
  { user_id: 'u-2', email: 'aisha@example.test', name: '', role: 'editor', is_owner: false, is_superadmin: false },
  { user_id: BLANK_UUID, email: '', name: '', role: 'viewer', is_owner: false, is_superadmin: false },
];

const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => r.fulfill({ json: ME }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  // The members roster the panel renders.
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { my_role: 'admin', members: MEMBERS, invitations: [] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.project-switcher')).toBeVisible();
}

// Switcher → ⚙ gear → ProjectForm → Members tab → the members table is visible.
async function openMembersPanel(page: Page) {
  await page.locator('.project-switcher').click();
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form__tabs')).toBeVisible();
  await page.getByRole('tab', { name: /members/i }).click();
  await expect(page.locator('.members-table')).toBeVisible();
}

const memberRows = (page: Page): Locator =>
  page.locator('.members-table tbody tr');

// A canonical RFC-4122-ish UUID anywhere in a string.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.describe('UX-5 — visual baseline (one per viewport via playwright.config.ts)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openMembersPanel(page);
  });

  // Baseline of the Members panel showing all three rows with human identifiers
  // and the "you" tag on the current user. Gate on the ACs first so the baseline
  // cannot pass vacuously against the pre-fix UUID rendering. Screenshot the
  // members table element directly; hide the position:fixed terminal bar.
  test('members panel baseline (human identifiers + you tag)', async ({ page }) => {
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });

    const table = page.locator('.members-table');
    await expect(table).toBeVisible();
    // Pre-conditions: no UUID visible, and the "you" tag is present.
    const tableText = (await table.innerText()).trim();
    expect(UUID_RE.test(tableText), 'baseline must be captured with no UUID labels').toBe(false);
    await expect(
      memberRows(page).filter({ hasText: ME.email }).getByText(/\byou\b/i),
      'baseline must be captured with the "you" tag present',
    ).toBeVisible();

    await expect(table).toHaveScreenshot('ux-5-members-panel.png');
  });
});
