#!/usr/bin/env bash
# PreToolUse guard: the active-task marker may only be written for an OPEN, structurally-Ready card.
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
case "$fp" in */.claude/.active-task.json|.claude/.active-task.json) ;; *) exit 0 ;; esac
content="$(printf '%s' "$input" | jq -r '.tool_input.content // ""')"
id="$(printf '%s' "$content" | jq -r '.id // ""' 2>/dev/null || echo "")"
root="${CLAUDE_PROJECT_DIR:-$PWD}"; rm="$root/docs/ROADMAP.md"
fail(){ echo "$1" >&2; exit 2; }
[ -n "$id" ] || fail "Active-task marker has no id."
card="$(awk -v id="$id" '
  $0 ~ "^- \\[[ x]\\] \\*\\*"id" " {f=1; b=$0; next}
  f && $0 ~ /^(- \[[ x]\]|## )/ {f=0}
  f {b=b"\n"$0} END{print b}' "$rm")"
[ -n "$card" ] || fail "Task $id not found in docs/ROADMAP.md."
printf '%s' "$card" | grep -q '^- \[ \]' || fail "Task $id is not open ( - [ ] )."
printf '%s' "$card" | grep -qiE 'TBD|TODO' && fail "Task $id not Ready: contains a TBD/TODO placeholder."
miss=""; for l in "Acceptance criteria" "Unit tests" "E2E" "UAT"; do
  printf '%s' "$card" | grep -q "$l" || miss="$miss $l"; done
[ -z "$miss" ] || fail "Task $id not Ready: missing$miss."
exit 0
