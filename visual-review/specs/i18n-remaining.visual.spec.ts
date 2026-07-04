import { test, expect, Page } from '@playwright/test';

/**
 * I18N-3 — Externalize the remaining untranslated surfaces (Profile / Ask /
 * Validate / ProjectForm / ProjectMembersPanel) to the en/fr bundles.
 *
 * Visual half of `frontend/tests/e2e/i18n-remaining.spec.ts` (VIS-11 split):
 * the functional/AC assertions stay there; this file carries ONLY the
 * extracted visual baseline — verbatim body, run under the dedicated Tier 1
 * visual config (`visual-review/playwright.visual.config.ts`).
 *
 * AC 3: visual baseline of the FRENCH Profile header at all three viewports
 * (mobile/tablet/desktop); a human approves (checking no FR overflow).
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

async function openSub(page: Page, stageId: string, subIndex: number) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
  const bar = page.locator('.subtabs-bar');
  await expect(bar).toBeVisible();
  await bar.locator('.subtab').nth(subIndex).click();
  return page.locator('.tab-content:visible');
}

test.describe('I18N-3 — visual baseline of the French Profile header', () => {
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
