import { defineConfig } from '@playwright/test';

/**
 * Storybook component-isolation visual baselines (Tier 2 — VIS-4).
 *
 * Relocated from frontend/playwright.storybook.config.ts (VIS-13) to sit alongside
 * ./playwright.visual.config.ts (Tier 1, VIS-9) under visual-review/, completing the
 * directory contract: every visual-testing tier's config, specs, and baselines now
 * live under one root instead of scattered through frontend/.
 *
 * Separate from playwright.visual.config.ts (Tier 1) and frontend/playwright.config.ts
 * (the main app functional+visual E2E harness) so this repo's CI-critical suites are
 * never at risk from Storybook build issues — this config screenshots a STATIC
 * Storybook build ("visual-review/storybook/static", produced by
 * `npm run storybook:build`) instead of the live Vite dev server, so no app
 * backend/dev-server is needed. Same three viewport projects + tolerance as the
 * other configs, so baselines are directly comparable.
 *
 * Workers hardcoded to 1 (VIS-8 carried forward at this relocated path) — this repo's
 * full-suite worker contention showed crash-class failures at a flat worker count of 4.
 *
 * Run: cd frontend && npm run storybook:build && npm run test:visual:storybook
 */
export default defineConfig({
  testDir: './storybook/specs',
  snapshotDir: 'storybook/baselines',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  outputDir: 'results/storybook/output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: 'results/storybook/report' }], ['list']]
    : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { browserName: 'chromium', baseURL: 'http://localhost:6006' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx http-server storybook/static -p 6006 -s',
    url: 'http://localhost:6006',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
