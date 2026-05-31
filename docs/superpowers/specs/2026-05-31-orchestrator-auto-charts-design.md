# Orchestrator — Report-from-Saved-Questions (Auto-Charts) Design

**Date:** 2026-05-31
**Status:** Design (owner approved "proceed with your recommendations"; decisions locked below)
**Roadmap:** Orchestrator follow-up. Lets `run-all` produce a report end-to-end on a fresh config (today it hard-stops when no `charts` are configured).

---

## 1. Goal

When `run-all` finds **no `charts` configured**, optionally auto-create a **deterministic** starter chart set from the saved `questions`, persist it to `config.yml`, and proceed — so the pipeline runs end-to-end on a fresh config. Gated behind an explicit `--auto-charts` flag so it never surprises an intentionally empty-charts config.

---

## 2. Decisions (locked)

- **Deterministic mapping, no LLM** — predictable, offline, fail-soft. One chart per eligible question:
  | question `category` | chart `type` |
  |---|---|
  | `categorical` | `bar` |
  | `quantitative` | `histogram` |
  Questions of other categories (`qualitative`, `geographical`, `date`, `undefined`) are **skipped** — those chart types need pairs/options a deterministic single-question rule can't safely pick.
- **Cap** at `MAX_DEFAULT_CHARTS = 25` to avoid an unwieldy template; if more eligible questions exist, take the first 25 and **log a warning** naming how many were skipped (no silent truncation).
- **Explicit opt-in only.** Default `run-all` keeps today's hard-stop on empty charts (message updated to mention `--auto-charts`). Auto-charts never runs unless `--auto-charts` is passed.
- **Persist to `config.yml`** (via `write_config`). This is required: `generate-template` (if the template is missing) and `build-report` are invoked as separate stages that each `load_config` from disk, so the charts must be on disk for the chain to place placeholders and render. It also leaves the user editable charts afterward (consistent with `fetch-questions` writing questions, and the Ask tab's `save_recipe`).
- **Reachable from the web** (per the project's web-first preference): `--auto-charts` is whitelisted and forwarded by `POST /api/run/run-all`, and surfaced as a small checkbox beside the Dashboard "Run pipeline" button.

**Out of scope:** AI/LLM chart proposing for defaults (the Ask tab already covers LLM proposals); auto-regenerating an *existing* template to add the new placeholders (auto-charts targets fresh configs where no template exists yet — documented limitation); chart `options` tuning.

---

## 3. Architecture

### `src/reports/default_charts.py` (new)
```python
default_charts_from_questions(cfg) -> list[dict]
```
- Iterates `cfg["questions"]`; for each with `category` in the mapping, emits a chart dict
  `{"name": <unique slug>, "title": <col>, "type": <chart_type>, "questions": [<col>]}`
  where `col = export_label or label or kobo_key` (charts reference `export_label` column names, per the project's chart/filter convention). Questions with no usable column name are skipped.
- `name` is `slugify(col)` (reusing `src/utils/periods.slugify`), de-duplicated with a numeric suffix.
- Caps the list at `MAX_DEFAULT_CHARTS`; logs a WARNING with the skipped count when capping.
- Pure (no I/O, no LLM). Returns `[]` when there are no chartable questions.

### `src/data/make.py` — `run-all`
- Add `--auto-charts` flag; signature becomes `cmd_run_all(ctx, sample, period, force, auto_charts)`.
- Replace the empty-charts precondition:
  - If `cfg.get("charts")` is empty:
    - **with `--auto-charts`:** `new = default_charts_from_questions(cfg)`. If `new` is empty → `click.echo(... "no chartable questions (need categorical or quantitative)" ...)` + `sys.exit(1)`. Else `cfg["charts"] = new`; `write_config(cfg, config_path)` (local import, per file convention); `log.info(f"✓ auto-created {len(new)} chart(s) from questions.")`. Then continue the pipeline (download → template-if-missing → build-report) — `generate-template` (if missing) now sees the charts on disk and emits placeholders.
    - **without the flag:** `click.echo("No charts configured — add charts (or use the Ask tab), or pass --auto-charts to generate a starter set before building a report.", err=True)` + `sys.exit(1)` (preserves today's behavior; existing `test_run_all_aborts_without_charts` still passes since it doesn't pass the flag).
- The questions precondition (hard-stop when no questions) is unchanged — auto-charts needs questions to derive from.

### `web/main.py`
- `ALLOWED_COMMANDS["run-all"]` gains `"--auto-charts"`.
- `RunPayload` gains `auto_charts: Optional[bool] = None`.
- `run_command`: `if payload.auto_charts and "--auto-charts" in ALLOWED_COMMANDS[command]: cmd += ["--auto-charts"]`.

### `frontend/src/hooks/useCommand.js`
- Forward two opts (closes a carried follow-up): `if (opts.period) body.period = opts.period;` and `if (opts.auto_charts) body.auto_charts = opts.auto_charts;`.

### `frontend/src/pages/Dashboard.jsx`
- A small "Auto-create charts" checkbox next to "Run pipeline"; its state is passed as `run('run-all', { auto_charts })`. Minimal, disabled while running.

## 4. Error handling
Fully fail-soft and explicit: auto-charts only runs on opt-in; if it finds nothing chartable it exits with a clear message rather than building an empty report; capping logs a warning. `default_charts_from_questions` is pure and total (never raises on malformed question entries — it skips entries lacking a category/column).

## 5. Testing (TDD)
- `tests/test_default_charts.py` (new): categorical→bar + quantitative→histogram; others skipped; uses `export_label` (falls back to `label`/`kobo_key`); unique names on duplicate labels; cap at 25 (e.g. 30 quantitative questions → 25 charts) with a warning; `[]` when no chartable questions.
- `tests/test_run_all.py` (extend): with `--auto-charts` and an empty-charts config (questions present) → charts written to config (assert the file now has charts) and build-report invoked; without the flag → still exits 1 (existing test). **Folded follow-up:** add a `generate-template`-failure test — when `cmd_generate_template` raises inside run-all (template missing), the chain stops with exit 1 and "generate-template failed".
- `tests/test_run_all_api.py` (extend): `"--auto-charts"` in `ALLOWED_COMMANDS["run-all"]`; `POST /api/run/run-all {auto_charts: true}` → argv includes `--auto-charts`.
- Frontend: clean `npm run build`.
- Full suite green (currently 305).

## 6. Risks
- **Existing template + auto-charts:** if a template already exists but charts were empty, auto-charts adds charts to config but the existing template lacks their placeholders → they won't render. Acceptable: the feature targets fresh configs (no template yet → `generate-template` runs). Documented.
- **Deterministic charts are basic** (one bar/histogram per question, default options) — intentional; the Ask tab and manual editing refine from there.
