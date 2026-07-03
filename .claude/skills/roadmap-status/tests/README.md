# roadmap-status — archive tests

## Automated (node)

`archive.test.mjs` covers the archiver against markdown fixtures matching this repo's actual
card format (`- [ ] **AREA-N — Title (Px)**` checkboxes under `## <Area>` headings, with
`**Completed:** YYYY-MM-DD` inline on the Created line) — the invariants that make it safe to
run on the real roadmap:

```bash
node .claude/skills/roadmap-status/tests/archive.test.mjs
```

Asserts: card parsing + Area tagging; only delivered (`[x]` **and** a real `**Completed:**`
date) cards archived; open cards + the static DoR/DoD/Global-status header preserved;
**lossless** (archived card equals the original text); **idempotent** (re-run changes nothing,
no duplicate ledger rows); **no-op** on an all-open roadmap (no archive dir created); and
**CRLF-safe** (this repo's `docs/ROADMAP.md` is checked out CRLF — the archiver preserves
whichever line ending the input file actually uses).

## Manual (dry run before touching the real file)

Never run `archive.mjs` against `docs/ROADMAP.md` directly as a first try — dry-run it against
a scratch copy first:

```bash
cp docs/ROADMAP.md /tmp/ROADMAP.dryrun.md
node .claude/skills/roadmap-status/archive.mjs --roadmap /tmp/ROADMAP.dryrun.md --archive-dir /tmp/roadmap-archive-dryrun
# inspect /tmp/ROADMAP.dryrun.md and /tmp/roadmap-archive-dryrun/*.md, then re-run once more
# to confirm it reports "Nothing to archive" (idempotency) before running for real.
```

| # | Initial state | Action | Expected |
|---|---|---|---|
| 1 | Roadmap with several delivered + open cards | `node .claude/skills/roadmap-status/archive.mjs` | Live file keeps only open/active cards + the `✅ Delivered (archived)` ledger; `docs/roadmap/archive/<area-slug>.md` holds the full delivered cards; re-run prints "Nothing to archive" |
| 2 | Long roadmap after archive | `/start-task <open-id>` (or the `/roadmap` "Start a task" step) | Locates the card by grepping to its heading, without reading the whole file |
