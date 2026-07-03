---
name: ship-task
description: Autonomous end-to-end pipeline that ships ONE roadmap task to an open PR. Validates DoR, creates the feature branch + active-task marker, runs test-author (RED) → task-implementer (GREEN, incl. impeccable audit/critique + Playwright screenshots, with bounded self-repair) → parallel security-audit + dep-audit + perf-review + qa-tester/ux-review (UI cards) reviews → roadmap-verifier (DoD, incl. visual-review for UI cards) → commit + mark the card [x] + pr-reviewer's diff-audit/lint + opens a PR. Human touchpoints only: DoR failure, tests still failing after auto-fix, review blockers, and final UAT + review + merge on the PR. Usage: /ship-task <TASK-ID> (e.g. /ship-task MNT-7) or /ship-task open (batch — drains all ready tasks).
---

# ship-task — Autonomous Task Pipeline (databridge-cli)

Adapted from the ai-augmented-coding template's `ship-task`, rewired to this repo's actual agents
and conventions. Read **CLAUDE.md** (Development workflow + Agents) before relying on it.

## What's different from the upstream template

| Template step/agent | Here |
|---|---|
| `test-writer` (RED/GREEN) | `roadmap-test-author` (RED) — author and implementer are separate, tests are frozen |
| `coder` | `roadmap-task-implementer` (GREEN) — also runs impeccable audit/critique + Playwright screenshots |
| `debugger` (Fix routing) | `roadmap-task-implementer` with explicit root-cause prompt (same agent, different framing) |
| `qa-tester` (screenshot capture) | folded into `roadmap-task-implementer`; `qa-tester`'s own AC-verification pass still runs separately in Review (UI cards) |
| `ux-review` | runs separately in Review, report-only (UI cards) — same gating as `qa-tester` |
| `debugger` self-repair loop | re-dispatch `roadmap-task-implementer` (bounded) |
| `security-audit`, `dep-audit`, `perf-review` | same names (local agents), always run in Review |
| `visual-review` | not dispatched directly by this script — `roadmap-verifier` dispatches it during Verify to check the visual DoD line |
| `pr-reviewer` (full gate: DoD + lint + diff-audit + push + PR) | its DoD re-check is **skipped** here (roadmap-verifier already confirmed DoD one phase earlier) — only its diff-audit + lint + push + PR steps run, in Ship |
| `commit` | dispatched in Ship to commit implementation/test changes (lint + secret-scan pre-flight), before the roadmap-flip commit |
| `schema-agent`, `docs`, `perf-measure` | not present — omitted |
| `.current-task` marker | `.claude/.active-task.json` = `{"id","started_at"}` |
| branch off integration | git-flow: `feature/<slug>` or `fix/<slug>` off **develop**; PR → develop |

## Permissions

✅ delegates to: roadmap-card-reviewer, roadmap-test-author, roadmap-task-implementer, debugger,
   security-audit, dep-audit, perf-review, qa-tester, ux-review (UI cards), roadmap-verifier
   (which itself dispatches visual-review for UI cards), commit, pr-reviewer
❌ never merges PRs — returns the PR URL for human UAT + review
❌ never marks a card `[x]` unless `roadmap-verifier` returns DONE

## How to use

```
/ship-task MNT-7          # single task by ID
/ship-task open           # batch — drains all ready tasks in priority order (P0 → P1 → P2)
```

The ID must match a card in `docs/ROADMAP.md`. If it doesn't exist, stop and tell the user to add
it via `/roadmap` first. Do not run on `main`/`develop` (the pipeline creates a feature branch).

## Type-based routing (Fix vs Feature)

Read the card's `Type:` field:
- **Type: Fix** → GREEN phase uses a root-cause-first prompt to `roadmap-task-implementer`:
  reproduce the bug → identify root cause → apply minimal fix. Tests written by `roadmap-test-author`
  still cover the fix (regression + new behaviour).
- **Type: Feature** (or absent) → standard full-implementation prompt to `roadmap-task-implementer`.

Both types go through the same RED → GREEN → Review → Verify → Ship phases.

## Invoking the Workflow

When invoked with `/ship-task <TASK-ID>`, call the **Workflow** tool immediately with `args` set to
the task ID string and the script below. For `/ship-task open`, pass `"open"` as args.
Invoking `/ship-task` is the user's explicit opt-in for multi-agent orchestration — do not ask
for confirmation.

```js
export const meta = {
  name: 'ship-task',
  description: 'Ship one roadmap task (or all ready tasks) to an open PR (databridge-cli)',
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

// ── Batch mode: /ship-task open ──────────────────────────────────────────────
if (args === 'open') {
  phase('Validate')
  const BATCH_SCHEMA = {
    type: 'object',
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'type', 'priority', 'dorMet', 'dorMissing'],
          properties: {
            id:         { type: 'string' },
            title:      { type: 'string' },
            type:       { type: 'string' },
            priority:   { type: 'string' },
            dorMet:     { type: 'boolean' },
            dorMissing: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  }
  const batch = await agent(
    'Read docs/ROADMAP.md. Find every open card (- [ ]) and check its Definition of Ready ' +
    '(Acceptance criteria concrete + testable; Unit/E2E/UAT filled or N/A with reason; Files ' +
    'identified; one deliverable; no unresolved blocking dependencies).\n' +
    'Return all open cards sorted: P0 first, then P1, then P2, then no-priority (treat as P1). ' +
    'For each: id, title, type (Feature/Fix or "Feature" if absent), priority (P0/P1/P2), ' +
    'dorMet (bool), dorMissing (array of strings — empty if dorMet).',
    { schema: BATCH_SCHEMA, phase: 'Validate', agentType: 'roadmap-card-reviewer' }
  )
  if (!batch) return { status: 'error', reason: 'Could not read roadmap for batch mode' }

  const ready    = batch.tasks.filter(t => t.dorMet)
  const notReady = batch.tasks.filter(t => !t.dorMet)

  log(`Batch: ${ready.length} ready, ${notReady.length} not-ready`)
  if (notReady.length) log('Not-ready: ' + notReady.map(t => `${t.id} (${t.dorMissing.join('; ')})`).join(' | '))
  if (!ready.length) return { status: 'done', shipped: [], notReady: notReady.map(t => t.id), reason: 'No tasks ready to ship' }

  const results = []
  for (const task of ready) {
    log(`▶ Starting ${task.id} — "${task.title}" [${task.priority ?? 'P1'}]`)
    const result = await workflow('ship-task', task.id)
    results.push({ id: task.id, ...result })
    if (result.status === 'blocked') {
      log(`⚠ ${task.id} blocked — continuing to next task`)
    }
  }
  const shipped = results.filter(r => r.status === 'done')
  const blocked = results.filter(r => r.status === 'blocked')
  log(`Batch complete: ${shipped.length} shipped, ${blocked.length} blocked, ${notReady.length} not-ready`)
  return { status: 'done', shipped: shipped.map(r => r.id), blocked: blocked.map(r => ({ id: r.id, reason: r.reason })), notReady: notReady.map(t => t.id) }
}

// ── Single-task mode ─────────────────────────────────────────────────────────
const TASK_ID = args
if (!TASK_ID) return { status: 'error', reason: 'No task ID. Usage: /ship-task <ID> or /ship-task open' }

const DOR_SCHEMA = {
  type: 'object',
  required: ['taskTitle', 'taskBlock', 'taskType', 'touchesUI', 'dorMet', 'dorMissing'],
  properties: {
    taskTitle:  { type: 'string' },
    taskBlock:  { type: 'string' },
    taskType:   { type: 'string' },
    touchesUI:  { type: 'boolean' },
    dorMet:     { type: 'boolean' },
    dorMissing: { type: 'array', items: { type: 'string' } },
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

// ── Phase 0: Validate DoR ────────────────────────────────────────────────────
phase('Validate')
const dor = await agent(
  'Read .claude/agents/roadmap-card-reviewer.md and act as that reviewer for card "' + TASK_ID + '".\n' +
  'Read its block in docs/ROADMAP.md (heading to next heading). Return:\n' +
  '- taskTitle: short title after the em dash\n' +
  '- taskBlock: the full markdown block\n' +
  '- taskType: the value of the "Type:" field ("Feature" if absent)\n' +
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
const isFix = (dor.taskType ?? '').toLowerCase() === 'fix'
log('✅ DoR satisfied — "' + dor.taskTitle + '" [' + (isFix ? 'Fix' : 'Feature') + ']')

// ── Phase 1: Setup (branch + active-task marker) ─────────────────────────────
phase('Setup')
const branchPrefix = isFix ? 'fix' : 'feature'
const slug = TASK_ID.toLowerCase().replace(/[^a-z0-9]+/g, '-')
await agent(
  'Set up the dev environment for task ' + TASK_ID + ' in databridge-cli (git-flow).\n' +
  '1. Ensure you are NOT on main or develop. Create/switch the branch:\n' +
  '   git switch develop && git pull --ff-only 2>/dev/null; git switch -c ' + branchPrefix + '/' + slug +
  '   (if it already exists: git switch ' + branchPrefix + '/' + slug + ')\n' +
  '2. Write .claude/.active-task.json with EXACTLY this JSON (real UTC timestamp from `date -u +%Y-%m-%dT%H:%M:%SZ`):\n' +
  '   {"id":"' + TASK_ID + '","started_at":"<iso8601-utc>"}\n' +
  '3. Confirm the branch name and that the marker file exists with the correct id.',
  { phase: 'Setup' }
)

// ── Phase 2: RED — author the failing tests ──────────────────────────────────
phase('RED')
const RED_SCHEMA = {
  type: 'object',
  required: ['testFiles', 'redConfirmed'],
  properties: {
    testFiles:    { type: 'array', items: { type: 'string' } },
    redConfirmed: { type: 'boolean' },
    failReason:   { type: 'string' },
  },
}
const red = await agent(
  'Read .claude/agents/roadmap-test-author.md and follow it exactly for task ' + TASK_ID + '.\n' +
  'Write unit + (for UI-facing cards) Playwright E2E tests strictly from the Acceptance criteria. ' +
  'Do NOT read or write implementation. Prove the tests FAIL (red) for the right reason.\n\n' +
  'Card:\n' + dor.taskBlock + '\n\n' +
  'Return: testFiles (array of written test paths), ' +
  'redConfirmed (true ONLY if tests fail because the behaviour is missing — not an import or fixture error), ' +
  'failReason (one-line reason the tests fail).',
  { schema: RED_SCHEMA, phase: 'RED', agentType: 'roadmap-test-author' }
)
if (!red) return { status: 'error', reason: 'Test author failed for ' + TASK_ID }
if (!red.redConfirmed) {
  log('🚫 RED gate: tests pass before any implementation — vacuous. Rewrite from AC so they fail.')
  return {
    status: 'blocked',
    reason: 'RED gate failed: tests passed before implementation. A passing RED test proves nothing — ' +
            'it is either vacuous or reverse-engineered from existing code. Rewrite from acceptance criteria.',
    taskId: TASK_ID,
  }
}
log('✅ RED confirmed — ' + (red.failReason || 'tests fail for the right reason'))

// ── Phase 3: GREEN — implement (Feature) or debug (Fix), with bounded self-repair
phase('GREEN')

async function implement(extra) {
  if (isFix) {
    // Fix tasks: dedicated debugger — reproduce → root cause → minimal fix
    return await agent(
      'Read .claude/agents/debugger.md and follow it exactly for task ' + TASK_ID + '.\n' +
      'The RED tests are already written and FROZEN — they are the oracle. Reproduce the failure, ' +
      'identify the root cause precisely (file:line), apply the minimal fix. NEVER edit tests.\n\n' +
      'Card:\n' + dor.taskBlock + '\n' + (extra || '') + '\n\n' +
      'Report: testsPassed (bool), filesChanged (array), failures (empty if green), summary (root cause + fix).',
      { schema: IMPL_SCHEMA, phase: 'GREEN', agentType: 'debugger' }
    )
  } else {
    // Feature tasks: full implementer with visual checks
    return await agent(
      'Read .claude/agents/roadmap-task-implementer.md and follow it exactly for task ' + TASK_ID + '.\n' +
      'The tests are already written and FROZEN — make them pass with minimal code; NEVER edit tests. ' +
      'Run the visual checks (impeccable audit/critique + Playwright screenshots at all three viewports ' +
      'if touchesUI=' + dor.touchesUI + '). Honor the active-task marker and the card\'s stated Files.\n\n' +
      'Card:\n' + dor.taskBlock + '\n' + (extra || '') + '\n\n' +
      'Report: testsPassed (bool, from running the card\'s Verify command), filesChanged (array), ' +
      'failures (array of failing tests, empty if green), summary.',
      { schema: IMPL_SCHEMA, phase: 'GREEN', agentType: 'roadmap-task-implementer' }
    )
  }
}
let impl = await implement('')
const MAX_FIX = 2
let attempts = 0
while ((!impl || !impl.testsPassed) && attempts < MAX_FIX) {
  attempts++
  const fails = impl ? impl.failures : ['agent failed']
  log('🔧 GREEN failing — self-repair ' + attempts + '/' + MAX_FIX + '…')
  impl = await implement('These tests still fail — root-cause and fix the IMPLEMENTATION only:\n' + JSON.stringify(fails))
}
if (!impl || !impl.testsPassed) {
  log('🚫 Tests still failing after ' + MAX_FIX + ' attempt(s) — needs a human')
  return { status: 'blocked', reason: 'Tests not green after implementation + ' + MAX_FIX + ' self-repair attempts', taskId: TASK_ID, failures: impl ? impl.failures : [] }
}
log('✅ GREEN — tests pass' + (attempts ? ' (after ' + attempts + ' self-repair)' : '') + '; visual checks done')

// ── Phase 4: Parallel reviews — security · deps · perf · QA · UX ────────────
phase('Review')
const reviewAgents = [
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
  () => agent(
    'Read .claude/agents/perf-review.md and follow it exactly for task ' + TASK_ID + '. ' +
    'Run in report-only mode. Check the diff for N+1 queries, unbounded selects, over-fetching, ' +
    'unparallelised async, and missing indexes. ' +
    'Return label="perf-review", blockers (Critical/High patterns), warnings (advisory).',
    { schema: REVIEW_SCHEMA, phase: 'Review', agentType: 'perf-review' }
  ),
]
if (dor.touchesUI) {
  reviewAgents.push(() => agent(
    'Read .claude/agents/qa-tester.md and follow it exactly for task ' + TASK_ID + '. ' +
    'Verify acceptance criteria from the user\'s perspective: run the Playwright E2E suite, ' +
    'review screenshots, check each AC. Report-only — do not sign the roadmap UAT field yet. ' +
    'Return label="qa-tester", blockers (unmet criteria or broken screenshots), warnings.',
    { schema: REVIEW_SCHEMA, phase: 'Review', agentType: 'qa-tester' }
  ))
  reviewAgents.push(() => agent(
    'Read .claude/agents/ux-review.md and follow it exactly for task ' + TASK_ID + ', in report-only ' +
    'mode. Audit the changed UI across the 7 structural dimensions (language, badges, icons, layout, ' +
    'component reuse, accessibility, consistency) against DESIGN.md\'s tokens. Do not edit anything. ' +
    'Return label="ux-review", blockers (Critical/High deviations), warnings (Minor deviations).',
    { schema: REVIEW_SCHEMA, phase: 'Review', agentType: 'ux-review' }
  ))
}
const reviews = await parallel(reviewAgents)
const ok = reviews.filter(Boolean)
const blockers = ok.flatMap(r => r.blockers)
const warnings = ok.flatMap(r => r.warnings)
if (warnings.length) log('⚠️  ' + warnings.join(' | '))
if (blockers.length) {
  log('🚫 ' + blockers.length + ' review blocker(s) — stopped before PR')
  return { status: 'blocked', reason: 'Review blockers must be resolved before a PR', taskId: TASK_ID, blockers, warnings }
}
log('✅ No review blockers')

// ── Phase 5: Verify DoD ──────────────────────────────────────────────────────
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

// ── Phase 6: Ship — commit, mark [x], diff-audit + push + PR ─────────────────
phase('Ship')

// 6a — commit the implementation/test changes via the dedicated commit agent (lint +
// secret/debug-string pre-flight baked in; runs non-interactively when dispatched here).
await agent(
  'Read .claude/agents/commit.md and follow it exactly for task ' + TASK_ID + '. Stage and commit ' +
  'any uncommitted implementation/test changes for this task. Autonomous mode — proceed without ' +
  'asking for confirmation.',
  { phase: 'Ship', agentType: 'commit' }
)

// 6b — flip the roadmap card, update Global status, clear the active-task marker.
await agent(
  'Follow the /roadmap Rule 0 for task ' + TASK_ID + ': read docs/ROADMAP.md whole, flip the card ' +
  'from "- [ ]" to "- [x]", append "· **Completed:** <today, YYYY-MM-DD>" to its Created line, ' +
  'update the matching Global status count, and Write the WHOLE conforming file. If the roadmap ' +
  'guard blocks the write, leave the card unchecked and note it. Then delete ' +
  '.claude/.active-task.json. Commit this roadmap/marker change with a Conventional Commit ' +
  '("docs(roadmap): mark ' + TASK_ID + ' done — <short title>").',
  { phase: 'Ship' }
)

// 6c — pr-reviewer's diff-audit + push + PR ONLY — deliberately skip its own "Verify
// Definition of Done" step, since roadmap-verifier already confirmed DoD one phase earlier;
// re-running the full test/E2E suite a third time is wasted work, not extra safety.
const ship = await agent(
  'Read .claude/agents/pr-reviewer.md. Do its "Diff audit" and "Push + PR" steps ONLY for task ' +
  TASK_ID + ' — SKIP "Verify Definition of Done" entirely (already confirmed by roadmap-verifier ' +
  'in this run\'s Verify phase; do not re-run tests/E2E).\n' +
  'Diff audit (git diff develop...HEAD): hardcoded secrets/tokens, console.log/print debug ' +
  'leftovers, new endpoints missing require_role(), DB queries not membership-scoped, and (if ' +
  'web/db/models.py changed) a present Alembic migration. Any finding blocks the push.\n' +
  'Lint: python -m ruff check src/ web/ (if available)' + (dor.touchesUI ? ' and cd frontend && npm run lint' : '') +
  ' — a lint error blocks the push.\n' +
  'If clean: push the branch and open a PR to develop with `gh pr create --base develop`, using ' +
  'pr-reviewer\'s PR body template — the card\'s UAT steps as an unchecked checklist, the review ' +
  'warnings (' + JSON.stringify(warnings) + ') under "Review notes", and confirm screenshots are ' +
  'committed. Never merge.\n' +
  'Return done=true and prUrl=<the PR URL>, or done=false and reasons=<diff-audit/lint findings>.',
  { schema: VERDICT_SCHEMA, phase: 'Ship', agentType: 'pr-reviewer' }
)
if (!ship || !ship.done) {
  log('🚫 Ship-time diff audit / lint blocked the PR — ' + (ship ? ship.reasons.join('; ') : 'agent failed'))
  return { status: 'blocked', reason: 'pr-reviewer diff audit or lint failed', taskId: TASK_ID, reasons: ship ? ship.reasons : [] }
}
const prUrl = ship.prUrl || '(see Ship log)'
log('🎉 ' + TASK_ID + ' — pipeline complete. PR: ' + prUrl + ' · Human UAT + review + merge are yours.')
return { status: 'done', taskId: TASK_ID, prUrl, warnings, awaiting: 'human UAT + review + merge on the PR' }
```

## Human touchpoints

Control returns to you only when:

| Situation | What to do |
|---|---|
| DoR not met | Fix the card's missing fields via `/roadmap`, then re-run `/ship-task <ID>` |
| RED gate fails | Tests passed before any implementation — rewrite tests so they fail for the right reason, re-run |
| Tests still failing after 2 self-repair attempts | Review the failures, fix manually, re-run |
| Review blockers (security/dep) | Resolve the listed blockers, then re-run |
| PR opened | Run **human UAT** against the PR, tick the UAT checklist, review the diff + screenshots, then **merge** |
| Batch: a task blocked | The pipeline continues to the next task; blocked items need manual resolution |

Everything else — branch + marker, RED tests, implementation, impeccable + Playwright visual checks,
the self-repair loop, security + dependency reviews, the DoD verify, commit, `[x]`, and PR creation —
runs without prompting. Final user acceptance is always yours.
