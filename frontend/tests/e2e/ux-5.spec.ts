import { test, expect, Page, Locator } from '@playwright/test';

/**
 * UX-5 — Member rows fall back to a raw UUID.
 *
 * Today `ProjectMembersPanel.jsx` renders each member as
 *   `{m.email || m.name || m.user_id}`
 * so a member whose email AND name are empty shows a raw UUID, and there is no
 * marker for the signed-in user's own row.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA (not the implementation):
 *   AC(a) Members show email/name, NEVER a UUID — every member row shows a
 *         human-readable identifier; no row exposes a raw UUID as its label.
 *   AC(b) A "you" tag marks the current user — the member row whose identity
 *         matches /api/me carries a /you/i marker.
 *
 * ----------------------------------------------------------------------------
 * SELECTOR / CONTRACT FOR THE IMPLEMENTER (what these tests pin):
 *   - Endpoint: GET /api/projects/{id}/members returns each member with a
 *     human-readable identifier (email and/or name) — populated server-side so
 *     the panel never has to fall back to user_id. (See the companion pytest
 *     tests/test_members_identity.py for the backend half.)
 *   - Panel:    `.members-table` (kept) renders each member's email or name as
 *     the visible label and NEVER the raw user_id. No member cell may contain a
 *     UUID string.
 *   - "you" tag: the current user is determined by matching the member row
 *     against /api/me (email is the stable cross-reference: members rows and
 *     /api/me both carry `email`). That row must render a /you/i marker — e.g.
 *     a <span class="badge"> with text "you" (or aria-label/text containing
 *     "you"). The test asserts the marker on the row whose email == me.email.
 * ----------------------------------------------------------------------------
 *
 * NETWORK-MOCKED end-to-end (same harness as ux-1 / ux-2 / a11y-*): the Vite dev
 * server serves the real SPA; every /api/** is intercepted with page.route(), so
 * no FastAPI backend is required. The Members panel is reached via the project
 * switcher → ⚙ gear (opens ProjectForm) → Members tab.
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

test.describe('UX-5 — members show a human identifier, never a UUID', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openMembersPanel(page);
  });

  // AC(a): every member row shows email or name; no row's visible text is a UUID.
  test('no member row displays a raw UUID', async ({ page }) => {
    const rows = memberRows(page);
    const count = await rows.count();
    expect(count, 'all three seeded members must render').toBe(MEMBERS.length);

    for (let i = 0; i < count; i++) {
      const text = (await rows.nth(i).innerText()).trim();
      expect(text, 'every member row must show some visible identifier').not.toBe('');
      expect(
        UUID_RE.test(text),
        `member row #${i} must not display a raw UUID as its label (got: "${text}")`,
      ).toBe(false);
    }
  });

  // AC(a), targeted: the email-less + name-less member must still be human-readable
  // — and specifically must NOT be its raw user_id UUID.
  test('the member with no email or name is not rendered as its UUID', async ({ page }) => {
    // The blank member's UUID must not appear anywhere in the members table.
    await expect(
      page.locator('.members-table', { hasText: BLANK_UUID }),
      'the blank member must not surface its raw user_id UUID',
    ).toHaveCount(0);

    // And the panel as a whole shows no UUID-shaped label.
    const tableText = (await page.locator('.members-table').innerText()).trim();
    expect(UUID_RE.test(tableText), `members table must contain no UUID (got: "${tableText}")`).toBe(false);
  });
});

test.describe('UX-5 — the current user row carries a "you" tag', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openMembersPanel(page);
  });

  // AC(b): the row whose identity matches /api/me is marked with a "you" tag.
  test('the signed-in user\'s row has a /you/i marker', async ({ page }) => {
    const myRow = memberRows(page).filter({ hasText: ME.email });
    await expect(myRow, 'the current user must have exactly one row').toHaveCount(1);
    await expect(
      myRow.getByText(/\byou\b/i),
      'the current user\'s row must carry a "you" tag/badge',
    ).toBeVisible();
  });

  // The "you" marker must be unique to the current user — other rows must not have it.
  test('only the current user\'s row is tagged "you"', async ({ page }) => {
    const otherRow = memberRows(page).filter({ hasText: 'aisha@example.test' });
    await expect(otherRow).toHaveCount(1);
    await expect(
      otherRow.getByText(/\byou\b/i),
      'a member who is not the signed-in user must not be tagged "you"',
    ).toHaveCount(0);
  });
});

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
