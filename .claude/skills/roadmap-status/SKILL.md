---
name: roadmap-status
description: Quick health snapshot of docs/ROADMAP.md — counts done/in-progress/blocked tasks, surfaces P0s, and shows what's next. Read-only. Use for standups, planning sessions, or before starting a new task.
---

# /roadmap-status — Roadmap Health Snapshot (databridge-cli)

Read-only (except `archive` mode, which only ever moves already-`[x]`+`**Completed:**` cards
verbatim — it never edits open work). Reads `docs/ROADMAP.md` and returns a terse health
snapshot, or archives delivered cards. Use `/roadmap` to add/start/complete a card.

## Usage

```
/roadmap-status             # full snapshot
/roadmap-status --area ME   # filter to one section (e.g. "M&E capabilities")
/roadmap-status archive     # sweep delivered cards out of the live file (see below)
```

## Keeping the roadmap lean — read selectively, archive delivered work

`docs/ROADMAP.md` is read by nearly every roadmap-pipeline agent, so it must stay proportional
to **active** work, not cumulative history.

**Read a slice, not the whole file** once the roadmap is large. For one card, grep to its
`- [ ] **<ID> —` / `- [x] **<ID> —` line and read that block (`offset`/`limit`), not the whole
file. For the backlog, read the `## Global status` table + the `## ✅ Delivered (archived)`
ledger, then open only the non-delivered cards you actually need.

**Archive delivered cards** — `/roadmap-status archive`:

```bash
node .claude/skills/roadmap-status/archive.mjs
```

Sweeps every card that is checked `[x]` **and** carries a real `**Completed:** YYYY-MM-DD` date
into `docs/roadmap/archive/<area-slug>.md` (one file per `## <Area>` heading), leaving a
compact ledger row in the live file's **✅ Delivered (archived)** table
(`| ID | Title | Area | ✅ date |`). It is **lossless** (the archived card equals the
original, byte-for-byte), **idempotent** (re-running archives nothing new, never duplicates a
card or a ledger row), a **no-op** when nothing is delivered (creates no files), and
**CRLF-safe** (preserves this file's actual line-ending style). Git history holds the full
cards regardless. Run it at the end of a batch of `/ship-task` completions, or whenever the
live roadmap feels large — **dry-run against a scratch copy first** (see
`.claude/skills/roadmap-status/tests/README.md`) before running it against the real file, since
it's a large structural rewrite. Do not hand-move cards — run the command so the move stays
lossless.

## Output format

```
## Roadmap snapshot — <date>

### Global
| Area | Planned | Done | Remaining |
|---|---|---|---|
| … | … | … | … |
Total: N done / M planned (X%)

### Active task
<ID> — <title> (started <date> per .claude/.active-task.json or "none")

### P0 open items (must-ship/blocking)
- <ID> — <title>

### P1 open items (important, non-blocking)
- <ID> — <title>

### P2 open items (nice-to-have)
- <ID> — <title>

### Blocked / at risk
<any card with a Blocked note, or none>

### What's next (by priority)
1. <P0 item if any>
2. <P1 item>
3. <P1 item>
```

## Workflow

### 1 — Read the roadmap

```bash
cat docs/ROADMAP.md
```

### 2 — Check active task

```bash
cat .claude/.active-task.json 2>/dev/null || echo "none"
```

### 3 — Parse and count

From `## Global status` table: extract Planned and Progress columns.
Count `- [ ]` (open) vs `- [x]` (done) per section if the table is stale — done counts include
rows in the `## ✅ Delivered (archived)` ledger (archived cards are still done, just moved).

### 4 — Identify priorities

Look for `Priority: P0`, `Priority: P1`, `Priority: P2` fields in open cards.
Cards without a Priority field default to P1.

### 5 — Surface risks

Any card where the description mentions "blocked", "depends on", or has unresolved
dependency IDs still open — surface it.

## Constraints

- Snapshot mode is read-only: never modify `docs/ROADMAP.md` yourself
- `archive` mode only ever runs `archive.mjs` — it never hand-edits the file, and it only ever
  moves cards that are already `[x]` + `**Completed:**` dated; it cannot touch open work
- Never start a task or mark cards `[x]`
- If asked to start a task, redirect to `/roadmap` + `/ship-task`
