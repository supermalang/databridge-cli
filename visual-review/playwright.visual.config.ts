import path from 'node:path';
import { defineConfig } from '@playwright/test';
// Installs `CSS.escape` in the Node test runtime (browser-only global, absent in
// Node) so id-based locators using `CSS.escape(id)` work — React's useId() emits
// ids with `:` that must be escaped. Shared with frontend/playwright.config.ts —
// imported here, not duplicated.
import '../frontend/tests/e2e/css-escape-polyfill';

const frontendDir = path.resolve(__dirname, '../frontend');

/**
 * Tier 1 dedicated visual-only harness (VIS-9).
 *
 * Distinct from frontend/playwright.config.ts (which still runs functional E2E +
 * visual assertions together under frontend/tests/e2e/). This config runs ONLY
 * the visual specs under ./specs, snapshotting against ./baselines, and writing
 * run output/reports under ./results — the target contract this repo is
 * migrating toward (VIS-10/11/12 bulk-split the remaining specs onto this
 * config; VIS-13 relocates the Tier 2 Storybook config alongside it).
 *
 * Three viewport projects — mobile, tablet, desktop — so every visual spec's
 * `toHaveScreenshot` assertion produces one baseline per device class.
 * snapshotPathTemplate includes the {projectName} token so the three viewports
 * never collide on one filename (the platform token alone is constant across
 * projects on one machine).
 *
 * Invoke via: cd frontend && npx playwright test --config=../visual-review/playwright.visual.config.ts
 */
export default defineConfig({
  testDir: './specs',
  snapshotDir: 'baselines',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  outputDir: 'results/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : '50%',
  reporter: [['html', { outputFolder: 'results/report' }], ['list']],
  // Small tolerance absorbs sub-pixel font/antialiasing noise without hiding real regressions.
  // animations: 'disabled' freezes CSS animations/transitions before each screenshot.
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 } },
  use: { browserName: 'chromium' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npm run dev',
    cwd: frontendDir,
    url: 'http://localhost:51730',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
