---
name: retro
description: Sprint retrospective — the Agile continuous-improvement ceremony that also closes the sprint. Verifies the sprint-exit checklist (all tasks DoD-done or carried over, usability run on shipped UI, report generated), then reads git history + roadmap outcomes + review blockers and writes a structured retrospective to docs/retros/<date>.md — what went well, what didn't, and concrete action items (unmet exit checks become action items). Read-only on code. Run at the end of a sprint, after /report.
---

# /retro — Sprint Retrospective (databridge-cli)

Continuous-improvement ceremony. Analyzes how the sprint went and what to change —
not what shipped (that's `/report`). Focus is process, not deliverables.

## Permissions

✅ CAN read   : `docs/ROADMAP.md`, git log, review findings, sprint reports
✅ CAN write  : `docs/retros/<YYYY-MM-DD>-<sprint-label>.md`
❌ CANNOT     : modify source, tests, `ROADMAP.md`, or assign blame to individuals
❌ CANNOT     : invent problems — quiet sprints get short retros

## Workflow

### 1 — Gather evidence

```bash
# Cards completed this sprint
grep -E "\- \[x\]" docs/ROADMAP.md | tail -20

# Commit patterns
git log --oneline --since="2 weeks ago"

# Review blockers (security-audit / roadmap-verifier findings)
git log --oneline --grep="BLOCK\|blocker\|NOT-DONE" --since="2 weeks ago"
```

Also read the last sprint report if one exists in `docs/reports/`.

### 2 — Identify patterns (not one-off events)

Distinguish:
- **Systemic** — happened 2+ times or reflects a structural gap (vague AC, missing test layer, late security find)
- **One-off** — isolated incident, not worth a retro action

Only systemic issues become action items.

### 3 — Structure the output

Write `docs/retros/<YYYY-MM-DD>-<label>.md` with four sections:

```markdown
## What went well
- <concrete, evidence-backed item>

## What didn't
- <friction point + how many times it appeared>

## Patterns & root causes
- Pattern: <name>
  Root cause: <why it keeps happening>

## Action items

| # | Action | Type | Owner | Target |
|---|---|---|---|---|
| 1 | <concrete action — not "be more careful"> | Process / Skill / Hook / DoR-DoD / Roadmap | Agent or Human | Next sprint |
```

**Action types:**
- **Process** — change how we work (apply directly)
- **Skill** — improve an agent's SKILL.md (apply directly)
- **Hook** — add/modify a `.claude/hooks/` guard (apply directly)
- **DoR-DoD** — tighten the Definition of Ready or Done (apply directly via `/roadmap`)
- **Roadmap** — new feature or fix card needed (hand to `/roadmap`)

### 4 — Route

- Process / Skill / Hook / DoR-DoD changes: describe the change; user can apply via `/roadmap` or direct edit
- Roadmap tasks: hand off to `/roadmap` with the retro evidence as context

## Report back

```
✅ Retro written → docs/retros/<filename>.md
📦 Cards completed : <n>
🔎 Patterns found  : <n>
🔧 Actions         : <n> (<breakdown by type>)
➡️  Roadmap tasks  : <list or none>
```
