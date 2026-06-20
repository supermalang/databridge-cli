import { test, expect, Page } from '@playwright/test';

/**
 * XTF-13 — Build options for Express & regular build:
 *   split-by (MAIN-table columns only) + sample preview (--split-sample).
 *
 * NETWORK-MOCKED end-to-end, same harness as express-template-fill.spec.ts: the Vite
 * dev server serves the real SPA; every /api/** is intercepted with page.route(), so no
 * FastAPI backend is required.
 *
 * SURFACE UNDER TEST: the REGULAR build (Reports tab → "Build report"), which drives
 * `useRun().run('build-report', opts)` directly. The card wires BOTH the Express
 * Apply&build chain and the regular Build; per the test author's note, one surface
 * exercising the contract is acceptable. The regular Reports build is the cleanest to
 * drive (no AI/infer/apply chain in front of it), so it is the surface here.
 *
 * COLUMN SOURCE the implementer must read (and that this spec mocks): the split-by
 * selector is populated from `config.questions[]` (GET /api/config → YAML), using
 * `export_label`, filtered to MAIN-table questions only — a question is main-table when
 * it has NO `repeat_group` (the repeat_group field is null/absent); a question WITH a
 * `repeat_group` is a repeat-group column and must be EXCLUDED.
 *
 * SELECTOR CONTRACT (data-testid) the implementer must satisfy:
 *   - build-options       — the build-options control container (screenshot target)
 *   - build-split-by      — the split-by control. As of XTF-17 this is a searchable
 *                           COMBOBOX, and build-split-by resolves to the trigger/input the
 *                           user clicks/types into (no longer a native <select>).
 *   - build-split-option  — each rendered option in the open combobox listbox. Options are
 *                           main-table export_labels ONLY (repeat-group excluded), plus a
 *                           "No split" option that clears split_by. Typing into build-split-by
 *                           filters which build-split-option elements are visible.
 *   - build-sample-mode   — the sample-preview mode <select>: "all" (default) | "first-n"
 *   - build-sample-n      — the N input, shown/used when mode = "first-n"
 *   - build-run           — the action that triggers run('build-report', {split_by, split_sample})
 *
 * PAYLOAD CONTRACT (unchanged by XTF-17): choosing a split-by column + "First 2 groups" →
 * the POST body to /api/run/build-report carries { split_by: "<export_label>",
 * split_sample: 2 }. Choosing "Build all groups (default)" and the "No split" option →
 * neither field present.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// Config with SEVERAL main-table columns (Site, Region, District — no repeat_group) and
// ONE repeat-group column (member_name, repeat_group: household_members). The split-by
// combobox must list the main-table columns and must NEVER list "member_name". Several
// main-table columns make the XTF-17 typeahead filter meaningful: typing "reg" must
// narrow to "Region" and exclude "Site"/"District". A template + downloaded session also
// exist so the build action is enabled (Reports.jsx buildMissing gate).
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

// SSE body with a terminal success status frame (useCommand reads res.body).
const BUILD_SSE =
  'event: log\ndata: {"line":"building report","level":"info"}\n\n' +
  'event: status\ndata: {"command":"build-report","status":"success"}\n\n';

async function stubBootstrap(page: Page) {
  // Catch-all FIRST so the specific routes below win (Playwright matches routes in
  // REVERSE registration order — last registered wins).
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
  // Reports-tab loads. A template matching report.template + one data session so the
  // regular Build action is enabled (Reports.jsx buildMissing = []).
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) =>
    r.fulfill({ json: { files: [{ name: 'report_template.docx' }] } }));
  // A downloaded session so buildMissing has no "data" gap. The Reports page's data-files
  // FileTable reads session.label / session.session_id / session.files[].length, so the
  // mocked session must carry that shape — an object missing `files` crashes the page
  // render (FileTable → s.files.length) before build-options can mount.
  await page.route('**/api/data/sessions', (r) =>
    r.fulfill({ json: { sessions: [{ session_id: 's1', label: 's1', created_at: '2026-06-01T00:00:00Z', files: [{ name: 'data.csv' }] }] } }));
}

// Capture the POST body sent to /api/run/build-report, then reply with a success SSE.
function stubRunCapture(page: Page, captured: { value: any }) {
  return page.route('**/api/run/build-report', (r) => {
    try { captured.value = JSON.parse(r.request().postData() || '{}'); }
    catch { captured.value = null; }
    return r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: BUILD_SSE });
  });
}

// --- XTF-17 combobox helpers ----------------------------------------------------------
//
// The split-by control is a searchable combobox. `build-split-by` resolves to the
// trigger/input. Opening it (click) reveals a listbox of `build-split-option` elements.
// Typing into the control filters which options are visible. These helpers keep the spec
// robust to whether the implementer uses a contenteditable trigger or a text <input>.

// Open the combobox listbox and return a locator over the (currently visible) options.
async function openSplitBy(page: Page) {
  const control = page.getByTestId('build-split-by');
  await control.click();
  // Options should be present once open.
  const options = page.getByTestId('build-split-option');
  await expect(options.first()).toBeVisible();
  return { control, options };
}

// Type a filter substring into the open combobox. Focus the control first so keystrokes
// land on the typeahead input.
async function typeFilter(page: Page, text: string) {
  const control = page.getByTestId('build-split-by');
  await control.click();
  await control.focus();
  await page.keyboard.type(text);
}

// The visible (filtered) option labels in the open listbox.
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

// Navigate to the Reports ("Browse") tab. The exact tab label is the implementer's, so
// match the tab whose route renders the build action; fall back through likely labels.
async function gotoReports(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project')).toBeVisible();
  // Deliver stage's DEFAULT subtab is Output/Sources — build-options is rendered on the
  // Reports SUBTAB, so click the top-level Deliver tab THEN the Reports subtab (mirrors
  // the sibling XTF-12 spec reports-delete-all.spec.ts gotoReports navigation).
  await page.locator('.tabs-bar .tab', { hasText: /reports|browse|deliver/i }).first().click();
  await page.locator('.subtabs-bar .subtab', { hasText: /reports/i }).click();
  // Sanity: the build-options control rendered (proves the bootstrap mocks are sound,
  // so any later failure is the missing XTF-13 UI — not a broken render).
  await expect(page.getByTestId('build-options')).toBeVisible();
}

test.describe('XTF-13 — build options: split-by (main-table only) + sample preview', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('split-by lists main-table columns only and forwards split_by + split_sample', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // The split-by combobox lists the MAIN-table columns and EXCLUDES the repeat-group one.
    const { options } = await openSplitBy(page);
    await expect(options.filter({ hasText: MAIN_LABEL })).toHaveCount(1);
    await expect(options.filter({ hasText: REPEAT_LABEL })).toHaveCount(0);

    // Choose the main-table column (Site) from the open listbox + "First N groups" N = 2.
    await options.filter({ hasText: MAIN_LABEL }).first().click();
    await page.getByTestId('build-sample-mode').selectOption('first-n');
    await page.getByTestId('build-sample-n').fill('2');

    // Trigger the build → the captured request body must carry both fields.
    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by).toBe(MAIN_LABEL);
    expect(captured.value.split_sample).toBe(2);
  });

  test('build all (default) + no split-by → neither field in the request body', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // Leave split-by unset and sample-mode on the default ("Build all groups").
    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by ?? null).toBeNull();
    expect(captured.value.split_sample ?? null).toBeNull();
  });

  test('visual baseline of the build-options control', async ({ page }) => {
    await gotoReports(page);
    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    // One assertion → one baseline per viewport (mobile/tablet/desktop) via
    // playwright.config.ts. The implementer produces the baselines for human approval.
    await expect(control).toHaveScreenshot('build-options.png');
  });
});

test.describe('XTF-15 — single "Build report" control (rail Quick Action removed)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('the Reports page has exactly one "Build report" button — the BuildOptions build-run control', async ({ page }) => {
    await gotoReports(page);

    // AC: the Reports page has exactly ONE "Build report" control. Currently TWO match:
    //   (1) the Quick Actions rail action (Reports.jsx ~127, run('build-report'))
    //   (2) the XTF-13 BuildOptions build-run button (default label "Build report")
    // After the rail action is removed, only (2) survives.
    const buildButtons = page.getByRole('button', { name: /build report/i });
    await expect(buildButtons).toHaveCount(1);

    // AC: the single survivor is the BuildOptions build-run control, NOT the rail action.
    // The rail action is a `.rail-action` button with no data-testid; build-run carries it.
    await expect(buildButtons).toHaveAttribute('data-testid', 'build-run');

    // The same element is reachable via its testid, and is the only "Build report" match.
    await expect(page.getByTestId('build-run')).toHaveText(/build report/i);
  });

  test('the Quick Actions rail drops "Build report" but keeps "Compare periods"', async ({ page }) => {
    await gotoReports(page);

    // AC: the Quick Actions rail no longer contains a "Build report" action…
    const railActions = page.locator('.rail-action');
    await expect(railActions.filter({ hasText: /build report/i })).toHaveCount(0);

    // …while the remaining rail actions (e.g. Compare periods) are unchanged and still present.
    await expect(railActions.filter({ hasText: /compare periods/i })).toHaveCount(1);
  });
});

test.describe('XTF-17 — searchable split-by combobox (typeahead, main-table only)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
  });

  test('typing a substring filters to matching main-table columns; repeat-group never appears', async ({ page }) => {
    await gotoReports(page);

    // Open the combobox: all three main-table columns are listed, repeat-group is not.
    const { options } = await openSplitBy(page);
    await expect(options.filter({ hasText: REGION_LABEL })).toHaveCount(1);
    await expect(options.filter({ hasText: DISTRICT_LABEL })).toHaveCount(1);
    await expect(options.filter({ hasText: MAIN_LABEL })).toHaveCount(1);
    // The repeat-group column (member_name) is NEVER an option, even with the list open.
    await expect(options.filter({ hasText: REPEAT_LABEL })).toHaveCount(0);

    // Type "reg" → the visible options narrow to "Region" and EXCLUDE Site/District.
    await typeFilter(page, 'reg');
    await expect.poll(() => visibleOptionTexts(page)).toContain(REGION_LABEL);
    const visible = await visibleOptionTexts(page);
    expect(visible).not.toContain(MAIN_LABEL);
    expect(visible).not.toContain(DISTRICT_LABEL);

    // The repeat-group column still never shows up, regardless of the filter text.
    expect(visible).not.toContain(REPEAT_LABEL);
  });

  test('selecting a filtered option sets split_by on the build request', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // Filter to "Region", then select it (clicking the single filtered option).
    await typeFilter(page, 'reg');
    const options = page.getByTestId('build-split-option');
    await options.filter({ hasText: REGION_LABEL }).first().click();

    // Build → the captured request body carries split_by = the chosen column.
    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by).toBe(REGION_LABEL);
  });

  test('choosing "No split" clears split_by from the build request', async ({ page }) => {
    const captured: { value: any } = { value: undefined };
    await stubRunCapture(page, captured);

    await gotoReports(page);

    // First select a real column…
    let options = (await openSplitBy(page)).options;
    await options.filter({ hasText: REGION_LABEL }).first().click();

    // …then reopen and choose the "No split" option, which must clear split_by.
    const control = page.getByTestId('build-split-by');
    await control.click();
    options = page.getByTestId('build-split-option');
    await options.filter({ hasText: /no split/i }).first().click();

    await page.getByTestId('build-run').click();

    await expect.poll(() => captured.value, { message: 'run/build-report body captured' }).toBeTruthy();
    expect(captured.value.split_by ?? null).toBeNull();
  });

  test('keyboard: focus + type-to-filter narrows the listbox', async ({ page }) => {
    await gotoReports(page);

    // Focus the combobox and type — the listbox opens and filters by keystrokes alone.
    const control = page.getByTestId('build-split-by');
    await control.focus();
    await page.keyboard.type('dist');

    await expect.poll(() => visibleOptionTexts(page)).toContain(DISTRICT_LABEL);
    const visible = await visibleOptionTexts(page);
    expect(visible).not.toContain(MAIN_LABEL);
    expect(visible).not.toContain(REGION_LABEL);
    expect(visible).not.toContain(REPEAT_LABEL);
  });

  test('visual baseline of the open, filtered combobox', async ({ page }) => {
    await gotoReports(page);

    // Open + filter so the screenshot captures the searchable listbox state.
    await typeFilter(page, 'reg');
    await expect.poll(() => visibleOptionTexts(page)).toContain(REGION_LABEL);

    // One assertion → one baseline per viewport (mobile/tablet/desktop) via
    // playwright.config.ts. The implementer produces the baselines for human approval.
    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    await expect(control).toHaveScreenshot('build-split-by-open.png');
  });
});

// --- XTF-24 — restrict split-by to single-select (select_one) columns -----------------
//
// Config with a MIX of main-table question types (none have a repeat_group, so they all
// currently appear in the split-by combobox). Only the `select_one`-family columns
// (select_one + select_one_from_file) may be offered as split-by options; every other
// type (select_multiple*, integer/decimal/range, text/note, gps/geo*, date*) is a valid
// main-table column but must be EXCLUDED, because splitting on it produces garbage.
const X24_SELECT_ONE = 'Region';            // type: select_one             → SHOULD appear
const X24_SELECT_ONE_FILE = 'District';     // type: select_one_from_file   → SHOULD appear
const X24_SELECT_MULTI = 'Skills';          // type: select_multiple        → must NOT appear
const X24_INTEGER = 'Age';                  // type: integer                → must NOT appear
const X24_TEXT = 'Respondent';              // type: text                   → must NOT appear
const X24_NOTE = 'Intro';                   // type: note                   → must NOT appear

// The full set of excluded main-table labels, all currently listed by the (unfixed) combo.
const X24_EXCLUDED = [X24_SELECT_MULTI, X24_INTEGER, X24_TEXT, X24_NOTE];
// The only labels the restricted dropdown may offer (plus the leading "No split" option).
const X24_ALLOWED = [X24_SELECT_ONE, X24_SELECT_ONE_FILE];
const NO_SPLIT_LABEL = 'No split — one combined report';

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

test.describe('XTF-24 — split-by restricted to single-select (select_one) columns', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page);
    // Override the bootstrap /api/config with the mixed-type config. Registered AFTER
    // stubBootstrap, so it wins (Playwright matches routes in reverse registration order).
    await page.route('**/api/config', (r) => r.fulfill({ json: { content: X24_CONFIG_YML } }));
  });

  test('the open dropdown offers ONLY select_one columns plus "No split"', async ({ page }) => {
    await gotoReports(page);

    // Open the combobox. The leading "No split" option is always present (and first).
    await openSplitBy(page);
    const visible = await visibleOptionTexts(page);

    // AC: "No split — one combined report" stays FIRST.
    expect(visible[0]).toBe(NO_SPLIT_LABEL);

    // AC: ONLY select_one-family columns are offered — the list is EXACTLY
    // ["No split …", "Region", "District"]. On current code every typed column is listed,
    // so this exact-set assertion fails → the correct red.
    expect(visible).toEqual([NO_SPLIT_LABEL, ...X24_ALLOWED]);
  });

  test('excluded-type main-table columns are absent from the dropdown', async ({ page }) => {
    await gotoReports(page);

    const { options } = await openSplitBy(page);

    // AC: the select_one + select_one_from_file columns ARE offered.
    await expect(options.filter({ hasText: X24_SELECT_ONE })).toHaveCount(1);
    await expect(options.filter({ hasText: X24_SELECT_ONE_FILE })).toHaveCount(1);

    // AC: select_multiple, integer, text, note columns are NOT offered, even though they
    // are main-table columns (no repeat_group). On current code each is listed → red.
    for (const label of X24_EXCLUDED) {
      await expect(options.filter({ hasText: label })).toHaveCount(0);
    }
  });

  test('XTF-17 typeahead still filters within the restricted (select_one) set', async ({ page }) => {
    await gotoReports(page);

    // Typing "reg" narrows to the single select_one match, "Region".
    await typeFilter(page, 'reg');
    await expect.poll(() => visibleOptionTexts(page)).toContain(X24_SELECT_ONE);
    let visible = await visibleOptionTexts(page);
    expect(visible).not.toContain(X24_SELECT_ONE_FILE);
    for (const label of X24_EXCLUDED) expect(visible).not.toContain(label);

    // A substring that only matches an EXCLUDED column ("age" → integer "Age") must yield
    // no column option — the excluded type never surfaces regardless of the filter text.
    await page.getByTestId('build-split-by').fill('');
    await typeFilter(page, 'age');
    visible = await visibleOptionTexts(page);
    expect(visible).not.toContain(X24_INTEGER);
  });

  test('visual baseline of the open dropdown with the restricted list', async ({ page }) => {
    await gotoReports(page);

    // Open the combobox so the screenshot captures the restricted (select_one-only) listbox.
    await openSplitBy(page);
    await expect.poll(() => visibleOptionTexts(page)).toContain(X24_SELECT_ONE);

    // One assertion → one baseline per viewport (mobile/tablet/desktop) via
    // playwright.config.ts. The implementer produces the baselines for human approval.
    const control = page.getByTestId('build-options');
    await expect(control).toBeVisible();
    await expect(control).toHaveScreenshot('build-options-split-by-select-one-open.png');
  });
});
