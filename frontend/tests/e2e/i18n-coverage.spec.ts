import { test, expect, Page } from '@playwright/test';

/**
 * I18N-2 — Full English + French translation coverage of the interface.
 *
 * Builds on I18N-1 (i18next + en/fr `translation` bundles + Profile language
 * switcher + per-user language from GET/PATCH /api/me). I18N-1 only wired the
 * primary nav tabs + the Profile page. I18N-2 widens coverage to the BODY of
 * all six pages + the shared shell, sourcing every user-facing string from the
 * en/fr bundles.
 *
 * This spec encodes the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. With the profile mocked to language:"fr", visiting EACH of the six tabs
 *      renders a representative, known string on that tab in FRENCH (not the
 *      English literal). RED on current code: the tab bodies are still hardcoded
 *      English (only nav + profile are translated by I18N-1).
 *   2. Switching back to English restores the English literal on each tab.
 *   3. No raw translation KEY (a `foo.bar`-style token) leaks into the rendered
 *      UI on any tab — every referenced key resolves to real text. Guards against
 *      half-wired t() calls.
 *   4. Visual baselines of two representative tabs (Home + Reports) in French at
 *      all three viewports (mobile/tablet/desktop via playwright.config.ts). A
 *      human approves them and confirms no French-length overflow.
 *
 * NETWORK-MOCKED end to end (same harness as i18n-switch / a11y / ux specs):
 * Vite serves the real SPA; every /api/ call is intercepted with page.route(),
 * so no FastAPI backend is needed.
 *
 * --- INTERFACE CONTRACT the implementer must satisfy (selectors + the exact
 *     EN→FR string pairs this spec asserts; the en/fr bundles MUST agree) ---
 *
 *   Navigation (language-independent): each primary stage is reached by its
 *   stable `data-tab` id on `.tabs-bar` (NOT its label, which is localized), then
 *   the sub-tab by its visible sub label on `.subtabs-bar .subtab`.
 *
 *   The six tabs + the ONE representative string per tab that I18N-2 must wire
 *   and translate (the test asserts the FR form renders and the EN literal is
 *   gone). The implementer adds these keys to BOTH bundles with EXACTLY these
 *   values so the runtime render matches:
 *
 *   | Tab (data-tab / sub label)        | EN literal (today, hardcoded)                              | Expected FR (implementer wires)                              |
 *   |-----------------------------------|------------------------------------------------------------|--------------------------------------------------------------|
 *   | Home  (home, primary)             | "Five stages from raw submissions to a finished report."   | "Cinq étapes, des soumissions brutes au rapport final."      |
 *   | Sources/Extract (extract → Connection) | "Connect your data"                                   | "Connectez votre source de données"                          |
 *   | Questions (transform → Questions) | "Rename what shows up"                                     | "Renommez ce qui apparaît"                                   |
 *   | Composition/Analyze (analyze → Charts & indicators) | "Shape your"                            | "Façonnez votre"                                             |
 *   | Reports (present → Reports)       | "Build a report"                                          | "Générer un rapport"                                         |
 *   | Templates (present → Templates)   | "Word templates." (PageHeader title "Word" + accent "templates.") | "Modèles Word" (title) + accent (e.g. "Word.")      |
 *
 *   These EN literals live in: Home.jsx (.home-head__sub), Sources.jsx (PageHeader
 *   title for the setup/Connection section), Questions.jsx (PageHeader title),
 *   Composition.jsx (PageHeader title, non-views/Analyze variant), Reports.jsx
 *   (.form-section-title "Build a report"), Templates.jsx (PageHeader title).
 */

// data-tab id + sub label to reach each tab, plus the EN/FR representative string.
// `sub` is null for the Home primary tab (no sub strip). Sub labels are the
// English literals rendered in `.subtabs-bar` today; I18N-2 may also localize the
// sub strip, but navigation here clicks by hasText on the EN label which remains
// present at least as a fallback — kept stable by the implementer.
type Tab = { id: string; sub: string | null; en: RegExp; fr: RegExp; name: string };

// NB: PageHeader renders `{title} <em>{accent}</em>` and the eyebrow runs
// directly into the title with no separating space in innerText, so the EN/FR
// patterns are distinctive phrase SUBSTRINGS (no leading `\b` anchor — a
// preceding word would defeat it). The phrases are deliberately specific so a
// stray occurrence elsewhere on the page can't satisfy them.
const TABS: Tab[] = [
  { name: 'Home',      id: 'home',      sub: null,                  en: /Five stages from raw submissions to a finished report\./i, fr: /Cinq étapes, des soumissions brutes au rapport final\./i },
  { name: 'Sources',   id: 'extract',   sub: 'Connection',          en: /Connect your data/i,                                       fr: /Connectez votre source de données/i },
  { name: 'Questions', id: 'transform', sub: 'Questions',           en: /Rename what shows up/i,                                    fr: /Renommez ce qui apparaît/i },
  { name: 'Analyze',   id: 'analyze',   sub: 'Charts & indicators', en: /Shape your/i,                                             fr: /Façonnez votre/i },
  { name: 'Reports',   id: 'present',   sub: 'Reports',             en: /Build a report/i,                                          fr: /Générer un rapport/i },
  { name: 'Templates', id: 'present',   sub: 'Templates',           en: /Word\s*templates\./i,                                      fr: /Modèles Word/i },
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

/**
 * Stub the bootstrap network. `language` controls what GET /api/me reports, so
 * the app applies it on load (I18N-1). The catch-all is registered FIRST because
 * Playwright matches routes in REVERSE registration order.
 */
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

// Navigate to a tab by its stable `data-tab` id (language-independent), then its
// sub-tab by visible label. Returns the visible page region for that tab.
async function openTab(page: Page, tab: Tab) {
  await page.locator(`.tabs-bar [data-tab="${tab.id}"]`).click();
  if (tab.sub) {
    await page.locator('.subtabs-bar .subtab', { hasText: tab.sub }).click();
  }
  // The visible pane is the only .tab-content with display:flex.
  const pane = page.locator('.tab-content:visible').first();
  await expect(pane).toBeVisible();
  return pane;
}

// Detect a RAW, unresolved translation key leaking into the rendered UI — the
// literal key string i18next echoes when a t('foo.bar') references a key absent
// from the active bundle (e.g. "home.subtitle", "nav.deliver"). A leaked key is
// a dotted token of [a-z0-9_] segments.
//
// This is a deliberately LIGHT runtime smoke check (AC3): the authoritative,
// exhaustive key-parity / no-empty / no-hardcoded-literal gate is the separate
// `check:i18n` script (frontend/scripts/check-i18n.mjs — the implementer's job),
// NOT this spec. So we exclude the dotted tokens the UI legitimately shows as
// machine-truth literals — domains/URLs (kf.kobotoolbox.org, ona.io), filenames
// (config.yml, report.docx), code/env tokens (env:KOBO_TOKEN), and config.yml
// paths (export.database) — to avoid false positives, while still catching a
// real leaked i18n key.
// Each segment ≥2 chars so prose abbreviations like "e.g" / "i.e" are not keys
// (real i18next key segments are meaningful identifiers, never single letters).
const KEYISH = /[a-z0-9_]{2,}(?:\.[a-z0-9_]{2,})+/g;
// Last-segment tokens that mark a domain TLD or filename extension (not a key).
const TLD_OR_EXT = new Set([
  'org', 'io', 'com', 'net', 'gov', 'edu', 'v2',
  'yml', 'yaml', 'json', 'js', 'jsx', 'ts', 'tsx', 'csv', 'docx', 'xlsx',
  'png', 'jpg', 'md', 'html', 'py', 'sh', 'env',
]);
// First-segment tokens that mark a config.yml path the UI shows on purpose.
const CONFIG_ROOTS = new Set([
  'api', 'form', 'export', 'report', 'pii', 'questions', 'filters', 'views',
  'charts', 'indicators', 'summaries', 'periods', 'framework', 'ai',
]);

function leakedKeys(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  KEYISH.lastIndex = 0;
  while ((m = KEYISH.exec(text))) {
    const tok = m[0];
    const i = m.index;
    const before = i > 0 ? text[i - 1] : ' ';
    const after = text[i + tok.length] || ' ';
    if (before === ':' || before === '/' || before === '.') continue; // code/env/url/path
    if (after === '/' || after === ':') continue;                       // url path / code
    const segs = tok.split('.');
    if (TLD_OR_EXT.has(segs[segs.length - 1])) continue;                // domain / filename
    if (CONFIG_ROOTS.has(segs[0])) continue;                            // config.yml path
    out.push(tok);
  }
  return out;
}

test.describe('I18N-2 — French coverage across all six tabs', () => {
  // AC 1: profile mocked to fr → each tab renders its representative string in
  // French (not the English literal). RED today: tab bodies are hardcoded EN.
  for (const tab of TABS) {
    test(`${tab.name} renders its representative string in French`, async ({ page }) => {
      await stubBootstrap(page, 'fr');
      await gotoApp(page);
      const pane = await openTab(page, tab);
      await expect(
        pane,
        `${tab.name}: the representative string must render in French (bundle value), not the English literal`,
      ).toContainText(tab.fr);
      await expect(
        pane,
        `${tab.name}: the English literal must NOT render when the language is French`,
      ).not.toContainText(tab.en);
    });
  }
});

test.describe('I18N-2 — switching back to English restores each tab', () => {
  // AC 2: with the profile mocked to en, each tab renders its English literal
  // (the round-trip — French translated, English restored).
  for (const tab of TABS) {
    test(`${tab.name} renders its representative string in English`, async ({ page }) => {
      await stubBootstrap(page, 'en');
      await gotoApp(page);
      const pane = await openTab(page, tab);
      await expect(
        pane,
        `${tab.name}: the representative string must render in English when language is English`,
      ).toContainText(tab.en);
      await expect(
        pane,
        `${tab.name}: the French translation must NOT render when the language is English`,
      ).not.toContainText(tab.fr);
    });
  }
});

test.describe('I18N-2 — no raw translation key leaks into the rendered UI', () => {
  // AC 3: every referenced key resolves to real text — no `foo.bar` token shows
  // on any tab, in either language. A half-wired t('home.subtitle') that is
  // missing from the bundle would render the bare key and fail this guard.
  for (const language of ['fr', 'en'] as const) {
    for (const tab of TABS) {
      test(`${tab.name} shows no raw key token (${language})`, async ({ page }) => {
        await stubBootstrap(page, language);
        await gotoApp(page);
        const pane = await openTab(page, tab);
        const text = (await pane.innerText()).trim();
        const leaks = leakedKeys(text);
        expect(
          leaks,
          leaks.length
            ? `${tab.name} (${language}): raw translation key(s) leaked into the UI: ${JSON.stringify(leaks)}`
            : undefined,
        ).toEqual([]);
      });
    }
  }
});

test.describe('I18N-2 — visual baselines in French (Home + Reports)', () => {
  // AC 4: capture Home + Reports in French at all three viewports (one baseline
  // per viewport via playwright.config.ts projects). Hide the bottom terminal so
  // its clock/log noise never destabilizes the diff. Gate on the wired FR string
  // first so the baseline is never vacuous (e.g. an untranslated EN page).
  const visualTabs = TABS.filter((t) => t.name === 'Home' || t.name === 'Reports');
  for (const tab of visualTabs) {
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
