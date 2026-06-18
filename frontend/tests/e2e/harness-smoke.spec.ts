import { test, expect } from '@playwright/test';

/**
 * VIS-1 harness smoke.
 *
 * Proves the visual pipeline works end-to-end at all three viewports without
 * coupling to the backend: a deterministic inline fixture is rendered and
 * screenshotted. Each viewport project (mobile/tablet/desktop) produces its own
 * baseline, so a regression in any device class fails the suite.
 *
 * App-driven specs (XTF-5, UX-*) follow the same `toHaveScreenshot` pattern but
 * navigate the real UI via the `webServer` block in playwright.config.ts.
 */
const FIXTURE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;color:#1a1a1a}
  .card{max-width:680px;margin:24px auto;padding:24px;background:#fff;
        border:1px solid #e3e6ea;border-radius:12px}
  h1{font-size:20px;margin:0 0 8px}
  p{margin:0 0 16px;color:#555;line-height:1.5}
  .btn{display:inline-block;padding:10px 16px;background:#1D9E75;color:#fff;
       border-radius:8px;font-weight:600;text-decoration:none}
</style></head>
<body><main class="card">
  <h1>Visual harness smoke</h1>
  <p>Deterministic fixture rendered at mobile, tablet and desktop viewports to
     validate the three-baseline screenshot pipeline.</p>
  <a class="btn" href="#">Apply &amp; build</a>
</main></body></html>`;

test('visual harness smoke — sample panel at all viewports', async ({ page }) => {
  await page.setContent(FIXTURE);
  await expect(page.locator('main.card')).toBeVisible();
  await expect(page).toHaveScreenshot('sample-panel.png');
});
