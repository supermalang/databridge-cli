import { test, expect, Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * A11Y-3 — Programmatic labels on form controls.
 *
 * Several inputs across the app are labeled only visually or by placeholder, so
 * assistive-technology users get no accessible name (WCAG 3.3.2 Labels or
 * Instructions, 4.1.2 Name/Role/Value). This spec asserts — strictly from the
 * A11Y-3 Acceptance criteria — that every audited control exposes a non-empty
 * accessible name that is NOT merely its placeholder, that per-row export-label
 * inputs have row-disambiguated names, and that an axe scan of each surface reports
 * no `label` / `aria-input-field-name` violations.
 *
 * Surfaces audited (per the card):
 *   - Sources YAML <textarea>           (Extract → Connection, "{ } YAML" view)
 *   - Questions per-row export-label inputs (Transform → Questions)
 *   - invite email input                 (Members panel, "Manage members…")
 *   - Composition inputs                 (Analyze → Charts & indicators)
 *
 * NETWORK-MOCKED: the Vite dev server serves the real SPA; every /api/** is
 * intercepted with page.route(), so no FastAPI backend is required. Same harness
 * as build-options.spec.ts / the A11Y-2 tab spec.
 *
 * NOTE: these assertions are derived from the A11Y-3 Acceptance criteria, not from
 * any current implementation. The current controls rely on placeholders only and
 * carry no <label>/aria-label, so every accessible-name + axe assertion below is
 * expected RED until A11Y-3 ships.
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
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  '',
].join('\n');

// Two questions so per-row export-label inputs can be disambiguated by name.
const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region of residence', export_label: 'region', type: 'select_one', category: 'categorical' },
  ],
};

const MEMBERS = {
  members: [{ user_id: 'u-1', email: 'owner@example.test', role: 'admin', is_owner: true }],
  invitations: [],
  my_role: 'admin',
};

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (Playwright matches routes in
  // REVERSE registration order — last registered wins).
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: false, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

// Navigate the primary + secondary nav by clicking the data-tab / sub-tab labels.
async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

// A control's accessible name must be non-empty AND must not be just its placeholder.
async function expectLabeled(control: Locator, message: string) {
  await expect(control, message).toBeVisible();
  const placeholder = await control.getAttribute('placeholder');
  const accName = await resolveAccessibleName(control);
  expect(accName.trim().length, `${message}: accessible name must be non-empty`).toBeGreaterThan(0);
  if (placeholder) {
    expect(accName.trim(), `${message}: accessible name must not be only the placeholder`)
      .not.toBe(placeholder.trim());
  }
}

// Resolve the accessible name as the AT would see it (label / aria-label / aria-labelledby),
// explicitly excluding the placeholder so a placeholder-only control resolves to "".
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
      const lbl = document.querySelector(`label[for="${id}"]`);
      if (lbl && (lbl.textContent || '').trim()) return (lbl.textContent || '').trim();
    }
    const wrapping = el.closest('label');
    if (wrapping && (wrapping.textContent || '').trim()) return (wrapping.textContent || '').trim();
    return ''; // placeholder is intentionally NOT an accessible name
  });
}

// Reusable surface audit: (1) run a Playwright axe scan and assert no label /
// aria-input-field-name violations (per the card), AND (2) assert every form control
// in the region has a real, non-placeholder accessible name. Step (2) is required
// because axe-core's `label` rule treats a `placeholder` as an acceptable name — so an
// axe-only assertion would pass on placeholder-only inputs and be vacuous. The two
// together gate the actual WCAG 3.3.2 / 4.1.2 requirement.
async function expectNoLabelViolations(page: Page, include: string, message: string) {
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag21a', 'wcag412'])
    .analyze();
  const labelViolations = results.violations.filter((v) =>
    ['label', 'label-title-only', 'aria-input-field-name', 'select-name'].includes(v.id));
  expect(labelViolations, `${message} (axe)\n${JSON.stringify(labelViolations, null, 2)}`).toEqual([]);

  // Non-placeholder accessible name for every control on the surface.
  const controls = page.locator(include).locator('input:visible, select:visible, textarea:visible');
  const count = await controls.count();
  expect(count, `${message}: surface must render at least one form control`).toBeGreaterThan(0);
  const unnamed: string[] = [];
  for (let i = 0; i < count; i++) {
    const c = controls.nth(i);
    const accName = (await resolveAccessibleName(c)).trim();
    const placeholder = (await c.getAttribute('placeholder')) || '';
    if (accName.length === 0 || accName === placeholder.trim()) {
      const outer = await c.evaluate((el) => (el as HTMLElement).outerHTML.slice(0, 160));
      unnamed.push(outer);
    }
  }
  expect(unnamed, `${message}: ${unnamed.length} control(s) lack a non-placeholder accessible name\n${unnamed.join('\n')}`)
    .toEqual([]);
}

// ---------------------------------------------------------------------------------------
// Sources — YAML textarea
// ---------------------------------------------------------------------------------------
test.describe('A11Y-3 — Sources YAML textarea has a programmatic label', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await gotoStage(page, 'extract');
    await gotoSub(page, 'Connection');
    // Reveal the YAML editor (default view is the form).
    await page.getByRole('button', { name: /YAML/ }).click();
  });

  test('the YAML <textarea> resolves by an accessible name (not placeholder)', async ({ page }) => {
    // AC: the YAML textarea (Sources) is specifically labeled. Resolve it as a
    // textbox by accessible name — a name-less textarea cannot be found this way.
    const yamlBox = page.getByRole('textbox', { name: /yaml|config/i });
    await expect(yamlBox).toBeVisible();
    await expectLabeled(yamlBox, 'Sources YAML textarea');
  });

  test('axe: no label / aria-input-field-name violations on the YAML editor', async ({ page }) => {
    // Guard against a vacuous pass: the textarea must actually be present first.
    await expect(page.locator('.src-card textarea')).toBeVisible();
    await expectNoLabelViolations(page, '.src-card', 'Sources YAML editor has labelling violations');
  });

  test('label persists after typing then clearing (placeholder is not the label)', async ({ page }) => {
    // Interact via a stable structural locator (no accessible name is needed to type);
    // then assert the accessible name still resolves with the field empty.
    const yamlBox = page.locator('.src-card textarea');
    await expect(yamlBox).toBeVisible();
    await yamlBox.fill('api: {}');
    await yamlBox.fill('');
    // Even with the field empty (placeholder would be showing), the accessible name holds.
    await expectLabeled(yamlBox, 'Sources YAML textarea after clear');
  });

  test('visual baseline: labeled Sources YAML field', async ({ page }) => {
    const card = page.locator('.src-card');
    await expect(card.locator('textarea')).toBeVisible();
    await expect(card).toHaveScreenshot('a11y3-sources-yaml-field.png');
  });
});

// ---------------------------------------------------------------------------------------
// Questions — per-row export-label inputs
// ---------------------------------------------------------------------------------------
test.describe('A11Y-3 — Questions per-row export-label inputs are labeled + row-disambiguated', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await gotoStage(page, 'transform');
    await gotoSub(page, 'Questions');
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
  });

  test('every export-label input has a non-empty accessible name (not placeholder)', async ({ page }) => {
    const inputs = page.locator('input.q-export-input');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      await expectLabeled(inputs.nth(i), `Questions export-label input #${i}`);
    }
  });

  test('two rows expose distinguishable accessible names', async ({ page }) => {
    // AC: per-row inputs have unique, row-disambiguated accessible names so AT users
    // can tell rows apart (e.g. referencing the question).
    const inputs = page.locator('input.q-export-input');
    const name0 = (await resolveAccessibleName(inputs.nth(0))).trim();
    const name1 = (await resolveAccessibleName(inputs.nth(1))).trim();
    expect(name0.length).toBeGreaterThan(0);
    expect(name1.length).toBeGreaterThan(0);
    expect(name0, 'row 0 and row 1 export-label inputs must have different accessible names')
      .not.toBe(name1);
  });

  test('axe: no label / aria-input-field-name violations on the Questions table', async ({ page }) => {
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
    await expectNoLabelViolations(page, '.q-table', 'Questions table has labelling violations');
  });

  test('visual baseline: labeled Questions export-label rows', async ({ page }) => {
    const table = page.locator('table.q-table, .q-table').first();
    await expect(table).toBeVisible();
    await expect(table).toHaveScreenshot('a11y3-questions-export-rows.png');
  });
});

// ---------------------------------------------------------------------------------------
// Members panel — invite email input
// ---------------------------------------------------------------------------------------
async function openMembersPanel(page: Page) {
  await page.locator('.project-switcher').click();
  await page.getByText('Manage members…').click();
  await expect(page.locator('.project-form__tabs')).toBeVisible();
  await expect(page.getByText('Invite someone')).toBeVisible();
}

test.describe('A11Y-3 — Members panel invite email input is labeled', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await openMembersPanel(page);
  });

  test('the invite email input resolves by an accessible name (not placeholder)', async ({ page }) => {
    // AC: the invite email input (Members panel) is specifically labeled.
    const email = page.getByRole('textbox', { name: /e-?mail|invite/i });
    await expect(email).toBeVisible();
    await expectLabeled(email, 'Members invite email input');
  });

  test('axe: no label / aria-input-field-name violations on the Members panel', async ({ page }) => {
    await expect(page.locator('.pf-panel input[type="email"]')).toBeVisible();
    await expectNoLabelViolations(page, '.pf-panel', 'Members panel has labelling violations');
  });
});

// ---------------------------------------------------------------------------------------
// Composition — remaining inputs
// ---------------------------------------------------------------------------------------
test.describe('A11Y-3 — Composition inputs are labeled', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await bootApp(page);
    await gotoStage(page, 'analyze');
    await gotoSub(page, 'Charts & indicators');
    // The Composition form controls live in the "Add chart" editor; open it.
    await page.getByRole('button', { name: /Add chart/i }).click();
    await expect(page.locator('.modal[role="dialog"]')).toBeVisible();
  });

  test('every Composition input/select/textarea has a non-empty accessible name', async ({ page }) => {
    const surface = page.locator('.modal[role="dialog"]');
    const controls = surface.locator('input:visible, select:visible, textarea:visible');
    const count = await controls.count();
    // Guard against a vacuous pass — the editor renders form controls.
    expect(count, 'Composition editor must render at least one form control').toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expectLabeled(controls.nth(i), `Composition control #${i}`);
    }
  });

  test('axe: no label / aria-input-field-name violations on Composition', async ({ page }) => {
    await expect(page.locator('.modal[role="dialog"]')).toBeVisible();
    await expectNoLabelViolations(page, '.modal[role="dialog"]', 'Composition editor has labelling violations');
  });
});
