#!/usr/bin/env bash
# stack-profile.sh — single source of truth for the stack-specific patterns the guard hooks use.
#
# The guard logic (path canonicalization, jq parsing, exit codes) is stack-agnostic and lives in
# the hook scripts. The only stack-bound pieces — which paths are gated, which branches are
# protected, what a test file looks like, what a destructive DB command is — live HERE so
# retargeting another stack means editing this one file, never the hooks.
#
# Each hook sources this file and reads values via `${VAR:-default}`: if this file is missing or a
# variable is unset, the hook falls back to the built-in default (current behaviour preserved).
#
# ─────────────────────────────────────────────────────────────────────────────
# PROFILE: databridge-cli — Python (FastAPI · pandas · click) · React (Vite) · Postgres/Alembic
# ─────────────────────────────────────────────────────────────────────────────

# NOTE: the gated-paths (src/ web/ frontend/src/ tests/) and protected-branches (main, develop)
# patterns are intentionally NOT exported here. The existing guards — guard-coding.sh,
# guard-branch.sh, guard-git-flow.sh — still hardcode those values, so a var here would read as
# controlling the gate while doing nothing. When those guards are refactored to source this file
# (currently gated as permission-control self-modification), add STACK_GATED_PATHS_REGEX and
# STACK_PROTECTED_BRANCHES at that time, in the same change that wires them in.

# Test/spec files — pytest (test_*.py / *_test.py) and Playwright specs (*.spec.{ts,tsx,js,jsx}).
# Excluded from the secret scanner.
export STACK_TEST_FILE_REGEX='(^|/)test_.*\.py$|_test\.py$|\.spec\.(ts|tsx|js|jsx)$'

# Conventional Commits types accepted by guard-commit-message.
export STACK_COMMIT_TYPES='feat|fix|docs|refactor|test|chore|ci|perf|style|build|revert'

# Destructive database commands that wipe data irreversibly (guard-destructive-db).
# Postgres + Alembic + SQLAlchemy. `docker down -v` / `docker volume rm` are matched separately
# in the hook (they need the dev data-volume names: pgdata, miniodata).
export STACK_DESTRUCTIVE_DB_PATTERN='alembic +downgrade +base|\bdropdb\b|DROP +(DATABASE|SCHEMA)\b|\.drop_all\('

# Hardcoded-secret patterns (guard-secret-scan). The hook ships a stack-agnostic default
# (private keys, AWS/GCP keys, GitHub/Slack tokens, credential assignments). Override only to add
# project-specific token formats — grep -E alternation. Our tokens (KOBO_TOKEN, S3_*, AI keys,
# LANGFUSE_*) all resolve via `env:` at load time and live in .env, so the credential-assignment
# default already covers an accidental literal. Leave unset unless a new token shape appears.
# export STACK_SECRET_PATTERNS='-----BEGIN [A-Z ]*PRIVATE KEY-----|...'
