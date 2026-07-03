#!/usr/bin/env bash
# guard-secret-scan.sh — warn when a hardcoded secret may have been written.
#
# Wire as PostToolUse(Write|Edit) in settings.json. Scans written content for credentials that
# should never be committed: private keys, cloud keys, provider tokens, and generic
# secret/api-key/password assignments to a literal value. Warning only (not a hard block) — code
# review + CI are the backstop. Test/spec and *.env.example files are excluded.
#
# Patterns are overridable via STACK_SECRET_PATTERNS in stack-profile.sh; the defaults are
# stack-agnostic. Here secrets normally arrive via `env:` config + .env (KOBO_TOKEN, S3_*, AI keys,
# LANGFUSE_*), so a literal assignment is exactly what this catches.

set -uo pipefail

PROFILE="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/hooks/stack-profile.sh"
[ -f "$PROFILE" ] && . "$PROFILE"

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

# Skip test/spec files and example env files (placeholders live there).
if printf '%s' "$file_path" | grep -Eq "${STACK_TEST_FILE_REGEX:-(^|/)test_.*\.py$|_test\.py$|\.spec\.(ts|tsx|js|jsx)$}"; then
  exit 0
fi
case "$file_path" in
  *.env.example | *.env.sample | *.env.template) exit 0 ;;
esac

content=$(printf '%s' "$input" | jq -r '.tool_input.new_string // .tool_input.content // ""')

# Default secret patterns (stack-agnostic). Override with STACK_SECRET_PATTERNS.
# q = an optional surrounding quote (single or double).
q="[\"']?"
default_patterns="-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|(api[_-]?key|secret|token|password|passwd|client[_-]?secret|access[_-]?key)[[:space:]]*[:=][[:space:]]*${q}[A-Za-z0-9/+_.-]{12,}"
secret_patterns="${STACK_SECRET_PATTERNS:-$default_patterns}"

# -e guards against the pattern's leading "----" being read as grep options.
if printf '%s' "$content" | grep -Eiq -e "$secret_patterns"; then
  printf '⚠️  SECRET SCAN: a possible hardcoded secret (private key, cloud key, provider token, or credential assignment) was detected in "%s". Never commit secrets — move it to .env and reference it via `env:` config. If this is a placeholder/example, ignore this warning.\n' "$file_path"
fi

exit 0
