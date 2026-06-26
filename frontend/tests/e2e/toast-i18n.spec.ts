import { test, expect, Page } from '@playwright/test';

/**
 * MNT-4 — Toast must not crash when it renders.
 *
 * Regression guard for the i18n shadowing bug: ToastProvider destructured the
 * translation function as `t`, then `toasts.map(t => …)` shadowed it, so the
 * dismiss button's `t('components.toast.dismiss')` invoked the toast object as a
 * function → "TypeError: t is not a function", crashing the whole app whenever
 * any toast rendered (e.g. "Try with sample data", "Create project").
 *
 * Network-mocked, same harness as connection-gating.spec.ts. We fire a toast via
 * a real user action ("Try with sample data") and assert the app does not crash.
 */

const ACTIVE_PROJECT = { id: 'proj-1', name: 'Test Project', slug: 'test-project', role: 'admin', is_archived: false };
const CONFIG_YML = [
  'api:', '  platform: kobo', '  url: https://kf.kobotoolbox.org/api/v2', '  token: env:KOBO_TOKEN',
  'form:', '  uid: aXyZ123', '  alias: test', '',
].join('\n');
const MEMBERS = { members: [{ user_id: 'u-1', email: 'o@e.test', role: 'admin', is_owner: true }], invitations: [], my_role: 'admin' };

async function stub(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) => r.fulfill({ json: { sub: 'dev', email: 'dev@e.test', given_name: 'Dev', family_name: 'User', language: 'en' } }));
  await page.route('**/api/projects', (r) => r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/periods/date-range', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: { questions: [] } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) => r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/framework', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/projects/*/members', (r) => r.fulfill({ json: MEMBERS }));
  await page.route('**/api/run/**', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/sample-data', (r) => r.fulfill({ json: { ok: true } }));
  await page.route('**/api/sources/test', (r) => r.fulfill({ json: { ok: true, fields: 42 } }));
}

test('toast renders without crashing the app, with an accessible dismiss control', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await stub(page);
  await page.goto('http://localhost:51730/');
  await expect(page.locator('.tabs-bar .tab').first()).toBeVisible();

  // Trigger a toast via a real user action: load sample data on Connection.
  await page.locator('.tabs-bar [data-tab="extract"]').click();
  await page.locator('.subtabs-bar .subtab', { hasText: /connection/i }).click();
  await expect(page.locator('.platform-card').first()).toBeVisible();
  await page.locator('[data-testid="try-sample-data"]').click();

  // The toast must appear...
  const toast = page.locator('[role="status"], [role="alert"]').first();
  await expect(toast).toBeVisible();

  // ...its dismiss button must have a non-empty accessible name (the i18n t()
  // resolved correctly inside the map)...
  const dismiss = toast.getByRole('button');
  await expect(dismiss).toBeVisible();
  const name = (await dismiss.getAttribute('aria-label')) || '';
  expect(name.trim().length, 'dismiss button must expose a non-empty accessible name').toBeGreaterThan(0);

  // ...and the app must NOT have crashed (no uncaught error, root still populated).
  expect(pageErrors, `no uncaught page error — got: ${pageErrors.join(' | ')}`).toHaveLength(0);
  const rootLen = await page.evaluate(() => document.getElementById('root')?.innerHTML.length ?? 0);
  expect(rootLen, 'app root must still be rendered (not blanked)').toBeGreaterThan(100);
});
