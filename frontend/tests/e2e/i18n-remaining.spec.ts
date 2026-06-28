import { test, expect, Page } from '@playwright/test';

/**
 * I18N-3 — Externalize the remaining untranslated surfaces (Profile / Ask /
 * Validate / ProjectForm / ProjectMembersPanel) to the en/fr bundles.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. With the profile mocked to language:"fr", a representative FRENCH string
 *      renders on Profile (the screenshot surface), Ask, Validate, the project
 *      edit form, and the members panel — and NO raw translation key (a bare
 *      `foo.bar` token) leaks into the rendered UI.
 *   2. With English selected the SAME surfaces render their English strings.
 *   3. Visual baseline of the FRENCH Profile header at all three viewports
 *      (mobile/tablet/desktop via playwright.config.ts projects); a human
 *      approves (checking no FR overflow).
 *
 * NETWORK-MOCKED end to end (same harness as i18n-subtabs / i18n-coverage):
 * Vite serves the real SPA; every /api/ call is intercepted with page.route(),
 * so no FastAPI backend is needed.
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
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

async function stubBootstrap(page: Page, language: 'en' | 'fr') {
  // Catch-all FIRST (Playwright matches routes in REVERSE registration order).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = (r.request().postDataJSON() || {}) as { language?: string };
      return r.fulfill({
        json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language: body.language ?? language },
      });
    }
    return r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language } });
  });
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: false, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/profile', (r) => r.fulfill({ json: { profiles: [] } }));
  await page.route('**/api/data-quality', (r) => r.fulfill({ json: { has_data: false } }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: { n_rows: 0, n_columns: 0, checks: [], summary: {} } }));
  await page.route('**/api/ask/examples', (r) => r.fulfill({ json: { examples: [] } }));
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

// Open a primary stage by its stable data-tab id, then a sub-tab by index
// (language-independent navigation is by structure; we click the Nth sub-tab).
// Returns the VISIBLE pane — kept-alive sub-panes all stay mounted (inactive
// ones are display:none), so locators must be scoped to the active one.
async function openSub(page: Page, stageId: string, subIndex: number) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
  const bar = page.locator('.subtabs-bar');
  await expect(bar).toBeVisible();
  await bar.locator('.subtab').nth(subIndex).click();
  return page.locator('.tab-content:visible');
}

// Open the project edit form (Details tab) via the switcher → gear.
async function openProjectForm(page: Page) {
  await page.locator('.project-switcher').click();
  await page.locator('.project-menu').waitFor();
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form')).toBeVisible();
}

// A leaked, unresolved translation key (e.g. "dataProfile.eyebrow" /
// "members.colMember") echoed verbatim when t('x.y') references a key absent
// from the active bundle. Matches a dotted lowercase identifier token.
const RAW_KEY = /\b[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*\b/;

function assertNoRawKey(text: string, where: string) {
  expect(RAW_KEY.test(text), `a raw translation key leaked into ${where}: ${JSON.stringify(text)}`).toBe(false);
}

test.describe('I18N-3 — remaining surfaces render French strings from the bundle', () => {
  test('Profile header + column table render in French (no raw key)', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const pane = await openSub(page, 'transform', 1);   // Questions(0) · Profile(1) · Validate(2)
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Profil des données');
    await expect(header).toContainText('Comprenez vos');
    assertNoRawKey((await header.innerText()).trim(), 'the French Profile header');
  });

  test('Ask header + placeholder + empty state render in French (no raw key)', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const pane = await openSub(page, 'analyze', 0);     // Ask(0) · Charts & indicators(1)
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Interroger');
    await expect(pane.locator('input[placeholder="ex. Combien de soumissions par région ?"]')).toBeVisible();
    await expect(pane).toContainText('Posez n’importe quelle question sur vos données');
    assertNoRawKey((await header.innerText()).trim(), 'the French Ask header');
  });

  test('Validate header renders in French (no raw key)', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const pane = await openSub(page, 'transform', 2);   // Validate(2)
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Valider');
    await expect(header).toContainText('Vérifiez vos');
    assertNoRawKey((await header.innerText()).trim(), 'the French Validate header');
  });

  test('Project edit form renders French labels + tabs (no raw key)', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    await openProjectForm(page);
    const form = page.locator('.project-form');
    await expect(form.locator('.pf-tab').first()).toContainText('Détails');
    await expect(form).toContainText('Nom *');
    await expect(form).toContainText('Langue par défaut');
    assertNoRawKey((await form.locator('.project-form__tabs').innerText()).trim(), 'the French project-form tabs');
  });

  test('Members panel renders French headers + invite labels (no raw key)', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    await openProjectForm(page);
    await page.locator('.project-form .pf-tab', { hasText: 'Membres' }).click();
    const panel = page.locator('.pf-panel').filter({ has: page.locator('.members-table') });
    await expect(panel).toContainText('Membre');
    await expect(panel).toContainText('Inviter quelqu’un');
    await expect(panel.locator('input[placeholder="email@example.com"]')).toBeVisible();
    assertNoRawKey((await panel.innerText()).trim(), 'the French members panel');
  });
});

test.describe('I18N-3 — the same surfaces revert to English', () => {
  test('Profile header renders in English', async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
    const pane = await openSub(page, 'transform', 1);
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Data profile');
    await expect(header).toContainText('Understand your');
    assertNoRawKey((await header.innerText()).trim(), 'the English Profile header');
  });

  test('Ask header renders in English', async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
    const pane = await openSub(page, 'analyze', 0);
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Ask');
    await expect(header).toContainText('Ask your');
  });

  test('Validate header renders in English', async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
    const pane = await openSub(page, 'transform', 2);
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Validate');
    await expect(header).toContainText('Check your');
  });

  test('Project edit form renders English labels', async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
    await openProjectForm(page);
    const form = page.locator('.project-form');
    await expect(form.locator('.pf-tab').first()).toContainText('Details');
    await expect(form).toContainText('Name *');
    await expect(form).toContainText('Default language');
  });

  test('Members panel renders English headers + invite labels', async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
    await openProjectForm(page);
    await page.locator('.project-form .pf-tab', { hasText: 'Members' }).click();
    const panel = page.locator('.pf-panel').filter({ has: page.locator('.members-table') });
    await expect(panel).toContainText('Member');
    await expect(panel).toContainText('Invite someone');
  });
});

test.describe('I18N-3 — visual baseline of the French Profile header', () => {
  // AC visual: capture the FRENCH Profile header at all three viewports (one
  // baseline per viewport via playwright.config.ts). Gate on a wired FR string
  // first so the baseline can never be vacuous (an untranslated EN header).
  test('visual baseline — French Profile header', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const pane = await openSub(page, 'transform', 1);
    const header = pane.locator('.page-header');
    await expect(header).toContainText('Profil des données');
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(header).toHaveScreenshot('i18n3-profile-header-fr.png');
  });
});
