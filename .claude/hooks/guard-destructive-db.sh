#!/usr/bin/env bash
# guard-destructive-db.sh — deny commands that irreversibly wipe the database or its volumes.
#
# Wire as PreToolUse(Bash) in settings.json. Blocks (near-zero reversibility — require an explicit
# human, not a silent automated run):
#   - alembic downgrade base / drop_all / dropdb / DROP DATABASE|SCHEMA  (Postgres + Alembic)
#   - docker ... down ... -v / --volumes                                 (removes named data volumes)
#   - docker volume rm ... (pgdata|miniodata)                            (removes the dev data volumes)
# Patterns come from stack-profile.sh (STACK_DESTRUCTIVE_DB_PATTERN); volume names are matched here.

set -uo pipefail

PROFILE="${CLAUDE_PROJECT_DIR:-$(pwd)}/.claude/hooks/stack-profile.sh"
[ -f "$PROFILE" ] && . "$PROFILE"

input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

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

# Destructive DB command — pattern from the stack profile.
if printf '%s' "$cmd" | grep -Eq "${STACK_DESTRUCTIVE_DB_PATTERN:-alembic +downgrade +base|\bdropdb\b|DROP +(DATABASE|SCHEMA)\b|\.drop_all\(}"; then
  deny "Blocked destructive DB command: '$cmd' irreversibly wipes the database (drop/downgrade-to-base). Run it manually if this is intentional."
fi

# docker down -v / --volumes — removes named volumes including the Postgres/Minio data volumes
if printf '%s' "$cmd" | grep -q 'docker' \
   && printf '%s' "$cmd" | grep -q 'down' \
   && printf '%s' "$cmd" | grep -Eq '(^| )-v( |$)|--volumes'; then
  deny "Blocked destructive command: 'down -v / --volumes' removes Docker volumes including pgdata (Postgres) and miniodata (S3) — all dev data is lost. Run it manually if intentional."
fi

# docker volume rm — removes volumes directly
if printf '%s' "$cmd" | grep -Eq 'docker volume rm'; then
  deny "Blocked destructive command: 'docker volume rm' can remove the pgdata/miniodata data volumes. Run it manually if intentional."
fi

exit 0
