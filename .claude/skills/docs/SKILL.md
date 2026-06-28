---
name: docs
description: Keeps docs/reference/ in sync with code changes — updates API references, chart docs, config docs, template placeholder docs, prompt site docs, and CHANGELOG when a ship-task or manual change touches user-facing surfaces. Triggered by remind-docs.sh or manually. Never touches source code or ROADMAP.md.
---

# /docs — Documentation Sync (databridge-cli)

Maintains `docs/reference/` in sync with code changes. Triggered after a successful ship-task
or manually when `remind-docs.sh` fires. Read-only on source; write-only on docs.

## Doc ↔ source map

| If this changed… | Update this doc |
|---|---|
| `src/reports/charts.py` · `CHART_DISPATCH` · new chart type | `docs/reference/charts.md` — chart type entry + options table |
| `src/reports/template_generator.py` · `src/reports/builder.py` · new `{{ placeholder }}` | `docs/reference/templates.md` — placeholder list + data shape |
| `src/utils/seed_prompts.py` · `src/utils/lf_client.py` · new prompt site | `docs/reference/prompts.md` — prompt name, vars, output schema |
| `src/utils/config.py` · new config field · new export target | `docs/reference/config.md` — field reference + annotated template |
| `web/db/` · `web/main.py` · new endpoint · RBAC change · run flow | `docs/reference/internals.md` — endpoint, RBAC matrix, run lifecycle |
| `src/data/make.py` · new CLI command | `docs/reference/internals.md` + `CLAUDE.md` Commands section |
| Any of the above | `CHANGELOG.md` — Keep a Changelog format |

## Permissions

- ✅ Read any source file
- ✅ Write `docs/reference/*.md`, `CHANGELOG.md`
- ✅ Run `git diff` to scope the change
- ❌ Modify `docs/ROADMAP.md` (owned by `/roadmap`)
- ❌ Modify source code, tests, or migration files
- ❌ Push or open PRs

## Workflow

### 1 — Scope (what changed?)

```bash
# From a ship-task run
git diff --name-only HEAD~1..HEAD

# From current branch vs develop
git diff --name-only develop...HEAD
```

If nothing in the doc↔source map matches, stop — no doc churn.

### 2 — Update affected docs

For each matched doc:
- Read the current doc fully
- Read the relevant source section
- Add/update the entry; preserve existing content and formatting
- Never remove a section unless the feature was fully deleted

**For `docs/reference/charts.md`:** each chart type has a table row in the dispatch table
and a prose block with question requirements + supported opts. Match the existing format.

**For `docs/reference/config.md`:** follow the annotated YAML comment style. New fields go
in the relevant section (api/form/questions/filters/views/charts/indicators/summaries/ai/
periods/framework/pii/export/report).

**For `docs/reference/templates.md`:** each placeholder has: name, data type/shape,
example rendered value, and which builder function populates it.

**For `docs/reference/prompts.md`:** each prompt site has: name, call site (file:fn),
input vars, output schema (JSON contract), fallback behaviour.

**For `docs/reference/internals.md`:** prose + tables. Endpoints go in the API table;
RBAC changes update the gate matrix; run-flow changes update the lifecycle diagram.

### 3 — CHANGELOG entry

```markdown
## [Unreleased]

### Added
- <feature> — one line, user-facing framing

### Changed
- <change>

### Fixed
- <fix>
```

Follow [Keep a Changelog](https://keepachangelog.com/). Add under `## [Unreleased]`, creating
the section if absent.

### 4 — Verify consistency

- No broken internal links (`[text](../reference/foo.md)`)
- No removed items still referenced elsewhere in docs
- No secrets or internal paths exposed in examples

### 5 — Handoff

Return: files updated, sections added/changed, CHANGELOG entry added (yes/no).
If nothing user-facing changed, return "no doc update needed" and stop.
