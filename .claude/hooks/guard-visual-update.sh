#!/usr/bin/env bash
# guard-visual-update.sh — deny agent self-approval of Playwright visual baselines (MNT-16, VIS-7).
#
# Wire as PreToolUse(Bash) in settings.json. Regenerating the screenshot baselines under
# visual-review/baselines/ (Tier 1 dedicated visual config, VIS-9) or
# visual-review/storybook/baselines/ (Tier 2 Storybook, VIS-13) is a HUMAN-approval step: a
# person runs the update, reviews the diff, and commits the PNGs. An agent must never re-baseline
# a failing visual test via Bash instead of fixing the regression — that silently defeats the
# visual gate.
#
# Blocks (with any leading cd/path/npx prefix and any extra flags):
#   - npm run test:e2e:update
#   - npm run test:visual:storybook:update  (Tier 2 baseline update)
#   - npm run test:visual:update            (Tier 1 dedicated-config baseline update, VIS-9)
#   - playwright test --update-snapshots  (and the -u alias) — matched on the real `playwright
#     test` subcommand invocation, not a bare "playwright" substring anywhere in the command
#     (e.g. a branch name like chore/playwright-workers-4, or free text in a commit message).
#
# Fail-safe OPEN: empty or unparseable tool_input.command never blocks. Unrelated -u usages
# (git push -u, sort -u) are NOT blocked because the -u alias is only honored for playwright
# test invocations.
#
# Command position (VIS-7 security fix): a baseline-update invocation is matched only when it
# sits in a real command position. A command position is:
#   - the start of the string, or
#   - immediately after one of ; & | ( ` {  — covering '&&', '||', pipes, subshell '(...)'
#     grouping, backtick command substitution `...`, '$(...)' substitution (the '(' anchor),
#     and brace '{ ...; }' grouping, or
#   - immediately after a bash keyword that introduces a command — `then`, `do`, `else`,
#     `elif`, `time` (word-bounded via \b<kw>\b-style boundaries so it never matches inside an
#     unrelated identifier like `redo` or `overtime`), or
#   - immediately after a leading `!` negation (an optional `! ` prefix at any of the above
#     positions).
# The backtick and '{' anchors were added after a security audit confirmed that
# `x=`playwright test --update-snapshots`` and `{ npx playwright test -u; }` were being
# ALLOWED even though the functionally identical `x=$(playwright test --update-snapshots)` was
# DENIED — an inconsistent anchor set, not an intentional narrowing. A second audit round then
# confirmed 6 more keyword/negation bypasses (`! npx playwright test -u`,
# `if …; then npx playwright test -u; fi`, `while/until/select …; do npx playwright test -u; done`,
# `time npx playwright test -u`) that were ALLOWED because the punctuation-only anchor did not
# recognize a command position introduced by a bash keyword or a leading `!` — hence the keyword
# and negation anchors above.
#
# A VIS-9 security audit found a further bypass: a leading environment-variable assignment
# (`VAR=value cmd`) is also a real command position — it runs `cmd` with `VAR` set, identical to
# `cmd` alone — but was not recognized, so `NODE_PATH="$PWD/node_modules" playwright test
# --update-snapshots` (the literal shell form of the `test:visual:update` npm script VIS-9 adds)
# bypassed the guard entirely. The anchor set now also allows zero or more repeatable
# `VAR=value ` assignments between the position anchor/negation and the matched command.
#
# Known limitation — `eval` (moderate, documented, not a regression): a baseline update hidden
# inside a quoted argument to `eval` (e.g. `eval "playwright test --update-snapshots"`) is NOT
# caught, because the invocation sits inside a string literal rather than in command position,
# and this is a line-oriented regex matcher with no shell parser. Closing this in general would
# require parsing/recursively evaluating `eval` arguments (or a broad `eval`+`playwright`
# heuristic that would re-introduce the free-text false positives this hook deliberately avoids).
# It is left as an accepted defense-in-depth gap rather than patched with a fragile heuristic.
#
# Known limitation — `case`-pattern ')' (low, documented, not a regression): a baseline update in
# the body of a case branch (e.g. `case x in *) npx playwright test -u ;; esac`) is NOT caught,
# because the only command-position marker before the invocation is the pattern-terminating ')'.
# A bare ')' is extremely common in ordinary shell/text (subshell close, `$(...)` close, `foo()`
# function defs, arithmetic) so treating it as a universal command-position delimiter would
# re-introduce broad false positives — exactly what this hook avoids. Exploiting it also requires
# the unusual `case`/`esac` construct, putting it closer to the `eval` obfuscation case than the
# 6 keyword/negation bypasses above. Left as an accepted residual gap alongside `eval` rather than
# patched with a fragile ')' heuristic.
#
# Command extraction (VIS-7 / VIS-14): decode the JSON `command` field with a real JSON parser —
# jq when present (the original, C-speed approach), else python3 (a project dependency). Both do
# correct JSON string unescaping (\" \\ \n ...) at native speed. The earlier pure-bash decoder
# walked the string a character at a time with `result+="$ch"`, which is O(n²) in the command
# length (bash reallocates on every append) — a PreToolUse gate that runs on EVERY Bash call, so
# a multi-KB heredoc commit/PR body (a documented convention here) took seconds to tens of
# seconds. A parser-based decode is O(n). jq stays preferred (not dropped) precisely because it
# is fast and correct when installed; the python3 fallback exists so a missing jq can never
# silently short-circuit extraction. If BOTH are absent, or parsing fails, we emit nothing —
# which the caller treats as fail-safe OPEN (allow).

set -uo pipefail

input="$(cat 2>/dev/null || true)"

# --- Extract tool_input.command from the PreToolUse JSON payload. ----------------------------
# Prefer jq (C-speed); fall back to python3 (also C-speed, correct JSON unescaping). Either path
# prints the decoded command with no trailing newline and nothing on parse failure / missing key,
# so the output is byte-identical to a correct JSON decode of tool_input.command.
extract_command() {
  local json="$1"

  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -j '.tool_input.command // empty' 2>/dev/null || true
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf '%s' "$json" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    cmd = ""
    if isinstance(data, dict):
        ti = data.get("tool_input")
        if isinstance(ti, dict):
            cmd = ti.get("command") or ""
    sys.stdout.write(cmd if isinstance(cmd, str) else "")
except Exception:
    pass
' 2>/dev/null || true
    return 0
  fi

  # Neither jq nor python3 available — fail-safe open (empty output => allow).
  printf ''
  return 0
}

cmd="$(extract_command "$input")"

# Fail-safe open: nothing to inspect.
[ -n "$cmd" ] || exit 0

deny() {
  # stderr + exit 2 (not a jq-built permissionDecision JSON blob) so the deny path itself never
  # depends on jq — mirroring guard-roadmap.sh / guard-coding.sh / guard-branch.sh. The original
  # jq -n deny() call was found (VIS-7 verify pass) to silently no-op when jq is absent: extraction
  # already falls back to python3, but deny() had no equivalent fallback, so a jq-less host matched
  # the command correctly and then produced no output / exit 0 — ALLOW — on a genuine denial. That
  # is the exact "silent jq-missing fail-open" bug this card exists to fix, just relocated from
  # extraction to the decision step.
  echo "$1" >&2
  exit 2
}

REASON="Blocked visual-baseline update: '$cmd'. Regenerating Playwright screenshot baselines is a human-approval step — a human runs 'npm run test:e2e:update', reviews the diff, and commits the PNGs. Do not self-approve baselines; fix the regression instead, then hand the diff to a human for approval."

# A leading `VAR=value ` shell assignment (repeatable) is a real command position — `VAR=value
# cmd` runs `cmd` with `VAR` set, same as `cmd` alone — so it is allowed between the
# anchor/negation and the matched command in both gates below (VIS-9 security-audit fix). The
# value may be a double-quoted or single-quoted string (which may itself contain spaces) or a
# bare whitespace-free token. The double-quoted alternative is backslash-escape-aware
# (`"(\\.|[^"\\])*"`, matching real bash double-quote semantics where `\"` does not end the
# string) — an adversarial re-audit found the simpler `"[^"]*"` broke the whole
# anchor+assignment+command match, and fell through to ALLOW, on a value combining a
# backslash-escaped quote with an embedded space, e.g. `NODE_PATH="a \" b" playwright test -u`.
# The single-quoted alternative needs no such escaping: bash has no escape mechanism at all
# inside single quotes (a literal `'` can never appear there), so `'[^']*'` is already exact.
# Held in a variable (not inlined into the grep patterns) because an earlier code-review pass on
# the first version of this fix found the inlined bare-token-only value pattern
# ([^[:space:]]*) broke the WHOLE anchor+assignment+command match — and fell through to
# ALLOW — on a quoted value containing a space, e.g. `NODE_PATH="a b" playwright test -u`;
# inlining the 3-way quoted/unquoted alternation directly into a single-quoted grep argument
# requires fragile quote-escaping that is exactly what produced that bug.
ENV_ASSIGN='([A-Za-z_][A-Za-z0-9_]*=("(\\.|[^"\\])*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]*)[[:space:]]+)*'

# --- npm run test:e2e:update / test:visual:storybook:update / test:visual:update ---
# Match only when `npm run test:...:update` is actually invoked in a command position — the
# start of the string or the start of a command segment (immediately after ';', '&', '|', '(',
# '`', or '{', which covers '&&', '||', pipes, 'cd <path> && ...' chains, '$(...)'/backtick
# command substitution, and '{ ...; }' brace grouping; after a command-introducing bash keyword
# 'then'/'do'/'else'/'elif'/'time'; or after a leading '!' negation), optionally with a path
# prefix like /usr/bin/npm. A bare substring anywhere in the string (e.g. inside a
# `git commit -m "... npm run test:e2e:update ..."` free-text message) is NOT a command
# invocation and must not be blocked — mirroring the `playwright test` subcommand fix. See
# ENV_ASSIGN above for the leading-assignment allowance.
if printf '%s' "$cmd" | grep -Eq "(^|[;&|(\`{]|\\b(then|do|else|elif|time)[[:space:]])[[:space:]]*(![[:space:]]+)?${ENV_ASSIGN}([^[:space:]]*/)?npm[[:space:]]+run[[:space:]]+test:(e2e:update|visual:storybook:update|visual:update)"; then
  deny "$REASON"
fi

# --- playwright test --update-snapshots / -u (only when the real `playwright test` subcommand
# is actually invoked — not a bare "playwright" substring in a branch name or free-text arg) ---
# Match only when `playwright test` sits in a command position — the start of the string or the
# start of a command segment (immediately after ';', '&', '|', '(', '`', or '{', which covers
# '&&', '||', pipes, 'cd <path> && ...' chains, '$(...)'/backtick command substitution, and
# '{ ...; }' brace grouping; after a command-introducing bash keyword 'then'/'do'/'else'/'elif'/
# 'time'; or after a leading '!' negation), optionally behind an `npx` launcher and/or a path
# prefix like /usr/bin/npx or /usr/bin/playwright. A bare "playwright test" substring anywhere else in
# the string (e.g. inside a `git commit -m "... playwright test --update-snapshots ..."` free-text
# message) is NOT a command invocation and must not be blocked — mirroring the npm-script fix.
# See ENV_ASSIGN above for the leading-assignment allowance.
if printf '%s' "$cmd" | grep -Eq "(^|[;&|(\`{]|\\b(then|do|else|elif|time)[[:space:]])[[:space:]]*(![[:space:]]+)?${ENV_ASSIGN}(([^[:space:]]*/)?npx[[:space:]]+)?([^[:space:]]*/)?playwright[[:space:]]+test"; then
  # The `-u` alias is bounded by start/space on the left and by start/space, end-of-string, or a
  # shell command terminator (; & | ) } `) on the right. The trailing terminator set closes a
  # second bypass the audit's brace-grouping payload also relied on: `{ npx playwright test -u; }`
  # (and the plain `npx playwright test -u; echo x`) put `-u` immediately before ';', which the
  # old `( |$)` boundary missed. The backtick was added after a confirmation audit found
  # `x=`npx playwright test -u`` still bypassed: the closing backtick that ends the command
  # substitution terminates `-u`, yet it was absent from this class even though backtick is already
  # a first-class command-position anchor in the two gates above. This widening only fires after
  # the `playwright test` command-position gate above, so unrelated `-u` (git push -u, sort -u) is
  # never reached.
  if printf '%s' "$cmd" | grep -Eq -- '--update-snapshots|(^|[[:space:]])-u([[:space:]);&|`}]|$)'; then
    deny "$REASON"
  fi
fi

exit 0
