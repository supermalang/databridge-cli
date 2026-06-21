import { test, expect, Page } from '@playwright/test';

/**
 * PUX-1 — Plain-language relabeling of data-engineering vocabulary.
 *
 * These specs encode the card's ACCEPTANCE CRITERIA, not the implementation. This
 * is a COPY/LABEL-ONLY card: stage ids, navigation targets, config keys and saved
 * values are unchanged — only displayed text differs. So the specs assert:
 *
 *   1. The third Home stage card (currently "Model") no longer shows the word
 *      "Model" nor the phrases "virtual tables" / "joins and aggregates", and reads
 *      in outcome-oriented plain language (a "combine / link your data" framing).
 *   2. The second Home stage card (currently "Transform") is no longer labelled with
 *      bare "Transform" as its only/visible label.
 *   3. Activating the third stage card lands on the SAME stage it always did
 *      (no behavior change) — a no-regression guard.
 *   4. On Questions, the export-label field reads as a plain-language report-friendly
 *      name with an inline one-line hint, and any raw `kobo_key` token shown to the
 *      user is accompanied by a plain-language explanation (never shown bare).
 *   5. Visual baselines of the relabeled Home cards and the relabeled Questions row,
 *      one per viewport (mobile/tablet/desktop via playwright.config.ts).
 *
 * NETWORK-MOCKED end-to-end (same harness as a11y-*.spec.ts): the Vite dev server
 * serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * SELECTORS (interface, not behavior under test):
 *   - Home stage cards: `.home-card` (container `.home-cards`).
 *   - Primary nav stages: `.tabs-bar [data-tab="<stageId>"]`; active: `.tab.active`.
 *   - Sub-tabs: `.subtabs-bar .subtab`.
 *   - Questions table: `.q-table`; per-row export-label input: `input.q-export-input`.
 * These structural hooks are unchanged by a copy-only relabel, so they stay valid.
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

// Two questions so the per-row export-label inputs render.
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

async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.home-card').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string | RegExp) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

// Forbidden data-engineering jargon that the AC says must NOT appear in the
// visible label/description of the third Home stage card.
const FORBIDDEN_THIRD_CARD = [/\bmodel\b/i, /virtual tables?/i, /joins?\s+and\s+aggregates?/i];

test.describe('PUX-1 — Home stage cards use plain language', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
  });

  // AC: the card currently labelled "Model" no longer uses "Model" or the phrase
  // "virtual tables of joins and aggregates" anywhere in its visible text.
  test('the third Home stage card drops "Model" / "virtual tables" / "joins and aggregates"', async ({ page }) => {
    const cards = page.locator('.home-card');
    await expect(cards).toHaveCount(5);
    const third = cards.nth(2);
    const text = ((await third.innerText()) || '').trim();
    expect(text.length, 'third stage card must render visible text').toBeGreaterThan(0);
    for (const pattern of FORBIDDEN_THIRD_CARD) {
      expect(
        text,
        `third Home stage card must not contain data-engineering jargon (${pattern}); got: ${JSON.stringify(text)}`,
      ).not.toMatch(pattern);
    }
  });

  // AC: it reads in outcome-oriented plain language — a "combine / link your data"
  // framing understandable to a non-expert.
  test('the third Home stage card reads as a plain-language "combine / link your data" framing', async ({ page }) => {
    const third = page.locator('.home-card').nth(2);
    const text = ((await third.innerText()) || '').trim();
    expect(
      text,
      `third Home stage card must use outcome-oriented plain language (combine / link / merge / join together your data); got: ${JSON.stringify(text)}`,
    ).toMatch(/combine|link|merge|bring together|connect/i);
  });

  // AC: the card currently labelled "Transform" is no longer labelled with bare
  // "Transform" as its only/visible label. The title (first non-numeric line) must
  // not be exactly "Transform".
  test('the second Home stage card is not labelled with bare "Transform"', async ({ page }) => {
    const second = page.locator('.home-card').nth(1);
    const text = ((await second.innerText()) || '').trim();
    expect(text.length, 'second stage card must render visible text').toBeGreaterThan(0);
    // The bare jargon word "Transform" must not stand as the card's label/heading.
    // (A reworded label may still describe transforming, but not as a bare term.)
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const heading = lines.find((l) => !/^\d+$/.test(l)) || '';
    expect(
      heading,
      `second Home stage card heading must not be the bare jargon word "Transform"; got heading ${JSON.stringify(heading)}`,
    ).not.toMatch(/^transform$/i);
  });

  // No-behavior-change guard: activating the third stage card lands on the SAME
  // stage destination it always did. The third stage's id is `model` (config key /
  // navigation target are unchanged by the copy relabel) — only the words change.
  // This guard must stay GREEN through the fix; if it goes red the relabel changed
  // behavior, which the AC forbids.
  test('activating the third stage card lands on the same (unchanged) "model" stage destination', async ({ page }) => {
    await page.locator('.home-card').nth(2).click();
    // Destination unchanged: the model stage (same data-tab id) is now active.
    await expect(page.locator('.tabs-bar .tab.active[data-tab="model"]')).toBeVisible();
  });

  // Visual baseline of the relabeled Home cards (one assertion → one baseline per
  // viewport via playwright.config.ts; a human approves them). Gate on the AC so the
  // baseline is not captured vacuously from pre-fix jargon copy.
  test('visual baseline of the relabeled Home stage cards', async ({ page }) => {
    const third = page.locator('.home-card').nth(2);
    const text = ((await third.innerText()) || '').trim();
    for (const pattern of FORBIDDEN_THIRD_CARD) {
      expect(text, 'Home cards must be relabeled before the baseline is captured').not.toMatch(pattern);
    }
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux1-home-stage-cards.png');
  });
});

test.describe('PUX-1 — Questions field labels use plain language', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await gotoHome(page);
    await gotoStage(page, 'transform');
    await gotoSub(page, /questions/i);
    await expect(page.locator('input.q-export-input').first()).toBeVisible();
  });

  // AC: the field for `export_label` (currently surfaced as the column header
  // "Export label") must read as a plain-language report-friendly NAME — the
  // data-engineering term "Export label" must no longer be the user-facing label.
  test('the export-label column no longer uses the jargon term "Export label"', async ({ page }) => {
    const table = page.locator('.q-table').first();
    const tableText = ((await table.innerText()) || '').trim();
    // "Export label" (and the raw snake_case token) is the data-engineering vocabulary
    // the card targets — it must not stand as the user-facing field label.
    expect(
      tableText,
      `Questions table must not use the jargon term "Export label" / "export_label"; got: ${JSON.stringify(tableText)}`,
    ).not.toMatch(/export[\s_]?label/i);
  });

  // AC: the report-name field reads as a plain-language report-friendly name AND
  // carries a one-line inline hint explaining, in user terms, what it controls
  // (the name this column gets in the exported report / spreadsheet).
  test('the report-name field reads as plain language with a one-line inline hint', async ({ page }) => {
    const table = page.locator('.q-table').first();
    const tableText = ((await table.innerText()) || '').trim();
    // Plain-language framing: it names the column shown in the report / spreadsheet.
    expect(
      tableText,
      `Questions report-name field must use plain language (report / spreadsheet column name); got: ${JSON.stringify(tableText)}`,
    ).toMatch(/report|spreadsheet|column name|name in (the|your)/i);
    // A one-line inline hint must accompany it — explanatory prose, not just a header.
    // The hint tells the user what the field controls in plain words.
    expect(
      tableText,
      `Questions report-name field must carry a one-line plain-language hint; got: ${JSON.stringify(tableText)}`,
    ).toMatch(/this is the name|the name (this|that|it)|how (this|it) (column )?appears|name (this|the|your) column|shown in (the|your) (report|spreadsheet|export)/i);
  });

  // AC: the export-label input resolves to a plain-language accessible name (not the
  // raw token, not the bare "Export label" jargon).
  test('the export-label input has a plain-language accessible name', async ({ page }) => {
    const input = page.locator('input.q-export-input').first();
    const accName = await resolveAccessibleName(input);
    expect(accName.trim().length, 'export-label input must have an accessible name').toBeGreaterThan(0);
    expect(
      accName,
      `export-label accessible name must not surface the jargon term "export label"/"export_label"; got ${JSON.stringify(accName)}`,
    ).not.toMatch(/export[\s_]?label/i);
  });

  // AC: the raw token `kobo_key` is never shown to the user without a one-line
  // plain-language explanation alongside it.
  test('any kobo_key shown to the user is accompanied by a plain-language explanation', async ({ page }) => {
    const table = page.locator('.q-table').first();
    const tableText = ((await table.innerText()) || '').trim();
    // The raw snake_case token must not appear bare anywhere on the surface.
    expect(
      tableText,
      `the raw token "kobo_key" must not be shown bare to the user; got: ${JSON.stringify(tableText)}`,
    ).not.toMatch(/kobo_key/i);
  });

  // Visual baseline of the relabeled Questions row (one assertion → one baseline per
  // viewport). Gate on the AC so the baseline is not captured from pre-fix copy.
  test('visual baseline of the relabeled Questions row', async ({ page }) => {
    const table = page.locator('.q-table').first();
    await expect(table).toBeVisible();
    const tableText = ((await table.innerText()) || '').trim();
    expect(tableText, 'Questions field labels must be relabeled before the baseline is captured')
      .not.toMatch(/export[\s_]?label|kobo_key/i);
    await expect(table).toHaveScreenshot('pux1-questions-row.png');
  });
});

// Resolve the accessible name as the AT would see it (label / aria-label /
// aria-labelledby), excluding placeholder.
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
