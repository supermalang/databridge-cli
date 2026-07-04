#!/usr/bin/env bash
# guard-visual-update.sh — deny agent self-approval of Playwright visual baselines (MNT-16).
#
# Wire as PreToolUse(Bash) in settings.json. Regenerating the screenshot baselines under
# frontend/tests/e2e/*-snapshots/ is a HUMAN-approval step: a person runs the update, reviews
# the diff, and commits the PNGs. An agent must never re-baseline a failing visual test via Bash
# instead of fixing the regression — that silently defeats the visual gate.
#
# Blocks (with any leading cd/path/npx prefix and any extra flags):
#   - npm run test:e2e:update
#   - playwright test --update-snapshots  (and the -u alias)
#
# Fail-safe OPEN: empty or unparseable tool_input.command never blocks. Unrelated -u usages
# (git push -u, sort -u) are NOT blocked because the -u alias is only honored for playwright
# invocations.

set -uo pipefail

input="$(cat 2>/dev/null || true)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null || true)"

# Fail-safe open: nothing to inspect.
[ -n "$cmd" ] || exit 0

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

REASON="Blocked visual-baseline update: '$cmd'. Regenerating Playwright screenshot baselines is a human-approval step — a human runs 'npm run test:e2e:update', reviews the diff, and commits the PNGs. Do not self-approve baselines; fix the regression instead, then hand the diff to a human for approval."

# --- npm run test:e2e:update (any prefix) ---
if printf '%s' "$cmd" | grep -Eq 'npm run test:e2e:update'; then
  deny "$REASON"
fi

# --- playwright test --update-snapshots / -u (only when playwright is invoked) ---
if printf '%s' "$cmd" | grep -Eq '\bplaywright\b'; then
  if printf '%s' "$cmd" | grep -Eq -- '--update-snapshots|(^| )-u( |$)'; then
    deny "$REASON"
  fi
fi

exit 0
