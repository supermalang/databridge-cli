// server.mjs — thin local review app for Tier 3 visual approval. Node built-ins only.
//
// Run (HUMAN, not an agent):
//   node visual-review/review-app/server.mjs
// Then open http://localhost:4444 and Approve / Reject each changed screenshot.
//
// Config via env (defaults match this repo's actual layout):
//   PORT, VISUAL_BASELINES_DIR, VISUAL_OUTPUT_DIR, VISUAL_APPROVALS
// Task association defaults to the id in .claude/.active-task.json.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDiffs, approve, reject } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.CLAUDE_PROJECT_DIR || join(HERE, '..', '..');
const PORT = Number(process.env.PORT || 4444);
// Tier 1 (visual-review/baselines) and, from VIS-13, Tier 2/Storybook (visual-review/storybook/baselines)
// are scanned as two independent baseline/output pairs and merged for the diffs endpoint — each tier
// writes its "-actual.png"/"-diff.png" candidates to its own Playwright output dir.
const baselinesDir = join(ROOT, process.env.VISUAL_BASELINES_DIR || 'visual-review/baselines');
const outputDir = join(ROOT, process.env.VISUAL_OUTPUT_DIR || 'visual-review/results/output');
const sbBaselinesDir = join(ROOT, process.env.VISUAL_STORYBOOK_BASELINES_DIR || 'visual-review/storybook/baselines');
const sbOutputDir = join(ROOT, process.env.VISUAL_STORYBOOK_OUTPUT_DIR || 'visual-review/results/storybook/output');
const approvalsFile = join(ROOT, process.env.VISUAL_APPROVALS || 'visual-review/visual-approvals.json');
const TIERS = [
  { baselinesDir, outputDir },
  { baselinesDir: sbBaselinesDir, outputDir: sbOutputDir },
];

function findAllDiffs() {
  return TIERS.flatMap((t) => findDiffs(t));
}

function currentTask() {
  const f = join(ROOT, '.claude/.active-task.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')).id || null; }
  catch { return null; }
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// Only serve PNGs that live under the two known image dirs (no arbitrary file read). The '/'
// suffix on each prefix guards the directory boundary — without it, a sibling dir sharing the
// same string prefix (e.g. "visual-review/baselines-tmp") would pass a bare startsWith() check.
function safeImg(p) {
  const abs = join(ROOT, p);
  const inKnownDir = TIERS.some((t) => abs.startsWith(t.baselinesDir + '/') || abs.startsWith(t.outputDir + '/'));
  return inKnownDir && abs.endsWith('.png') && existsSync(abs) ? abs : null;
}

function toRelUrl(p) {
  return '/img?p=' + encodeURIComponent(relFromRoot(p));
}
function relFromRoot(p) {
  return p.startsWith(ROOT + '/') ? p.slice(ROOT.length + 1) : p;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, readFileSync(join(HERE, 'index.html')), 'text/html');
  }

  if (req.method === 'GET' && url.pathname === '/api/diffs') {
    const diffs = findAllDiffs().map((d) => ({
      id: d.id,
      name: d.name,
      baseline: toRelUrl(d.baseline),
      actual: toRelUrl(d.actual),
      diff: d.diff ? toRelUrl(d.diff) : null,
    }));
    return send(res, 200, { task: currentTask(), diffs });
  }

  if (req.method === 'GET' && url.pathname === '/img') {
    const abs = safeImg(url.searchParams.get('p') || '');
    return abs ? send(res, 200, readFileSync(abs), 'image/png') : send(res, 404, { error: 'not found' });
  }

  if (req.method === 'POST' && (url.pathname === '/api/approve' || url.pathname === '/api/reject')) {
    const body = await readJsonBody(req);
    const at = new Date().toISOString();
    const task = body.task || currentTask();
    const entry = findAllDiffs().find((d) => d.id === body.id);
    if (!entry) return send(res, 404, { error: 'unknown baseline id' });
    const result = url.pathname.endsWith('approve')
      ? approve({ id: entry.id, task, actualPath: entry.actual, baselinePath: entry.baseline, approvalsFile, at })
      : reject({ id: entry.id, task, approvalsFile, at });
    return send(res, 200, { ok: true, id: entry.id, decision: result.decision });
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`Visual review app -> http://localhost:${PORT}`);
  console.log(`  Tier 1 baselines:  ${baselinesDir}`);
  console.log(`  Tier 1 candidates: ${outputDir}`);
  console.log(`  Tier 2 baselines:  ${sbBaselinesDir}`);
  console.log(`  Tier 2 candidates: ${sbOutputDir}`);
  console.log(`  approvals:         ${approvalsFile}`);
});
