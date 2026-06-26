import { test, expect, Page } from '@playwright/test';

/**
 * I18N-1 — i18n framework + language switcher + persisted profile preference.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. With the profile preference = English (the default), a representative
 *      WIRED interface string renders in English — both a Profile-page label
 *      ("Your profile" / "First name" / "Save") AND a primary nav tab label
 *      (one of Home / Extract / Transform / Model / Analyze / Deliver).
 *   2. The Profile page exposes a language switcher offering exactly English +
 *      French (no third option). Choosing French switches those same strings to
 *      their French equivalents LIVE — no page navigation/reload — AND posts
 *      `language: "fr"` to the profile update endpoint (PATCH /api/me).
 *   3. Reloading the app with the profile mock now returning `language: "fr"`
 *      brings the interface up in French (the saved preference is re-applied on
 *      load).
 *   4. The switcher control is keyboard-operable and has an accessible name.
 *   5. Visual baselines of the Profile page with the switcher in the EN and FR
 *      states, one per viewport (mobile/tablet/desktop via playwright.config.ts);
 *      a human approves them.
 *
 * NETWORK-MOCKED end to end (same harness as the pux/a11y specs): Vite serves
 * the real SPA; every /api/ call is intercepted with page.route(), so no FastAPI
 * backend is needed.
 *
 * --- INTERFACE CONTRACT the implementer must satisfy (selectors, not behavior) ---
 *
 *   - The signed-in user's profile is read from `GET /api/me`, whose JSON now
 *     carries a `language` field ("en" | "fr"); the app applies it on load.
 *   - The language preference is written via `PATCH /api/me` with body
 *     `{ "language": "fr" | "en" }` (the existing profile-update endpoint).
 *   - The user menu avatar (`.user-avatar`) opens a dropdown with a "Profile"
 *     item that opens the full-screen profile page (`.project-form`).
 *   - On that profile page lives the language switcher, addressable by the
 *     test id `[data-testid="language-switcher"]`, with an accessible name and a
 *     visible focus ring; it offers exactly the two options English + French.
 *   - WIRED STRINGS (the initial translated set this card ships):
 *       · a Profile label — "Your profile" (EN) / "Votre profil" (FR)
 *       · primary nav tabs — e.g. Transform (EN) / Transformer (FR),
 *         Deliver (EN) / Diffuser (FR)  [rendered in `.tabs-bar .tab`]
 *     The implementer wires these through the en/fr resource bundles; the spec
 *     asserts the EN forms render by default and the FR forms after switching.
 */

// Two distinct primary nav tabs whose EN labels must become FR after the switch.
// (Both are present in STAGES today: Transform + Deliver.)
const NAV_EN = ['Transform', 'Deliver'];
const NAV_FR = ['Transformer', 'Diffuser'];

// A Profile-page heading string wired through the bundles.
const PROFILE_TITLE_EN = /your profile/i;
const PROFILE_TITLE_FR = /votre profil/i;

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

let lastPatchedLanguage: string | null = null;

/**
 * Stub the bootstrap network. `language` controls what GET /api/me reports, so a
 * reload with language:"fr" exercises the "preference re-applied on load" path.
 * The PATCH /api/me handler records the posted language so the spec can assert
 * the switcher persists the choice.
 */
async function stubBootstrap(page: Page, language: 'en' | 'fr') {
  lastPatchedLanguage = null;
  // Catch-all FIRST (Playwright matches routes in REVERSE registration order).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => {
    if (r.request().method() === 'PATCH') {
      const body = (r.request().postDataJSON() || {}) as { language?: string };
      lastPatchedLanguage = body.language ?? null;
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

// Open the user menu → "Profile" item → the full-screen profile page.
async function openProfile(page: Page) {
  await page.locator('.user-avatar').click();
  // Language-independent: the Profile item is the only `.user-menu__item` that
  // is NOT the danger-styled Sign-out button, so this matches whether the menu
  // renders "Profile" (EN) or "Profil" (FR).
  await page.locator('.user-menu__item:not(.user-menu__danger)').click();
  await expect(page.locator('.project-form')).toBeVisible();
}

const navTab = (page: Page, label: string) =>
  page.locator('.tabs-bar .tab', { hasText: new RegExp(`^${label}$`, 'i') });

const switcher = (page: Page) => page.locator('[data-testid="language-switcher"]');

// Select French in the switcher in a way that works for a native <select> or a
// custom control: prefer selectOption, fall back to clicking a French option.
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

test.describe('I18N-1 — language switcher + persisted preference', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  // AC: default English — wired Profile + nav strings render in English.
  test('defaults to English for the wired interface strings', async ({ page }) => {
    for (const en of NAV_EN) {
      await expect(navTab(page, en), `nav tab "${en}" must render in English by default`).toBeVisible();
    }
    await openProfile(page);
    await expect(
      page.locator('.project-form'),
      'the Profile page title must render in English by default',
    ).toContainText(PROFILE_TITLE_EN);
  });

  // AC: the switcher offers EXACTLY English + French (no third option).
  test('the language switcher offers exactly English and French', async ({ page }) => {
    await openProfile(page);
    const control = switcher(page);
    await expect(control, 'a language switcher must exist on the Profile page').toBeVisible();
    const optionText = (await control.innerText().catch(() => '')) || '';
    const tag = await control.evaluate((el) => el.tagName.toLowerCase());
    if (tag === 'select') {
      const labels = await control.locator('option').allInnerTexts();
      expect(labels.length, `switcher must offer exactly two options; got ${JSON.stringify(labels)}`).toBe(2);
      expect(labels.join(' ')).toMatch(/english/i);
      expect(labels.join(' ')).toMatch(/fran[cç]ais|french/i);
    } else {
      // A custom control: open it and count the offered options.
      await control.click();
      const opts = page.getByRole('option');
      await expect(opts, 'switcher must offer exactly two language options').toHaveCount(2);
      expect(`${optionText} ${(await opts.allInnerTexts()).join(' ')}`).toMatch(/english/i);
    }
  });

  // AC: choosing French switches the wired strings LIVE (no reload) AND persists
  // the choice via PATCH /api/me { language: "fr" }.
  test('selecting French switches the interface live and persists the choice', async ({ page }) => {
    await openProfile(page);
    const patchPromise = page.waitForRequest(
      (req) => /\/api\/me$/.test(req.url()) && req.method() === 'PATCH',
    );
    await selectFrench(page);

    // Persisted to the profile endpoint with the new language.
    const patch = await patchPromise;
    expect(patch.postDataJSON()?.language, 'selecting French must PATCH language="fr"').toBe('fr');
    expect(lastPatchedLanguage).toBe('fr');

    // LIVE: the Profile title flips to French with no navigation/reload.
    await expect(
      page.locator('.project-form'),
      'the Profile title must switch to French live (no reload)',
    ).toContainText(PROFILE_TITLE_FR);

    // LIVE: the primary nav tabs flip to their French labels too.
    for (const fr of NAV_FR) {
      await expect(navTab(page, fr), `nav tab must show its French label "${fr}" after the live switch`).toBeVisible();
    }
    // And the bare English nav labels are gone.
    for (const en of NAV_EN) {
      await expect(navTab(page, en), `English nav tab "${en}" must no longer render after switching to French`).toHaveCount(0);
    }
  });

  // AC: the switcher is keyboard-operable with an accessible name.
  test('the language switcher has an accessible name and is keyboard-focusable', async ({ page }) => {
    await openProfile(page);
    const control = switcher(page);
    const accName = await resolveAccessibleName(control);
    expect(accName.trim().length, 'the language switcher must have an accessible name').toBeGreaterThan(0);
    // Focusable via keyboard (programmatic focus reflects keyboard reachability).
    await control.focus();
    await expect(control, 'the language switcher must be keyboard-focusable').toBeFocused();
  });

  // AC visual: Profile page with the switcher in the ENGLISH state (one baseline
  // per viewport). Gate on the wired EN string so the baseline isn't vacuous.
  test('visual baseline — Profile page with the switcher in English', async ({ page }) => {
    await openProfile(page);
    await expect(switcher(page)).toBeVisible();
    await expect(page.locator('.project-form')).toContainText(PROFILE_TITLE_EN);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(page.locator('.project-form')).toHaveScreenshot('i18n1-profile-switcher-en.png');
  });

  // AC visual: Profile page with the switcher in the FRENCH state.
  test('visual baseline — Profile page with the switcher in French', async ({ page }) => {
    await openProfile(page);
    await selectFrench(page);
    await expect(page.locator('.project-form')).toContainText(PROFILE_TITLE_FR);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(page.locator('.project-form')).toHaveScreenshot('i18n1-profile-switcher-fr.png');
  });
});

test.describe('I18N-1 — saved preference re-applied on load', () => {
  // AC: a reload with the profile mock returning language:"fr" must bring the
  // interface up in French (preference re-applied on load) — no manual switch.
  test('the interface comes up in French when the saved preference is fr', async ({ page }) => {
    await stubBootstrap(page, 'fr');
    await gotoApp(page);
    for (const fr of NAV_FR) {
      await expect(navTab(page, fr), `nav tab "${fr}" must render in French from the saved preference`).toBeVisible();
    }
    await openProfile(page);
    await expect(
      page.locator('.project-form'),
      'the Profile title must come up in French from the saved preference',
    ).toContainText(PROFILE_TITLE_FR);
  });
});

// Resolve the accessible name as an AT would (label / aria-label / aria-labelledby).
async function resolveAccessibleName(control: import('@playwright/test').Locator): Promise<string> {
  return control.evaluate((el: Element) => {
    const byId = (id: string | null) => (id ? document.getElementById(id) : null);
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const txt = labelledby.split(/\s+/).map((i) => byId(i)?.textContent || '').join(' ').trim();
      if (txt) return txt;
    }
    const id = el.getAttribute('id');
    if (id) {
      const lbl = document.querySelector(`label[for="${id}"]`);
      if (lbl && (lbl.textContent || '').trim()) return (lbl.textContent || '').trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && (wrapping.textContent || '').trim()) return (wrapping.textContent || '').trim();
    return '';
  });
}
