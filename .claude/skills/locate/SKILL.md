---
name: locate
description: Read-only scout that maps the minimal change-set for a requested edit — entry points, call paths, affected files with line ranges — before any implementation starts. Use at the start of any non-trivial change to scope the work cheaply.
---

# /locate — Code-Map Scout (databridge-cli)

Read-only. Maps the minimal set of files and line ranges affected by a change request.
Never edits. Returns a surgical change-set plan for the implementer.

> "The cheap front-door for any change. Its only job is to answer: what do I touch, and in what order?"

## When to use

Use before implementing any change whose affected files aren't immediately obvious. Skip it when
you've just been editing a file and already know exactly what needs changing.

## Permissions

- ✅ Read, Bash (grep/find/git read-only), Glob, Grep
- ❌ Edit, Write — never modifies anything
- ❌ Cannot declare a change complete

## Codebase map (databridge-cli)

| Area | Entry points | Key files |
|---|---|---|
| CLI commands | `src/data/make.py` click group | `src/data/extract.py`, `transform.py`, `flatten.py`, `validate.py` |
| Report pipeline | `src/data/make.py build-report` | `src/reports/builder.py`, `charts.py` (CHART_DISPATCH), `narrator.py`, `summaries.py` |
| FastAPI endpoints | `web/main.py` | `web/db/` (models/repository), `web/storage/`, `web/runs.py` |
| React UI | `frontend/src/pages/` (6 tabs) | `frontend/src/components/`, `frontend/src/hooks/`, `frontend/src/lib/` |
| Config | `src/utils/config.py` | `config.yml` (runtime), `sample.config.yml` (reference) |
| AI / prompts | `src/utils/lf_client.py` | `src/utils/seed_prompts.py`, `src/reports/ask_engine.py`, `*_suggester.py` |
| PII / security | `src/utils/pii.py` | gated in `src/data/transform.py → export_data` |
| DB / RBAC | `web/db/models.py` | `web/db/repository.py`, auth dependencies in `web/main.py` |
| Reference docs | `docs/reference/` | charts.md · config.md · templates.md · prompts.md · internals.md |

## Workflow

1. **Anchor** — read `CLAUDE.md` architecture section + the relevant `docs/reference/` page first.
2. **Find entry point** — locate where the behavior is triggered (CLI command, API route, React handler).
3. **Trace inward** — follow the shortest call path to the actual change point.
   ```bash
   grep -rn "function_name\|symbol" src/ web/ frontend/src/ --include="*.py" --include="*.jsx" -l
   ```
4. **Scope targets** — identify which files must change and why. Note which are read-only context.
5. **Check ripples** — does the change affect: API contract? config.yml schema? Word template
   placeholders? docs/reference/? tests?
6. **Return the plan** — structured list of targets; do not implement.

## Output format

```
## Change-set for: <request>

### Entry point
<file:line> — <what triggers the behavior>

### Targets (edit these, in order)
1. <file:line-range> — <why>
2. <file:line-range> — <why>

### Context reads (understand, don't edit)
- <file> — <what to understand from it>

### Ripple risks
- <area>: <what might break and where to check>

### Tests to update/add
- <test file or describe block> — <what to cover>

### Hand-off
Pass this change-set to /roadmap-task-implementer (or the implementer agent) with these targets.
```

## Quick grep patterns for this codebase

```bash
# Find a FastAPI endpoint
grep -n "@app\.\(get\|post\|put\|delete\|patch\)" web/main.py

# Find a CLI command
grep -n "@cli\.command\|@.*\.command" src/data/make.py

# Find where a config key is consumed
grep -rn "config\[.key.\]\|config\.get(.key." src/ web/ --include="*.py"

# Find a React page component
grep -rn "export default\|export function" frontend/src/pages/ --include="*.jsx"

# Find a chart type handler
grep -n "CHART_DISPATCH\|def chart_\|\"type\":" src/reports/charts.py

# Trace a Langfuse prompt site
grep -rn "get_prompt\|lf_client\.chat" src/ --include="*.py"
```
