---
name: visual-review
description: Read-only report of visual-approval state — which changed screenshot baselines are approved / rejected / pending, per task. Backed by visual-review/visual-approvals.json (written only by a human via visual-review/review-app/, or by hand). Use before merging a UI-facing PR, or when roadmap-verifier needs to check the "visual baseline approved" DoD line.
---

# /visual-review — Visual Approval State Reporter (databridge-cli)

Read-only (see `.claude/agents/visual-review.md` for the full playbook — this skill just
dispatches it). Never re-baselines; never edits `visual-approvals.json` or the roadmap.

## Usage

```
/visual-review              # report on the current branch's changed baselines
```

## What it reports

For every baseline PNG under `frontend/tests/e2e/**-snapshots/`, `frontend/tests/storybook/**-snapshots/`,
or (from VIS-9) `visual-review/baselines/**/` that differs from `develop` (committed or
uncommitted), look it up in `visual-review/visual-approvals.json` by its id — path relative to
`frontend/tests/` for the first two locations, path relative to `visual-review/baselines/` for
the third (POSIX separators either way) — and classify:

- **approved** — ledger entry with `decision: "approved"`
- **rejected** — ledger entry with `decision: "rejected"`
- **pending** — no ledger entry at all (default — a changed baseline is never assumed approved
  just because no one rejected it)

Overall verdict is `clear` only when there are zero `pending` and zero `rejected` entries.

## How approvals get into the ledger

A **human** runs the Tier 3 local review app (`node visual-review/review-app/server.mjs`
→ `http://localhost:4444`), reviews each changed baseline side-by-side against the previous
one, and clicks Approve (re-baselines by file copy + writes `decision: "approved"`) or Reject
(writes `decision: "rejected"`, no re-baseline). See its README for the full loop. Agents cannot
do this — `.claude/hooks/guard-visual-update.sh` blocks any Bash-issued re-baseline command, and
this skill/agent has no `Edit`/`Write` tool access to the ledger either.

## Where this plugs in

- `roadmap-verifier` consults `/visual-review` when checking the DoD's "visual baseline
  approved" line for a UI-facing card — a `pending`/`rejected` verdict on that card's own
  baselines is a named FAIL, not a silent pass.
- A card whose baselines are all `approved` (or which touches no visual baseline at all)
  satisfies that DoD line.

## Constraints

- Read-only: never modifies `visual-approvals.json`, baseline PNGs, or `docs/ROADMAP.md`
- Never runs `--update-snapshots` or any re-baseline command
- If asked to "approve" or "bless" a baseline, redirect to the human-run review app
