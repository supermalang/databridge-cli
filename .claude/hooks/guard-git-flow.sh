#!/usr/bin/env bash
# PreToolUse(Bash) guard: block git commit/push on protected branches (main, develop).
set -euo pipefail
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // ""')"
printf '%s' "$cmd" | grep -qE '\bgit\b.*\b(commit|push)\b' || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
case "$branch" in
  main|develop)
    echo "Refusing git commit/push on '$branch' — protected branches receive merges only. Create a derived branch: git switch -c feature/<desc> (from develop)." >&2
    exit 2;;
esac
exit 0
