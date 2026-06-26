import { test, expect, Page } from '@playwright/test';

/**
 * PUX-8 — Primary navigation labels adopt the PUX-1 plain-language stage names.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation. This
 * is a COPY/LABEL-ONLY card: stage ids, `data-tab` ids and navigation targets are
 * unchanged — only the visible nav label TEXT changes, to match the plain-language
 * Home stage cards reworded in PUX-1:
 *
 *   - nav tab `transform`  must read the SAME as Home card `home.stages.transform`
 *       EN "Clean & check"  / FR "Nettoyer et vérifier"
 *       (no "Transform" / "Transformer" jargon remains as the visible nav label)
 *   - nav tab `model`      must read the SAME as Home card `home.stages.model`
 *       EN "Combine data"   / FR "Combiner les données"
 *       (no "Model" / "Modéliser" remains)
 *   - the other primary tabs (Home, Extract, Analyze, Deliver) are unchanged
 *   - no behaviour change: clicking each renamed tab lands on the same stage it
 *     always did (same data-tab id active + same sub-tab strip)
 *
 * NETWORK-MOCKED end to end (same harness as i18n-subtabs / the pux specs): Vite
 * serves the real SPA; every /api/ call is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * ROBUSTNESS (avoids a prior flaky authoring race): on load the app calls
 * /api/me then setLanguage() to the saved language, which RE-RENDERS the nav
 * asynchronously. Every assertion here uses an AUTO-RETRYING Playwright locator
 * assertion — expect(locator).toHaveText / .toContainText / .not.toContainText —
 * never a one-shot innerText() compared with a non-retrying expect(string).toBe.
 * That is the same robust pattern as the green i18n-subtabs.spec.ts.
 *
 * SELECTORS (interface, not behaviour under test):
 *   - Primary nav tabs: `.tabs-bar .tab[data-tab="<stageId>"]`; active: `.tab.active`.
 *   - Sub-tab strip:    `.subtabs-bar` with `.subtab` buttons (multi-sub stages).
 * These structural hooks are unchanged by a copy-only relabel.
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
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

// A primary stage tab, addressed by its stable, language-independent data-tab id.
const navTab = (page: Page, id: string) => page.locator(`.tabs-bar .tab[data-tab="${id}"]`);

// Plain-language stage names PUX-8 brings into the nav (verbatim from
// home.stages.<id>.label in src/locales/{en,fr}.json), the OLD jargon that must
// no longer appear, and the UNCHANGED tabs, per language.
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

  test.describe(`PUX-8 — primary nav labels (language=${lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await stubBootstrap(page, lang);
      await gotoApp(page);
    });

    // AC: the transform tab reads the plain-language Home stage name; no jargon.
    test('the "transform" primary tab reads the plain-language stage name (no jargon)', async ({ page }) => {
      const t = navTab(page, 'transform');
      await expect(
        t,
        `transform nav tab must read the plain-language stage name "${L.transform.plain}"`,
      ).toHaveText(L.transform.plain);
      await expect(
        t,
        `transform nav tab must not keep the "${L.transform.jargon}" jargon label`,
      ).not.toContainText(L.transform.jargon);
    });

    // AC: the model tab reads the plain-language Home stage name; no jargon.
    test('the "model" primary tab reads the plain-language stage name (no jargon)', async ({ page }) => {
      const t = navTab(page, 'model');
      await expect(
        t,
        `model nav tab must read the plain-language stage name "${L.model.plain}"`,
      ).toHaveText(L.model.plain);
      await expect(
        t,
        `model nav tab must not keep the "${L.model.jargon}" jargon label`,
      ).not.toContainText(L.model.jargon);
    });

    // AC: the remaining primary tabs (Home, Extract, Analyze, Deliver) are unchanged.
    test('the remaining primary tabs (Home, Extract, Analyze, Deliver) are unchanged', async ({ page }) => {
      for (const [id, expected] of Object.entries(L.unchanged)) {
        await expect(navTab(page, id), `the "${id}" primary tab must be unchanged`).toHaveText(expected);
      }
    });

    // AC: no behaviour change — every stage data-tab id is still present.
    test('stage data-tab ids are unchanged (home, extract, transform, model, analyze, present)', async ({ page }) => {
      for (const id of ['home', 'extract', 'transform', 'model', 'analyze', 'present']) {
        await expect(navTab(page, id), `primary tab with data-tab="${id}" must still exist`).toHaveCount(1);
      }
    });

    // AC: no behaviour change — clicking the renamed transform tab lands on the
    // SAME stage (its data-tab becomes active + its sub-tab strip appears with the
    // unchanged Questions/Profile/Validate subs).
    test('clicking the renamed "transform" tab lands on the unchanged transform stage', async ({ page }) => {
      const t = navTab(page, 'transform');
      await t.click();
      await expect(t, 'the transform tab becomes the active primary tab').toHaveClass(/active/);
      const bar = page.locator('.subtabs-bar');
      await expect(bar, 'the transform stage sub-tab strip appears (route unchanged)').toBeVisible();
      await expect(bar.locator('.subtab')).toHaveCount(3);
    });

    // AC: no behaviour change — clicking the renamed model tab lands on the SAME
    // stage (its data-tab becomes active).
    test('clicking the renamed "model" tab lands on the unchanged model stage', async ({ page }) => {
      const t = navTab(page, 'model');
      await t.click();
      await expect(t, 'the model tab becomes the active primary tab').toHaveClass(/active/);
    });

    // AC visual: baseline of the primary nav (one assertion → one baseline per
    // viewport). Gate on the relabel first via auto-retrying assertions so the
    // baseline is never captured vacuously from the pre-fix jargon copy.
    test('visual baseline of the primary nav', async ({ page }) => {
      await expect(navTab(page, 'transform')).toHaveText(L.transform.plain);
      await expect(navTab(page, 'model')).toHaveText(L.model.plain);
      await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
      await expect(page.locator('.tabs-bar')).toHaveScreenshot(`pux8-primary-nav-${lang}.png`);
    });
  });
}
