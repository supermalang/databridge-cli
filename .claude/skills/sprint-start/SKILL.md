---
name: sprint-start
description: Sprint kickoff ritual. Verifies every planned task satisfies the Definition of Ready (hard gate) and that the story map / user journey is current with gaps planned (recommendation) before the sprint begins. Use when a new sprint is about to start.
---

# /sprint-start — Sprint Kickoff

Sprint entry ritual. Gates the sprint on DoR compliance and recommends a story-map check before work begins.

## Permissions

✅ CAN read   : `docs/ROADMAP.md`, `docs/story-map.md`, git log
❌ CANNOT     : modify source, tests, or `ROADMAP.md`

## Workflow

### 1 — DoR gate (hard block)

For every task planned for this sprint, verify the Definition of Ready:

```bash
# List open tasks
grep -E "^\- \[ \]" docs/ROADMAP.md
```

Check each card for:
- [ ] Acceptance criteria are concrete and testable
- [ ] Unit tests, E2E, and UAT fields filled (no blank / TBD / placeholder)
- [ ] All affected files identified
- [ ] No unresolved blocking dependencies
- [ ] Scoped to one deliverable (INVEST: Independent + Small)
- [ ] Priority declared (P0 / P1 / P2)
- [ ] On a derived branch off `develop`

**If any task fails DoR: block the sprint.** List the failing tasks and missing fields. Do not proceed until the user resolves them or removes the task from the sprint scope.

### 2b — Story-map / journey check (sprint-entry ritual)

Beyond per-task DoR, verify the sprint-entry check from Sprint rituals in the roadmap: is the
story map current, and are the user-journey gaps it surfaces either planned into a task or consciously
deferred? If `docs/story-map.md` is missing or stale, or it flags a ⚠️ GAP that the sprint needs,
recommend running `/story-map` (then `/roadmap` for any gap) before the sprint starts. This is a
recommendation, not a hard block like DoR — note it in the report.

## Report back

```
✅ Sprint-start check complete
🟢 DoR gate     : <n> tasks ready / <n> blocked
⚠️  Story map   : current | stale | missing (recommendation)
➡️  Action      : Ready to start | Resolve DoR issues first
```
