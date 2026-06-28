---
name: roadmap-status
description: Quick health snapshot of docs/ROADMAP.md — counts done/in-progress/blocked tasks, surfaces P0s, and shows what's next. Read-only. Use for standups, planning sessions, or before starting a new task.
---

# /roadmap-status — Roadmap Health Snapshot (databridge-cli)

Read-only. Reads `docs/ROADMAP.md` and returns a terse health snapshot.
Does not modify the roadmap — use `/roadmap` for that.

## Usage

```
/roadmap-status             # full snapshot
/roadmap-status --area ME   # filter to one section (e.g. "M&E capabilities")
```

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
Count `- [ ]` (open) vs `- [x]` (done) per section if the table is stale.

### 4 — Identify priorities

Look for `Priority: P0`, `Priority: P1`, `Priority: P2` fields in open cards.
Cards without a Priority field default to P1.

### 5 — Surface risks

Any card where the description mentions "blocked", "depends on", or has unresolved
dependency IDs still open — surface it.

## Constraints

- Read-only: never modify `docs/ROADMAP.md`
- Never start a task or mark cards `[x]`
- If asked to start a task, redirect to `/roadmap` + `/ship-task`
