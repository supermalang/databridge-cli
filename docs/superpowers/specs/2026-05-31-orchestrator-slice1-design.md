# Orchestrator, Slice 1 (Sequenced `run-all`) Design

**Date:** 2026-05-31
**Status:** Design (approved) — precedes the implementation plan
**Roadmap:** The cross-cutting **orchestrator** from [the analyst-pipeline architecture](2026-05-30-analyst-pipeline-architecture.md) — turns the pile of independent commands into one automated run. Slice 1 = sequenced execution; staleness detection is Slice 2.

---

## 1. Goal

One command/endpoint that runs the core pipeline **in order** — download → (template if missing) → build-report — with **precondition checks** and **stop-on-failure**, streaming a staged log. The dashboard gets the chained run it currently lacks (today each stage is a separate manual button; there is no `run-all`).

---

## 2. Scope

**Slice 1 (this spec):** a `run-all` CLI command that chains the existing commands via `ctx.invoke`, plus `/api/run/run-all` (reusing the existing subprocess streamer) and a "Run pipeline" button on the dashboard.

**Decisions (locked):** default stages = `download → build-report` (classification auto-runs inside download; `generate-template` runs first only if no template exists); `fetch-questions` stays a separate setup step; staleness deferred; `ctx.invoke` chaining; no-charts handled as a clear stop-on-failure (auto-creating charts belongs to the deferred "report from saved questions" slice).

**Out of scope (later):** staleness/change-detection (Slice 2); the `_proc` concurrency fix; configurable stage lists; `fetch-questions` in the default run; scheduling (the separate `/schedule` capability).

---

## 3. Architecture (Approach A — `ctx.invoke` chaining)

`run-all` reuses the existing commands' exact logic by invoking them in-process through Click's `ctx.invoke`, so PII gating, classification, `command_trace`, and the `--strict`/`--config` context all carry through unchanged. No stage logic is duplicated or refactored.

### CLI (`src/data/make.py`)
- **`run-all`** — `@cli.command("run-all")`, `@click.pass_context`, with optional `--sample` / `--period` flags (forwarded to the relevant stages). Behavior:
  1. **Precondition:** load config from `ctx.obj["config_path"]`; if no `questions` configured → `click.echo("No questions configured — run fetch-questions first.", err=True)` + `sys.exit(1)`.
  2. Log `▶ download` → `ctx.invoke(cmd_download, sample=sample, period=period, no_redact=False)`. On exception → `✗ download failed: <e>` + `sys.exit(1)`. Else `✓ download`.
  3. **Template:** read `cfg["report"]["template"]` (default `templates/report_template.docx`); if the file is missing, log `▶ generate-template` → `ctx.invoke(cmd_generate_template)` (defaults: `out=None, context=None, summary_prompt=None`).
  4. Log `▶ build-report` → `ctx.invoke(cmd_build_report, sample=None, random_sample=False, split_by=None, split_sample=None, session=None, period=period, compare=None)`. On exception → `✗ build-report failed: <e>` + `sys.exit(1)`. If it fails specifically because no charts are configured, the message should read `"No charts configured — add charts (or use the Ask tab) before building a report."`.
  5. Log `✓ Pipeline complete.`
  - Wrap the body in `lf_client.command_trace("run-all")` so the whole run groups under one trace (nested per-stage traces are acceptable).

  Exact invoke signatures (verified): `cmd_download(ctx, sample, period, no_redact)`, `cmd_generate_template(ctx, out, context, summary_prompt)`, `cmd_build_report(ctx, sample, random_sample, split_by, split_sample, session, period, compare)`.

### Web (`web/main.py`)
- Add `"run-all"` to `ALLOWED_COMMANDS` (optionally allowing `--sample`/`--period`), so the existing `POST /api/run/run-all` builds `["python","src/data/make.py","run-all", ...]` and streams via the current `_stream` machinery. No new endpoint or runner. (The web subprocess runs from the project root, so the CLI's default `--config ./config.yml` resolves as for every other command.)

### Frontend (`frontend/src/pages/Dashboard.jsx`)
- Add a prominent **"Run pipeline"** button that POSTs `/api/run/run-all` and streams the staged combined log into the existing BottomTerminal (reusing the `useCommand` hook / run-log surface). The per-step wizard buttons remain.

---

## 4. Error handling
Stop-on-failure: a failing stage logs `✗ <stage> failed: <reason>` and exits non-zero, so the chain halts and the run-log shows exactly which stage broke. Preconditions abort early with actionable text (no questions → "run fetch-questions first"; no charts → the Ask-tab hint). Each stage keeps its own fail-soft behavior (e.g. PII fail-closed in download) — `run-all` only sequences and reports.

## 5. Testing (TDD)
- CLI (Click `CliRunner` or direct invocation):
  - `run-all` with no `questions` in config → exits non-zero, message "run fetch-questions first".
  - With stages stubbed (monkeypatch `make.cmd_download` and `make.cmd_build_report` so `ctx.invoke` records call order) → asserts download is invoked before build-report; a stage raising → the chain stops and exits non-zero before the next stage.
  - Template auto-gen: when the template file is missing, `cmd_generate_template` is invoked before build-report; when present, it is not.
- API: `POST /api/run/run-all` is whitelisted (in `ALLOWED_COMMANDS`) and the built argv is `[..., "run-all", ...]` (assert via the same pattern as existing `/api/run` tests).
- Frontend: clean Vite build (no JS unit harness).
- Full suite green (currently 287).

## 6. Risks & open questions
- **`ctx.invoke` nesting + `command_trace`:** invoking commands that each open their own `command_trace` inside `run-all`'s `command_trace` yields nested traces — acceptable (Langfuse handles nesting; tracing is fail-soft).
- **No-charts hard stop:** until the "report from saved questions" slice lands, a config with no `charts` makes the `build-report` stage fail. Slice 1 surfaces this clearly rather than papering over it.
- **`generate-template` overwrites:** Slice 1 only auto-generates when the template is *missing*, so it never clobbers a user's existing template.
- **Concurrency:** the web `_proc` is a single global; two simultaneous runs still clobber it (pre-existing). Not addressed here; a long `run-all` is itself one subprocess.
