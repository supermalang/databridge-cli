import { test, expect, Page } from '@playwright/test';

/**
 * PUX-8 — Primary navigation labels adopt the PUX-1 plain-language stage names.
 *
 * Visual half of `frontend/tests/e2e/nav-labels.spec.ts` (VIS-11 split): the
 * functional/AC assertions stay there; this file carries ONLY the extracted
 * visual baseline — verbatim body + the minimal shared setup it needs — run
 * under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * Visual baseline of the primary nav (one per language × viewport); a human
 * approves them.
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
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

const navTab = (page: Page, id: string) => page.locator(`.tabs-bar .tab[data-tab="${id}"]`);

const LABELS = {
  en: {
    transform: { plain: 'Clean & check', jargon: 'Transform' },
    model: { plain: 'Combine data', jargon: 'Model' },
    unchanged: { home: 'Home', extract: 'Extract', analyze: 'Analyze', present: 'Deliver' },
  },
  fr: {
    transform: { plain: 'Nettoyer et vérifier', jargon: 'Transformer' },
    model: { plain: 'Combiner les données', jargon: 'Modéliser' },
    unchanged: { home: 'Accueil', extract: 'Extraire', analyze: 'Analyser', present: 'Diffuser' },
  },
} as const;

for (const lang of ['en', 'fr'] as const) {
  const L = LABELS[lang];

  test.describe(`PUX-8 — visual baseline of the primary nav (language=${lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await stubBootstrap(page, lang);
      await gotoApp(page);
    });

    test('visual baseline of the primary nav', async ({ page }) => {
      await expect(navTab(page, 'transform')).toHaveText(L.transform.plain);
      await expect(navTab(page, 'model')).toHaveText(L.model.plain);
      await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
      await expect(page.locator('.tabs-bar')).toHaveScreenshot(`pux8-primary-nav-${lang}.png`);
    });
  });
}
