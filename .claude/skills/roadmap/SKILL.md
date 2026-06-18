---
name: roadmap
description: Use whenever adding, editing, starting, or completing work tracked in docs/ROADMAP.md. Enforces the task-card template (global Definition of Ready + Definition of Done; per-card Acceptance criteria, Unit tests, E2E, UAT), the tests-first / separate-author rule, and sets/clears the active-task marker that unblocks edits to src/, web/, frontend/src/, tests/.
---

# Roadmap skill

`docs/ROADMAP.md` is the single tracked source of work. Every change goes through this skill.
Hooks back it up: `guard-roadmap` (template), `guard-coding` (marker gate), `guard-ready` (DoR
at marker write), `guard-git-flow` + `guard-branch` (no commits/code-edits on main/develop).

## Rule 0 — rewrite the whole file
Never `Edit` `docs/ROADMAP.md` (the guard blocks partial edits). Read it, compute the full new
content, `Write` the whole file.

## Template
- The header carries, once: `## Definition of Ready` (entry gate), `## Definition of Done`
  (exit gate), and a `## Global status` table.
  - **DoR:** AC concrete + testable · Unit/E2E/UAT filled (no `TBD`; E2E + UAT may be
    `N/A (reason)` for non-UI/CLI cards) · Files identified · dependencies resolved · scoped to
    one deliverable · on a derived branch.
  - **DoD:** unit + E2E green · visual baseline approved · impeccable audit/critique clean ·
    UAT signed (UI-facing cards only; non-UI/CLI cards are `N/A` — PR review is the human gate) ·
    committed.
- Each task card carries (labels checked verbatim by the guard):
  `**Acceptance criteria**` (testable, behavior-specific), `**Unit tests:**` (pytest file +
  cases), `**E2E:**` (Playwright spec + visual: impeccable audit/critique + `toHaveScreenshot`
  baselines at all three viewports — mobile 390×844, tablet 820×1180, desktop 1440×900;
  `N/A (reason)` for non-UI), `**UAT:**` (manual numbered steps for UI-facing cards; `N/A (reason)`
  for non-UI/CLI cards — UAT moves in lockstep with E2E). Plus Files / Config impact /
  Verify. ID = `AREA-N`. Each sprint adds golden-path `SP-N-E` + sprint UAT.

## Operations
- **Add/edit a task:** read roadmap → write the whole file with the card following the
  template → keep Global status counts in sync. (Optionally dispatch `roadmap-planner` to draft
  and `roadmap-card-reviewer` to validate Readiness.)
- **Start a task (unlocks coding):** confirm it's `- [ ]` **and Ready** (DoR). Write
  `.claude/.active-task.json` = `{"id":"AREA-N","started_at":"<ISO8601 UTC>"}`. `guard-ready`
  refuses the marker for a card that isn't open + structurally Ready. Then tests-first.
- **Tests-first, separate authors:** `roadmap-test-author` writes tests from the Acceptance
  criteria and proves they FAIL (red) before any code. `roadmap-task-implementer` makes them
  pass and MUST NOT edit tests. A test believed wrong is escalated, not edited.
- **Complete a task:** dispatch `roadmap-verifier` (DoD exit gate). Only on `DONE` → write the
  roadmap with `- [x]` + updated Global status → delete `.claude/.active-task.json`.

## Gate before coding
No feature/bug/fix code without the task existing here and started via this skill. Minor
config, docs, and harness/tooling are exempt. Work happens on a `feature/ fix/ chore/` branch
off `develop` — never on main/develop. PR feature → develop, release PR develop → main.
