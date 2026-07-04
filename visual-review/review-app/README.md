# Visual review app (Tier 3 — VIS-4, relocated by VIS-9)

A thin, dependency-free local web app for approving screenshot baselines by clicking — a
baseline-vs-candidate side-by-side with **Approve / Reject**. Node built-ins only; no
`npm install` needed for the app itself.

## Run (human only)

```bash
# 1. Produce candidates first (either harness — this app watches both output trees):
cd frontend && npm run test:visual               # Tier 1 dedicated visual config
cd frontend && npm run storybook:build && npm run test:visual:storybook   # Tier 2 — components

# 2. Launch the review app from the repo root and open it:
node visual-review/review-app/server.mjs   # -> http://localhost:4444
```

Approve → the candidate PNG is copied over the baseline (**re-baselined**) and a record is
written to `visual-review/visual-approvals.json`. Reject → a `rejected` record is written, no
re-baseline. Both are read by `/visual-review` and gate the roadmap DoD via `roadmap-verifier`.

## Why this is allowed when agents are blocked

Re-baselining here is a **file copy in Node**, not a `playwright ... --update-snapshots` shell
command — so `.claude/hooks/guard-visual-update.sh` (which blocks *agents'* Bash update
commands) does not apply here. A **human** runs this app. Same rule, honoured: only a human (or
this app they drive) blesses baselines.

**Known gap, accepted deliberately (matches the upstream template's own posture):** nothing
technically stops an agent from hitting `POST /api/approve` directly (`curl`, or importing
`lib.mjs` and calling `approve()`), or from hand-editing `visual-approvals.json` / copying a
candidate over a baseline via plain Bash — neither `visual-review/baselines/**` nor
`visual-review/visual-approvals.json` are covered by any existing guard. "Human-only" here is a
convention, not an enforced boundary, same as it is upstream. If this ever needs to be a hard
boundary rather than a convention, extend `guard-visual-update.sh` (or add a sibling guard) to
also deny Bash-issued requests to this app's endpoints and direct writes to these paths.

## Config (env, optional)

| Var | Default |
|---|---|
| `PORT` | `4444` |
| `VISUAL_BASELINES_DIR` | `visual-review/baselines` (Tier 1; Tier 2 coverage under `visual-review/storybook/baselines/` is added by VIS-13) |
| `VISUAL_OUTPUT_DIR` | `visual-review/results/output` (shared by both Playwright configs) |
| `VISUAL_APPROVALS` | `visual-review/visual-approvals.json` |

Task association defaults to the `id` in `.claude/.active-task.json`.

## Test

```bash
node visual-review/review-app/test.mjs        # assertions on the approve/reject/find logic
```
