#!/usr/bin/env node
// archive.mjs — sweep delivered task cards out of docs/ROADMAP.md into a per-area archive,
// leaving a compact one-line ledger row in the live file. Node built-ins only.
//
// Adapted from the ai-augmented-coding template's archiver for THIS repo's card format:
// checkbox cards ("- [ ] **AREA-N — Title (Px)**" / "- [x] ...") grouped under "## <Area>"
// domain headings, with "**Completed:** YYYY-MM-DD" inline on the Created line — not the
// template's "### ID — Title" + standalone "**Completion date:**" + "## Sprint N" shape.
//
// Keeps the LIVE roadmap proportional to active work: nearly every roadmap-pipeline agent
// reads docs/ROADMAP.md, so cumulative done-history must not bloat it. Git preserves full
// history regardless; the archive file is a convenience, not the source of truth.
//
// A card is ARCHIVABLE when it is checked `[x]` AND its Created line carries a real
// `**Completed:** YYYY-MM-DD` date — the single unambiguous "this shipped" marker (the
// `/roadmap` "Complete a task" step stamps both at once).
//
// Guarantees: lossless (archived card text == original card text, including its original
// line-ending style), idempotent (re-run once a card is moved = no-op), and a true no-op on
// an all-open roadmap (no files created). CRLF-safe: this repo's docs/ROADMAP.md is checked
// out CRLF (core.autocrlf=true) — the detected line ending is preserved on write, not
// hardcoded to LF like the upstream template assumes.
//
// Usage: node archive.mjs [--roadmap <path>] [--archive-dir <dir>]

import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const CARD_RE = /^- \[( |x)\] \*\*([A-Za-z]+-\d+) — (.*)\*\*\s*$/;
const HEADING_RE = /^##\s+(.*?)\s*$/;
const COMPLETED_RE = /\*\*Completed:\*\*\s*(\d{4}-\d{2}-\d{2})/;
const SPECIAL_HEADINGS = new Set([
  'Definition of Ready', 'Definition of Done', 'Sprint rituals (cadence-level checks)',
  'Global status', '✅ Delivered (archived)',
]);

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

function detectEol(raw) {
  return raw.includes('\r\n') ? '\r\n' : '\n';
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Split the roadmap into card blocks. A block runs from `- [ ]/[x] **ID — Title**` to the
 *  next card line or the next `## ` heading (or EOF). Tracks the nearest preceding `## `
 *  heading (skipping the special/static sections) as each card's Area.
 *  Returns {id,title,done,area,startLine,endLine,text}. */
export function parseBlocks(lines) {
  const blocks = [];
  let area = null;
  let cur = null;
  const push = (endLine) => {
    if (!cur) return;
    cur.endLine = endLine;
    cur.text = lines.slice(cur.startLine, endLine).join('\n');
    blocks.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADING_RE);
    if (h) {
      push(i);
      if (!SPECIAL_HEADINGS.has(h[1])) area = h[1];
      continue;
    }
    const c = lines[i].match(CARD_RE);
    if (c) {
      push(i);
      cur = { id: c[2], title: c[3].replace(/\s*\(P\d\)\s*$/, ''), done: c[1] === 'x', area: area || 'Uncategorized', startLine: i };
      continue;
    }
  }
  push(lines.length);
  return blocks;
}

/** Trim trailing blank lines and a trailing `---` separator from a card's text. */
function stripSeparator(text) {
  return text.replace(/\n+\s*---\s*$/, '').replace(/\s+$/, '');
}

export function archiveRoadmap({ roadmapPath, archiveDir }) {
  if (!existsSync(roadmapPath)) return { archived: [], reason: 'no roadmap file' };
  const original = readFileSync(roadmapPath, 'utf8');
  const eol = detectEol(original);
  const lines = original.split(/\r\n|\n/);
  const blocks = parseBlocks(lines);

  const archivable = blocks.filter((b) => b.done && COMPLETED_RE.test(b.text));
  if (archivable.length === 0) return { archived: [], reason: 'nothing to archive' };

  // Remove archivable blocks from the live text (splice bottom-up to keep indices valid).
  let liveLines = lines.slice();
  const ledger = [];
  for (const b of [...archivable].sort((a, z) => z.startLine - a.startLine)) {
    const date = (b.text.match(COMPLETED_RE) || [null, '—'])[1];
    ledger.push({ id: b.id, title: b.title, area: b.area, date });

    const areaSlug = slugify(b.area);
    const archiveFile = join(archiveDir, `${areaSlug}.md`);
    mkdirSync(archiveDir, { recursive: true });
    const existing = existsSync(archiveFile) ? readFileSync(archiveFile, 'utf8') : '';
    if (!existing.includes(`**${b.id} —`)) {
      const header = existing
        ? ''
        : `# ${b.area} — archived (delivered) cards${eol}${eol}> Full history also in git. Live roadmap keeps only the ledger row.${eol}${eol}`;
      appendFileSync(archiveFile, (header + stripSeparator(b.text) + `${eol}${eol}---${eol}${eol}`).split(/\r\n|\n/).join(eol));
    }
    liveLines.splice(b.startLine, b.endLine - b.startLine);
  }

  // Ensure the Delivered-ledger table exists (right after Global status); add one row per
  // archived card (skip if already present — idempotent).
  let live = liveLines.join(eol);
  const LEDGER_HEAD = '## ✅ Delivered (archived)';
  if (!live.includes(LEDGER_HEAD)) {
    const marker = '## Global status';
    const idx = live.indexOf(marker);
    const block = `${LEDGER_HEAD}${eol}${eol}` +
      `> Full card bodies live in \`docs/roadmap/archive/\` and in git history.${eol}${eol}` +
      `| ID | Title | Area | Done |${eol}|----|-------|------|------|${eol}`;
    if (idx !== -1) {
      // Insert right after the Global status table (before the next `---` + heading).
      const afterTable = live.indexOf('\n---', idx);
      if (afterTable !== -1) {
        live = live.slice(0, afterTable).replace(/\s+$/, '') + `${eol}${eol}---${eol}${eol}${block}${eol}---${eol}` + live.slice(afterTable + 4);
      } else {
        live = live.replace(/\s*$/, '') + `${eol}${eol}---${eol}${eol}${block}`;
      }
    } else {
      live = live.replace(/\s*$/, '') + `${eol}${eol}---${eol}${eol}${block}`;
    }
  }
  for (const e of ledger.reverse()) {
    const row = `| ${e.id} | ${e.title} | ${e.area} | ✅ ${e.date} |`;
    if (!live.includes(`| ${e.id} |`)) {
      live = live.replace(
        /(## ✅ Delivered \(archived\)[\s\S]*?\|----\|-------\|------\|------\|\r?\n)/,
        `$1${row}${eol}`
      );
    }
  }

  const collapseRe = new RegExp(`(?:${eol}){3,}`, 'g');
  writeFileSync(roadmapPath, live.replace(collapseRe, eol + eol));
  return { archived: ledger.map((e) => e.id) };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('archive.mjs')) {
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const roadmapPath = arg('--roadmap', join(root, 'docs/ROADMAP.md'));
  const archiveDir = arg('--archive-dir', join(root, 'docs/roadmap/archive'));
  const res = archiveRoadmap({ roadmapPath, archiveDir });
  if (res.archived.length) console.log(`Archived ${res.archived.length} card(s): ${res.archived.join(', ')}`);
  else console.log(res.reason === 'nothing to archive' ? 'Nothing to archive — no delivered cards in the live roadmap.' : res.reason);
}
