#!/usr/bin/env bash
# PreToolUse guard: edits to implementation code + tests require a fresh active-task marker.
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
[ -n "$fp" ] || exit 0
root="${CLAUDE_PROJECT_DIR:-$PWD}"
# Canonicalize (collapse .. and symlinks) before matching so path-traversal can't dodge the gate.
rel="$(realpath -m --relative-to="$root" -- "$fp" 2>/dev/null || printf '%s' "${fp#"$root"/}")"
case "$rel" in src/*|web/*|frontend/src/*|tests/*) ;; *) exit 0 ;; esac
marker="$root/.claude/.active-task.json"
fail(){ echo "$1" >&2; exit 2; }
[ -f "$marker" ] || fail "No active roadmap task. Use /roadmap to start the task you're implementing (sets the marker). Config/docs/tooling are exempt."
id="$(jq -r '.id // ""' "$marker")"; started="$(jq -r '.started_at // ""' "$marker")"
[ -n "$id" ] && [ -n "$started" ] || fail "Active-task marker malformed. Re-run /roadmap."
printf '%s' "$id" | grep -qE '^[A-Za-z]+-[A-Za-z0-9-]+$' || fail "Active-task marker id '$id' is malformed. Re-run /roadmap."
se="$(date -d "$started" +%s 2>/dev/null || echo 0)"; ne="$(date +%s)"
[ "$se" -eq 0 ] && fail "Active-task marker has an unparseable started_at. Re-run /roadmap."
[ $((ne-se)) -gt 28800 ] && fail "Active-task marker for $id is stale (>8h). Re-run /roadmap."
grep -qE "^- \[ \] \*\*${id} " "$root/docs/ROADMAP.md" 2>/dev/null || fail "Task $id is not an open ( - [ ] ) task in docs/ROADMAP.md."
exit 0
