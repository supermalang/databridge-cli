import { test, expect, Page, Locator } from '@playwright/test';

/**
 * PUX-2 — First-run / empty-state onboarding with a single recommended next action.
 *
 * Visual half of `frontend/tests/e2e/pux-2.spec.ts` (VIS-11 split): the
 * functional/AC assertions stay there; this file carries ONLY the extracted
 * visual baselines — verbatim bodies + the minimal shared setup they need —
 * run under the dedicated Tier 1 visual config
 * (`visual-review/playwright.visual.config.ts`).
 *
 * AC 5 (PUX-2): visual baselines of BOTH the first-run state and the
 * returning-user state, one per viewport. Plus the A11Y-6 baseline of a
 * focused dimmed stage card (added to this same file upstream).
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
  '  alias: test',
  '',
].join('\n');

type Readiness = { has_questions: boolean; has_data: boolean };

async function stubBootstrap(page: Page, readiness: Readiness) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({
      json: {
        has_questions: readiness.has_questions,
        has_data: readiness.has_data,
        has_templates: false,
        has_ai: false,
      },
    }));
}

async function gotoHome(page: Page) {
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.home-card').first()).toBeVisible();
}

const connectCta = (page: Page) =>
  page.getByRole('button', { name: /connect your form/i })
    .or(page.getByRole('link', { name: /connect your form/i }));

async function tabUntilFocused(page: Page, target: Locator, maxTabs = 25): Promise<boolean> {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  const handle = await target.elementHandle();
  if (!handle) return false;
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate((el) => el === document.activeElement, handle).catch(() => false);
    if (focused) return true;
  }
  return false;
}

test.describe('PUX-2 / A11Y-6 — visual baselines of the first-run state', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, { has_questions: false, has_data: false });
    await gotoHome(page);
  });

  // Visual baseline of a focused dimmed card at all three viewports — gate on the AC
  // (the wrap is un-dimmed under focus) so the baseline captures the fixed state.
  test('visual baseline of a focused dimmed stage card', async ({ page }) => {
    const dimmedWrap = page.locator('.home-card-wrap.is-dimmed').first();
    await expect(dimmedWrap).toBeVisible();
    const innerCard = dimmedWrap.locator('.home-card').first();
    const reached = await tabUntilFocused(page, innerCard);
    expect(reached, 'the dimmed stage card must be reachable in keyboard tab order').toBe(true);
    await expect(Number(await dimmedWrap.evaluate((el) => getComputedStyle(el).opacity)))
      .toBeCloseTo(1, 2);
    await expect(dimmedWrap).toHaveScreenshot('a11y6-focused-dimmed-card.png');
  });

  // Visual baseline of the first-run state. Gate on the AC (the single CTA is present)
  // so the baseline is not captured vacuously from the pre-fix five-equal-cards view.
  test('visual baseline of the first-run state', async ({ page }) => {
    await expect(connectCta(page), 'first-run CTA must exist before the baseline is captured').toBeVisible();
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux2-firstrun-home.png');
  });
});

test.describe('PUX-2 — visual baseline of the returning-user state', () => {
  test.beforeEach(async ({ page }) => {
    await stubBootstrap(page, { has_questions: true, has_data: true });
    await gotoHome(page);
  });

  test('visual baseline of the returning-user state', async ({ page }) => {
    await expect(page.locator('.home-card')).toHaveCount(5);
    await expect(connectCta(page), 'returning-user view must have no first-run CTA before baseline').toHaveCount(0);
    await expect(page.locator('.home-cards')).toHaveScreenshot('pux2-returning-home.png');
  });
});
