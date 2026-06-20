#!/usr/bin/env bash
# remind-docs.sh — gentle PostToolUse reminder to update the matching reference doc.
#
# Wire as PostToolUse(Write|Edit) in settings.json. databridge-cli keeps hand-maintained reference
# docs under docs/reference/ (charts, config, templates, prompts, internals). CLAUDE.md's "Common
# tasks" pairs each source area with the doc it must keep in sync. This is a NON-blocking reminder
# (stdout, exit 0) — never a gate.

set -uo pipefail

input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')
[ -n "$file_path" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
rel="$(realpath -m --relative-to="$root" -- "$file_path" 2>/dev/null || printf '%s' "${file_path#"$root"/}")"

# Map a changed source area → the reference doc that documents it.
doc=""
case "$rel" in
  src/reports/charts.py|src/reports/default_charts.py)     doc="docs/reference/charts.md (chart types + options)";;
  src/reports/template_generator.py|src/reports/builder.py) doc="docs/reference/templates.md (placeholders)";;
  src/utils/seed_prompts.py|src/utils/lf_client.py|src/reports/*_suggester.py) doc="docs/reference/prompts.md (prompt sites + schemas)";;
  src/data/transform.py)                                   doc="docs/reference/config.md (export targets / config fields)";;
  src/utils/config.py)                                     doc="docs/reference/config.md (config fields)";;
  web/db/*|web/main.py)                                    doc="docs/reference/internals.md (RBAC / runs / endpoints)";;
esac

[ -n "$doc" ] && printf 'ℹ️  Docs reminder: "%s" changed — check that %s is still in sync before opening a PR.\n' "$rel" "$doc"

exit 0
