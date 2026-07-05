import { test, expect, Page } from '@playwright/test';

/**
 * XTF-13/17/24 — Build options for Express & regular build: split-by combobox.
 *
 * VIS-12: visual baselines extracted from frontend/tests/e2e/build-options.spec.ts.
 * Minimal duplicated setup (bootstrap stub + combobox helpers + navigation) needed
 * to reach the three captured states: the closed control, the open/filtered
 * combobox, and the restricted (select_one-only) open dropdown.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

const MAIN_LABEL = 'Site';
const REGION_LABEL = 'Region';
const DISTRICT_LABEL = 'District';
const MAIN_LABELS = [MAIN_LABEL, REGION_LABEL, DISTRICT_LABEL];
const REPEAT_LABEL = 'member_name';
const mainQuestionYaml = (label: string) => [
  `  - kobo_key: ${label}`,
  `    label: ${label}`,
  '    type: select_one',
  '    category: categorical',
  `    export_label: ${label}`,
  '    repeat_group: null',
];
const CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  'report:',
  '  template: templates/report_template.docx',
  'questions:',
  ...MAIN_LABELS.flatMap(mainQuestionYaml),
  '  - kobo_key: household_members/member_name',
  `    label: ${REPEAT_LABEL}`,
  '    type: text',
  '    category: qualitative',
  `    export_label: ${REPEAT_LABEL}`,
  '    repeat_group: household_members',
  '',
].join('\n');

async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: true, has_ai: true } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 's1', created_at: '2026-06-01T00:00:00Z', files: [{ name: 'data.csv' }] }] } }));
}

async function gotoReports(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project')).toBeVisible();
  await page.locator('.tabs-bar .tab', { hasText: /reports|browse|deliver/i }).first().click();
  await page.locator('.subtabs-bar .subtab', { hasText: /reports/i }).click();
  await expect(page.getByTestId('build-options')).toBeVisible();
}

async function typeFilter(page: Page, text: string) {
  const control = page.getByTestId('build-split-by');
  await control.click();
  await control.focus();
  await page.keyboard.type(text);
}

async function visibleOptionTexts(page: Page): Promise<string[]> {
  const options = page.getByTestId('build-split-option');
  const out: string[] = [];
  const n = await options.count();
  for (let i = 0; i < n; i++) {
    const opt = options.nth(i);
    if (await opt.isVisible()) out.push(((await opt.textContent()) || '').trim());
  }
  return out;
}

async function openSplitBy(page: Page) {
  const control = page.getByTestId('build-split-by');
  await control.click();
  const options = page.getByTestId('build-split-option');
  await expect(options.first()).toBeVisible();
  return { control, options };
}

test.describe('XTF-13 — build options visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('visual baseline of the build-options control', async ({ page }) => {
    await gotoReports(page);
    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    await expect(control).toHaveScreenshot('build-options.png');
  });
});

test.describe('XTF-17 — searchable split-by combobox visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('visual baseline of the open, filtered combobox', async ({ page }) => {
    await gotoReports(page);

    await typeFilter(page, 'reg');
    await expect.poll(() => visibleOptionTexts(page)).toContain(REGION_LABEL);

    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    await expect(control).toHaveScreenshot('build-split-by-open.png');
  });
});

// XTF-24 — restrict split-by to single-select (select_one) columns.
const X24_SELECT_ONE = 'Region';
const X24_SELECT_ONE_FILE = 'District';
const X24_SELECT_MULTI = 'Skills';
const X24_INTEGER = 'Age';
const X24_TEXT = 'Respondent';
const X24_NOTE = 'Intro';

const x24Question = (label: string, type: string) => [
  `  - kobo_key: ${label}`,
  `    label: ${label}`,
  `    type: ${type}`,
  `    export_label: ${label}`,
  '    repeat_group: null',
];
const X24_CONFIG_YML = [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  alias: test',
  'report:',
  '  template: templates/report_template.docx',
  'questions:',
  ...x24Question(X24_SELECT_ONE, 'select_one'),
  ...x24Question(X24_SELECT_ONE_FILE, 'select_one_from_file'),
  ...x24Question(X24_SELECT_MULTI, 'select_multiple'),
  ...x24Question(X24_INTEGER, 'integer'),
  ...x24Question(X24_TEXT, 'text'),
  ...x24Question(X24_NOTE, 'note'),
  '',
].join('\n');

test.describe('XTF-24 — restricted split-by dropdown visual baseline', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    await page.route('**/api/config', (r) => r.fulfill({ json: { content: X24_CONFIG_YML } }));
  });

  test('visual baseline of the open dropdown with the restricted list', async ({ page }) => {
    await gotoReports(page);

    await openSplitBy(page);
    await expect.poll(() => visibleOptionTexts(page)).toContain(X24_SELECT_ONE);

    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    await expect(control).toHaveScreenshot('build-options-split-by-select-one-open.png');
  });
});
