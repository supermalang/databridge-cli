import { test, expect, Page } from '@playwright/test';

/**
 * ME-6 — Surface below-threshold indicators in the Validate panel.
 *
 * Acceptance criteria tested:
 *   - A below-threshold indicator finding renders in the Validate panel
 *     with its RAG severity (warning/critical).
 *   - The finding shows the indicator name and a descriptive message.
 *   - The "indicator" badge renders instead of "0 rows".
 *   - Visual baseline at three viewports (mobile/tablet/desktop).
 *
 * Network-mocked: every /api/** is intercepted with page.route().
 */

const ACTIVE_PROJECT = {
  id: 'proj-1', name: 'Test Project', slug: 'test-project',
  role: 'admin', is_archived: false,
};

const CONFIG_YML = 'form:\n  alias: test\napi:\n  url: https://kf.kobotoolbox.org/api/v2\n  token: env:KOBO_TOKEN\n';

const QUESTIONS = {
  questions: [
    { kobo_key: 'Count', label: 'Count', export_label: 'Count', type: 'integer', category: 'quantitative', group: '' },
  ],
};

const VALIDATE_REPORT_WITH_THRESHOLD = {
  n_rows: 10,
  n_columns: 1,
  checks: [
    {
      kind: 'below_threshold',
      column: 'coverage',
      severity: 'warning',
      message: "Indicator 'coverage' is at 10% of target 100; actual: 10 — status: warning",
      count: 0,
      pct: 0.0,
      examples: ['target: 100', 'actual: 10', 'achievement: 10%'],
    },
    {
      kind: 'below_threshold',
      column: 'reach',
      severity: 'critical',
      message: "Indicator 'reach' is at 5% of target 1000; actual: 50 — status: critical",
      count: 0,
      pct: 0.0,
      examples: ['target: 1000', 'actual: 50', 'achievement: 5%'],
    },
  ],
};

async function stubBootstrap(page: Page) {
  await page.route('**/api/**', (r) => r.fulfill({ json: {} }));
  await page.route('**/api/me', (r) =>
    r.fulfill({ json: { sub: 'dev', email: 'dev@example.test', given_name: 'Dev', family_name: 'User' } }));
  await page.route('**/api/projects', (r) =>
    r.fulfill({ json: { active_id: ACTIVE_PROJECT.id, is_superadmin: false, projects: [ACTIVE_PROJECT] } }));
  await page.route('**/api/periods', (r) => r.fulfill({ json: { current: null, registry: [] } }));
  await page.route('**/api/config', (r) => r.fulfill({ json: { content: CONFIG_YML } }));
  await page.route('**/api/ai/status', (r) => r.fulfill({ json: { configured: false, verified: false } }));
  await page.route('**/api/state', (r) =>
    r.fulfill({ json: { has_questions: true, has_data: true, has_templates: false, has_ai: false } }));
  await page.route('**/api/data/sessions', (r) => r.fulfill({ json: { sessions: [] } }));
  await page.route('**/api/templates', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/templates/active', (r) => r.fulfill({ json: { active: null } }));
  await page.route('**/api/reports', (r) => r.fulfill({ json: { files: [] } }));
  await page.route('**/api/validate', (r) => r.fulfill({ json: VALIDATE_REPORT_WITH_THRESHOLD }));
  await page.route('**/api/questions', (r) => r.fulfill({ json: QUESTIONS }));
}

async function gotoValidate(page: Page) {
  await page.goto('http://localhost:51730/');
  await page.waitForLoadState('networkidle');
  // Use data-tab / ARIA id — stable, i18n-independent selectors.
  await page.locator('.tabs-bar [data-tab="transform"]').click();
  await page.locator('#tab-sub-validate').click();
}

async function waitForFindings(page: Page) {
  // Validate auto-runs on mount — just wait for the first finding to appear.
  await expect(page.locator('.validate-finding').first()).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// AC: threshold finding renders with correct severity
// ---------------------------------------------------------------------------

test('warning threshold finding renders with warning severity', async ({ page }) => {
  await stubBootstrap(page);
  await gotoValidate(page);
  await waitForFindings(page);

  const warningFinding = page.locator('.validate-finding[data-severity="warning"]').filter({ hasText: 'coverage' });
  await expect(warningFinding).toBeVisible();
  await expect(warningFinding.locator('.validate-finding__sev')).toHaveText('warning');
});

test('critical threshold finding renders with critical severity', async ({ page }) => {
  await stubBootstrap(page);
  await gotoValidate(page);
  await waitForFindings(page);

  const criticalFinding = page.locator('.validate-finding[data-severity="critical"]').filter({ hasText: 'reach' });
  await expect(criticalFinding).toBeVisible();
  await expect(criticalFinding.locator('.validate-finding__sev')).toHaveText('critical');
});

test('threshold finding shows "indicator" badge not row count', async ({ page }) => {
  await stubBootstrap(page);
  await gotoValidate(page);
  await waitForFindings(page);

  const finding = page.locator('.validate-finding').filter({ hasText: 'coverage' });
  await expect(finding.locator('.validate-finding__indicator-badge')).toBeVisible();
  await expect(finding.locator('.validate-finding__indicator-badge')).toHaveText('indicator');
});

test('threshold finding message describes target, actual, and status', async ({ page }) => {
  await stubBootstrap(page);
  await gotoValidate(page);
  await waitForFindings(page);

  const finding = page.locator('.validate-finding').filter({ hasText: 'coverage' });
  await expect(finding.locator('.validate-finding__msg')).toContainText('target');
  await expect(finding.locator('.validate-finding__msg')).toContainText('actual');
});

// ---------------------------------------------------------------------------
// Visual baseline — 3 viewports
// ---------------------------------------------------------------------------

const VIEWPORTS = [
  { name: 'mobile',   width: 390,  height: 844  },
  { name: 'tablet',   width: 820,  height: 1180 },
  { name: 'desktop',  width: 1440, height: 900  },
];

for (const vp of VIEWPORTS) {
  test(`visual: validate panel with threshold findings — ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await stubBootstrap(page);
    await gotoValidate(page);
    await waitForFindings(page);
    // Ensure both findings are visible before screenshotting.
    await expect(page.locator('.validate-finding').nth(1)).toBeVisible();
    await expect(page.locator('.page:visible')).toHaveScreenshot(
      `validate-thresholds-${vp.name}-linux.png`,
    );
  });
}
