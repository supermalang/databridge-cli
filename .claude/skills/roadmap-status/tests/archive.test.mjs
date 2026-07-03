// archive.test.mjs — fixture tests for the roadmap archiver. Node built-ins only.
// Run: node .claude/skills/roadmap-status/tests/archive.test.mjs
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { archiveRoadmap, parseBlocks } from '../archive.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m));

const DONE = `- [x] **MNT-99 — A delivered card (P2)**

  **Created:** 2026-07-01 · **Completed:** 2026-07-03

  Something shipped.

  **Type:** Fix

  **Verify:** \`pytest -q\``;

const OPEN = `- [ ] **MNT-100 — An open card (P1)**

  **Created:** 2026-07-03

  Not done yet.

  **Type:** Feature`;

const HEADER = `# Roadmap — databridge-cli

## Definition of Ready

...

## Definition of Done

...

## Global status

| Area | Planned | Progress |
|---|---|---|
| [Maintenance & hardening](#maintenance--hardening) | 2 | 1 / 2 |

---

## Maintenance & hardening

`;

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'rm-'));
  const roadmapPath = join(root, 'ROADMAP.md');
  const archiveDir = join(root, 'archive');
  writeFileSync(roadmapPath, HEADER + DONE + '\n\n---\n\n' + OPEN + '\n');
  return { root, roadmapPath, archiveDir };
}

// 1 — parseBlocks finds both cards and tags them with the enclosing Area
{
  const blocks = parseBlocks((HEADER + DONE + '\n\n---\n\n' + OPEN).split('\n'));
  ok(blocks.length === 2, 'parseBlocks: finds 2 cards');
  ok(blocks[0].id === 'MNT-99' && blocks[1].id === 'MNT-100', 'parseBlocks: extracts ids in order');
  ok(blocks[0].done === true && blocks[1].done === false, 'parseBlocks: reads [x]/[ ] state');
  ok(blocks[0].area === 'Maintenance & hardening' && blocks[1].area === 'Maintenance & hardening',
     'parseBlocks: tags cards with the nearest preceding ## Area heading');
  ok(blocks[0].title === 'A delivered card', 'parseBlocks: strips the trailing (Px) from the title');
}

// 2 — archives only the delivered card; open card stays
{
  const { root, roadmapPath, archiveDir } = fixture();
  const res = archiveRoadmap({ roadmapPath, archiveDir });
  const live = readFileSync(roadmapPath, 'utf8');
  ok(res.archived.length === 1 && res.archived[0] === 'MNT-99', 'archive: only the delivered card archived');
  ok(!live.includes('**MNT-99 —'), 'archive: delivered card removed from live file');
  ok(live.includes('**MNT-100 —'), 'archive: open card kept in live file');
  ok(live.includes('## Definition of Ready') && live.includes('## Global status'),
     'archive: static header preserved');

  // lossless: archive holds the full original card body
  const archived = readFileSync(join(archiveDir, 'maintenance-hardening.md'), 'utf8');
  ok(archived.includes('**MNT-99 — A delivered card (P2)**') && archived.includes('Something shipped.'),
     'archive: card preserved losslessly (heading through last field)');

  // ledger row present with id, title, area, date
  ok(/\| MNT-99 \| A delivered card \| Maintenance & hardening \| ✅ 2026-07-03 \|/.test(live),
     'archive: compact ledger row written under "## ✅ Delivered (archived)"');

  rmSync(root, { recursive: true, force: true });
}

// 3 — idempotent: re-run makes no changes and never duplicates
{
  const { root, roadmapPath, archiveDir } = fixture();
  archiveRoadmap({ roadmapPath, archiveDir });
  const after1 = readFileSync(roadmapPath, 'utf8');
  const arch1 = readFileSync(join(archiveDir, 'maintenance-hardening.md'), 'utf8');
  const res2 = archiveRoadmap({ roadmapPath, archiveDir });
  const after2 = readFileSync(roadmapPath, 'utf8');
  const arch2 = readFileSync(join(archiveDir, 'maintenance-hardening.md'), 'utf8');
  ok(res2.archived.length === 0, 'idempotent: second run archives nothing');
  ok(after1 === after2, 'idempotent: live file unchanged on re-run');
  ok(arch1 === arch2, 'idempotent: archive file unchanged on re-run');
  ok((after2.match(/\| MNT-99 \|/g) || []).length === 1, 'idempotent: ledger row not duplicated');
  rmSync(root, { recursive: true, force: true });
}

// 4 — no-op: all-open roadmap changes nothing, creates no archive
{
  const root = mkdtempSync(join(tmpdir(), 'rm-'));
  const roadmapPath = join(root, 'ROADMAP.md');
  const archiveDir = join(root, 'archive');
  writeFileSync(roadmapPath, HEADER + OPEN + '\n');
  const before = readFileSync(roadmapPath, 'utf8');
  const res = archiveRoadmap({ roadmapPath, archiveDir });
  ok(res.archived.length === 0 && res.reason === 'nothing to archive', 'no-op: reports nothing to archive');
  ok(readFileSync(roadmapPath, 'utf8') === before, 'no-op: live file untouched');
  ok(!existsSync(archiveDir), 'no-op: no archive dir/file created');
  rmSync(root, { recursive: true, force: true });
}

// 5 — a [x] card with no Completed date is NOT archivable (defensive: [x] alone isn't the marker)
{
  const root = mkdtempSync(join(tmpdir(), 'rm-'));
  const roadmapPath = join(root, 'ROADMAP.md');
  const archiveDir = join(root, 'archive');
  const doneNoDate = `- [x] **MNT-98 — Checked but undated (P3)**

  **Created:** 2026-07-01

  No Completed date was ever stamped.

  **Type:** Fix`;
  writeFileSync(roadmapPath, HEADER + doneNoDate + '\n');
  const res = archiveRoadmap({ roadmapPath, archiveDir });
  ok(res.archived.length === 0 && res.reason === 'nothing to archive',
     'safety: [x] without **Completed:** date is left alone, not archived');
  rmSync(root, { recursive: true, force: true });
}

// 6 — CRLF preservation: this repo's real docs/ROADMAP.md is checked out CRLF
{
  const root = mkdtempSync(join(tmpdir(), 'rm-'));
  const roadmapPath = join(root, 'ROADMAP.md');
  const archiveDir = join(root, 'archive');
  const crlf = (HEADER + DONE + '\n\n---\n\n' + OPEN + '\n').split('\n').join('\r\n');
  writeFileSync(roadmapPath, crlf);
  archiveRoadmap({ roadmapPath, archiveDir });
  const live = readFileSync(roadmapPath, 'utf8');
  const archived = readFileSync(join(archiveDir, 'maintenance-hardening.md'), 'utf8');
  ok(live.includes('\r\n') && !/[^\r]\n/.test(live), 'CRLF: live file stays CRLF end-to-end after archiving');
  ok(archived.includes('\r\n') && !/[^\r]\n/.test(archived), 'CRLF: archive file is written CRLF too');
  rmSync(root, { recursive: true, force: true });
}

console.log(`\narchive.test.mjs — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
