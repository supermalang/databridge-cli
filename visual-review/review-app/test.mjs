// test.mjs — self-test for lib.mjs. Node built-ins only.
// Run: node visual-review/review-app/test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { findDiffs, approve, reject, readApprovals, baselineId } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m));

// Fixture: a baselines dir + a Playwright output dir with one changed screenshot.
const root = mkdtempSync(join(tmpdir(), 'vr-'));
const baselinesDir = join(root, 'baselines', 'e2e', 'home.spec.ts-snapshots');
const outputDir = join(root, 'out', 'home-desktop-chromium');
mkdirSync(baselinesDir, { recursive: true });
mkdirSync(outputDir, { recursive: true });
const baseline = join(baselinesDir, 'home-desktop-linux.png');
const actual = join(outputDir, 'home-desktop-actual.png');
const diff = join(outputDir, 'home-desktop-diff.png');
writeFileSync(baseline, 'OLD-PIXELS');
writeFileSync(actual, 'NEW-PIXELS');
writeFileSync(diff, 'DIFF');
const approvalsFile = join(root, 'visual-approvals.json');
const dirs = { outputDir: join(root, 'out'), baselinesDir: join(root, 'baselines') };

// 1 — findDiffs correlates candidate -> baseline
const diffs = findDiffs(dirs);
ok(diffs.length === 1, 'findDiffs: one changed baseline found');
ok(diffs[0] && diffs[0].id === 'e2e/home.spec.ts-snapshots/home-desktop-linux.png', 'findDiffs: id is baseline-relative POSIX path');
ok(diffs[0] && diffs[0].diff !== null, 'findDiffs: pairs the -diff.png');

// 2 — approve re-baselines (copies candidate over baseline) + records approval
approve({ id: diffs[0].id, task: 'VIS-4', actualPath: actual, baselinePath: baseline, approvalsFile, at: '2026-07-03T00:00:00Z' });
ok(readFileSync(baseline, 'utf8') === 'NEW-PIXELS', 'approve: baseline re-based to the candidate pixels');
const appr = readApprovals(approvalsFile);
ok(appr[diffs[0].id]?.decision === 'approved', 'approve: records decision=approved');
ok(appr[diffs[0].id]?.task === 'VIS-4', 'approve: records the task id');
ok(appr[diffs[0].id]?.capturedImage === actual, 'approve: records the rendered candidate (parity provenance)');

// 3 — reject records without re-baselining
writeFileSync(baseline, 'OLD-AGAIN');
reject({ id: diffs[0].id, task: 'VIS-4', approvalsFile, at: '2026-07-03T00:01:00Z' });
ok(readFileSync(baseline, 'utf8') === 'OLD-AGAIN', 'reject: baseline is NOT re-based');
ok(readApprovals(approvalsFile)[diffs[0].id]?.decision === 'rejected', 'reject: records decision=rejected');

// 4 — baselineId helper
ok(baselineId(join(root, 'baselines'), baseline).endsWith('home-desktop-linux.png'), 'baselineId: relative + posix');

// 5 — a brand-new candidate with no committed baseline is not treated as a diff to review
{
  const freshOutputDir = join(root, 'fresh-out');
  mkdirSync(freshOutputDir, { recursive: true });
  writeFileSync(join(freshOutputDir, 'never-seen-actual.png'), 'BRAND-NEW');
  const freshDiffs = findDiffs({ outputDir: freshOutputDir, baselinesDir: dirs.baselinesDir });
  ok(freshDiffs.length === 0, 'findDiffs: an -actual with no committed baseline is skipped (new snapshot, not a diff)');
}

// 6 — VIS-13: the running review-app server's /api/diffs endpoint merges
// Tier 1 (visual-review/baselines + results/output) and Tier 2/Storybook
// (visual-review/storybook/baselines + results/storybook/output) diffs into
// one list with no id collisions, given one manufactured diff in each tier
// simultaneously. Drives the real server.mjs as a subprocess (not just
// lib.mjs) since the two-tier scan is the server's job, not findDiffs'.
async function testTwoTierServerMerge() {
  const projectRoot = mkdtempSync(join(tmpdir(), 'vr-project-'));

  // Tier 1 fixture, at the server's real default relative paths.
  const t1BaselinesDir = join(projectRoot, 'visual-review', 'baselines', 'specs', 'home.visual.spec.ts-snapshots');
  const t1OutputDir = join(projectRoot, 'visual-review', 'results', 'output', 'home-desktop-chromium');
  mkdirSync(t1BaselinesDir, { recursive: true });
  mkdirSync(t1OutputDir, { recursive: true });
  writeFileSync(join(t1BaselinesDir, 'home-desktop-linux.png'), 'OLD-TIER1-PIXELS');
  writeFileSync(join(t1OutputDir, 'home-desktop-actual.png'), 'NEW-TIER1-PIXELS');

  // Tier 2 (Storybook) fixture, at its real post-VIS-13 default relative paths.
  const t2BaselinesDir = join(projectRoot, 'visual-review', 'storybook', 'baselines', 'example.visual.spec.ts');
  const t2OutputDir = join(projectRoot, 'visual-review', 'results', 'storybook', 'output', 'button-primary-desktop-chromium');
  mkdirSync(t2BaselinesDir, { recursive: true });
  mkdirSync(t2OutputDir, { recursive: true });
  writeFileSync(join(t2BaselinesDir, 'button-primary-linux.png'), 'OLD-TIER2-PIXELS');
  writeFileSync(join(t2OutputDir, 'button-primary-actual.png'), 'NEW-TIER2-PIXELS');

  const port = 4400 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, [join(HERE, 'server.mjs')], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectRoot, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    // Wait for the server to start listening (poll stdout, bounded).
    await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('server did not start in time')), 5000);
      child.stdout.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('http://localhost')) { clearTimeout(timer); resolve(); }
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early with code ${code}`)); });
    });

    const res = await fetch(`http://localhost:${port}/api/diffs`);
    const body = await res.json();
    const ids = (body.diffs || []).map((d) => d.id);

    ok(ids.some((id) => id.includes('home-desktop-linux.png')), 'server /api/diffs: Tier 1 diff present in merged list');
    ok(ids.some((id) => id.includes('button-primary-linux.png')), 'server /api/diffs: Tier 2 (Storybook) diff present in merged list');
    ok(new Set(ids).size === ids.length, 'server /api/diffs: no id collisions between Tier 1 and Tier 2 entries');
    ok(ids.length === 2, `server /api/diffs: exactly the two manufactured diffs are reported (got ${ids.length}: ${JSON.stringify(ids)})`);
  } finally {
    child.kill();
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

await testTwoTierServerMerge();

rmSync(root, { recursive: true, force: true });
console.log(`\nvisual-review-app test.mjs — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
