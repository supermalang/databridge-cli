#!/usr/bin/env bash
# guard-visual-update.test.sh — pipeline-grade tests for the PreToolUse(Bash) hook that blocks
# agent self-approval of Playwright visual baselines.
#
# Derived strictly from the MNT-16 acceptance criteria. Drives the hook the same way Claude Code
# does: JSON on stdin with .tool_input.command; the hook signals its PreToolUse decision via exit
# code + stderr (VIS-7 verify fix — see guard-visual-update.sh's deny() comment for why this
# replaced the earlier jq-built stdout JSON, which silently no-op'd when jq was absent).
#
# Contract under test (guard-visual-update.sh):
#   - DENY  -> exit code 2, stderr reason mentioning human approval.
#   - ALLOW -> exit code 0, no deny reason on stderr.
#
# Run: bash .claude/hooks/tests/guard-visual-update.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$HERE/../guard-visual-update.sh"

pass=0
fail=0
LAST_RC=0
LAST_ERR=""

# A jq-free PATH: symlink every executable already on PATH into a scratch dir, except jq, so
# the hook falls back to its python3 extraction/deny codepaths exactly as it would on a host
# that never had jq installed. Built once, reused by every jq-missing test case below.
NO_JQ_DIR="$(mktemp -d)"
trap 'rm -rf "$NO_JQ_DIR"' EXIT
IFS=':' read -ra _path_dirs <<< "$PATH"
for _d in "${_path_dirs[@]}"; do
  [ -d "$_d" ] || continue
  for _f in "$_d"/*; do
    [ -x "$_f" ] || continue
    _base="$(basename "$_f")"
    [ "$_base" = "jq" ] && continue
    [ -e "$NO_JQ_DIR/$_base" ] || ln -s "$_f" "$NO_JQ_DIR/$_base" 2>/dev/null
  done
done

# Feed a command string to the hook (wrapped as a PreToolUse Bash tool_input); sets LAST_RC/LAST_ERR.
run_hook() {
  local cmd="$1"
  local payload
  payload="$(jq -n --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
  LAST_ERR="$(printf '%s' "$payload" | bash "$HOOK" 2>&1 1>/dev/null)"
  LAST_RC=$?
}

# Feed raw JSON (for the empty/unparseable case); sets LAST_RC/LAST_ERR.
run_hook_raw() {
  LAST_ERR="$(printf '%s' "$1" | bash "$HOOK" 2>&1 1>/dev/null)"
  LAST_RC=$?
}

# Run the hook with a caller-controlled PATH (e.g. a jq-free directory) so jq-availability
# behavior can be exercised directly; sets LAST_RC/LAST_ERR.
run_hook_with_path() {
  local cmd="$1" path="$2"
  local payload
  payload="$(jq -n --arg c "$cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
  LAST_ERR="$(printf '%s' "$payload" | PATH="$path" bash "$HOOK" 2>&1 1>/dev/null)"
  LAST_RC=$?
}

is_deny() {
  # True iff the hook exited 2 (the deny signal used by every guard hook in this repo).
  [ "$LAST_RC" -eq 2 ]
}

has_human_reason() {
  # Deny reason (on stderr) must mention human approval (case-insensitive).
  printf '%s' "$LAST_ERR" | grep -qiE 'human|approv'
}

assert_deny() {
  local desc="$1" cmd="$2"
  run_hook "$cmd"
  if is_deny; then
    echo "PASS: deny — $desc"
    pass=$((pass+1))
  else
    echo "FAIL: expected DENY — $desc"
    echo "      command: $cmd"
    echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
    fail=$((fail+1))
  fi
}

assert_allow() {
  local desc="$1" cmd="$2"
  run_hook "$cmd"
  if is_deny; then
    echo "FAIL: expected ALLOW — $desc"
    echo "      command: $cmd"
    echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
    fail=$((fail+1))
  else
    echo "PASS: allow — $desc"
    pass=$((pass+1))
  fi
}

assert_deny_no_jq() {
  local desc="$1" cmd="$2"
  run_hook_with_path "$cmd" "$NO_JQ_DIR"
  if is_deny; then
    echo "PASS: deny (no jq on PATH) — $desc"
    pass=$((pass+1))
  else
    echo "FAIL: expected DENY with no jq on PATH — $desc"
    echo "      command: $cmd"
    echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
    fail=$((fail+1))
  fi
}

assert_allow_no_jq() {
  local desc="$1" cmd="$2"
  run_hook_with_path "$cmd" "$NO_JQ_DIR"
  if is_deny; then
    echo "FAIL: expected ALLOW with no jq on PATH — $desc"
    echo "      command: $cmd"
    echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
    fail=$((fail+1))
  else
    echo "PASS: allow (no jq on PATH) — $desc"
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
run_hook "npm run test:e2e:update"
if has_human_reason; then
  echo "PASS: deny reason mentions human approval"
  pass=$((pass+1))
else
  echo "FAIL: deny reason must mention human approval"
  echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
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
run_hook_raw 'not json at all'
if is_deny; then
  echo "FAIL: unparseable stdin must not block (fail-safe open)"
  echo "      rc: $LAST_RC  stderr: ${LAST_ERR:-<empty>}"
  fail=$((fail+1))
else
  echo "PASS: allow — unparseable stdin (fail-safe open)"
  pass=$((pass+1))
fi

# --- VIS-7: real subcommand match only — bare "playwright" substring in unrelated commands must
# not be denied (this is the exact incident command from this session) ---
assert_allow "git push -u origin chore/playwright-workers-4 (branch name merely contains 'playwright'; no playwright-test invocation)" \
  "git push -u origin chore/playwright-workers-4"

# --- VIS-7: "playwright" occurring only as free text (commit message) must not be denied ---
assert_allow "git commit -m \"fix playwright config regression\" (playwright is free text, not an invocation)" \
  "git commit -m \"fix playwright config regression\""

# --- VIS-7: commit message containing escaped quotes/backslashes must still be parsed correctly
# and evaluated as an allow (proves the jq/python3-based command extraction survives escaped
# quoting) ---
assert_allow "commit message with escaped nested quotes and the word 'playwright' as free text" \
  'git commit -m "fix playwright config for \"nested quotes\" case"'

# --- VIS-7: Tier 2 baseline-update script (currently live, unguarded gap) must now be denied ---
assert_deny "npm run test:visual:storybook:update (Tier 2 baseline update — currently unguarded)" \
  "npm run test:visual:storybook:update"

# --- VIS-7: proactive coverage for the VIS-9 baseline-update script name (doesn't exist yet) ---
assert_deny "npm run test:visual:update (VIS-9 baseline update script — proactive coverage)" \
  "npm run test:visual:update"

# --- VIS-7 gap: an npm-script name occurring only as free text in a git commit message must NOT
# be denied (analogous to the playwright free-text case; this literally happened during VIS-7) ---
assert_allow "git commit -m mentioning 'npm run test:e2e:update' as free text (not an invocation)" \
  'git commit -m "chore: document that npm run test:e2e:update is human-only"'
assert_allow "git commit -m mentioning 'npm run test:visual:storybook:update' as free text" \
  'git commit -m "note: npm run test:visual:storybook:update rebaselines Tier 2"'
assert_allow "git log --grep referencing the npm update script name as free text" \
  'git log --grep "npm run test:visual:update"'

# --- VIS-7 gap: a REAL npm-script invocation must still be denied even after the free-text fix,
# including a compound command where the invocation follows a preceding statement ('&&', ';') ---
assert_deny "cd frontend && npm run test:visual:storybook:update (real invocation after cd &&)" \
  "cd frontend && npm run test:visual:storybook:update"
assert_deny "git commit -m \"msg\" && npm run test:e2e:update (real invocation after && — must not be masked by the commit)" \
  'git commit -m "wip" && npm run test:e2e:update'
assert_deny "npm run test:e2e:update after a semicolon (real invocation in a command segment)" \
  "echo starting; npm run test:e2e:update"

# --- VIS-7 gap: a `playwright test --update-snapshots` mention occurring only as free text in a
# git commit message must NOT be denied (analogous to the npm-script free-text case; the bare
# `playwright test` regex previously denied this) ---
assert_allow "git commit -m mentioning 'playwright test --update-snapshots' as free text (not an invocation)" \
  'git commit -m "run playwright test --update-snapshots to rebaseline, human-only"'
assert_allow "git log --grep referencing 'playwright test -u' as free text" \
  'git log --grep "playwright test -u"'

# --- VIS-7 gap: a REAL `playwright test` invocation must still be denied after the free-text fix,
# including compound commands where the invocation follows a preceding statement ('&&', ';') ---
assert_deny "git commit -m \"wip\" && npx playwright test -u (real invocation after && — must not be masked by the commit)" \
  'git commit -m "wip" && npx playwright test -u'
assert_deny "echo starting; npx playwright test --update-snapshots (real invocation after ;)" \
  "echo starting; npx playwright test --update-snapshots"

# --- VIS-7 security audit: command-substitution and brace-grouping command positions must be
# blocked. The command-position anchor originally omitted the backtick and '{' characters, so
# these functionally-identical invocations were silently ALLOWED while the '$(...)' form was
# DENIED. Payloads are the exact ones the auditor crafted. ---
assert_deny "backtick command substitution wrapping playwright update (\`playwright test --update-snapshots\`)" \
  'x=`playwright test --update-snapshots`'
assert_deny "backtick command substitution wrapping npm update script (\`npm run test:e2e:update\`)" \
  'x=`npm run test:e2e:update`'
assert_deny "\$(...) command substitution wrapping playwright update (parity with the backtick form)" \
  'x=$(playwright test --update-snapshots)'
assert_deny "brace group { npx playwright test -u; } (real invocation inside { ...; } grouping)" \
  '{ npx playwright test -u; }'
assert_deny "brace group { npx playwright test --update-snapshots; }" \
  '{ npx playwright test --update-snapshots; }'
assert_deny "brace group { npm run test:e2e:update; } (npm-script check inside brace grouping)" \
  '{ npm run test:e2e:update; }'

# --- VIS-7 security audit: the -u alias must be recognized when immediately followed by a shell
# command terminator (';' '&' '|' ')' '}'), not only by a space/end — a second bypass the brace
# payload relied on ('-u;'). Unrelated -u (git push -u, sort -u) stays allowed because it never
# reaches the flag check without a preceding `playwright test` command-position match. ---
assert_deny "npx playwright test -u; echo done (-u followed by ';' terminator, not space)" \
  "npx playwright test -u; echo done"
assert_allow "git push -u origin main (unrelated -u followed by space — still allowed)" \
  "git push -u origin main"

# --- VIS-7 (confirmation audit): the -u alias must also be recognized when the character
# immediately terminating it is a closing backtick — i.e. the `-u` sits at the end of a backtick
# command substitution (`x=`npx playwright test -u``). The backtick is already a command-position
# anchor for the `playwright test` gate above, but it was missing from the `-u` right-boundary
# terminator class, so this functionally-identical invocation was silently ALLOWED. ---
assert_deny "backtick command substitution ending in -u (\`npx playwright test -u\`)" \
  'x=`npx playwright test -u`'
assert_deny "backtick command substitution ending in -u then more text (\`npx playwright test -u\`; echo done)" \
  'x=`npx playwright test -u`; echo done'

# --- VIS-7 (2nd audit round): bash-keyword- and negation-introduced command positions must be
# blocked. The punctuation-only command-position anchor recognized ; & | ( ` { but NOT a command
# position introduced by the keywords then/do/else/elif/time or a leading '!' negation, so these
# functionally-identical invocations were silently ALLOWED. Payloads are the exact ones the
# auditor confirmed. ---
assert_deny "leading '!' negation: ! npx playwright test -u" \
  "! npx playwright test -u"
assert_deny "after 'then': if true; then npx playwright test -u; fi" \
  "if true; then npx playwright test -u; fi"
assert_deny "after 'do' (while): while true; do npx playwright test --update-snapshots; done" \
  "while true; do npx playwright test --update-snapshots; done"
assert_deny "after 'do' (until): until false; do npx playwright test -u; done" \
  "until false; do npx playwright test -u; done"
assert_deny "after 'do' (select): select x in a b; do npx playwright test -u; break; done" \
  "select x in a b; do npx playwright test -u; break; done"
assert_deny "after 'time' keyword: time npx playwright test -u" \
  "time npx playwright test -u"
assert_deny "after 'else': if false; then :; else npx playwright test -u; fi" \
  "if false; then :; else npx playwright test -u; fi"
assert_deny "npm-script after 'then': if true; then npm run test:e2e:update; fi" \
  "if true; then npm run test:e2e:update; fi"

# --- VIS-7 (2nd audit round): the keyword/negation anchors must NOT introduce false positives —
# legitimate if/while/until/select/case/time usage with no baseline-update invocation stays
# ALLOWED, and the \b word boundaries must not match keywords embedded in unrelated identifiers
# (e.g. 'time' inside 'runtime'). ---
assert_allow "legit 'then' with no update: if [ -f x ]; then echo done; fi" \
  "if [ -f x ]; then echo done; fi"
assert_allow "legit 'do' (while) with no update: while read l; do echo \"\$l\"; done < f" \
  'while read l; do echo "$l"; done < f'
assert_allow "legit 'do' (until) with no update: until false; do echo waiting; done" \
  "until false; do echo waiting; done"
assert_allow "legit 'do' (select) with no update: select opt in a b; do echo \"\$opt\"; done" \
  'select opt in a b; do echo "$opt"; done'
assert_allow "legit 'else'/'elif' with no update: if...then...elif...else...fi" \
  "if [ -f a ]; then echo a; elif [ -f b ]; then echo b; else echo c; fi"
assert_allow "legit leading '!' negation with unrelated cmd: ! grep -q foo file" \
  "! grep -q foo file"
assert_allow "legit 'time' with a non-update npm run: time npm run test:e2e" \
  "time npm run test:e2e"
assert_allow "legit 'time' with an unrelated cmd: time ls -la" \
  "time ls -la"
assert_allow "word-boundary: 'time' inside 'runtime' must not anchor (echo runtime playwright test results)" \
  "echo runtime playwright test results"
assert_allow "legit 'case' with no update: case \$x in a) echo a ;; *) echo b ;; esac" \
  'case $x in a) echo a ;; *) echo b ;; esac'

# --- VIS-7 (2nd audit round): DOCUMENTED RESIDUAL — a baseline update in a case-branch body,
# reachable only via the pattern-terminating ')', is intentionally NOT blocked (see the hook's
# "Known limitation — case-pattern ')'" note). A bare ')' is too common in ordinary shell/text to
# treat as a universal command-position delimiter without broad false positives; exploiting it
# requires the unusual case/esac construct, so it is an accepted residual alongside `eval`. This
# assertion pins that residual behaviour so a future change to it is a conscious decision. ---
assert_allow "documented residual: case x in *) npx playwright test -u ;; esac (case-pattern ')' gap)" \
  "case x in *) npx playwright test -u ;; esac"

# --- VIS-7: DOCUMENTED RESIDUAL — a baseline update hidden inside an `eval` string argument is
# intentionally NOT blocked (see the hook's "Known limitation — eval" note). Pinning this so a
# future change to it is a conscious decision, same as the case-pattern residual above. ---
assert_allow "documented residual: eval \"playwright test --update-snapshots\" (eval-obfuscation gap)" \
  'eval "playwright test --update-snapshots"'

# --- VIS-9 (security-audit finding): a leading env-var assignment before the real invocation is
# a genuine command position — `VAR=value cmd` runs `cmd` with `VAR` in its environment, same as
# `cmd` alone — but the command-position anchor set did not include it, so `NODE_PATH="$PWD/node_
# modules" playwright test --config=../visual-review/playwright.visual.config.ts --update-snapshots`
# (the literal shell form of the new `test:visual:update` npm script VIS-9 adds to
# frontend/package.json) bypassed the guard entirely. Pinning the fix with the exact bypass string
# plus variants (multiple assignments, after another anchor, npm-script form) and confirming the
# widened anchor does not swallow free-text/unrelated commands. ---
assert_deny "env-var-prefixed playwright update bypasses the guard: NODE_PATH=\"\$PWD/node_modules\" playwright test --update-snapshots" \
  'NODE_PATH="$PWD/node_modules" playwright test --config=../visual-review/playwright.visual.config.ts --update-snapshots'
assert_deny "env-var-prefixed npm script bypasses the guard: NODE_PATH=./node_modules npm run test:visual:update" \
  'NODE_PATH=./node_modules npm run test:visual:update'
assert_deny "multiple leading env-var assignments before playwright test -u" \
  'FOO=1 BAR=2 npx playwright test -u'
assert_deny "env-var assignment following another command-position anchor" \
  'cd frontend && NODE_PATH=./node_modules playwright test -u'
assert_allow "env-var assignment with an unrelated command must still be allowed" \
  'FOO=1 echo hi'
assert_allow "free-text mention inside a quoted commit message must still be allowed (not a real command position)" \
  'git commit -m "NODE_PATH=./node_modules playwright test -u fixed the CI script"'

# --- VIS-9 (workflow code-review finding): the env-var-assignment value pattern
# ([^[:space:]]*) is not quote-aware, so a *quoted* value containing a space breaks the whole
# anchor+assignment+command match and the guard falls through to ALLOW — silently re-opening the
# exact bypass the assignment fix above was meant to close. A double-quoted or single-quoted
# value (which may contain spaces) must be recognized as part of the same command position. ---
assert_deny "double-quoted env-var value containing a space still denies playwright -u" \
  'NODE_PATH="a b" playwright test -u'
assert_deny "double-quoted env-var value containing a space still denies the npm update script" \
  'NODE_PATH="a b" npm run test:visual:update'
assert_deny "single-quoted env-var value containing a space still denies playwright --update-snapshots" \
  "NODE_PATH='a b' playwright test --update-snapshots"

# --- VIS-7 (verify-pass fix): the deny path itself must not depend on jq. On a host with no jq
# on PATH, extract_command() already fell back to python3, but the original jq -n deny() had no
# equivalent fallback — it silently produced no output and exit 0 (ALLOW) on a genuine denial,
# reintroducing the exact "silent jq-missing fail-open" bug this card exists to fix, just moved
# from the extraction step to the decision step. deny() now signals via stderr + exit 2, which
# needs no JSON parser at all, so this must deny/allow identically with or without jq. ---
assert_deny_no_jq "npm run test:e2e:update denied with no jq on PATH" \
  "npm run test:e2e:update"
assert_deny_no_jq "npx playwright test --update-snapshots denied with no jq on PATH" \
  "npx playwright test --update-snapshots"
assert_allow_no_jq "unrelated command allowed with no jq on PATH" \
  "git push -u origin chore/playwright-workers-4"
assert_allow_no_jq "free-text mention allowed with no jq on PATH" \
  'git commit -m "fix playwright config regression"'

# --- VIS-14: bounded-time regression guard — command extraction must be O(n), not O(n²). A
# ~100KB command (well within the documented heredoc `git commit`/`gh pr create --body` sizes
# that flow through this PreToolUse gate on EVERY Bash call) must be processed in well under the
# threshold. The prior char-by-char pure-bash decoder was O(n²): ~19s at 50KB, ~75s at 100KB, so
# a regression back to it would blow past this by an order of magnitude. The threshold is
# deliberately generous (2s) so it is not flaky on a slow CI runner yet still catches O(n²). ---
big_cmd="echo $(python3 -c 'import sys; sys.stdout.write("a"*100000)')"
big_payload="$(jq -n --arg c "$big_cmd" '{tool_name:"Bash", tool_input:{command:$c}}')"
t_start="$(python3 -c 'import time; print(time.time())')"
printf '%s' "$big_payload" | bash "$HOOK" >/dev/null 2>&1
t_end="$(python3 -c 'import time; print(time.time())')"
elapsed="$(python3 -c "print(f'{$t_end - $t_start:.3f}')")"
if python3 -c "import sys; sys.exit(0 if ($t_end - $t_start) < 2.0 else 1)"; then
  echo "PASS: bounded-time — 100KB command processed in ${elapsed}s (< 2s; O(n) extraction)"
  pass=$((pass+1))
else
  echo "FAIL: 100KB command took ${elapsed}s (>= 2s) — likely an O(n²) extraction regression"
  fail=$((fail+1))
fi

echo ""
echo "Results: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
