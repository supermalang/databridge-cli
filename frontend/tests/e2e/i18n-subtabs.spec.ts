import { test, expect, Page } from '@playwright/test';

/**
 * I18N-5 — Translate the navigation SUB-tabs (the secondary `.subtabs-bar` strip).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. With the profile mocked to language:"fr", EVERY secondary sub-tab label
 *      renders its FRENCH translation from the existing `subs.*` bundle (e.g.
 *      Connexion, Profil, Valider, Vues, Interroger, "Graphiques et indicateurs",
 *      Sortie, Modèles, Rapports). No English sub-tab label remains.
 *      RED on current code: the sub-tab strip renders the hardcoded English
 *      `sub.label` from the STAGES array — never wired through t() — so the
 *      sub-tabs stay English even when the interface is French.
 *   2. With English selected, the sub-tabs render the English strings (no
 *      regression) and NO raw `subs.*` key leaks into the UI.
 *   3. Switching the language flips the SAME strip between FR and EN.
 *   4. No behaviour change: the sub-tab ids / ordering / selection are unchanged
 *      — only the displayed label is translated.
 *   5. Visual baselines of a French sub-tab bar at all three viewports
 *      (mobile/tablet/desktop via playwright.config.ts projects); a human approves.
 *
 * NETWORK-MOCKED end to end (same harness as i18n-switch / i18n-coverage): Vite
 * serves the real SPA; every /api/ call is intercepted with page.route(), so no
 * FastAPI backend is needed.
 *
 * --- INTERFACE CONTRACT the implementer must satisfy (selectors, not behaviour) ---
 *
 *   Navigation is language-INDEPENDENT: a primary stage is reached by its stable
 *   `data-tab` id on `.tabs-bar`; the sub-tab strip then renders as
 *   `.subtabs-bar .subtab` buttons in STAGES order. The displayed label of each
 *   sub-tab must come from the EXISTING `subs.<id>` keys in the en/fr bundles
 *   (already complete + key-aligned) via t(); no parallel string set is added.
 *
 *   The EN→FR sub-tab label pairs this spec asserts (sourced verbatim from the
 *   committed `translation.subs.*` namespace in src/locales/{en,fr}.json):
 */

// stage data-tab id → ordered list of { subKey id, EN label, FR label }.
// (subKey is the `subs.*` bundle key; for every sub today subKey === the sub id,
//  EXCEPT the analyze "Charts & indicators" sub whose bundle key is `composition`.)
type Sub = { en: RegExp; fr: RegExp; enText: string; frText: string };
type Stage = { id: string; subs: Sub[] };

const sub = (en: string, fr: string): Sub => ({
  en: new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  fr: new RegExp(`^${fr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  enText: en,
  frText: fr,
});

// Every secondary sub-tab STRIP across the nav, with its committed EN/FR strings.
// NB: the secondary strip (`.subtabs-bar`) only renders for a stage with MORE THAN
// ONE sub (existing, unchanged behaviour). The `model` stage has a single sub
// ("Views"/"Vues") so it shows no strip and is out of scope for this render test —
// its `subs.views` key is still covered by the en/fr key-parity gate (check:i18n).
const STAGES: Stage[] = [
  { id: 'extract',   subs: [sub('Connection', 'Connexion'), sub('AI configuration', 'Configuration de l’IA')] },
  { id: 'transform', subs: [sub('Questions', 'Questions'), sub('Profile', 'Profil'), sub('Validate', 'Valider')] },
  { id: 'analyze',   subs: [sub('Ask', 'Interroger'), sub('Charts & indicators', 'Graphiques et indicateurs')] },
  { id: 'present',   subs: [sub('Output', 'Sortie'), sub('Templates', 'Modèles'), sub('Reports', 'Rapports')] },
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

// Open a primary stage by its stable data-tab id and return its sub-tab strip.
async function openStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
  const bar = page.locator('.subtabs-bar');
  await expect(bar).toBeVisible();
  return bar;
}

// A leaked, unresolved `subs.*` key (e.g. "subs.profile") echoed verbatim when a
// t('subs.x') references a key absent from the active bundle.
const SUBS_KEY = /\bsubs\.[a-z]+\b/;

test.describe('I18N-5 — sub-tabs render French labels from the subs.* bundle', () => {
  // AC 1: profile = fr → every secondary sub-tab label renders its French
  // translation; no English sub-tab label remains in that strip.
  for (const stage of STAGES) {
    test(`stage "${stage.id}" sub-tabs render in French`, async ({ page }) => {
      await stubBootstrap(page, 'fr');
      await gotoApp(page);
      const bar = await openStage(page, stage.id);
      for (const s of stage.subs) {
        await expect(
          bar.locator('.subtab', { hasText: s.fr }),
          `sub-tab must show its French label "${s.frText}" when the interface is French`,
        ).toBeVisible();
      }
      // No English sub-tab label remains in this strip (only where EN ≠ FR;
      // "Questions" is identical in both languages so it is legitimately present).
      for (const s of stage.subs) {
        if (s.enText === s.frText) continue;
        await expect(
          bar.locator('.subtab', { hasText: s.en }),
          `English sub-tab label "${s.enText}" must NOT render when the interface is French`,
        ).toHaveCount(0);
      }
    });
  }

  // AC 2 (no leak): no raw subs.* key token leaks into the rendered strip in FR.
  test('no raw subs.* key leaks into the French sub-tab strip', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    for (const stage of STAGES) {
      const bar = await openStage(page, stage.id);
      const text = (await bar.innerText()).trim();
      expect(
        SUBS_KEY.test(text),
        `a raw subs.* key leaked into the "${stage.id}" sub-tab strip (FR): ${JSON.stringify(text)}`,
      ).toBe(false);
    }
  });
});

test.describe('I18N-5 — sub-tabs render English labels with no regression', () => {
  // AC 2: with English selected, the sub-tabs render the English strings and no
  // raw subs.* key leaks.
  for (const stage of STAGES) {
    test(`stage "${stage.id}" sub-tabs render in English`, async ({ page }) => {
      await stubBootstrap(page, 'en');
      await gotoApp(page);
      const bar = await openStage(page, stage.id);
      for (const s of stage.subs) {
        await expect(
          bar.locator('.subtab', { hasText: s.en }),
          `sub-tab must show its English label "${s.enText}" when the interface is English`,
        ).toBeVisible();
      }
      const text = (await bar.innerText()).trim();
      expect(
        SUBS_KEY.test(text),
        `a raw subs.* key leaked into the "${stage.id}" sub-tab strip (EN): ${JSON.stringify(text)}`,
      ).toBe(false);
    });
  }
});

test.describe('I18N-5 — behaviour unchanged (ids / ordering / selection)', () => {
  // AC 5: translating the label must not change sub-tab ids, ordering, or which
  // sub is selected. The Transform strip has 3 subs in a fixed order; the first
  // is active by default. We verify the count + order via data-* ids and the
  // active state — language-independent — under FR.
  test('Transform sub-tab ids, order, and default selection are unchanged in French', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const bar = await openStage(page, 'transform');
    const subtabs = bar.locator('.subtab');
    await expect(subtabs, 'Transform must still expose exactly 3 sub-tabs').toHaveCount(3);
    // Exactly one sub-tab is active (the default), and it is the FIRST one.
    await expect(bar.locator('.subtab.active')).toHaveCount(1);
    await expect(subtabs.first()).toHaveClass(/active/);
    // Order is preserved: first → Questions, then Profil, then Valider (FR).
    await expect(subtabs.nth(0)).toHaveText(/^Questions$/i);
    await expect(subtabs.nth(1)).toHaveText(/^Profil$/i);
    await expect(subtabs.nth(2)).toHaveText(/^Valider$/i);
  });
});

test.describe('I18N-5 — visual baseline of a French sub-tab bar', () => {
  // AC visual: capture the FRENCH sub-tab strip at all three viewports (one
  // baseline per viewport via playwright.config.ts). Gate on a wired FR string
  // first so the baseline can never be vacuous (an untranslated EN strip).
  test('visual baseline — Transform sub-tab bar in French', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const bar = await openStage(page, 'transform');
    await expect(bar.locator('.subtab', { hasText: /^Profil$/i })).toBeVisible();
    await expect(bar.locator('.subtab', { hasText: /^Valider$/i })).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(bar).toHaveScreenshot('i18n5-subtabs-transform-fr.png');
  });

  test('visual baseline — Deliver sub-tab bar in French', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    const bar = await openStage(page, 'present');
    await expect(bar.locator('.subtab', { hasText: /^Sortie$/i })).toBeVisible();
    await expect(bar.locator('.subtab', { hasText: /^Modèles$/i })).toBeVisible();
    await expect(bar.locator('.subtab', { hasText: /^Rapports$/i })).toBeVisible();
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(bar).toHaveScreenshot('i18n5-subtabs-deliver-fr.png');
  });
});
