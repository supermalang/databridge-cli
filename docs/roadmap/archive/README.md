# Roadmap archive

Full card bodies for **delivered** (`[x]` + `**Completed:**` dated) cards, swept out of the
live `docs/ROADMAP.md` to keep it proportional to *active* work — nearly every roadmap-pipeline
agent (`/roadmap`, `/roadmap-status`, `/ship-task`, `roadmap-planner`, `roadmap-verifier`, …)
reads that file on every run.

- One file per **Area** (the `## <Area>` domain heading a card lives under), slugified:
  `docs/roadmap/archive/<area-slug>.md` — e.g. `maintenance-hardening.md`,
  `express-template-fill.md`.
- Written by `node .claude/skills/roadmap-status/archive.mjs` (invoke via `/roadmap-status
  archive`), which moves each card whose checkbox is `[x]` **and** whose Created line carries a
  real `**Completed:** YYYY-MM-DD` date, and leaves a one-line row in the live file's
  **✅ Delivered (archived)** ledger table: `| ID | Title | Area | Done |`.
- **Git history is the real source of truth** — this archive is a convenience for browsing
  shipped work without bloating the live roadmap. Archiving is lossless (the archived card
  equals the original, byte-for-byte) and idempotent (safe to re-run any time).

Do not hand-edit these files during normal work — run the archive command instead so the move
stays lossless and the ledger row stays in sync.
