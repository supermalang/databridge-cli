#!/usr/bin/env bash
# guard-commit-message.sh — warn when a commit subject isn't Conventional Commits format.
#
# Wire as PreToolUse(Bash) in settings.json. Checks that the subject matches: type(scope): description
# Types come from STACK_COMMIT_TYPES in stack-profile.sh.
#
# Only inspects -m "..." / -m '...' patterns. Heredoc commits (git commit -m "$(cat <<EOF ...)")
# are skipped gracefully — they can't be parsed reliably, and we use them for trailers. Warning only.

set -uo pipefail

PROFILE="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/hooks/stack-profile.sh"
[ -f "$PROFILE" ] && . "$PROFILE"

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

# Fast path: only check git commit commands that use -m
case "$cmd" in
  *git*commit*-m*) ;;
  *) exit 0 ;;
esac

# Extract the first argument after -m (handles both " and ' quoting)
msg=$(printf '%s' "$cmd" | grep -oP "(?<=-m\s)['\"].*?['\"]" | head -1 | sed "s/^['\"]//;s/['\"]$//")

# If we couldn't parse the message (heredoc, variable, $(...)), allow through
[ -z "$msg" ] && exit 0

# Subject = first line only
subject=$(printf '%s' "$msg" | head -1)

TYPES="${STACK_COMMIT_TYPES:-feat|fix|docs|refactor|test|chore|ci|perf|style|build|revert}"
if ! printf '%s' "$subject" | grep -Eq "^($TYPES)(\(.+\))?: .{1,}"; then
  printf '⚠️  CONVENTIONAL COMMITS: "%s" does not match the expected format.\n' "$subject"
  printf '   Format : type(scope): short description\n'
  printf '   Example: feat(charts): add dot_map chart type\n'
  printf '            fix(flatten): correct _row_id for nested repeats\n'
  printf '   Valid types: %s\n' "$TYPES"
fi

exit 0
