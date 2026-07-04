import { test, expect } from '@playwright/test';

/**
 * VIS-1 harness smoke.
 *
 * A minimal functional smoke check that the harness's deterministic inline
 * fixture renders correctly, without coupling to the backend. The visual
 * (screenshot) assertion this spec used to carry was moved to the dedicated
 * Tier 1 visual pilot spec, `visual-review/specs/harness-smoke.visual.spec.ts`
 * (VIS-9), which now proves the three-baseline screenshot pipeline end-to-end.
 *
 * App-driven specs (XTF-5, UX-*) follow the same functional-check pattern but
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
  <p>Deterministic fixture rendered to validate the harness's functional smoke
     check independent of the screenshot pipeline.</p>
  <a class="btn" href="#">Apply &amp; build</a>
</main></body></html>`;

test('harness smoke — sample panel renders', async ({ page }) => {
  await page.setContent(FIXTURE);
  await expect(page.locator('main.card')).toBeVisible();
});
