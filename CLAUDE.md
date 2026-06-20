# CLAUDE.md — kobo-reporter / databridge-cli

This file provides guidance to Claude Code when working in this repository.

## Project

**kobo-reporter** (databridge-cli) — CLI + web tool that fetches Kobo/Ona survey
schemas, lets users configure extraction / visualization / export through a single
`config.yml`, downloads + filters + exports submission data, and generates Word reports
(`.docx`) with embedded charts and editable text. React UI + FastAPI backend on one host;
no Docker required to *run* the app.

## Tech stack

Python (pandas · matplotlib · docxtpl · click) · FastAPI + uvicorn · React + Vite (JSX) ·
SQLAlchemy 2.0 + PostgreSQL (app state) + Alembic · Minio/S3 (project files) · Zitadel
(auth) · Langfuse (prompt management) · OpenAI / Anthropic (AI features)

## Architecture

Three layers, two languages, same machine:

| Layer | Language | Lives in | Does |
|---|---|---|---|
| CLI + data + reports | Python | `src/` | fetch schemas, download/filter submissions, render 21 chart types, fill Word templates |
| HTTP API + log streamer | Python (FastAPI) | `web/main.py` | `/api/*` REST, runs CLI as subprocess, streams stdout as SSE |
| Web UI | JSX/React (Vite) | `frontend/src/` → `dist/` | six-tab dashboard calling `/api/*` |

`web/` is a Python package (FastAPI imports `web.main:app`); `frontend/` is a Vite root
(owns `package.json`, `node_modules/`). Kept separate so neither toolchain crawls the
other's files.

### Layout

```
src/
  data/    make.py (CLI: click group) · extract.py (KoboClient) · questions.py · transform.py
           flatten.py · profile.py · validate.py · classifier.py · run_state.py
  reports/ builder.py · charts.py (CHART_DISPATCH) · template_generator.py · narrator.py
           summaries.py · ask_engine.py · data_quality.py · default_charts.py · ai_*_suggester.py
  utils/   config.py (env: resolution) · pii.py · lf_client.py · seed_prompts.py
web/       main.py (FastAPI) · db/ (models/repository/provision) · storage/ (s3/local/workspace) · runs.py
frontend/  src/pages/ (six tabs) · components/ · hooks/useCommand.js · lib/ · styles.css
scripts/   dev.sh · serve.sh
```

### Run modes (no Docker)

| Mode | Command | Ports |
|---|---|---|
| Dev (HMR) | `./scripts/dev.sh` | uvicorn `:8000` + vite `:51730` (proxies `/api`, `/terminal/`) |
| Prod-like | `./scripts/serve.sh` | uvicorn `:8000` only (serves built bundle + API) |

First run installs npm deps automatically. Edit `.jsx` → Vite HMR picks it up in dev;
edit `web/main.py` → `uvicorn --reload` restarts.

## Commands

### Setup

```bash
pip install -r requirements.txt
```

App state requires **Postgres** (`DATABASE_URL`) + **Minio/S3** (`S3_*`). Local services:

```bash
docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=databridge -p 5432:5432 postgres:16
docker run --rm -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio \
  -e MINIO_ROOT_PASSWORD=minio12345 minio/minio server /data --console-address ":9001"
```

### Tests

The suite self-provisions SQLite + local storage (no Postgres/Minio needed), but needs the
project root on `PYTHONPATH` and a headless matplotlib backend — same as CI:

```bash
pip install -r requirements.txt -r requirements-dev.txt   # first time
PYTHONPATH=. MPLBACKEND=Agg python -m pytest -q            # full suite
PYTHONPATH=. MPLBACKEND=Agg python -m pytest tests/test_flatten.py   # single file
```

**Visual / E2E (Playwright).** UI cards are screenshot-tested at three viewports — mobile
(390×844), tablet (820×1180), desktop (1440×900) — defined as projects in
`frontend/playwright.config.ts`. Baselines live next to each spec under
`frontend/tests/e2e/<spec>-snapshots/*.png` (tracked) and one is produced per viewport.

```bash
cd frontend && npm run test:e2e          # run visual suite vs committed baselines (3 viewports)
cd frontend && npm run test:e2e:update   # regenerate baselines (human approves the diff)
cd frontend && npm run test:e2e:report   # open the last HTML report
```

App-driven specs boot Vite via the `webServer` block in the config; fixture/smoke specs use
`page.setContent` and need no server. CI runs the suite on PRs touching `frontend/**`
(`.github/workflows/visual.yml`).

### CLI (run from root)

```bash
python3 src/data/make.py fetch-questions                  # schema → config.yml questions
python3 src/data/make.py generate-template                # auto-build Word template from charts
python3 src/data/make.py download [--sample N] [--period "Q3 2026"] [--no-redact]
python3 src/data/make.py build-report [--sample N] [--split-by Site] [--period "Q2 2026"] [--compare "Q1 2026,Q2 2026"]
python3 src/data/make.py set-period "Q3 2026"
python3 src/data/make.py push-prompts [--force]           # seed prompts → Langfuse
python3 src/data/make.py run-all [--sample N] [--force] [--auto-charts]
```

Same commands exposed at `POST /api/run/{command}` with SSE logs (whitelisted in
`ALLOWED_COMMANDS`).

- **`run-all`** chains download → generate-template (if missing) → build-report via Click
  `ctx.invoke` with preconditions + stop-on-failure. Skips build-report when data + config
  are unchanged (fingerprints in `reports/.run_all_state.json`); `--force` rebuilds;
  `--auto-charts` derives a starter chart set from questions (categorical→bar,
  quantitative→histogram, cap 25).
- **Not standalone CLI commands:** Validation (`POST /api/validate`, `src/data/validate.py`),
  data-quality overview (`GET /api/data-quality`), and open-text classification (runs
  automatically at the end of `download` when `ai:` is set and a question has
  `classify.enabled: true`).

## config.yml

Single source of config (full annotated template: `sample.config.yml`; full field-by-field
reference + categorization + filter syntax: [`docs/reference/config.md`](docs/reference/config.md)).
Key sections:

```yaml
api:    {url, token: env:KOBO_TOKEN}     # env: prefix → resolved from environment at load
form:   {uid, alias}                     # alias = export filename prefix
questions:                               # auto-filled by fetch-questions; user then edits
  - {kobo_key, label, type, category, group, choice_list, export_label}
filters: ["Age > 0", "Region != 'Test'"] # pandas .query(); references export_label, NOT kobo_key
views:   [...]                           # named virtual tables (repeat groups + aggregations)
charts:  [{name, title, type, questions, options}]      # each → {{ chart_<n> }}
indicators: [{name, stat, question, framework_ref, disaggregate_by, primary}]  # each → {{ ind_<name> }}
summaries:  [...]                        # each → {{ summary_<name> }}
ai:      {provider, model, api_key: env:..., language, max_tokens}
periods: {current, baseline, registry}   # multi-period: date-range (started/ended) slices one
                                         # download; label-only = legacy per-period files
framework: {goal, outcomes, outputs}     # results framework (logframe) → {{ logframe }}
pii:     {consent_column, consent_value, redact}    # redaction + consent gating
export:  {format, output_dir, database}  # csv | json | xlsx | mysql | postgres | supabase
report:  {template, output_dir, title, period, filename_pattern, split_by}
```

**Question categories (fetch-questions, `src/data/questions.py`):** `select_*`→categorical ·
`integer`/`decimal`/`range`→quantitative · `text`/`note`→qualitative ·
`gps`/`geo*`→geographical · `date`/`datetime`/`time`→date · else→undefined. Re-run preserves
user-edited `category` + `export_label`.

## Charts (`src/reports/charts.py`)

21 types in `CHART_DISPATCH`, all sharing `fn(df, questions, title, out_path, opts)`. Output
saved to `data/processed/charts/<name>.png` at build-report time.

`bar` · `horizontal_bar` · `stacked_bar` · `grouped_bar` · `pie` · `donut` · `line` · `area` ·
`histogram` · `scatter` · `box_plot` · `heatmap` · `treemap` · `waterfall` · `funnel` · `table` ·
`bullet_chart` · `likert` · `scorecard` · `pyramid` · `dot_map`. Common opts: `top_n`,
`width_inches`, `height_inches`, `color`, `xlabel`, `ylabel`, `sort`.

Per-type question requirements + options, and how to add a type:
[`docs/reference/charts.md`](docs/reference/charts.md).

## Word templates (docxtpl / Jinja2)

Placeholders: `{{ report_title }}` · `{{ period }}` · `{{ n_submissions }}` ·
`{{ generated_at }}` · `{{ summary_text }}` · `{{ observations }}` · `{{ recommendations }}` ·
`{{ ind_<name> }}` (+ `_breakdown` / `_table`) · `{{ summary_<name> }}` · `{{ chart_<n> }}` ·
`{{ split_value }}` · `{{ data_quality }}` · `{{ logframe }}` · `{{ provenance.footer }}`.

**Critical:** each `{{ chart_... }}` must be a single unbroken XML run in the `.docx` — always
use `generate-template`, never type chart placeholders by hand.

Full placeholder list (with the data shape behind `{{ data_quality }}` / `{{ logframe }}` /
`{{ ind_<name>_breakdown }}`): [`docs/reference/templates.md`](docs/reference/templates.md).

## Prompts (Langfuse — `src/utils/lf_client.py`)

17 prompt sites fetched by name at runtime (`narrator`, `summaries`, `chart_suggester`,
`*_suggester`, `classifier_*`, `ask_*`, `template_inference`). Resolution order: **cache**
(`~/.cache/databridge/prompts/`, 1h TTL) → **Langfuse** (HTTPS) → **bundled seeds**
(`src/utils/seed_prompts.py`). AI features keep working offline (seeds) and with no AI keys
(feature no-ops). 13 of the 17 produce JSON with an `output_schema` enforced via OpenAI
structured outputs / Anthropic forced tool-use. Seed with `push-prompts`.

Full prompt↔file↔contract table, Langfuse setup/tracing, and the output-schema rules:
[`docs/reference/prompts.md`](docs/reference/prompts.md).

## Key implementation details

One bullet each — full prose (RBAC gating matrix, invitations, run concurrency, export
routing, profiling internals, Ask-engine pipeline) in
[`docs/reference/internals.md`](docs/reference/internals.md).

- **App DB / projects (`web/db/`):** users ↔ orgs ↔ projects in Postgres (SQLAlchemy 2.0);
  each project's config is a `jsonb` column (source of truth), every query membership-scoped.
  Alembic migrations run on FastAPI startup; tests use SQLite (`DATABRIDGE_SKIP_MIGRATIONS=1`).
  `/api/config` reads/writes the caller's **active project**; on save or project switch the
  config is mirrored to `config.yml` so the file-based CLI stays consistent.
- **RBAC (`web/db/` + `web/main.py`):** per-project `ProjectMembership(role ∈
  viewer<editor<admin)` + project `owner_id` + global `is_superadmin`. `require_role()` gates
  mutating endpoints (config/questions/run → editor; deletes → editor/admin). Invitations are
  consumed on login; superadmins bootstrapped from `SUPERADMIN_EMAILS`. Frontend `lib/perms.js`
  hides destructive controls (server still enforces).
- **Storage (`web/storage/`):** project files (data sessions, reports, templates) live in
  Minio/S3. Local `data/processed` / `reports` / `templates` are a materialized mirror of the
  active project — `pull_workspace` on activate, `push_outputs` after a successful run.
  `data/raw` + `data/processed/charts` are not synced (regenerable).
- **Per-run isolation:** each `/api/run/{cmd}` runs in its own tempdir (`hydrate_run_dir`
  writes config + pulls the command's `RUN_INPUTS`); CLI runs with `cwd=<tempdir>`. On success
  outputs push to Minio + config syncs back to the DB. Runs tracked by in-memory `RunRegistry`
  — one run per project (else **409**); different projects run concurrently up to
  `MAX_CONCURRENT_RUNS` (else **429** + `Retry-After`).
- **`env:` resolution (`src/utils/config.py`):** any config string starting `env:` is resolved
  from the environment at load time.
- **SSE log streaming (`web/main.py`):** CLI runs as an `asyncio` subprocess; merged
  stdout/stderr stream line-by-line as SSE frames. Only `ALLOWED_COMMANDS` are runnable — no
  arbitrary shell. React reads via `fetch().body.getReader()` in `hooks/useCommand.js`.
- **Flatten (`src/data/flatten.py`):** `load_data` → main table + one base table per repeat
  level. Linkage cols on every repeat row: `_root_id`, `_parent_index` (alias of `_root_id`),
  `_parent_row_id`, `_row_id` (e.g. `"12.0.1"`), `_row_index`. Catalog at `GET /api/base-tables`.
- **Profiling (`src/data/profile.py`):** deterministic per-column EDA (role, completeness,
  3×IQR outliers, correlations) — the single source of truth feeding `validate.py` +
  `summaries.py`. `GET /api/profile`.
- **PII gate (`src/utils/pii.py`):** strict `enforce_pii` inside `export_data` is **fail-closed**
  (missing consent/redact column or unknown strategy → `PIIConfigError` aborts download) — so
  `data/processed` + DB are always redacted + consent-gated. Lenient `apply_pii` runs again at
  render time. `download --no-redact` is an off-by-default raw escape hatch (CLI-only).
- **Ask engine (`src/reports/ask_engine.py`):** `ask()` answers an NL question with 1–3
  locally-computed charts/indicators (LLM proposes a recipe, validated then executed locally).
  `POST /api/ask`, `/api/ask/save`, `/api/ask/refine`. Needs an AI provider + downloaded data.

## Web UI

Six tabs under `frontend/src/pages/` mirroring the pipeline: **Dashboard** · **① Sources** ·
**② Questions** · **③ Composition** · **④ Reports** · **Templates** (plus Validate / Profile /
Ask panels). All CSS in `frontend/src/styles.css` (design tokens at top). Vite (`:51730`)
proxies `/api/*` → uvicorn (`:8000`); same code paths in prod-like single-port mode. Per-tab
purpose + endpoints: [`docs/reference/internals.md`](docs/reference/internals.md#web-ui-tabs).

## Common tasks

- **New chart type:** add `fn(df, questions, title, out_path, opts)` to `charts.py` → add to
  `CHART_DISPATCH` → add to `CHART_TYPES` in `frontend/src/pages/Composition.jsx`.
- **New export target:** add `_export_<t>()` in `transform.py` → branch in `export_data()` →
  optional import *inside* the function → chip in `Sources.jsx` → env vars in `.env.example`.
- **New CLI command:** `@cli.command()` in `make.py` → add to `ALLOWED_COMMANDS` in
  `web/main.py` → surface it in the UI.
- **New prompt site:** add to `SEED_PROMPTS` (`seed_prompts.py`) → call
  `lf_client.get_prompt(name, vars)` + `lf_client.chat(trace_name=name)` → `push-prompts`.

## Environment variables

| Variable | Required | For |
|---|---|---|
| `KOBO_TOKEN` | Yes | Kobo/Ona API token |
| `DATABASE_URL` | Yes | App-state Postgres (Alembic on startup) |
| `S3_*` | Yes | Project file storage (Minio/S3) |
| `DB_USER` / `DB_PASSWORD` | DB export | SQL export targets |
| `SUPABASE_KEY` | Supabase export | Supabase service role key |
| `OPENAI_API_KEY` / Anthropic | AI features | LLM provider |
| `LANGFUSE_PUBLIC_KEY` / `SECRET_KEY` / `HOST` | Prompt mgmt | Langfuse (falls back to seeds) |
| `SUPERADMIN_EMAILS` / `ZITADEL_API_TOKEN` | Admin | Superadmin bootstrap + invitations |

## Development workflow (gated)

All work is tracked in [`docs/ROADMAP.md`](docs/ROADMAP.md). The `/roadmap` skill is the only
way to edit it; PreToolUse hooks in `.claude/hooks/` enforce the rules below.

- **Gate before coding.** No feature/bug/fix code unless the task exists in the roadmap and is
  started via `/roadmap` (writes `.claude/.active-task.json`). Edits to `src/ web/ frontend/src/
  tests/` are blocked without a fresh marker. Exempt: minor config, `docs/**`, `*.md`,
  `.claude/**`, `scripts/**`, `.github/**`.
- **Definition of Ready (entry gate).** A card is *startable* only when Ready: AC concrete +
  testable, Unit/E2E/UAT filled (E2E + UAT may be `N/A` for non-UI/CLI cards), Files known, deps
  resolved, scoped, on a derived branch. `guard-ready` blocks the marker otherwise.
- **Definition of Done (exit gate).** Unit + E2E green · visual baseline approved · impeccable
  audit/critique clean · UAT signed (UI-facing cards only; non-UI/CLI cards are `N/A`, gated by
  PR review) · **security review clean** (OWASP Top 10 + project absolute rules; no Critical/High
  — `security-audit` agent / `/security-review`) · committed. `roadmap-verifier` gates it before a
  card flips `- [x]`.
  PR review) · **security & dependency review clean** (`security-audit` → `SECURITY: CLEAR`;
  `dep-audit` when deps changed; `/code-review` no blockers — or `N/A` with no security surface) ·
  committed. `roadmap-verifier` gates it before a card flips `- [x]`.
- **Roadmap edits go through `/roadmap`** (whole-file rewrite; `guard-roadmap` validates the
  template — header `## Definition of Ready` + `## Definition of Done` + `## Global status`;
  each card carries the literal labels `Acceptance criteria`, `Unit tests`, `E2E`, `UAT`).
- **Branching (git-flow).** `main` (prod) + `develop` (integration) are **merge-only** —
  `guard-git-flow` + `guard-branch` block commits/code-edits on them. Work on `feature/ fix/
  chore/` branches off `develop`; PR → develop, release PR → main; delete branch after merge.
- **Tests-first, separate authors.** `roadmap-test-author` writes tests from the AC and proves
  them red; `roadmap-task-implementer` makes them pass and never edits them. A test believed
  wrong is escalated, not edited.
- **Visual checks.** impeccable `audit`/`critique` + Playwright `toHaveScreenshot` on UI tasks,
  baselined at three viewports (mobile/tablet/desktop — see *Tests → Visual / E2E*); a human
  approves the first baseline per viewport and runs UAT. UAT applies to UI-facing cards; non-UI/CLI
  cards mark it `N/A` and rely on PR review as the human gate.
- **Server-side teeth.** CI validates the roadmap template + rejects direct main/develop pushes;
  GitHub branch protection requires PR review.

### Agents (`.claude/agents/`)
`roadmap-planner` (decompose → cards) · `roadmap-card-reviewer` (DoR + template) ·
`roadmap-test-author` (AC-derived tests, red-first) · `roadmap-task-implementer` (frozen-tests
impl) · `security-audit` (OWASP + project-rules review of the task diff; report-only) ·
`dep-audit` (SCA scan) · `roadmap-verifier` (DoD exit gate).

### Orchestrator
`/ship-task <TASK-ID>` (`.claude/skills/ship-task/`) — autonomous Workflow pipeline that takes ONE
card to an open PR: DoR check → branch + active-task marker → `roadmap-test-author` (RED) →
`roadmap-task-implementer` (GREEN + impeccable + Playwright screenshots, bounded self-repair) →
parallel `security-audit` + `dep-audit` → `roadmap-verifier` (DoD) → marks `[x]` + opens PR →
**develop**. Human touchpoints only: DoR failure, tests still red after auto-fix, review blockers,
and final UAT + review + merge on the PR.
impl) · `roadmap-verifier` (DoD exit gate) · `security-audit` (OWASP + absolute-rules gate,
report-only) · `dep-audit` (SCA / vulnerable + outdated deps).

### Process skills (superpowers — keep)
review → `/code-review`, `/security-review`, requesting/receiving-code-review · debug →
systematic-debugging · verify → verification-before-completion · isolate → using-git-worktrees ·
deliver → finishing-a-development-branch. (These govern *how* we engineer; the roadmap governs
*what* + the quality bar — complementary layers.)

### Design (impeccable)
`/impeccable` (audit · critique · polish · detect · live) is the frontend design + visual-quality
layer. Its skill tree is gitignored — re-install with `npx impeccable skills install`.

## Harness

`.claude/settings.json` allowlists the pytest commands and registers the PreToolUse guard hooks
(`guard-roadmap`, `guard-coding`, `guard-ready`, `guard-git-flow`, `guard-branch`). Skills:
`/roadmap`, `/impeccable`, `/ship-task`. Agents live in `.claude/agents/`. Run the suite with
`PYTHONPATH=. MPLBACKEND=Agg python -m pytest`.

## Design Context

Strategic + visual design intent lives in two root files, read by `/impeccable` and useful for
any UI work:

- **[`PRODUCT.md`](PRODUCT.md)** (who/what/why) — **register: product**. Users: M&E officers +
  field coordinators (mixed/low technical skill). Outcome: **self-serve for non-experts**.
  Personality: **clear · neutral · institutional**. A11y target: **WCAG 2.1 AA + low-bandwidth/
  field**. Anti-references: engineer-only tools, consumer/playful SaaS, generic AI-template slop.
- **[`DESIGN.md`](DESIGN.md)** + `.impeccable/design.json` (how it looks) — North Star **"The
  Clear Workbench"**. Cool-slate neutrals + one rationed **Deep Field Teal** (`#0F766E`) accent;
  Inter + JetBrains Mono; flat-by-default elevation (1px borders carry structure).

Design principles (from PRODUCT.md): **Guide don't gate · Plain language over jargon · Make the
safe path the default · Credible over clever · Respect the field.** Core doctrines (DESIGN.md):
**The One Voice Rule** (teal is the only action color), **The Mono-Means-Literal Rule** (mono =
machine-truth only), **The Flat-By-Default Rule** (shadows respond to state, never ambient).
