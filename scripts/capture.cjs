// Capture clean, ordered screenshots of every pipeline screen for the hyperframe video.
// Drives the dev-mode instance on :8010 (auth off). 1440x900 @2x retina.
const { chromium } = require('/home/vscode/.npm/_npx/e41f203b7505f1fb/node_modules/playwright');
const DIR = '/workspaces/databridge-cli/.claude/worktrees/video-assets/docs/video/screenshots/';

// stage = top-nav item; sub = sub-tab (null = stage landing); file = output name
const SHOTS = [
  { stage: 'Home',      sub: null,                 file: '01-home-pipeline.png' },
  { stage: 'Extract',   sub: 'Connection',         file: '02-extract-connection.png' },
  { stage: 'Extract',   sub: 'AI configuration',   file: '03-extract-ai-config.png' },
  { stage: 'Transform', sub: 'Questions',          file: '04-transform-questions.png' },
  { stage: 'Transform', sub: 'Profile',            file: '05-transform-profile.png' },
  { stage: 'Transform', sub: 'Validate',           file: '06-transform-validate.png' },
  { stage: 'Model',     sub: null,                 file: '07-model-views.png' },
  { stage: 'Analyze',   sub: 'Charts & indicators',file: '08-analyze-charts.png' },
  { stage: 'Analyze',   sub: 'Ask',                file: '09-analyze-ask.png' },
  { stage: 'Deliver',   sub: 'Output',             file: '10-deliver-output.png' },
  { stage: 'Deliver',   sub: 'Reports',            file: '11-deliver-reports.png' },
  { stage: 'Deliver',   sub: 'Templates',          file: '12-deliver-templates.png' },
];

// Click an element whose exact text matches `txt` and which sits in the top nav band (y < 110).
async function clickNav(page, txt) {
  const loc = page.getByText(txt, { exact: true });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;   // skip hidden home-card buttons
    const box = await el.boundingBox().catch(() => null);
    if (box && box.y < 110) { await el.click({ timeout: 4000 }); return true; }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto('http://127.0.0.1:8010/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const manifest = [];
  for (const s of SHOTS) {
    const okStage = await clickNav(page, s.stage);
    await page.waitForTimeout(1200);
    let okSub = true;
    if (s.sub) { okSub = await clickNav(page, s.sub); await page.waitForTimeout(1600); }
    // settle: wait for any network + for async "Profiling…/Loading…" spinners to clear
    await page.waitForLoadState('networkidle').catch(() => {});
    for (let t = 0; t < 24; t++) {
      const busy = await page.evaluate(() => /\b(Profiling|Loading|Computing|Validating)(\.|…)/.test(document.body.innerText));
      if (!busy) break;
      await page.waitForTimeout(800);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: DIR + s.file });
    manifest.push({ ...s, okStage, okSub });
    console.log(`${s.file}  stage=${okStage} sub=${okSub}`);
  }
  console.log('MANIFEST=' + JSON.stringify(manifest));
  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
