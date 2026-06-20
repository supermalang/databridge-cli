---
name: ship-task
description: Autonomous end-to-end pipeline that ships ONE roadmap task to an open PR. Validates DoR, creates the feature branch + active-task marker, runs test-author (RED) → task-implementer (GREEN, incl. impeccable audit/critique + Playwright screenshots, with bounded self-repair) → parallel security-audit + dep-audit reviews → roadmap-verifier (DoD) → marks the card [x] and opens a PR. Human touchpoints only: DoR failure, tests still failing after auto-fix, review blockers, and final UAT + review + merge on the PR. Usage: /ship-task <TASK-ID> (e.g. /ship-task A11Y-1).
---

# ship-task — Autonomous Task Pipeline (databridge-cli)

Adapted from the ai-augmented-coding template's `ship-task`, rewired to this repo's actual agents
and conventions. Read **CLAUDE.md** (Development workflow + Agents) before relying on it.

## What's different from the upstream template

| Template step/agent | Here |
|---|---|
| `test-writer` (RED/GREEN) | `roadmap-test-author` (RED) — author and implementer are separate, tests are frozen |
| `coder` | `roadmap-task-implementer` (GREEN) — also runs impeccable audit/critique + Playwright screenshots |
| `ux-review` + `qa-tester` (visual/UAT screenshots) | folded into `roadmap-task-implementer` |
| `debugger` self-repair loop | re-dispatch `roadmap-task-implementer` (bounded) |
| `security-audit`, `dep-audit` | same names (local agents) |
| `pr-reviewer` (marks [x], opens PR) | `roadmap-verifier` (DoD gate) → ship step marks [x] + `gh pr create` |
| `schema-agent`, `docs`, `perf-*` | not present here — omitted |
| `.current-task` marker | `.claude/.active-task.json` = `{"id","started_at"}` |
| branch off integration | git-flow: `feature/<slug>` off **develop**; PR → develop |

## Permissions

✅ delegates to: roadmap-card-reviewer, roadmap-test-author, roadmap-task-implementer,
   security-audit, dep-audit, roadmap-verifier
❌ never merges PRs — returns the PR URL for human UAT + review
❌ never marks a card `[x]` unless `roadmap-verifier` returns DONE

## How to use

```
/ship-task A11Y-1
```

The ID must match a card in `docs/ROADMAP.md`. If it doesn't exist, stop and tell the user to add
it via `/roadmap` first. Do not run on `main`/`develop` (the pipeline creates a feature branch).

## Invoking the Workflow

When invoked with `/ship-task <TASK-ID>`, call the **Workflow** tool immediately with `args` set to
the task ID string and the script below. Invoking `/ship-task` is the user's explicit opt-in for
multi-agent orchestration — do not ask for confirmation.

```js
export const meta = {
  name: 'ship-task',
  description: 'Ship one roadmap task to an open PR (databridge-cli)',
  phases: [
    { title: 'Validate' },
    { title: 'Setup' },
    { title: 'RED' },
    { title: 'GREEN' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Ship' },
  ],
}

const TASK_ID = args
if (!TASK_ID) return { status: 'error', reason: 'No task ID. Usage: /ship-task <ID>' }

const DOR_SCHEMA = {
  type: 'object',
  required: ['taskTitle', 'taskBlock', 'touchesUI', 'dorMet', 'dorMissing'],
  properties: {
    taskTitle:   { type: 'string' },
    taskBlock:   { type: 'string' },
    touchesUI:   { type: 'boolean' },
    dorMet:      { type: 'boolean' },
    dorMissing:  { type: 'array', items: { type: 'string' } },
  },
}
const IMPL_SCHEMA = {
  type: 'object',
  required: ['testsPassed', 'filesChanged', 'failures'],
  properties: {
    testsPassed:  { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    failures:     { type: 'array', items: { type: 'string' } },
    summary:      { type: 'string' },
  },
}
const REVIEW_SCHEMA = {
  type: 'object',
  required: ['label', 'blockers', 'warnings'],
  properties: {
    label:    { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
}
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['done', 'reasons'],
  properties: {
    done:    { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string' } },
    prUrl:   { type: 'string' },
  },
}

// ── Phase 0: Validate DoR ────────────────────────────────────────────────
phase('Validate')
const dor = await agent(
  'Read .claude/agents/roadmap-card-reviewer.md and act as that reviewer for card "' + TASK_ID + '".\n' +
  'Read its block in docs/ROADMAP.md (heading to next heading). Return:\n' +
  '- taskTitle: short title after the em dash\n' +
  '- taskBlock: the full markdown block\n' +
  "- touchesUI: true if Files include frontend/src or the card is UI-facing\n" +
  '- dorMet: true only if the card is open (- [ ]) AND structurally Ready per the Definition of Ready\n' +
  '  (Acceptance criteria concrete; Unit/E2E/UAT filled or justified N/A; Files identified; one deliverable)\n' +
  '- dorMissing: each unmet DoR item as a string (empty if dorMet)',
  { schema: DOR_SCHEMA, phase: 'Validate', agentType: 'roadmap-card-reviewer' }
)
if (!dor) return { status: 'error', reason: 'Could not read card ' + TASK_ID }
if (!dor.dorMet) {
  log('🚫 DoR not met: ' + dor.dorMissing.join(', '))
  return { status: 'blocked', reason: 'Definition of Ready not satisfied', taskId: TASK_ID, missing: dor.dorMissing }
}
log('✅ DoR satisfied — "' + dor.taskTitle + '"')

// ── Phase 1: Setup (branch + active-task marker) ─────────────────────────
phase('Setup')
const slug = TASK_ID.toLowerCase().replace(/[^a-z0-9]+/g, '-')
await agent(
  'Set up the dev environment for task ' + TASK_ID + ' in databridge-cli (git-flow).\n' +
  '1. Ensure you are NOT on main or develop. Create/switch the branch:\n' +
  '   git switch develop && git pull --ff-only 2>/dev/null; git switch -c feature/' + slug +
  '   (if it already exists: git switch feature/' + slug + ')\n' +
  '2. Write .claude/.active-task.json with EXACTLY this JSON (real UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`):\n' +
  '   {"id":"' + TASK_ID + '","started_at":"<iso8601-utc>"}\n' +
  '3. Confirm the branch name and that the marker file exists with the correct id.',
  { phase: 'Setup' }
)

// ── Phase 2: RED — author the failing tests ──────────────────────────────
phase('RED')
const red = await agent(
  'Read .claude/agents/roadmap-test-author.md and follow it exactly for task ' + TASK_ID + '.\n' +
  'Write unit + (for UI-facing cards) Playwright E2E tests strictly from the Acceptance criteria. ' +
  'Do NOT read or write implementation. Prove the tests FAIL (red) for the right reason.\n\n' +
  'Card:\n' + dor.taskBlock + '\n\n' +
  'Report the test files written and confirm they are red.',
  { phase: 'RED', agentType: 'roadmap-test-author' }
)
if (!red) return { status: 'error', reason: 'Test author failed for ' + TASK_ID }

// ── Phase 3: GREEN — implement, with bounded self-repair ─────────────────
phase('GREEN')
async function implement(extra) {
  return await agent(
    'Read .claude/agents/roadmap-task-implementer.md and follow it exactly for task ' + TASK_ID + '.\n' +
    'The tests are already written and FROZEN — make them pass with minimal code; NEVER edit tests. ' +
    'Run the visual checks (impeccable audit/critique + Playwright screenshots at all three viewports). ' +
    'Honor the active-task marker and the card\'s stated Files.\n\n' +
    'Card:\n' + dor.taskBlock + '\n' + (extra || '') + '\n\n' +
    'Report: testsPassed (bool, from running the card\'s Verify command), filesChanged (array), ' +
    'failures (array of failing tests, empty if green), summary.',
    { schema: IMPL_SCHEMA, phase: 'GREEN', agentType: 'roadmap-task-implementer' }
  )
}
let impl = await implement('')
const MAX_FIX = 2
let attempts = 0
while ((!impl || !impl.testsPassed) && attempts < MAX_FIX) {
  attempts++
  const fails = impl ? impl.failures : ['implementer agent failed']
  log('🔧 GREEN failing — self-repair ' + attempts + '/' + MAX_FIX + '…')
  impl = await implement('These tests still fail — root-cause and fix the IMPLEMENTATION only:\n' + JSON.stringify(fails))
}
if (!impl || !impl.testsPassed) {
  log('🚫 Tests still failing after ' + MAX_FIX + ' attempt(s) — needs a human')
  return { status: 'blocked', reason: 'Tests not green after implementation + ' + MAX_FIX + ' self-repair attempts', taskId: TASK_ID, failures: impl ? impl.failures : [] }
}
log('✅ GREEN — tests pass' + (attempts ? ' (after ' + attempts + ' self-repair)' : '') + '; visual checks done by implementer')

// ── Phase 4: Parallel reviews — security + dependencies ──────────────────
phase('Review')
const reviews = await parallel([
  () => agent(
    'Read .claude/agents/security-audit.md and follow it exactly for task ' + TASK_ID + '. ' +
    'Review ONLY this task\'s diff (git diff against the branch point). ' +
    'Return label="security-audit", blockers (Critical/High), warnings (Moderate/Low).',
    { schema: REVIEW_SCHEMA, phase: 'Review', agentType: 'security-audit' }
  ),
  () => agent(
    'Read .claude/agents/dep-audit.md and follow it exactly. Run the SCA scan (pip-audit + npm audit). ' +
    'Treat Critical/High CVEs with a non-major fix as blockers; major-only fixes and outdated ' +
    '(non-security) packages as warnings. Do NOT apply major bumps. If a tool is unavailable here, ' +
    'return no blockers and one warning saying so. Return label="dep-audit", blockers, warnings.',
    { schema: REVIEW_SCHEMA, phase: 'Review', agentType: 'dep-audit' }
  ),
])
const ok = reviews.filter(Boolean)
const blockers = ok.flatMap(r => r.blockers)
const warnings = ok.flatMap(r => r.warnings)
if (warnings.length) log('⚠️  ' + warnings.join(' | '))
if (blockers.length) {
  log('🚫 ' + blockers.length + ' review blocker(s) — stopped before PR')
  return { status: 'blocked', reason: 'Review blockers must be resolved before a PR', taskId: TASK_ID, blockers, warnings }
}
log('✅ No review blockers')

// ── Phase 5: Verify DoD ──────────────────────────────────────────────────
phase('Verify')
const verdict = await agent(
  'Read .claude/agents/roadmap-verifier.md and act as that DoD exit gate for card ' + TASK_ID + '. ' +
  'Adversarially confirm every Acceptance criterion traces to a passing test, impeccable is clean, ' +
  'no scope creep, and the card is otherwise Done EXCEPT the human gates (UAT sign-off + merge), ' +
  'which happen on the PR. Return done (bool — true if everything except the human PR gates is satisfied) ' +
  'and reasons (array).',
  { schema: VERDICT_SCHEMA, phase: 'Verify', agentType: 'roadmap-verifier' }
)
if (!verdict || !verdict.done) {
  log('🚫 Verifier: NOT-DONE — ' + (verdict ? verdict.reasons.join('; ') : 'agent failed'))
  return { status: 'blocked', reason: 'roadmap-verifier did not pass', taskId: TASK_ID, reasons: verdict ? verdict.reasons : [] }
}
log('✅ Verifier: automated DoD satisfied (human UAT + merge remain)')

// ── Phase 6: Ship — commit, mark [x], open PR ────────────────────────────
phase('Ship')
const ship = await agent(
  'Ship task ' + TASK_ID + ' for review (do NOT merge).\n' +
  '1. Stage and commit any uncommitted implementation/test changes with a Conventional Commit ' +
  '   ("feat(...)"/"fix(...)") ending with the repo\'s Co-Authored-By trailer.\n' +
  '2. Follow the /roadmap Rule 0: read docs/ROADMAP.md whole, flip card ' + TASK_ID + ' from "- [ ]" to "- [x]", ' +
  '   update the matching Global status count, and Write the WHOLE conforming file. ' +
  '   If the roadmap guard blocks the write, leave the card unchecked and note it.\n' +
  '3. Delete .claude/.active-task.json.\n' +
  '4. Commit the roadmap/marker change, push the branch, and open a PR to develop with `gh pr create --base develop`. ' +
  '   The PR body MUST include the card\'s UAT steps as an unchecked checklist for the human reviewer, ' +
  '   list the review warnings (' + JSON.stringify(warnings) + '), and note screenshots are attached/committed.\n' +
  'Return done=true and prUrl=<the PR URL>.',
  { schema: VERDICT_SCHEMA, phase: 'Ship' }
)
const prUrl = ship && ship.prUrl ? ship.prUrl : '(see Ship log)'
log('🎉 ' + TASK_ID + ' — pipeline complete. PR: ' + prUrl + ' · Human UAT + review + merge are yours.')
return { status: 'done', taskId: TASK_ID, prUrl, warnings, awaiting: 'human UAT + review + merge on the PR' }
```

## Human touchpoints

Control returns to you only when:

| Situation | What to do |
|---|---|
| DoR not met | Fix the card's missing fields via `/roadmap`, then re-run `/ship-task <ID>` |
| Tests still failing after 2 self-repair attempts | Review the failures, fix manually, re-run |
| Review blockers (security/dep) | Resolve the listed blockers, then re-run |
| PR opened | Run **human UAT** against the PR, tick the UAT checklist, review the diff + screenshots, then **merge** |

Everything else — branch + marker, RED tests, implementation, impeccable + Playwright visual checks,
the self-repair loop, security + dependency reviews, the DoD verify, commit, `[x]`, and PR creation —
runs without prompting. This mirrors the template's contract: **autonomous up to the PR; final user
acceptance is always yours.**
