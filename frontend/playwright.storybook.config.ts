import { defineConfig } from '@playwright/test';

/**
 * Storybook component-isolation visual baselines (Tier 2 — VIS-4).
 *
 * Separate from playwright.config.ts (the main app E2E harness, VIS-1) so this
 * repo's CI-critical suite is never at risk from Storybook build issues — this
 * config screenshots a STATIC Storybook build ("storybook-static", produced by
 * `npm run storybook:build`) instead of the live Vite dev server, so no app
 * backend/dev-server is needed. Same three viewport projects + tolerance as the
 * main config, so baselines are directly comparable.
 *
 * Run: npm run storybook:build && npm run test:visual:storybook
 */
export default defineConfig({
  testDir: './tests/storybook',
  testMatch: /.*\.visual\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  reporter: process.env.CI ? [['html', { open: 'never', outputFolder: 'playwright-report-storybook' }], ['list']] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { browserName: 'chromium', baseURL: 'http://localhost:6006' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx http-server storybook-static -p 6006 -s',
    url: 'http://localhost:6006',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
