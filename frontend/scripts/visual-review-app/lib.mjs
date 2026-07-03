// lib.mjs — pure logic for the Tier 3 visual review app. Node built-ins only (no deps),
// so it runs with just Node — no npm install needed for this app itself.
//
// Approval-environment parity: candidates come from the Playwright OUTPUT dir
// (`frontend/test-results/**/*-actual.png`) — the same run that CI would produce — so a
// human approves exactly what CI will produce, never some other local render.
//
// Re-baselining here is a file copy (fs.copyFileSync), NOT a `playwright --update-snapshots`
// shell call — so guard-visual-update.sh (which blocks *agents'* Bash update commands) never
// applies to this human-run app, exactly as intended (see its README section on this).

import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';

/** Recursively list files under dir matching a predicate. */
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

/** Baseline id = path relative to the baselines dir, POSIX-separated (matches visual-approvals.json). */
export function baselineId(baselinesDir, baselinePath) {
  return relative(baselinesDir, baselinePath).split(sep).join('/');
}

export function readApprovals(approvalsFile) {
  if (!existsSync(approvalsFile)) return {};
  try { return JSON.parse(readFileSync(approvalsFile, 'utf8')); }
  catch { return {}; }
}

export function writeApprovals(approvalsFile, obj) {
  writeFileSync(approvalsFile, JSON.stringify(obj, null, 2) + '\n');
}

/**
 * Correlate container/CI-rendered candidates with their committed baselines.
 * Scans outputDir for `*-actual.png`, pairs each with a sibling `*-diff.png` (if any) and the
 * baseline of the same name under baselinesDir (tolerating the `{platform}` filename suffix
 * Playwright appends, e.g. `-linux.png`). Returns one entry per changed baseline.
 */
export function findDiffs({ outputDir, baselinesDir }) {
  const actuals = walk(outputDir, (p) => p.endsWith('-actual.png'));
  const baselines = walk(baselinesDir, (p) => p.endsWith('.png'));
  const results = [];
  for (const actual of actuals) {
    const stem = basename(actual).replace(/-actual\.png$/, '');
    const diff = actual.replace(/-actual\.png$/, '-diff.png');
    const baseline = baselines.find((b) => basename(b).replace(/\.png$/, '') === stem
      || basename(b).replace(/-[a-z0-9]+\.png$/, '') === stem); // tolerate {platform} suffix
    if (!baseline) continue; // an -actual with no committed baseline is a brand-new snapshot
    results.push({
      id: baselineId(baselinesDir, baseline),
      name: stem,
      baseline,
      actual,
      diff: existsSync(diff) ? diff : null,
    });
  }
  return results;
}

/** Approve one baseline: re-baseline (copy candidate over baseline) + record the decision. */
export function approve({ id, task, actualPath, baselinePath, approvalsFile, at }) {
  copyFileSync(actualPath, baselinePath); // the re-baseline — a file copy, not --update-snapshots
  const approvals = readApprovals(approvalsFile);
  approvals[id] = { decision: 'approved', task: task || null, capturedImage: actualPath, at };
  writeApprovals(approvalsFile, approvals);
  return approvals[id];
}

/** Reject one baseline: record the decision, do NOT re-baseline. */
export function reject({ id, task, approvalsFile, at }) {
  const approvals = readApprovals(approvalsFile);
  approvals[id] = { decision: 'rejected', task: task || null, at };
  writeApprovals(approvalsFile, approvals);
  return approvals[id];
}
