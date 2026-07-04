// test.mjs — self-test for lib.mjs. Node built-ins only.
// Run: node frontend/scripts/visual-review-app/test.mjs
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findDiffs, approve, reject, readApprovals, baselineId } from './lib.mjs';

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

rmSync(root, { recursive: true, force: true });
console.log(`\nvisual-review-app test.mjs — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
