#!/usr/bin/env bash
# PreToolUse guard: docs/ROADMAP.md may only be written via /roadmap, and the written content
# must carry the task-card template (header DoR + DoD + Global status; each card AC/Unit/E2E/UAT).
set -euo pipefail
input="$(cat)"
fp="$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')"
case "$fp" in */docs/ROADMAP.md|docs/ROADMAP.md) ;; *) exit 0 ;; esac
tool="$(printf '%s' "$input" | jq -r '.tool_name // ""')"
if [ "$tool" != "Write" ]; then
  echo "Roadmap changes go through /roadmap, which rewrites the whole file; a partial $tool can't be validated." >&2
  exit 2
fi
content="$(printf '%s' "$input" | jq -r '.tool_input.content // ""')"
read -r -d '' awkprog <<'AWK' || true
function flush(   miss){
  if (id=="") return
  miss=""
  if (body !~ /Acceptance criteria/) miss=miss " Acceptance-criteria"
  if (body !~ /Unit tests/)          miss=miss " Unit-tests"
  if (body !~ /E2E/)                 miss=miss " E2E"
  if (body !~ /UAT/)                 miss=miss " UAT"
  if (miss!="") printf("  %s missing:%s\n", id, miss)
  id=""; body=""
}
BEGIN{h1=0; dor=0; dod=0; gs=0}
NR==1 && $0 ~ /^# .*[Rr]oadmap/ {h1=1}
$0 ~ /^## Definition of Ready/ {dor=1}
$0 ~ /^## Definition of Done/ {dod=1}
$0 ~ /^## Global status/ {gs=1}
$0 ~ /^- \[[ x]\] \*\*[A-Za-z]+-[0-9]+/ { flush(); id=$0; sub(/^- \[[ x]\] \*\*/,"",id); sub(/ .*/,"",id); body=$0; next }
$0 ~ /^## / {flush()}
{ body=body "\n" $0 }
END{ flush();
  if(!h1)  print "  missing H1 roadmap title (line 1)"
  if(!dor) print "  missing '## Definition of Ready' section"
  if(!dod) print "  missing '## Definition of Done' section"
  if(!gs)  print "  missing '## Global status' section" }
AWK
errors="$(printf '%s' "$content" | awk "$awkprog")"
if [ -n "$errors" ]; then
  { echo "Roadmap content failed template validation — use /roadmap."; echo "Problems:"; echo "$errors"; } >&2
  exit 2
fi
exit 0
