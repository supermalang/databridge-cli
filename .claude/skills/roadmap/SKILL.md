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
- **Date fields (required on every card, stamped automatically):**
  - `**Created:** YYYY-MM-DD` — stamped when the card is first written; never changed
  - `**Started:** YYYY-MM-DD` — stamped (inline on the Created line) when the active-task marker is written
  - `**Completed:** YYYY-MM-DD` — stamped (inline on the Created line) when the card flips `[x]`
  - Format: `**Created:** 2026-06-28 · **Completed:** 2026-06-28` (dot-separated on one line)
  - The guard checks for `**Created:**` on every card; missing it is a template violation.

## DoR authoring checklist (run before declaring a card Ready)

Use this when writing or reviewing a new card. Each item must be satisfied before the card can
be started. The card-reviewer checks all of these — failing any one blocks the task.

| # | Check | Common failure mode |
|---|---|---|
| 1 | **AC = user-observable outcomes** | AC describes test implementation ("a new E2E test stubs X and asserts Y") instead of observable behavior ("when X happens, the UI shows Y") — move test detail to E2E field |
| 2 | **AC covers every HTTP behavior** | An endpoint change (status code, response shape) has no AC clause — add one per distinct status code or field |
| 3 | **Files = every modified file** | Only the backend file is listed; the frontend component or test file is missing — list `frontend/src/pages/Foo.jsx` and `tests/test_foo.py` explicitly |
| 4 | **Unit tests = one named case per AC clause** | Unit tests says "add a test for X" without a function name — name each case and its assertion |
| 5 | **Unit tests cover the endpoint if AC mentions HTTP** | AC says "endpoint returns 500" but unit tests only cover the Python function — add a `TestClient`-based case in `tests/test_api_*.py` |
| 6 | **E2E includes impeccable audit/critique** | E2E lists `toHaveScreenshot` baselines but omits `npx impeccable audit` + `npx impeccable critique` on the new/changed view |
| 7 | **UAT has a concrete trigger** | UAT says "when the server returns an error" without explaining how to force that error in a real running environment — add a step with a specific mechanism (unset env var, DevTools Override, etc.) |
| 8 | **Global status count is current** | Adding a new card or changing card state without updating the `## Global status` row for that area — recount planned and done |

## Operations
- **Add/edit a task:** read roadmap → write the whole file with the card following the
  template → keep Global status counts in sync. Stamp `**Created:** YYYY-MM-DD` on the new card.
  (Optionally dispatch `roadmap-planner` to draft and `roadmap-card-reviewer` to validate Readiness.)
- **Start a task (unlocks coding):** confirm it's `- [ ]` **and Ready** (DoR). Write
  `.claude/.active-task.json` = `{"id":"AREA-N","started_at":"<ISO8601 UTC>"}`. Also update the
  card in the roadmap to append `· **Started:** YYYY-MM-DD` to its Created line. `guard-ready`
  refuses the marker for a card that isn't open + structurally Ready. Then tests-first.
- **Tests-first, separate authors:** `roadmap-test-author` writes tests from the Acceptance
  criteria and proves they FAIL (red) before any code. `roadmap-task-implementer` makes them
  pass and MUST NOT edit tests. A test believed wrong is escalated, not edited.
- **Complete a task:** dispatch `roadmap-verifier` (DoD exit gate). Only on `DONE` → write the
  roadmap with `- [x]` + append `· **Completed:** YYYY-MM-DD` to the card's Created line +
  updated Global status → delete `.claude/.active-task.json`.

## End-of-session hygiene

**Branch sweep (after every session):** Run `git branch -r --no-merged develop` and open PRs
for any completed branches that have no open PR. Completed branches sitting without PRs are
invisible finished work that can accumulate conflicts.

**Manual-PR card closure:** When a card's implementation is completed across multiple manual
PRs (bypassing ship-task), immediately do a cleanup commit on the last branch: flip `[x]`,
update Global status count, delete `.claude/.active-task.json`. Don't leave the card open for
the next session to discover via a RED-gate failure.

## Gate before coding
No feature/bug/fix code without the task existing here and started via this skill. Minor
config, docs, and harness/tooling are exempt. Work happens on a `feature/ fix/ chore/` branch
off `develop` — never on main/develop. PR feature → develop, release PR develop → main.
