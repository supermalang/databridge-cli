#!/usr/bin/env bash
# guard-visual-update.sh — deny agent self-approval of Playwright visual baselines (MNT-16, VIS-7).
#
# Wire as PreToolUse(Bash) in settings.json. Regenerating the screenshot baselines under
# frontend/tests/e2e/*-snapshots/ is a HUMAN-approval step: a person runs the update, reviews
# the diff, and commits the PNGs. An agent must never re-baseline a failing visual test via Bash
# instead of fixing the regression — that silently defeats the visual gate.
#
# Blocks (with any leading cd/path/npx prefix and any extra flags):
#   - npm run test:e2e:update
#   - npm run test:visual:storybook:update  (Tier 2 baseline update)
#   - npm run test:visual:update            (Tier 1 dedicated-config baseline update, VIS-9)
#   - playwright test --update-snapshots  (and the -u alias) — matched on the real `playwright
#     test` subcommand invocation, not a bare "playwright" substring anywhere in the command
#     (e.g. a branch name like chore/playwright-workers-4, or free text in a commit message).
#
# Fail-safe OPEN: empty or unparseable tool_input.command never blocks. Unrelated -u usages
# (git push -u, sort -u) are NOT blocked because the -u alias is only honored for playwright
# test invocations.
#
# Command extraction (VIS-7): pure-bash/grep+sed field extraction — no jq dependency, so a
# missing jq binary can no longer silently short-circuit this hook into a no-op fail-open.

set -uo pipefail

input="$(cat 2>/dev/null || true)"

# --- Extract tool_input.command from the PreToolUse JSON payload without jq. -----------------
# Locate the `"command"` key, skip past ':' and any whitespace to the opening quote, then walk
# the string a character at a time so JSON escape sequences (\" \\ \n ...) are decoded correctly
# and the true closing (unescaped) quote is found — a plain grep/sed one-liner can't reliably
# tell an escaped quote from a terminating one.
extract_command() {
  local json="$1" marker='"command"' rest ch esc result i len

  case "$json" in
    *"$marker"*) ;;
    *) printf ''; return 0 ;;
  esac
  rest="${json#*"$marker"}"
  rest="${rest#*:}"
  while [ "${rest:0:1}" = " " ] || [ "${rest:0:1}" = $'\t' ]; do
    rest="${rest:1}"
  done
  [ "${rest:0:1}" = '"' ] || { printf ''; return 0; }
  rest="${rest:1}"

  result=''
  i=0
  len=${#rest}
  while [ "$i" -lt "$len" ]; do
    ch="${rest:$i:1}"
    if [ "$ch" = '\' ]; then
      i=$((i + 1))
      esc="${rest:$i:1}"
      case "$esc" in
        '"') result+='"' ;;
        '\') result+='\' ;;
        '/') result+='/' ;;
        n) result+=$'\n' ;;
        t) result+=$'\t' ;;
        r) result+=$'\r' ;;
        *) result+="$esc" ;;
      esac
      i=$((i + 1))
    elif [ "$ch" = '"' ]; then
      break
    else
      result+="$ch"
      i=$((i + 1))
    fi
  done
  printf '%s' "$result"
}

cmd="$(extract_command "$input")"

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

# --- npm run test:e2e:update / test:visual:storybook:update / test:visual:update (any prefix) ---
if printf '%s' "$cmd" | grep -Eq 'npm run test:(e2e:update|visual:storybook:update|visual:update)'; then
  deny "$REASON"
fi

# --- playwright test --update-snapshots / -u (only when the real `playwright test` subcommand
# is actually invoked — not a bare "playwright" substring in a branch name or free-text arg) ---
if printf '%s' "$cmd" | grep -Eq 'playwright[[:space:]]+test'; then
  if printf '%s' "$cmd" | grep -Eq -- '--update-snapshots|(^| )-u( |$)'; then
    deny "$REASON"
  fi
fi

exit 0
