import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PLANG-2 — Create-only language field + read-only language in AI config (UI).
 *
 * Visual half of `frontend/tests/e2e/project-language.spec.ts` (VIS-11 split):
 * the functional/AC assertions stay there; this file carries ONLY the
 * extracted visual baselines — verbatim bodies + the minimal shared setup they
 * need — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * AC 6: visual baselines (one per viewport) of the edit-mode read-only
 * language field and the AI-config read-only language; a human approves them.
 */

const PROJECT_LANGUAGE = 'French';

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
  language: PROJECT_LANGUAGE,
};

const CONFIG_YML = [
  'api:',
  '  url: https://kf.kobotoolbox.org/api/v2',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  'ai:',
  '  provider: openai',
  '  language: French',
  '',
].join('\n');

async function stubBootstrap(page: Page, interfaceLanguage: 'en' | 'fr' = 'en') {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = (r.request().postDataJSON() || {}) as { language?: string };
      return r.fulfill({
        json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language: body.language ?? interfaceLanguage },
      });
    }
    return r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language: interfaceLanguage } });
  });
  await page.route('**/api/projects', (r) => {
    if (r.request().method() === 'POST') {
      return r.fulfill({ json: { id: 'proj-new', name: 'Brand New Project', slug: 'new', role: 'admin', is_archived: false, language: 'French' } });
    }
    return r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } });
  });
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

async function openProjectMenu(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
}

async function openEditForm(page: Page) {
  await openProjectMenu(page);
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form')).toBeVisible();
}

async function openAiConfig(page: Page) {
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /AI/i }).click();
  await expect(page.locator('.tab-content:visible').first()).toBeVisible();
}

const formLanguageControl = (page: Page): Locator =>
  page.locator('.project-form .profile-field select, .project-form [data-testid="project-language"]');

test.describe('PLANG-2 — visual baseline of the read-only language in the edit form', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  test('visual baseline — edit-form read-only language field', async ({ page }) => {
    await openEditForm(page);
    const control = formLanguageControl(page).first();
    await expect(control).toBeVisible();
    await expect(page.locator('.project-form')).toContainText(PROJECT_LANGUAGE);
    await expect(page.locator('.project-form')).toContainText(/at creation|cannot be changed|set when|fixed|once created/i);
    const editable = await control.evaluate((el) => {
      const disabled = (el as HTMLSelectElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
      const readonly = el.getAttribute('readonly') !== null || el.getAttribute('aria-readonly') === 'true';
      const isSelect = el.tagName.toLowerCase() === 'select';
      return isSelect && !disabled && !readonly;
    });
    expect(editable, 'baseline must capture the read-only language field').toBe(false);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(page.locator('.project-form')).toHaveScreenshot('plang2-edit-language-readonly.png');
  });
});

test.describe('PLANG-2 — visual baseline of the read-only language in AI config', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  test('visual baseline — AI-config read-only language', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(pane).toContainText(PROJECT_LANGUAGE);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(pane).toHaveScreenshot('plang2-aiconfig-language-readonly.png');
  });
});
