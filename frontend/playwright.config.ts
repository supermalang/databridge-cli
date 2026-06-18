import { defineConfig } from '@playwright/test';

/**
 * Visual / E2E harness (VIS-1).
 *
 * Three viewport projects — mobile, tablet, desktop — so every UI card's
 * `toHaveScreenshot` assertion produces one baseline per device class. The
 * project name is baked into the baseline filename, so the three never collide.
 *
 * For specs that drive the real app (XTF-5, UX-*), enable the `webServer` block
 * below to boot Vite; harness/fixture specs that use `page.setContent` need no
 * server and stay deterministic.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  // Small tolerance absorbs sub-pixel font/antialiasing noise without hiding real regressions.
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { browserName: 'chromium' },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
  ],
  // App-driven specs (XTF-5, UX-*) boot Vite. The spec stubs every /api/** call
  // with page.route(), so no FastAPI backend is required — Vite serves the SPA
  // and all network is intercepted in-page.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:51730',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
