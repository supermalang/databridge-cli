import { test, expect, Page } from '@playwright/test';

/**
 * PERF-3 — Per-page skeleton loaders for the data-driven tabs (perceived performance).
 *
 * Visual half of `frontend/tests/e2e/perf-3-skeleton.spec.ts` (VIS-11 split):
 * the functional/AC assertions stay there; this file carries ONLY the
 * extracted visual baselines — verbatim bodies + the minimal shared setup they
 * need — run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * ANIMATION NOTE: the skeleton has a live shimmer CSS animation. The dedicated
 * Tier 1 visual config freezes animations before each screenshot
 * (`expect.toHaveScreenshot.animations: 'disabled'`), which the OLD
 * `frontend/playwright.config.ts` did not do — so these two baselines were
 * NOT moved verbatim; they were regenerated under the new config and must be
 * human-re-approved (per the VIS-11 AC's animation-affected-spec carve-out).
 *
 * AC 7: baselines of a Questions skeleton and a Profile skeleton at all three
 * viewports; a human approves them.
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

const QUESTIONS = {
  questions: [
    { kobo_key: 'group_a/age', label: 'Respondent age', export_label: 'age', type: 'integer', category: 'quantitative', group: 'group_a' },
    { kobo_key: 'group_a/region', label: 'Region of residence', export_label: 'region', type: 'select_one', category: 'categorical', group: 'group_a' },
  ],
};

const PROFILE = {
  profiles: [
    {
      name: 'main',
      rows: 100,
      columns: [
        { name: 'age', role: 'quantitative', distinct: 50 },
        { name: 'region', role: 'categorical', distinct: 5 },
      ],
    },
  ],
};

function makeGate() {
  let release!: () => void;
  const opened = new Promise<void>((res) => { release = res; });
  return { opened, release };
}

async function stubBootstrap(
  page: Page,
  gates: { questions?: Promise<void>; profile?: Promise<void> } = {},
) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: { n_rows: 0, n_columns: 0, checks: [] } }));
  await page.route('**/api/projects/*/members', (r) =>
    r.fulfill({ json: { members: [], invitations: [], my_role: 'admin' } }));

  await page.route('**/api/questions', async (r) => {
    if (gates.questions) await gates.questions;
    await r.fulfill({ json: QUESTIONS });
  });
  await page.route('**/api/profile', async (r) => {
    if (gates.profile) await gates.profile;
    await r.fulfill({ json: PROFILE });
  });
}

async function gotoApp(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();
}

async function openTransformSub(page: Page, sub: RegExp) {
  await page.locator('.tabs-bar [data-tab="transform"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: sub }).click();
}

const skeleton = (page: Page) => page.locator('[data-testid="skeleton"]');
const plainLoading = (page: Page) => page.locator('.empty-state', { hasText: /loading|loading…|chargement/i });

async function hideTerminal(page: Page) {
  await page.addStyleTag({ content: '.bottom-term{display:none!important}' });
}

test.describe('PERF-3 — visual baselines of the skeleton states (3 viewports)', () => {
  test('visual baseline — Questions skeleton', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { questions: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /questions/i);

    await expect(skeleton(page).first()).toBeVisible();
    await expect(plainLoading(page)).toHaveCount(0);
    await hideTerminal(page);
    await expect(page.locator('.page:visible')).toHaveScreenshot('perf3-questions-skeleton.png');

    gate.release();
  });

  test('visual baseline — Profile skeleton', async ({ page }) => {
    const gate = makeGate();
    await stubBootstrap(page, { profile: gate.opened });
    await gotoApp(page);
    await openTransformSub(page, /^profile$/i);

    await expect(skeleton(page).first()).toBeVisible();
    await expect(plainLoading(page)).toHaveCount(0);
    await hideTerminal(page);
    await expect(page.locator('.page:visible')).toHaveScreenshot('perf3-profile-skeleton.png');

    gate.release();
  });
});
