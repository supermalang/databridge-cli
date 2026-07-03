#!/usr/bin/env bash
# guard-visual-update.test.sh — pipeline-grade tests for the PreToolUse(Bash) hook that blocks
# agent self-approval of Playwright visual baselines.
#
# Derived strictly from the MNT-16 acceptance criteria. Drives the hook the same way Claude Code
# does: JSON on stdin with .tool_input.command; the hook prints a PreToolUse decision on stdout.
#
# Contract under test (guard-visual-update.sh):
#   - DENY  -> stdout JSON with hookSpecificOutput.permissionDecision == "deny" and a reason
#             mentioning human approval.
#   - ALLOW -> no "deny" decision emitted.
#
# Run: bash .claude/hooks/tests/guard-visual-update.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../guard-visual-update.sh"

pass=0
fail=0

# Feed a command string to the hook (wrapped as a PreToolUse Bash tool_input) and capture stdout.
run_hook() {
  local cmd="$1"
  local payload
  payload="$(jq -n --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
  printf '%s' "$payload" | bash "$HOOK" 2>/dev/null
}

# Feed raw JSON (for the empty/unparseable case) and capture stdout.
run_hook_raw() {
  printf '%s' "$1" | bash "$HOOK" 2>/dev/null
}

is_deny() {
  # True iff the hook output is valid JSON whose permissionDecision is exactly "deny".
  # Empty / non-JSON output counts as NOT a deny (fail-safe open).
  local out="$1" decision
  [ -n "$out" ] || return 1
  decision="$(printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)" || return 1
  [ "$decision" = "deny" ]
}

has_human_reason() {
  # Deny reason must mention human approval (case-insensitive).
  printf '%s' "$1" \
    | jq -r '.hookSpecificOutput.permissionDecisionReason // ""' 2>/dev/null \
    | grep -qiE 'human|approv'
}

assert_deny() {
  local desc="$1" cmd="$2" out
  out="$(run_hook "$cmd")"
  if is_deny "$out"; then
    echo "PASS: deny — $desc"
    pass=$((pass+1))
  else
    echo "FAIL: expected DENY — $desc"
    echo "      command: $cmd"
    echo "      output : ${out:-<empty>}"
    fail=$((fail+1))
  fi
}

assert_allow() {
  local desc="$1" cmd="$2" out
  out="$(run_hook "$cmd")"
  if is_deny "$out"; then
    echo "FAIL: expected ALLOW — $desc"
    echo "      command: $cmd"
    echo "      output : ${out:-<empty>}"
    fail=$((fail+1))
  else
    echo "PASS: allow — $desc"
    pass=$((pass+1))
  fi
}

# Precondition: the hook must exist and be runnable (a missing script is a real red, not a
# fixture error — the implementer creates it).
if [ ! -f "$HOOK" ]; then
  echo "FAIL: hook not found at $HOOK"
  echo ""
  echo "Results: 0 passed, 1 failed"
  exit 1
fi

# --- AC: deny `npm run test:e2e:update` (with any leading cd/path prefix) ---
assert_deny "npm run test:e2e:update" \
  "npm run test:e2e:update"
assert_deny "cd frontend && npm run test:e2e:update (leading cd)" \
  "cd frontend && npm run test:e2e:update"

# --- AC: deny `playwright test --update-snapshots` and the `-u` alias, incl. npx/cd/path prefixes + extra flags ---
assert_deny "npx playwright test --update-snapshots" \
  "npx playwright test --update-snapshots"
assert_deny "playwright test -u (alias)" \
  "playwright test -u"
assert_deny "cd frontend && npx playwright test --update-snapshots --grep smoke (prefix + extra flags)" \
  "cd frontend && npx playwright test --update-snapshots --grep smoke"

# --- AC: a denial returns a PreToolUse deny with a human-approval reason ---
DENY_OUT="$(run_hook "npm run test:e2e:update")"
if has_human_reason "$DENY_OUT"; then
  echo "PASS: deny reason mentions human approval"
  pass=$((pass+1))
else
  echo "FAIL: deny reason must mention human approval"
  echo "      output : ${DENY_OUT:-<empty>}"
  fail=$((fail+1))
fi

# --- AC: does NOT block unrelated `-u` usages or non-playwright commands ---
assert_allow "git push -u origin x (unrelated -u)" \
  "git push -u origin x"
assert_allow "sort -u file (unrelated -u)" \
  "sort -u file"
assert_allow "npm run test:e2e (run, not update)" \
  "npm run test:e2e"

# --- AC: empty/unparseable command does not block (fail-safe open) ---
assert_allow "empty command string" \
  ""
UNPARSE_OUT="$(run_hook_raw 'not json at all')"
if is_deny "$UNPARSE_OUT"; then
  echo "FAIL: unparseable stdin must not block (fail-safe open)"
  echo "      output : ${UNPARSE_OUT:-<empty>}"
  fail=$((fail+1))
else
  echo "PASS: allow — unparseable stdin (fail-safe open)"
  pass=$((pass+1))
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
