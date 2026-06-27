import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * PLANG-2 — Create-only language field + read-only language in AI config (UI).
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation:
 *
 *   1. In the CREATE project form the language selector is editable
 *      (English / French / Spanish / Portuguese / Arabic) and its value is
 *      submitted on create (POST /api/projects body carries the chosen language).
 *   2. In the EDIT project form the language is shown read-only / disabled with a
 *      visible one-line note that it is set at creation and cannot be changed; the
 *      form's dirty-tracking does NOT flag the unchanged read-only language (the
 *      Save button stays in its pristine state — no unsaved-changes guard fires).
 *   3. The AI-config tab (Extract → AI configuration) no longer presents language
 *      as an editable input; it displays the active PROJECT's language read-only
 *      with a hint that it is the project's language and governs generated output.
 *   4. The read-only AI-config language MATCHES the project's language.
 *   5. The controls are keyboard-accessible with accessible names and a visible
 *      focus ring; an axe audit of both surfaces reports no violations.
 *   6. Visual baselines (one per viewport) of the edit-mode read-only language
 *      field and the AI-config read-only language; a human approves them.
 *
 * NETWORK-MOCKED end to end (same harness as i18n-switch / i18n-coverage / a11y
 * specs): Vite serves the real SPA; every /api/ call is intercepted with
 * page.route(), so no FastAPI backend is needed.
 *
 * --- INTERFACE CONTRACT the implementer must satisfy (selectors, not behavior) ---
 *
 *   - The project create/edit form is `.project-form`; its Details panel hosts the
 *     language control. CREATE is reached from the project switcher menu
 *     (`.project-switcher` → `.project-menu__add`); EDIT from a project row gear
 *     (`.project-menu__gear`).
 *   - The active project + its language come from `GET /api/projects`; PLANG-1
 *     makes the project's `language` authoritative. The project row carries a
 *     `language` field that the AI-config view reads.
 *   - The AI-config view is `<Sources section="ai">`, reached via the Extract
 *     primary tab (`.tabs-bar [data-tab="extract"]`) then the "AI configuration"
 *     sub-tab (`.subtabs-bar .subtab`).
 *   - Today the AI section renders an EDITABLE language `<input>` with
 *     aria-label "Language"; PLANG-2 replaces it with a READ-ONLY display.
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

let lastCreateBody: Record<string, unknown> | null = null;

/**
 * Stub the bootstrap network. `language` controls the INTERFACE language reported
 * by GET /api/me (I18N-1) — kept English here so the test asserts the PROJECT
 * language (French) independently of the interface language. The POST /api/projects
 * handler records the create body so the spec can assert the chosen language is
 * submitted. The catch-all is registered FIRST (Playwright matches routes in
 * REVERSE registration order).
 */
async function stubBootstrap(page: Page, interfaceLanguage: 'en' | 'fr' = 'en') {
  lastCreateBody = null;
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
      lastCreateBody = (r.request().postDataJSON() || {}) as Record<string, unknown>;
      return r.fulfill({ json: { id: 'proj-new', name: lastCreateBody.name, slug: 'new', role: 'admin', is_archived: false, language: lastCreateBody.language } });
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

// Open the project switcher dropdown.
async function openProjectMenu(page: Page) {
  await page.locator('.project-switcher').click();
  await expect(page.locator('.project-menu')).toBeVisible();
}

// Open the CREATE project form via the "+ new project" menu item.
async function openCreateForm(page: Page) {
  await openProjectMenu(page);
  await page.locator('.project-menu__add').click();
  await expect(page.locator('.project-form')).toBeVisible();
}

// Open the EDIT project form via the active project's gear.
async function openEditForm(page: Page) {
  await openProjectMenu(page);
  await page.locator('.project-menu__gear').first().click();
  await expect(page.locator('.project-form')).toBeVisible();
}

// Navigate to the AI-config view (Extract → AI configuration).
async function openAiConfig(page: Page) {
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /AI/i }).click();
  await expect(page.locator('.tab-content:visible').first()).toBeVisible();
}

// The language control inside the project form's Details panel.
const formLanguageControl = (page: Page): Locator =>
  page.locator('.project-form .profile-field select, .project-form [data-testid="project-language"]');

// Resolve the accessible name as an AT would (label / aria-label / aria-labelledby).
async function resolveAccessibleName(control: Locator): Promise<string> {
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
      const lbl = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (lbl && (lbl.textContent || '').trim()) return (lbl.textContent || '').trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && (wrapping.textContent || '').trim()) return (wrapping.textContent || '').trim();
    return '';
  });
}

test.describe('PLANG-2 — create-only language field', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  // AC1: the CREATE form's language selector is editable with the five languages.
  test('create form: language selector is editable with English/French/Spanish/Portuguese/Arabic', async ({ page }) => {
    await openCreateForm(page);
    const control = formLanguageControl(page).first();
    await expect(control, 'create form must expose a language selector').toBeVisible();
    await expect(control, 'create-form language selector must be editable (not disabled)').toBeEnabled();

    const tag = await control.evaluate((el) => el.tagName.toLowerCase());
    expect(tag, 'the create-form language control must be an editable <select>').toBe('select');
    const labels = (await control.locator('option').allInnerTexts()).join(' | ');
    for (const lang of ['English', 'French', 'Spanish', 'Portuguese', 'Arabic']) {
      expect(labels, `create-form language selector must offer "${lang}"`).toContain(lang);
    }
  });

  // AC1: the chosen language is submitted on create.
  test('create form: the chosen language is submitted in POST /api/projects', async ({ page }) => {
    await openCreateForm(page);
    await page.locator('.project-form input').first().fill('Brand New Project');
    const control = formLanguageControl(page).first();
    await control.selectOption({ label: 'French' });

    const createReq = page.waitForRequest(
      (req) => /\/api\/projects$/.test(req.url()) && req.method() === 'POST',
    );
    await page.locator('.project-form button', { hasText: /^Create$/ }).click();
    const req = await createReq;
    expect(req.postDataJSON()?.language, 'create must submit the chosen language (French)').toBe('French');
  });
});

test.describe('PLANG-2 — read-only language in edit form', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  // AC2: in EDIT mode the language is read-only / disabled.
  test('edit form: the language control is read-only / disabled', async ({ page }) => {
    await openEditForm(page);
    const control = formLanguageControl(page).first();
    await expect(control, 'edit form must still show the language').toBeVisible();
    // Read-only is expressed as a disabled control, aria-disabled, or readonly —
    // any of which means it cannot be edited. An enabled, non-readonly <select>
    // FAILS this (the current behavior).
    const editable = await control.evaluate((el) => {
      const disabled = (el as HTMLSelectElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
      const readonly = el.getAttribute('readonly') !== null || el.getAttribute('aria-readonly') === 'true';
      const isSelect = el.tagName.toLowerCase() === 'select';
      return isSelect && !disabled && !readonly;
    });
    expect(editable, 'the edit-form language control must NOT be an editable, enabled <select>').toBe(false);
    // And it shows the project's saved language value.
    await expect(page.locator('.project-form')).toContainText(PROJECT_LANGUAGE);
  });

  // AC2: a visible one-line note explains the language is fixed at creation.
  test('edit form: a note states the language is set at creation and cannot be changed', async ({ page }) => {
    await openEditForm(page);
    // The note lives in the Details panel near the language field. It must convey
    // "fixed/set at creation" — asserted via a tolerant phrase match so the exact
    // wording is the implementer's (key-aligned EN/FR) choice.
    const panel = page.locator('.project-form');
    await expect(
      panel,
      'the edit form must show a note that the language is fixed at creation',
    ).toContainText(/at creation|cannot be changed|set when|fixed|once created/i);
  });

  // AC2: the unchanged read-only language must not flag the form dirty. We open
  // edit, change NOTHING, and Back must close without a discard-changes prompt.
  test('edit form: the unchanged read-only language does not flag the form dirty', async ({ page }) => {
    await openEditForm(page);
    await expect(formLanguageControl(page).first()).toBeVisible();
    // Going Back with no edits must NOT raise the "Discard unsaved changes?"
    // confirm — i.e. dirty tracking is pristine for the immutable language.
    await page.locator('.project-form button', { hasText: /Back/i }).click();
    await expect(
      page.getByText(/Discard unsaved changes\?/i),
      'closing an untouched edit form must not raise the unsaved-changes guard',
    ).toHaveCount(0);
    await expect(page.locator('.project-form'), 'the form should close cleanly').toHaveCount(0);
  });

  // AC5: the edit-mode language control has an accessible name + visible focus ring.
  test('edit form: the read-only language control has an accessible name and is focusable', async ({ page }) => {
    await openEditForm(page);
    const control = formLanguageControl(page).first();
    const accName = await resolveAccessibleName(control);
    expect(accName.trim().length, 'the language control must have an accessible name').toBeGreaterThan(0);
    await control.focus();
    await expect(control, 'the language control must be keyboard-focusable').toBeFocused();
  });

  // AC5: axe audit of the edit form (read-only language surface) — no violations.
  test('edit form: axe audit reports no violations', async ({ page }) => {
    await openEditForm(page);
    await expect(formLanguageControl(page).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).include('.project-form').analyze();
    expect(
      results.violations,
      `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  });

  // AC6 visual: edit-mode read-only language field (one baseline per viewport).
  // Gate on the READ-ONLY state + fixed-at-creation note so the baseline isn't
  // captured against the current editable <select> (which would be vacuous).
  test('visual baseline — edit-form read-only language field', async ({ page }) => {
    await openEditForm(page);
    const control = formLanguageControl(page).first();
    await expect(control).toBeVisible();
    await expect(page.locator('.project-form')).toContainText(PROJECT_LANGUAGE);
    // The fixed-at-creation note must be present (only true once PLANG-2 lands).
    await expect(page.locator('.project-form')).toContainText(/at creation|cannot be changed|set when|fixed|once created/i);
    // And the control must be read-only (not an editable, enabled <select>).
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

test.describe('PLANG-2 — read-only language in AI config', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, 'en');
    await gotoApp(page);
  });

  // AC3: the AI-config tab no longer presents language as an editable input.
  test('ai-config: language is no longer an editable input', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(pane).toBeVisible();
    // Today the AI section renders <input aria-label="Language">. PLANG-2 removes
    // that editable input. Assert no editable text input for the language remains.
    await expect(
      pane.locator('input[aria-label="Language"], input[aria-label="Langue"]'),
      'the AI-config language must not be an editable input',
    ).toHaveCount(0);
  });

  // AC3 + AC4: the AI-config language renders read-only and matches the project's.
  test('ai-config: shows the project language read-only and it matches the project', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(
      pane,
      'the AI-config view must display the project language (French) read-only',
    ).toContainText(PROJECT_LANGUAGE);
  });

  // AC3: a hint explains the language comes from the project and drives output.
  test('ai-config: a hint explains the language is the project\'s and drives output', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(
      pane,
      'the AI-config view must show a hint that the language is set on the project / governs generated output',
    ).toContainText(/project|generated|output/i);
  });

  // AC5: axe audit of the AI-config surface — no violations.
  test('ai-config: axe audit reports no violations', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(pane).toContainText(PROJECT_LANGUAGE);
    // AxeBuilder.include() forwards its selector to axe-core's native
    // document.querySelectorAll, which does NOT understand Playwright's `:visible`
    // pseudo-class. Resolve the visible AI-config pane's stable id (the active
    // tabpanel carries id="panel-primary-<stage>"; keep-alive hidden panes have
    // display:none and no such id) and scope axe with a plain CSS id selector.
    const paneId = await pane.evaluate((el) => el.id);
    expect(paneId, 'the visible AI-config pane must expose a stable id').toBeTruthy();
    const results = await new AxeBuilder({ page }).include(`#${paneId}`).analyze();
    expect(
      results.violations,
      `axe violations: ${JSON.stringify(results.violations.map((v) => v.id))}`,
    ).toEqual([]);
  });

  // AC6 visual: AI-config read-only language (one baseline per viewport).
  test('visual baseline — AI-config read-only language', async ({ page }) => {
    await openAiConfig(page);
    const pane = page.locator('.tab-content:visible').first();
    await expect(pane).toContainText(PROJECT_LANGUAGE);
    await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
    await expect(pane).toHaveScreenshot('plang2-aiconfig-language-readonly.png');
  });
});
