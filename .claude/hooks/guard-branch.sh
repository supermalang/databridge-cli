#!/usr/bin/env bash
# PreToolUse(Write|Edit|MultiEdit) guard: block editing gated code on protected branches.
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$fp" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
# Canonicalize (collapse .. and symlinks) before matching so path-traversal can't dodge the gate.
rel="$(realpath -m --relative-to="$root" -- "$fp" 2>/dev/null || printf '%s' "${fp#"$root"/}")"
case "$rel" in src/*|web/*|frontend/src/*|tests/*) ;; *) exit 0 ;; esac
branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
case "$branch" in
  main|develop)
    echo "Refusing to edit code on '$branch' — create a derived branch first: git switch -c feature/<desc> (from develop)." >&2
    exit 2;;
esac
exit 0
