// server.mjs — thin local review app for Tier 3 visual approval. Node built-ins only.
//
// Run (HUMAN, not an agent):
//   node frontend/scripts/visual-review-app/server.mjs
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
const ROOT = process.env.CLAUDE_PROJECT_DIR || join(HERE, '..', '..', '..');
const PORT = Number(process.env.PORT || 4444);
// Covers both Tier 1 (frontend/tests/e2e/*-snapshots) and Tier 2 (frontend/tests/storybook/*-snapshots)
// baselines, and the shared Playwright output dir both configs write "-actual.png"/"-diff.png" to.
const baselinesDir = join(ROOT, process.env.VISUAL_BASELINES_DIR || 'frontend/tests');
const outputDir = join(ROOT, process.env.VISUAL_OUTPUT_DIR || 'frontend/test-results');
const approvalsFile = join(ROOT, process.env.VISUAL_APPROVALS || 'visual-approvals.json');

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

// Only serve PNGs that live under the two known image dirs (no arbitrary file read).
function safeImg(p) {
  const abs = join(ROOT, p);
  return (abs.startsWith(baselinesDir) || abs.startsWith(outputDir)) && abs.endsWith('.png') && existsSync(abs)
    ? abs : null;
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
    const diffs = findDiffs({ outputDir, baselinesDir }).map((d) => ({
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
    const entry = findDiffs({ outputDir, baselinesDir }).find((d) => d.id === body.id);
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
  console.log(`  baselines:  ${baselinesDir}`);
  console.log(`  candidates: ${outputDir}`);
  console.log(`  approvals:  ${approvalsFile}`);
});
