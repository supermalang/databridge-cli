import { test, expect } from '@playwright/test';

/**
 * VIS-9 pilot migration.
 *
 * Proves the new visual-review/ scaffold (playwright.visual.config.ts —
 * testDir './specs', snapshotDir 'baselines', the project-name-token
 * snapshotPathTemplate, outputDir 'results/output') works end-to-end by
 * running the same deterministic inline fixture previously exercised by
 * frontend/tests/e2e/harness-smoke.spec.ts (VIS-1), now under the dedicated
 * Tier 1 config. Each viewport project (mobile/tablet/desktop) must produce
 * its OWN distinct baseline file — the whole point of the project-name-token
 * fix in the snapshotPathTemplate.
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

test('visual harness smoke — sample panel at all viewports (Tier 1 dedicated config)', async ({ page }) => {
  await page.setContent(FIXTURE);
  await expect(page.locator('main.card')).toBeVisible();
  await expect(page).toHaveScreenshot('sample-panel.png');
});
