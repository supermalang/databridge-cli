import { test, expect, Page } from '@playwright/test';

/**
 * I18N-1 — i18n framework + language switcher + persisted profile preference.
 *
 * Visual half of `frontend/tests/e2e/i18n-switch.spec.ts` (VIS-11 split): the
 * functional/AC assertions stay there; this file carries ONLY the extracted
 * visual baseline(s) — verbatim bodies + the minimal shared setup they need —
 * run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * AC 5: visual baselines of the Profile page with the switcher in the EN and
 * FR states, one per viewport; a human approves them.
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

const PROFILE_TITLE_EN = /your profile/i;
const PROFILE_TITLE_FR = /votre profil/i;

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

async function openProfile(page: Page) {
  await page.locator('.user-avatar').click();
  await page.locator('.user-menu__item:not(.user-menu__danger)').click();
  await expect(page.locator('.project-form')).toBeVisible();
}

const switcher = (page: Page) => page.locator('[data-testid="language-switcher"]');

async function selectFrench(page: Page) {
  const control = switcher(page);
  const tag = await control.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await control.selectOption({ label: /fran[cç]ais/i } as any).catch(async () => {
      await control.selectOption('fr');
    });
  } else {
    await control.click();
    await page.getByRole('option', { name: /fran[cç]ais/i }).click();
  }
}

test.describe('I18N-1 — visual baselines of the language switcher', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  test('visual baseline — Profile page with the switcher in English', async ({ page }) => {
    await openProfile(page);
    await expect(switcher(page)).toBeVisible();
    await expect(page.locator('.project-form')).toContainText(PROFILE_TITLE_EN);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(page.locator('.project-form')).toHaveScreenshot('i18n1-profile-switcher-en.png');
  });

  test('visual baseline — Profile page with the switcher in French', async ({ page }) => {
    await openProfile(page);
    await selectFrench(page);
    await expect(page.locator('.project-form')).toContainText(PROFILE_TITLE_FR);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(page.locator('.project-form')).toHaveScreenshot('i18n1-profile-switcher-fr.png');
  });
});
