import { test, expect, Page } from '@playwright/test';

/**
 * I18N-2 — Full English + French translation coverage of the interface.
 *
 * Visual half of `frontend/tests/e2e/i18n-coverage.spec.ts` (VIS-11 split): the
 * functional/AC assertions stay there; this file carries ONLY the extracted
 * visual baseline(s) — verbatim bodies, run under the dedicated Tier 1 visual
 * config (`visual-review/playwright.visual.config.ts`).
 *
 * AC 4: visual baselines of two representative tabs (Home + Reports) in French
 * at all three viewports (mobile/tablet/desktop). A human approves them and
 * confirms no French-length overflow.
 */

type Tab = { id: string; sub: string | null; en: RegExp; fr: RegExp; name: string };

const TABS: Tab[] = [
  { name: 'Home',    id: 'home',    sub: null, en: /Five stages from raw submissions to a finished report\./i, fr: /Cinq étapes, des soumissions brutes au rapport final\./i },
  { name: 'Reports', id: 'present', sub: 'Reports', en: /Build a report/i, fr: /Générer un rapport/i },
];

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
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

async function openTab(page: Page, tab: Tab) {
  await page.locator(`.tabs-bar [data-tab="${tab.id}"]`).click();
  if (tab.sub) {
    await page.locator('.subtabs-bar .subtab', { hasText: tab.sub }).click();
  }
  const pane = page.locator('.tab-content:visible').first();
  await expect(pane).toBeVisible();
  return pane;
}

test.describe('I18N-2 — visual baselines in French (Home + Reports)', () => {
  for (const tab of TABS) {
    test(`visual baseline — ${tab.name} in French`, async ({ page }) => {
      await stubBootstrap(page, 'fr');
      await gotoApp(page);
      const pane = await openTab(page, tab);
      await expect(pane).toContainText(tab.fr);
      await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
      await expect(pane).toHaveScreenshot(`i18n2-${tab.name.toLowerCase()}-fr.png`);
    });
  }
});
