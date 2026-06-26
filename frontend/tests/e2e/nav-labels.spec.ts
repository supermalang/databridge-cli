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
 *   - the nav labels match the Home card labels in BOTH languages (single source
 *     of truth preferred)
 *   - no behaviour change: clicking each renamed tab lands on the same stage it
 *     always did (same data-tab id active + same first sub-tab)
 *
 * NETWORK-MOCKED end to end (same harness as the pux/i18n specs): Vite serves the
 * real SPA; every /api/ call is intercepted with page.route(), so no FastAPI
 * backend is required.
 *
 * SELECTORS (interface, not behaviour under test):
 *   - Home stage cards: `.home-card` (container `.home-cards`); order matches
 *     STAGES so card nth(1) = transform stage, nth(2) = model stage.
 *   - Primary nav tabs: `.tabs-bar [data-tab="<stageId>"]`; active: `.tab.active`.
 *   - Sub-tabs: `.subtabs-bar .subtab`; each is `#tab-sub-<subId>` (A11Y-2 tabId).
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

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

// The plain-language stage names PUX-1 shipped on the Home cards, per language.
const STAGE_LABELS = {
  en: { transform: 'Clean & check', model: 'Combine data' },
  fr: { transform: 'Nettoyer et vérifier', model: 'Combiner les données' },
};

// Jargon the card says must NOT remain as the visible nav label, per language.
const FORBIDDEN = {
  en: { transform: /^transform$/i, model: /^model$/i },
  fr: { transform: /^transformer$/i, model: /^modéliser$/i },
};

async function stubBootstrap(page: Page, language: 'en' | 'fr') {
  // Catch-all FIRST (Playwright matches routes in REVERSE registration order).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', name: 'Dev User', language } }));
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
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

const navTab = (page: Page, id: string) => page.locator(`.tabs-bar [data-tab="${id}"]`);

// The visible label of a primary tab, trimmed.
async function navLabel(page: Page, id: string): Promise<string> {
  return ((await navTab(page, id).innerText()) || '').trim();
}

for (const lang of ['en', 'fr'] as const) {
  test.describe(`PUX-8 — primary nav labels (language=${lang})`, () => {
    test.beforeEach(async ({ page }) => {
      await stubBootstrap(page, lang);
      await gotoApp(page);
    });

    // AC: the transform tab reads the plain-language Home stage name; no jargon.
    test('the "transform" primary tab reads the plain-language stage name (no jargon)', async ({ page }) => {
      const label = await navLabel(page, 'transform');
      expect(label.length, 'the transform nav tab must render visible text').toBeGreaterThan(0);
      expect(
        label,
        `transform nav tab must not keep the jargon label; got ${JSON.stringify(label)}`,
      ).not.toMatch(FORBIDDEN[lang].transform);
      expect(
        label,
        `transform nav tab must read the plain-language stage name "${STAGE_LABELS[lang].transform}"; got ${JSON.stringify(label)}`,
      ).toBe(STAGE_LABELS[lang].transform);
    });

    // AC: the model tab reads the plain-language Home stage name; no jargon.
    test('the "model" primary tab reads the plain-language stage name (no jargon)', async ({ page }) => {
      const label = await navLabel(page, 'model');
      expect(label.length, 'the model nav tab must render visible text').toBeGreaterThan(0);
      expect(
        label,
        `model nav tab must not keep the jargon label; got ${JSON.stringify(label)}`,
      ).not.toMatch(FORBIDDEN[lang].model);
      expect(
        label,
        `model nav tab must read the plain-language stage name "${STAGE_LABELS[lang].model}"; got ${JSON.stringify(label)}`,
      ).toBe(STAGE_LABELS[lang].model);
    });

    // AC: the nav labels MATCH their corresponding Home stage-card labels (single
    // source of truth) — assert the nav text equals the live Home card heading.
    test('the renamed nav tabs match their Home stage-card labels', async ({ page }) => {
      const cards = page.locator('.home-card');
      await expect(cards.first()).toBeVisible();
      // Home card order matches STAGES: nth(1) = transform stage, nth(2) = model.
      const cardHeading = async (n: number) => {
        const text = ((await cards.nth(n).innerText()) || '').trim();
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        return lines.find((l) => !/^\d+$/.test(l)) || '';
      };
      const transformCard = await cardHeading(1);
      const modelCard = await cardHeading(2);

      expect(await navLabel(page, 'transform'), 'transform nav label must equal its Home card heading')
        .toBe(transformCard);
      expect(await navLabel(page, 'model'), 'model nav label must equal its Home card heading')
        .toBe(modelCard);
    });

    // AC: the remaining primary tabs are unchanged.
    test('the remaining primary tabs (Home, Extract, Analyze, Deliver) are unchanged', async ({ page }) => {
      const unchanged: Record<'en' | 'fr', Record<string, string>> = {
        en: { home: 'Home', extract: 'Extract', analyze: 'Analyze', present: 'Deliver' },
        fr: { home: 'Accueil', extract: 'Extraire', analyze: 'Analyser', present: 'Diffuser' },
      };
      for (const [id, expected] of Object.entries(unchanged[lang])) {
        expect(await navLabel(page, id), `the ${id} primary tab must be unchanged`).toBe(expected);
      }
    });

    // AC: no behaviour change — the data-tab ids are byte-for-byte unchanged.
    test('stage data-tab ids are unchanged (transform, model, present present)', async ({ page }) => {
      for (const id of ['home', 'extract', 'transform', 'model', 'analyze', 'present']) {
        await expect(navTab(page, id), `primary tab with data-tab="${id}" must still exist`).toHaveCount(1);
      }
    });

    // AC: no behaviour change — clicking the renamed transform tab lands on the
    // SAME stage (same data-tab active + same first sub-tab "questions").
    test('clicking the renamed "transform" tab lands on the unchanged transform stage', async ({ page }) => {
      await navTab(page, 'transform').click();
      await expect(page.locator('.tabs-bar .tab.active[data-tab="transform"]')).toBeVisible();
      // Same destination: the transform stage's panel renders, and its (unchanged)
      // multi-sub strip still leads with the "questions" sub-tab.
      await expect(
        page.locator('#panel-primary-transform'),
        'the transform stage panel must render after clicking its renamed tab',
      ).toBeVisible();
      await expect(
        page.locator('.subtabs-bar #tab-sub-questions'),
        'the transform stage must still open its "questions" sub-tab',
      ).toBeVisible();
    });

    // AC: no behaviour change — clicking the renamed model tab lands on the SAME
    // stage (same data-tab active + same first sub-tab "views").
    test('clicking the renamed "model" tab lands on the unchanged model stage', async ({ page }) => {
      await navTab(page, 'model').click();
      await expect(page.locator('.tabs-bar .tab.active[data-tab="model"]')).toBeVisible();
      // Same destination: the model stage's panel renders unchanged.
      await expect(
        page.locator('#panel-primary-model'),
        'the model stage panel must render after clicking its renamed tab',
      ).toBeVisible();
    });

    // AC visual: baseline of the primary nav (one assertion → one baseline per
    // viewport). Gate on the relabel so the baseline is not captured vacuously
    // from the pre-fix jargon copy.
    test('visual baseline of the primary nav', async ({ page }) => {
      const transformLabel = await navLabel(page, 'transform');
      const modelLabel = await navLabel(page, 'model');
      expect(transformLabel, 'nav must be relabeled before the baseline is captured')
        .toBe(STAGE_LABELS[lang].transform);
      expect(modelLabel, 'nav must be relabeled before the baseline is captured')
        .toBe(STAGE_LABELS[lang].model);
      await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
      await expect(page.locator('.tabs-bar')).toHaveScreenshot(`pux8-primary-nav-${lang}.png`);
    });
  });
}
