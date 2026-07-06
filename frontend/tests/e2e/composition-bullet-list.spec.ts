import { test, expect, Page, Locator } from '@playwright/test';

/**
 * MNT-25 — Composition UI migration to a first-class Lists section.
 *
 * `bullet_list` used to live as a hidden sub-type of the regular Chart editor
 * (`kind="chart"`, `type="bullet_list"` — see the retired XTF-27/MNT-21 tests this file
 * replaces). MNT-23 promoted `list` to a genuine first-class kind with its own
 * `cfg['lists']` config section (backend-only). This card gives it its own Composition
 * UI surface — a "Lists" card mirroring `TablesCard`/`IndicatorsCard` — and retires
 * `bullet_list` from the regular chart-type dropdown.
 *
 * Per the card:
 *   - `bullet_list` no longer appears in the chart-type dropdown when adding/editing a
 *     chart in Composition.
 *   - A new "Lists" card exists, grouped with Tables under the Advanced/progressive-
 *     disclosure toggle (PUX-3), listing existing `cfg['lists']` entries with
 *     add/edit/remove actions.
 *   - Creating a list via the new modal (name, title, question, optional filter) saves
 *     it into `cfg['lists']`, round-trips on reload, and renders correctly at
 *     build-report time (this file exercises the frontend persistence half; the
 *     render-at-build-time half is covered by `tests/test_lists_section.py`, MNT-23).
 *   - Dirty-tracking and Save correctly include the `lists` section — unsaved list
 *     changes trigger the SAME "unsaved changes" guard as other sections. That guard is
 *     the existing page-level "Save changes" button in `.page-header__actions`
 *     (confirmed here against the TablesCard/IndicatorsCard behavior already shipped
 *     on this page): it renders `disabled` with `title="No unsaved changes"` while the
 *     in-memory config is pristine, and becomes an enabled `.btn-primary` (empty title)
 *     the moment ANY section (including a newly-added list) is edited. Saving PUTs/POSTs
 *     `{ content: <yaml> }` to `/api/config` and the button returns to its pristine state.
 *   - No regression to any other Composition section (charts, indicators, tables,
 *     summaries).
 *
 * NETWORK-MOCKED: Vite serves the real SPA; every /api/** call is intercepted with
 * page.route(), so no FastAPI backend is required. Same harness pattern as
 * composition-progressive.spec.ts / chart-editor.spec.ts.
 *
 * RED-FIRST: derived from the MNT-25 Acceptance criteria, NOT the current
 * implementation. Today: `bullet_list` IS still a selectable `<option>` in the chart-type
 * dropdown, there is no "Lists" card anywhere on the page (so every `cardByTitle(page,
 * 'Lists')` locator resolves to zero elements), and there is no `ListModal`. Every
 * assertion below is expected to fail until MNT-25 ships.
 *
 * ── Selector contract for the implementer ──────────────────────────────────────────
 * Mirror the existing TablesCard/IndicatorsCard conventions exactly so this spec turns
 * green without edits:
 *   - Lists card: `.comp-card` with `.comp-card__title` text "Lists", grouped inside the
 *     same `data-testid="composition-advanced"` region as Tables (PUX-3), collapsed by
 *     default along with it.
 *   - "+ Add list" control: a button inside the Lists card matching /add list/i.
 *   - Each list row exposes `.icon-btn[title="Edit"]` and `.icon-btn[title="Delete"]`,
 *     exactly like the Tables/Indicators rows.
 *   - Deleting a row opens the SAME confirm-dialog pattern already used for tables
 *     (`.modal[role="dialog"]` titled "Delete list?" with a `.btn-danger` "Delete" and a
 *     `.btn-ghost` "Cancel").
 *   - ListModal fields (mirroring TableModal/IndicatorModal `aria-label` conventions):
 *       `aria-label="List name"`, `aria-label="List title"`, `aria-label="List question"`
 *       (single-column picker — a text input or native <select> is fine, `getByLabel`
 *       works for both), `aria-label="List filter"` (optional, plain text input for a
 *       pandas `.query()` expression). Save/Cancel buttons follow the shared Modal
 *       footer convention (`.btn-primary` / `.btn-ghost`).
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The visual baseline (Lists card revealed under Advanced + the Add/Edit list modal, at
 * all three viewports) was extracted to
 * `visual-review/specs/composition-bullet-list.visual.spec.ts` (VIS-11 split
 * convention). The 6 previously human-approved `chart-type-dropdown` baselines under
 * `visual-review/baselines/composition-bullet-list.visual.spec.ts/` are retired along
 * with the old bullet_list-in-dropdown behavior; fresh baselines are captured for the
 * new Lists UI and require new human approval.
 */

const ACTIVE_PROJECT = {
  id: 'proj-1',
  name: 'Test Project',
  slug: 'test-project',
  role: 'admin',
  is_archived: false,
};

// One pre-existing list (`success_stories`) so "list existing entries" assertions are
// non-vacuous, plus a chart + a table so charts/indicators/tables regression checks and
// the "chart-type dropdown" checks have something concrete to exercise.
const baseConfigYaml = () => [
  'api:',
  '  url: https://kobo.example.test',
  '  token: env:KOBO_TOKEN',
  'form:',
  '  uid: aXyZ123',
  '  alias: test',
  'charts:',
  '  - name: age_hist',
  '    title: Age distribution',
  '    type: histogram',
  '    questions: [age]',
  'tables:',
  '  - name: by_region',
  '    questions: [region]',
  'lists:',
  '  - name: success_stories',
  '    title: Success stories',
  '    question: Story',
  '',
].join('\n');

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative' },
    { kobo_key: 'group_a/region', label: 'Region', export_label: 'region', type: 'select_one', category: 'categorical' },
    { kobo_key: 'group_a/story', label: 'Success story', export_label: 'Story', type: 'text', category: 'qualitative' },
    { kobo_key: 'group_a/partner', label: 'Partner name', export_label: 'Partner_name', type: 'text', category: 'qualitative' },
  ],
};

// Mutable holder so the /api/config mock can behave statelessly-but-consistently:
// GETs return whatever was last PUT/POSTed, letting a reload prove a true round-trip.
type ConfigState = { yaml: string; puts: string[] };

async function stubBootstrap(page: Page, state: ConfigState) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', async (r) => {
    const method = r.request().method();
    if (method === 'PUT' || method === 'POST') {
      let content = '';
      try {
        content = (r.request().postDataJSON() as { content?: string })?.content || '';
      } catch {
        content = '';
      }
      state.puts.push(content);
      if (content) state.yaml = content;
      return r.fulfill({ json: { ok: true } });
    }
    return r.fulfill({ json: { content: state.yaml } });
  });
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: true, verified: true } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: true } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/indicators/preview', (r) => r.fulfill({ json: { value: 0 } }));
  await page.route('**/api/charts/preview', (r) =>
    r.fulfill({ json: { image: Buffer.from('fake-png').toString('base64') } }));
}

async function bootApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.getByText('Test Project').first()).toBeVisible();
}

async function gotoStage(page: Page, stageId: string) {
  await page.locator(`.tabs-bar [data-tab="${stageId}"]`).click();
}
async function gotoSub(page: Page, label: string) {
  await page.locator('.subtabs-bar .subtab', { hasText: label }).click();
}

async function openComposition(page: Page) {
  await gotoStage(page, 'analyze');
  await gotoSub(page, 'Charts & indicators');
  await expect(page.locator('.comp-card').first()).toBeVisible();
}

const cardByTitle = (page: Page, title: string): Locator =>
  page.locator('.comp-card', { has: page.locator('.comp-card__title', { hasText: title }) });

const advancedToggle = (page: Page): Locator => page.getByTestId('composition-advanced-toggle');
const advancedRegion = (page: Page): Locator => page.getByTestId('composition-advanced');

const chartsCard = (page: Page): Locator => cardByTitle(page, 'Charts');
const listsCard = (page: Page): Locator => cardByTitle(page, 'Lists');

const editorDialog = (page: Page): Locator => page.locator('.modal[role="dialog"]');

// The page-level "Save changes" affordance — the SAME dirty-tracking guard already
// governing charts/indicators/tables/summaries on this page.
const saveChangesButton = (page: Page): Locator => page.getByRole('button', { name: /save changes/i });

async function expectPristine(page: Page) {
  const btn = saveChangesButton(page);
  await expect(btn, 'Save changes must be disabled while the config is pristine').toBeDisabled();
}

async function expectDirty(page: Page) {
  const btn = saveChangesButton(page);
  await expect(btn, 'Save changes must become enabled once a section is dirty').toBeEnabled();
}

async function expandAdvanced(page: Page) {
  const toggle = advancedToggle(page);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  await expect(advancedRegion(page)).toBeVisible();
}

async function openAddChartModal(page: Page) {
  await chartsCard(page).getByRole('button', { name: /add chart/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

async function openEditChartModal(page: Page) {
  await chartsCard(page).locator('.icon-btn[title="Edit"]').first().click();
  await expect(editorDialog(page)).toBeVisible();
}

async function openAddListModal(page: Page) {
  await listsCard(page).getByRole('button', { name: /add list/i }).click();
  await expect(editorDialog(page)).toBeVisible();
}

test.describe('MNT-25 — bullet_list retired from the chart-type dropdown', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
  });

  // AC1 — Add chart modal.
  test('AC1: bullet_list is absent from the Chart type dropdown when adding a chart', async ({ page }) => {
    await openAddChartModal(page);
    const typeSelect = editorDialog(page).getByLabel('Chart type');
    await expect(typeSelect).toBeVisible();
    await expect(
      typeSelect.locator('option[value="bullet_list"]'),
      'bullet_list must no longer be a selectable <option> in the Add-chart Chart type dropdown',
    ).toHaveCount(0);
  });

  // AC1 — Edit chart modal (the AC explicitly says "adding/editing").
  test('AC1: bullet_list is absent from the Chart type dropdown when editing a chart', async ({ page }) => {
    await openEditChartModal(page);
    const typeSelect = editorDialog(page).getByLabel('Chart type');
    await expect(typeSelect).toBeVisible();
    await expect(
      typeSelect.locator('option[value="bullet_list"]'),
      'bullet_list must no longer be a selectable <option> in the Edit-chart Chart type dropdown',
    ).toHaveCount(0);
  });
});

test.describe('MNT-25 — a first-class Lists card grouped with Tables under Advanced', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
  });

  // AC2 — Lists is collapsed by default, same as Tables (PUX-3 precedent).
  test('AC2: the Lists card is not visible on first view (collapsed behind Advanced)', async ({ page }) => {
    await expect(advancedToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(listsCard(page), 'Lists card must not be visible by default').toBeHidden();
  });

  // AC2 — expanding Advanced reveals Lists alongside Tables.
  test('AC2: expanding Advanced reveals the Lists card alongside Tables', async ({ page }) => {
    await expandAdvanced(page);
    const region = advancedRegion(page);
    await expect(region.locator('.comp-card__title', { hasText: 'Lists' }), 'Lists card must be revealed').toBeVisible();
    await expect(region.locator('.comp-card__title', { hasText: 'Tables' }), 'Tables card must still be revealed').toBeVisible();
  });

  // AC2 — existing cfg['lists'] entries are listed with edit/remove actions.
  test('AC2: existing cfg[lists] entries render with edit and remove actions', async ({ page }) => {
    await expandAdvanced(page);
    const card = listsCard(page);
    await expect(card.getByText('success_stories'), 'the seeded list entry must render by name').toBeVisible();
    const row = card.locator('.comp-row', { hasText: 'success_stories' }).first();
    await expect(row.locator('.icon-btn[title="Edit"]'), 'each list row must expose an Edit action').toHaveCount(1);
    await expect(row.locator('.icon-btn[title="Delete"]'), 'each list row must expose a Delete/remove action').toHaveCount(1);
  });

  // Regression guard — Charts and Indicators are unaffected, and are NOT nested inside Advanced.
  test('no regression: Charts + Indicators remain primary and outside the Advanced region', async ({ page }) => {
    await expect(chartsCard(page)).toBeVisible();
    await expect(cardByTitle(page, 'Indicators')).toBeVisible();
    await expect(
      advancedRegion(page).locator('.comp-card__title', { hasText: 'Charts' }),
    ).toHaveCount(0);
  });

  // Folded in from this card's own ux-review round: the right-rail Status card must
  // show a "N lists" line once lists are configured (mirroring every sibling
  // section), but must NOT gain a broken "Suggest lists" AI quick-action — there is
  // no suggest-lists CLI command, unlike charts/indicators/tables/summaries/views.
  test('status rail shows "N lists" and does not add a Suggest-lists quick action', async ({ page }) => {
    await expect(page.locator('.check-list__label', { hasText: /lists$/ })).toHaveText('1 lists');
    await expect(page.locator('.rail-action', { hasText: /suggest lists/i })).toHaveCount(0);
  });
});

test.describe('MNT-25 — creating a list via the ListModal', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
    await expandAdvanced(page);
  });

  // AC3/AC4 — filling the modal and saving adds the row and dirties the page-level guard.
  test('AC3/AC4: adding a list (name/title/question/filter) shows it in the card and dirties Save changes', async ({ page }) => {
    await expectPristine(page);

    await openAddListModal(page);
    const dialog = editorDialog(page);
    await dialog.getByLabel('List name').fill('partner_list');
    await dialog.getByLabel('List title').fill('Partner organizations');
    await dialog.getByLabel('List question').fill('Partner_name');
    const filterField = dialog.getByLabel('List filter');
    if ((await filterField.count()) > 0) {
      await filterField.fill("Region == 'North'");
    }
    await dialog.locator('.btn-primary').click();
    await expect(dialog, 'the ListModal must close after Save').toHaveCount(0);

    await expect(listsCard(page).getByText('partner_list'), 'the new list must appear in the Lists card').toBeVisible();
    await expectDirty(page);
  });

  // AC4 — the modal is a real form: Cancel must NOT create a row or dirty the page.
  test('Cancel does not create a list or dirty the page', async ({ page }) => {
    await expectPristine(page);
    await openAddListModal(page);
    const dialog = editorDialog(page);
    await dialog.getByLabel('List name').fill('should_not_persist');
    await dialog.locator('.btn-ghost', { hasText: /cancel/i }).click();
    await expect(dialog).toHaveCount(0);
    await expect(listsCard(page).getByText('should_not_persist')).toHaveCount(0);
    await expectPristine(page);
  });
});

test.describe('MNT-25 — saving persists cfg[lists] and round-trips on reload', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
    await expandAdvanced(page);
  });

  // AC3 — Save changes PUTs/POSTs a `lists:` section containing the new entry.
  test('AC3: clicking Save changes persists the new list into cfg[lists]', async ({ page }) => {
    await openAddListModal(page);
    const dialog = editorDialog(page);
    await dialog.getByLabel('List name').fill('partner_list');
    await dialog.getByLabel('List title').fill('Partner organizations');
    await dialog.getByLabel('List question').fill('Partner_name');
    await dialog.locator('.btn-primary').click();
    await expect(dialog).toHaveCount(0);

    await expectDirty(page);
    await saveChangesButton(page).click();

    await expect(async () => {
      expect(state.puts.length, 'Save changes must PUT/POST the updated config').toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });

    const savedYaml = state.puts[state.puts.length - 1];
    expect(savedYaml, 'the saved config must contain a lists: section').toMatch(/lists:/);
    expect(savedYaml, 'the saved config must contain the new list entry name').toMatch(/partner_list/);
    expect(savedYaml, 'the saved config must reference the chosen question').toMatch(/Partner_name/);

    // The save guard returns to pristine after a successful save.
    await expectPristine(page);
  });

  // AC3 — round-trips on reload: a freshly-loaded page shows both the pre-existing and
  // the newly-added list.
  test('AC3: the new list round-trips after Save changes + reload', async ({ page }) => {
    await openAddListModal(page);
    const dialog = editorDialog(page);
    await dialog.getByLabel('List name').fill('partner_list');
    await dialog.getByLabel('List title').fill('Partner organizations');
    await dialog.getByLabel('List question').fill('Partner_name');
    await dialog.locator('.btn-primary').click();
    await expect(dialog).toHaveCount(0);
    await saveChangesButton(page).click();
    await expect(async () => {
      expect(state.puts.length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });

    await page.reload();
    await expect(page.getByText('Test Project').first()).toBeVisible();
    await openComposition(page);
    await expandAdvanced(page);

    await expect(listsCard(page).getByText('success_stories'), 'the pre-existing list must still be present').toBeVisible();
    await expect(listsCard(page).getByText('partner_list'), 'the newly-saved list must survive a reload').toBeVisible();
  });
});

test.describe('MNT-25 — editing an existing list', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
    await expandAdvanced(page);
  });

  // AC2 — the Edit action opens the ListModal pre-filled, and saving a change updates
  // the row + dirties the page.
  test('editing a list pre-fills the modal and saves the change', async ({ page }) => {
    await expectPristine(page);

    const row = listsCard(page).locator('.comp-row', { hasText: 'success_stories' }).first();
    await row.locator('.icon-btn[title="Edit"]').click();
    const dialog = editorDialog(page);
    await expect(dialog).toBeVisible();

    await expect(dialog.getByLabel('List name'), 'the Name field must be pre-filled').toHaveValue('success_stories');
    await expect(dialog.getByLabel('List title'), 'the Title field must be pre-filled').toHaveValue('Success stories');

    await dialog.getByLabel('List title').fill('Success stories (updated)');
    await dialog.locator('.btn-primary').click();
    await expect(dialog).toHaveCount(0);

    await expect(
      listsCard(page).getByText('Success stories (updated)'),
      'the updated title must be reflected in the Lists card',
    ).toBeVisible();
    await expectDirty(page);
  });
});

test.describe('MNT-25 — removing a list', () => {
  let state: ConfigState;
  test.beforeEach(async ({ page }) => {
    state = { yaml: baseConfigYaml(), puts: [] };
    await stubBootstrap(page, state);
    await bootApp(page);
    await openComposition(page);
    await expandAdvanced(page);
  });

  // AC2 — the Delete action removes the row (after confirmation) and dirties the page;
  // saving persists the removal.
  test('deleting a list removes it from the card, dirties Save changes, and persists on save', async ({ page }) => {
    await expectPristine(page);

    const row = listsCard(page).locator('.comp-row', { hasText: 'success_stories' }).first();
    await row.locator('.icon-btn[title="Delete"]').click();

    // Confirmation dialog (same pattern as Tables' "Delete table?").
    const confirmDialog = page.locator('.modal[role="dialog"]', { hasText: /delete/i });
    await expect(confirmDialog, 'deleting a list must ask for confirmation, mirroring the Tables delete flow').toBeVisible();
    await confirmDialog.locator('.btn-danger', { hasText: /delete/i }).click();
    await expect(confirmDialog).toHaveCount(0);

    await expect(listsCard(page).getByText('success_stories'), 'the deleted list must no longer render').toHaveCount(0);
    await expectDirty(page);

    await saveChangesButton(page).click();
    await expect(async () => {
      expect(state.puts.length).toBeGreaterThan(0);
    }).toPass({ timeout: 3000 });
    const savedYaml = state.puts[state.puts.length - 1];
    expect(savedYaml, 'the removed list must not be present in the saved config').not.toMatch(/success_stories/);
  });
});
