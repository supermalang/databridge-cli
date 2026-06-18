[![forthebadge made-with-python](http://ForTheBadge.com/images/badges/made-with-python.svg)](https://www.python.org/)  
[![GitHub license](https://img.shields.io/github/license/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/LICENSE)
[![GitHub tag](https://img.shields.io/github/tag/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/tags/)



databridge-cli
==============================

**databridge-cli** is a multi-tenant, web-based report-generation platform that connects to [Kobo Toolbox](https://www.kobotoolbox.org/) or [Ona](https://ona.io/) data-collection services. It automates the full pipeline — fetching survey questions, profiling and validating data, configuring charts/indicators, downloading submissions, and building Word (`.docx`) reports with embedded charts — from a browser-based interface, with optional AI assistance.

Everything is driven by a single `config.yml` per project. Multiple users and organizations can each work on their own projects, with per-project role-based access control.

# Features

- **Guided 5-stage workflow** in the browser: Extract → Transform → Model → Analyze → Deliver
- **Multi-tenant**: users ↔ organizations ↔ projects, each project with its own config, data, reports, and templates
- **Per-project RBAC**: `viewer` / `editor` / `admin` roles, project owners, email invitations, and global superadmins
- **Authentication** via Zitadel (OIDC); identity, orgs, and memberships auto-provisioned on first login
- **21 chart types** including NGO-specific ones: grouped bar, bullet chart, Likert scale, scorecard, population pyramid, dot map
- **Indicators** — text/number/percentage values rendered inline in Word (`{{ ind_<name> }}` placeholders), with disaggregation, results-framework linkage, and data-quality stats
- **Data profiling & validation** — deterministic EDA profile and data-quality findings (missingness, outliers, duplicates, type issues) before you build
- **Ask** — natural-language questions answered as locally-computed charts or indicators
- **AI narrative** — auto-written summary / observations / recommendations, with prompts versioned in [Langfuse](https://cloud.langfuse.com)
- **Multi-period** support (baseline / midline / endline or quarterly rounds) and a **results framework** (logframe)
- **PII redaction + consent gating** at export and render time
- **Split-by reports** — one report per unique value of any column (e.g., one per region)
- Export to CSV, JSON, XLSX, MySQL, PostgreSQL, or Supabase
- Real-time log streaming via Server-Sent Events (SSE), with concurrent runs isolated per project
- Runs locally with **no Docker** (uvicorn + Vite); a production Docker image is provided for deployment

---

# How it works

Three layers in two languages:

| Layer | Language | Lives in | What it does |
|---|---|---|---|
| **CLI + data + reports** | Python (pandas, matplotlib, docxtpl) | `src/` | Fetch schemas, download submissions, apply filters, render 21 chart types, fill Word templates |
| **HTTP API + log streamer** | Python (FastAPI + uvicorn) | `web/` | `/api/*` REST endpoints, runs CLI commands as subprocesses and streams stdout as SSE |
| **Web UI** | React (Vite) | `frontend/` | The guided dashboard that calls `/api/*` |

Backing services:

- **Postgres** — application database (users, orgs, projects, memberships, invitations). Each project's `config.yml` is stored as a `jsonb` column (the source of truth) and mirrored to disk for the CLI. Migrations are run automatically (Alembic) on startup.
- **Minio / S3** — durable per-project object storage for data sessions, reports, and templates. The local `data/`, `reports/`, and `templates/` directories are a materialized mirror of the active project.
- **Zitadel (OIDC)** — authentication and (optionally) user provisioning for invitations.

---

# The workflow (web UI)

The UI is organized as **Home + five ordered stages**. Stages with more than one screen show a secondary sub-tab strip.

| Stage | Sub-tabs | Purpose |
|---|---|---|
| **Home** | — | Greeting, pipeline strip, KPIs, recent runs, AI queue, project usage; one-click "Run pipeline" |
| **Extract** | Connection · AI configuration | Platform picker (Kobo/Ona), API & form, AI provider/narrative |
| **Transform** | Questions · Profile · Validate | Edit `export_label`s; deterministic data profile; data-quality findings |
| **Model** | Views | Named virtual tables (joins/aggregations) reused by charts, summaries, indicators |
| **Analyze** | Ask · Charts & indicators | Natural-language Q&A; charts, indicators, tables, summaries, framework, PII |
| **Deliver** | Output · Templates · Reports | Export format; Word template management; generated `.docx` reports + data sessions |

A sticky **bottom terminal** shows pipeline-run / fetch logs and survives tab switches.

---

# Running locally (no Docker)

## Prerequisites

- **Python 3.11+** and **Node.js** (for the Vite frontend)
- A running **Postgres** database (`DATABASE_URL`)
- A running **Minio / S3** bucket (`S3_*`)
- A **Kobo Toolbox** or **Ona** API token
- *(Optional)* a **Zitadel** OIDC app for authentication — when OIDC env vars are absent, the app runs as a single local dev user
- *(Optional)* an **OpenAI / Anthropic** key and a **Langfuse** account for AI features

Quick local backing services:

```bash
# Postgres
docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=databridge -p 5432:5432 postgres:16

# Minio
docker run --rm -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 \
  minio/minio server /data --console-address ":9001"
```

## Setup

```bash
git clone https://github.com/supermalang/databridge-cli.git
cd databridge-cli

cp .env.example .env          # fill in your values (see Configuration)
cp sample.config.yml config.yml

pip install -r requirements.txt
# npm dependencies install automatically the first time you run dev.sh / serve.sh
```

## Two run modes

| Mode | Command | Ports | When to use |
|---|---|---|---|
| **Dev (HMR)** | `./scripts/dev.sh` | uvicorn `:8000` + Vite `:51730` (proxies `/api`) | UI iteration — rebuild in ~2s |
| **Prod-like** | `./scripts/serve.sh` | uvicorn `:8000` only (serves the built React bundle + API) | Demo, share, pre-deploy |

In dev mode, open the Vite port (`:51730`); Vite proxies `/api/*` to uvicorn. Override host/port with `HOST=… PORT=…`.

## Production deployment

A production Docker image (single container: built React + FastAPI on one port) and a single-VPS Docker Compose + Traefik setup are documented in **[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

# Configuration

## Environment variables (`.env`)

| Variable | Required | Description |
|---|---|---|
| `KOBO_TOKEN` | Yes | Kobo Toolbox or Ona API token |
| `DATABASE_URL` | Yes | Postgres connection string for the app database |
| `S3_ENDPOINT_URL` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_BUCKET` / `S3_REGION` | Yes | Minio / S3 object storage for per-project files |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Auth | Zitadel OIDC app. Absent ⇒ auth disabled, single local dev user |
| `SESSION_SECRET` | Auth | Secret used to sign/encrypt the session cookie (`openssl rand -hex 32`) |
| `APP_BASE_URL` | Auth | Public base URL (e.g. `https://databridge.example.com`); drives redirect URI + secure cookies |
| `SUPERADMIN_EMAILS` | No | Comma-separated emails bootstrapped as global superadmins on first login |
| `ZITADEL_API_TOKEN` | No | Zitadel Management API token; enables creating + emailing invited users |
| `APP_DOMAIN` | Deploy | Domain for Traefik routing (see docs/DEPLOY.md) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | AI | Key for the configured AI provider |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_HOST` | AI | Langfuse prompt management + tracing (optional; bundled seed prompts used otherwise) |
| `DB_USER` / `DB_PASSWORD` | DB export | Credentials for SQL/Supabase **export targets** (not the app DB) |
| `SUPABASE_KEY` | Supabase export | Supabase service-role key |

Any `config.yml` value starting with `env:` is resolved from the environment at load time (e.g. `token: env:KOBO_TOKEN`).

## `config.yml`

Create it from the sample (`cp sample.config.yml config.yml`). When auth is enabled, the active project's config is the source of truth and is mirrored to this file; you can also edit it from the UI or on disk.

### API & form

```yaml
api:
  platform: kobo                          # kobo | ona
  url: https://kf.kobotoolbox.org/api/v2
  token: env:KOBO_TOKEN

form:
  uid: aAbBcCdDeEfFgGhH                    # asset UID
  alias: monitoring_survey                 # filename prefix in exports
```

| Platform | `api.platform` | Example `api.url` |
|----------|----------------|-------------------|
| Kobo Toolbox | `kobo` | `https://kf.kobotoolbox.org/api/v2` |
| Kobo (self-hosted) | `kobo` | `https://kobo.yourdomain.com/api/v2` |
| Ona | `ona` | `https://api.ona.io/api/v1` |
| Ona (self-hosted) | `ona` | `https://ona.yourdomain.com/api/v1` |

### Questions

Auto-populated by `fetch-questions`. On re-run, your edits to `category` and `export_label` are preserved. Each entry: `kobo_key`, `label`, `type`, `category` (`categorical` / `quantitative` / `qualitative` / `geographical` / `date` / `undefined`), `group`, `choice_list`, `export_label`. Free-text questions may carry a `classify:` block to cluster responses into themes during `download`.

> Charts and templates reference `export_label` values — rename them in the **Questions** sub-tab to short, clean column names.

### Filters

[pandas `.query()` syntax](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.query.html), applied before export and chart generation. Column names are `export_label`s.

```yaml
filters:
  - "Age > 0"
  - "Region != 'Test'"
  - "submission_date >= '2025-01-01'"
```

### Views

Named virtual tables computed once and reused by charts/summaries/indicators.

```yaml
views:
  - name: dept_student_totals
    source: villages          # repeat group path, or "main"
    join_parent: [Departement]
    group_by: Departement
    question: Number of Students
    agg: sum                  # sum | mean | count | max | min
```

### Charts

Each chart maps to a `{{ chart_<name> }}` placeholder.

```yaml
charts:
  - name: satisfaction_overview
    title: Overall satisfaction
    type: horizontal_bar
    questions: [Satisfaction]
    options:
      top_n: 10
      width_inches: 5.5
      sort: value             # value | label | none
```

### Indicators

Each indicator renders as `{{ ind_<name> }}`.

```yaml
indicators:
  - name: total_beneficiaries
    label: Total beneficiaries
    question: Beneficiary_ID
    stat: count               # see stats below
    format: number            # number | decimal | percent | text
  - name: vaccinations_administered
    stat: sum
    question: Number of doses
    framework_ref: OP1.1               # link to a results-framework node
    disaggregate_by: [Region, Sex]     # adds ind_<name>_breakdown + ind_<name>_table
    primary: true                      # headline indicator for its framework node
```

**`stat` options:** `count` · `count_distinct` · `sum` · `mean` · `median` · `min` · `max` · `percent` · `most_common` · `grouped_agg` · `completeness` · `outlier_rate` · `duplicate_rate` (the last three are data-quality stats — pair with `format: percent`).
**`direction`:** `increase` (default, higher-is-better) | `decrease` (lower-is-better) — controls achievement vs target.

### Export

```yaml
export:
  format: csv                 # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions
```

### Report

```yaml
report:
  template: templates/report_template.docx
  output_dir: reports
  title: Monitoring Report
  period: Q1 2025
  # split_by: Region          # one report per unique value of this column
```

The template is a `.docx` with Jinja2-style placeholders: `{{ report_title }}`, `{{ period }}`, `{{ n_submissions }}`, `{{ generated_at }}`, `{{ summary_text }}`, `{{ chart_<name> }}`, `{{ ind_<name> }}`, `{{ data_quality }}`, `{{ logframe }}`, `{{ provenance.footer }}`, etc. Run `generate-template` to create a correct starter template — never type chart placeholders by hand.

Optional sections — **`periods:`** (multi-period), **`framework:`** (results framework / logframe), **`pii:`** (redaction + consent), and **`ai:`** (narrative) — are documented in their sections below.

---

# CLI commands

Run from the project root with `PYTHONPATH=.`. All of these are also exposed in the UI as `POST /api/run/{command}` with streamed logs (only whitelisted commands can be triggered — no arbitrary shell).

| Command | Description | Key options |
|---|---|---|
| `fetch-questions` | Fetch form schema → write questions into `config.yml` | — |
| `generate-template` | Build a starter Word template from charts/indicators | `--out <path>` |
| `download` | Download submissions, apply filters/PII gate, export | `--sample N`, `--period "Q3 2026"`, `--no-redact` |
| `build-report` | Build the Word report from downloaded data | `--sample N`, `--random-sample`, `--split-by <col>`, `--split-sample N`, `--period "..."`, `--compare "Q1,Q2"` |
| `run-all` | Run the whole pipeline: download → generate-template (if missing) → build-report | `--sample N`, `--period "..."`, `--force`, `--auto-charts` |
| `set-period` | Switch the active period (`periods.current`) | `--baseline` |
| `push-prompts` | Push bundled seed prompts to Langfuse | `--force` |
| `list-sessions` | List downloaded data sessions | — |
| `suggest-charts` / `suggest-views` / `suggest-summaries` / `suggest-tables` / `suggest-indicators` | AI suggestions (write YAML to stdout or `--out`) | `--out <path>` |
| `ai-generate-template` | AI-designed Word template | `--out <path>` |

```bash
# Typical first run
python3 src/data/make.py fetch-questions
python3 src/data/make.py generate-template
python3 src/data/make.py download --sample 50
python3 src/data/make.py build-report --sample 50

# Or the whole thing at once
python3 src/data/make.py run-all --auto-charts

# One report per region
python3 src/data/make.py build-report --split-by Region
```

> `run-all` skips the build-report stage when the downloaded data + report-relevant config are unchanged since the last build (fingerprints in `reports/.run_all_state.json`); pass `--force` to rebuild. `--auto-charts` derives a deterministic starter chart set from your questions when none are configured.

---

# Chart types (21)

All share the signature `fn(df, questions, title, out_path, opts)`.

| Type | Questions needed | Notes |
|---|---|---|
| `bar` | 1 categorical | |
| `horizontal_bar` | 1 categorical | best for long labels |
| `stacked_bar` | 2 categorical | `[x_axis, stack_by]`; option `normalize: true` |
| `grouped_bar` | 2 categorical | `[category, group_by]` |
| `pie` | 1 categorical | |
| `donut` | 1 categorical | |
| `line` | 1–2 | date + numeric; option `freq: month` |
| `area` | 1–2 | date + numeric; option `freq: month` |
| `histogram` | 1 numeric | option `bins` |
| `scatter` | 2 numeric | |
| `box_plot` | 1 categorical + 1 numeric | |
| `heatmap` | 2 categorical | |
| `treemap` | 1 categorical | requires `squarify` |
| `waterfall` | 1 categorical | |
| `funnel` | 1 categorical | |
| `table` | 1 categorical | renders as PNG |
| `bullet_chart` | 1 numeric | option `target` (required) |
| `likert` | 1 categorical | diverging bar; options `scale`, `neutral` |
| `scorecard` | 1+ any | KPI cards; options `columns`, `stat` |
| `pyramid` | age_group + gender | demographic pyramid |
| `dot_map` | lat + lon | GPS dot map; options `basemap`, `color_by`, `size` |

**Common options:** `top_n`, `width_inches`, `height_inches`, `color`, `xlabel`, `ylabel`. **Sort** (`bar`, `horizontal_bar`, `grouped_bar`, `waterfall`): `sort: value | label | none`.

---

# Repeat groups

Forms with repeat groups (e.g., household members within a household survey) are flattened into a **main table plus one table per repeat level** (including nested sub-repeats). Every repeat row carries linkage columns:

- `_root_id` — id of the root submission the row descends from
- `_parent_index` — alias of `_root_id` (backward-compat)
- `_parent_row_id` — `_row_id` of the immediate parent repeat row
- `_row_id` — stable composite id, e.g. `"12.0.1"`
- `_row_index` — position within the immediate parent

Join any level to its parent on `_parent_row_id == parent._row_id`, or to the root on `_root_id == main._id`.

**Export behavior by format:**

| Format | Main table | Repeat tables |
|--------|-----------|---------------|
| CSV | `alias_data.csv` | `alias_groupname.csv` (one per group) |
| JSON | `alias_data.json` | `alias_groupname.json` (one per group) |
| XLSX | `main` sheet | one sheet per group |
| SQL / Supabase | `submissions` | `submissions_groupname` |

> Filters applied to the main table automatically prune orphaned repeat rows whose parent submission was filtered out.

---

# Data quality, profiling & Ask

- **Profile** (`GET /api/profile`) — a deterministic EDA profile for every table: per-column role, completeness, cardinality, numeric stats + 3×IQR outliers, date ranges, low-cardinality top values, correlations, duplicate-id info. No LLM, no I/O.
- **Validate** (`POST /api/validate`) — findings for missingness, numeric outliers, duplicate identifiers, type-coercion issues, and orphan `framework_ref`s. A read-only **data-quality overview** (`GET /api/data-quality`) shows per-column completeness / outlier-rate / duplicate-rate.
- **Ask** (`POST /api/ask`) — ask a question in plain language; it returns 1–3 locally-computed answers (each a chart or a scalar indicator), grounded captions from the actual values, and can be **refined** ("make it a line chart", "split by sex"). Save an answer back into `config.yml`. Needs an AI provider + downloaded data.

---

# Authentication, projects & access control

When OIDC env vars are configured, the app authenticates users via **Zitadel**. On first login a user and a personal organization are auto-provisioned from the identity claims.

- **Multi-tenant model:** users ↔ organizations ↔ projects. Each project stores its own `config.yml` (as `jsonb`) and owns its data sessions, reports, and templates in object storage. All queries are membership-scoped — you only see your orgs' projects.
- **Per-project RBAC:** `ProjectMembership` with roles `viewer < editor < admin`, plus the project **owner** (creator) and a global **superadmin** override. Mutating endpoints require at least `editor`; destructive/admin operations require `admin`.
- **Invitations:** an admin can invite by email; if a Zitadel Management token is configured the user is created and emailed. Pending invites become memberships when that email logs in.
- **Per-run isolation:** each run executes in its own temp directory hydrated from object storage; outputs are pushed back on success. One run per project at a time; different projects run concurrently.

> The member roster shows each member's name/email (falling back to a user id only if neither is known). Identity is populated from OIDC claims at login.

---

# AI features & prompt management

AI features (narrator, chart/view/summary/table/indicator suggesters, template generator, text classifier, Ask engine) call an LLM provider configured in the `ai:` block:

```yaml
ai:
  provider: openai            # openai | anthropic
  model: gpt-4o
  api_key: env:OPENAI_API_KEY
  base_url: ""                # optional — Azure, Groq, Mistral, Ollama
  language: English
  max_tokens: 1500
```

Prompts are stored and versioned in **[Langfuse](https://cloud.langfuse.com)** and fetched at runtime. Resolution order: local cache (`~/.cache/databridge/prompts/`, 1-hour TTL) → Langfuse → bundled seeds (`src/utils/seed_prompts.py`). AI features keep working with no Langfuse keys (bundled seeds) and no provider key (the feature no-ops).

```bash
python3 src/data/make.py push-prompts          # seed prompts into Langfuse (create-if-missing)
python3 src/data/make.py push-prompts --force   # overwrite with current bundled defaults
```

**Output schemas:** the JSON-producing prompts carry a JSON Schema (in Langfuse's per-prompt `config`). OpenAI enforces it via Structured Outputs; Anthropic via forced tool-use. An invalid schema falls back to no-schema mode for that one prompt (logged), so the feature keeps running. Every LLM call is recorded as a Langfuse generation with cost/latency/token counts; a full pipeline run is grouped under one trace.

---

# Multi-period workflow

Track data collection across periods (baseline / midline / endline, or quarterly rounds) without overwriting earlier downloads.

```yaml
periods:
  current:  "Q2 2026"
  baseline: "Q1 2026"
  registry:
    - { label: "Q1 2026", slug: "q1_2026", started: 2026-01-01, ended: 2026-03-31 }
    - { label: "Q2 2026", slug: "q2_2026" }
```

A registry entry is either **date-range** (has `started`/`ended` — one plain download is sliced by `_submission_time` at report time) or **label-only** (legacy per-period downloads writing slug-prefixed files).

```bash
python3 src/data/make.py download --period "Q3 2026"
python3 src/data/make.py build-report --period "Q2 2026"
python3 src/data/make.py build-report --compare "Q1 2026,Q2 2026"
python3 src/data/make.py set-period "Q3 2026"
```

**Extra placeholders:** `{{ ind_<name>_p_<slug> }}`, `{{ ind_<name>_delta }}`, `{{ ind_<name>_pct_change }}`, `{{ provenance.period_label }}`, `{{ provenance.compared_periods }}`. Configs without a `periods:` block behave as single-period.

---

# Results framework (logframe)

Structure indicators in a Goal → Outcomes → Outputs hierarchy, editable in **Analyze → Charts & indicators** and rendered as a `{{ logframe }}` section.

```yaml
framework:
  goal:
    id: GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - { id: OC1, label: "80% of children under 5 fully vaccinated", parent: GOAL }
  outputs:
    - { id: OP1.1, label: "10,000 vaccination doses administered", parent: OC1 }
```

Link an indicator to a node with `framework_ref: OP1.1`; mark the headline indicator with `primary: true`. Indicators whose `framework_ref` doesn't match any node surface as an `orphan_framework_ref` finding in Validate. Configs without `framework:` are unaffected.

---

# Privacy & consent (PII)

Redact PII columns and gate on respondent consent.

```yaml
pii:
  consent_column: "Consent_to_share_data"
  consent_value:  "yes"
  redact:
    - { column: "Respondent_name", strategy: drop }
    - { column: "Phone_number",    strategy: hash }            # sha256(value)[:8]
    - { column: "GPS",             strategy: generalize_geo, decimals: 2 }
    - { column: "Date_of_birth",   strategy: generalize_date } # year only
    - { column: "National_ID",     strategy: mask }
```

Two tiers: a **strict export gate** (`enforce_pii` inside `download` — fail-closed on a missing consent/redact column or unknown strategy, consent-gates the main table, prunes orphaned repeat rows, then redacts) so `data/processed` + DB/Supabase are always gated; and a **lenient render net** at report/preview time as defense-in-depth. `download --no-redact` is an explicit, CLI-only escape hatch that writes raw data and logs a warning. Configs without a `pii:` block are unaffected.

---

# Trust & audit

- Values shown in the UI are computed live from your downloaded data — no placeholders.
- Generated `.docx` reports include a provenance footer (`{{ provenance.footer }}`): when generated, when the data was downloaded, the number of submissions, active filters, a short hash of the config, and a PII note when redaction is configured. Same config + data ⇒ same hash.

---

# API endpoints

The FastAPI backend exposes `/api/*`. Highlights (not exhaustive):

- **Config & questions:** `GET/POST /api/config`, `GET/POST /api/questions`
- **Run pipeline:** `POST /api/run/{command}` (SSE), `GET /api/status`, `POST /api/stop/{run_id}`
- **Outputs:** `/api/reports*`, `/api/templates*`, `/api/data*`, `/api/data/sessions`
- **Analysis:** `GET /api/profile`, `POST /api/validate`, `GET /api/data-quality`, `GET /api/base-tables`, `POST /api/ask`, `POST /api/ask/refine`, `POST /api/ask/save`
- **Projects & access:** `GET /api/projects`, project members `GET/POST/PATCH/DELETE /api/projects/{id}/members*`, invitations, `POST /api/admin/superadmins`
- **Auth:** `/auth/login`, `/auth/callback`, `/auth/logout`, `GET /api/me`
- **Health:** `GET /api/health`

Mutating endpoints are role-gated (editor for config/questions/run/deletes; admin for templates/projects/members). Previews, suggestions, and AI-test stay ungated.

---

# Testing

A pytest suite under `tests/` covers auth, RBAC, provisioning, the provenance helper, prompt-seed validation, and build-report / compare smoke paths. Tests run against SQLite (`DATABRIDGE_SKIP_MIGRATIONS=1`) and the local-fs storage backend (`STORAGE_BACKEND=local`).

```bash
PYTHONPATH=. pytest -v
```

> Working with an AI agent (Claude Code)? Tests run as `PYTHONPATH=. MPLBACKEND=Agg python -m pytest` — the headless matplotlib backend is required for the chart-rendering tests.

---

# Development workflow & governance

This repo uses a lightweight, **roadmap-driven** development process, enforced for AI agents by hooks under `.claude/` and documented for humans here and in [CLAUDE.md](CLAUDE.md).

**All work is tracked in [docs/ROADMAP.md](docs/ROADMAP.md).** Every task is a card with a fixed template:

- **Acceptance criteria** — concrete, testable conditions for *this* task
- **Unit tests** (pytest) · **E2E** (Playwright + visual snapshot, for UI) · **UAT** (manual checklist)
- The roadmap header carries a single **Definition of Ready** (entry gate) and **Definition of Done** (exit gate)

**Lifecycle:** define → plan → test → implement → verify → deliver. Tests are written **first, from the acceptance criteria** (by a separate author from the implementer, so tests validate the requirement — not the code), proven to fail, then made to pass. Visual quality on UI changes is checked with [impeccable](https://www.npmjs.com/package/impeccable) (`audit` / `critique`) plus Playwright screenshots.

**Branching (git-flow) — protected branches receive merges only:**

```
feature/… ─PR→ develop ─release PR→ main
fix/…    ─┘
chore/…  ─┘
```

- Branch from `develop` using `feature/`, `fix/`, or `chore/` prefixes.
- **Never commit directly to `main` or `develop`.** `main` receives releases from `develop`; `develop` receives merges from derived branches. Open a PR; delete the branch after merge.

**For AI agents:** the `/roadmap` skill is the only way to edit the roadmap, and PreToolUse guard hooks block (1) code edits without an active, *Ready* roadmap task, (2) commits/code-edits on `main`/`develop`, and (3) roadmap writes that don't match the template. Server-side, CI validates the roadmap template and branch protection requires PR review. See [CLAUDE.md](CLAUDE.md#development-workflow-gated) for the full contract.

---

# Schedule automatic execution

Schedule the pipeline with a host cron job that runs the CLI (set `PYTHONPATH=.`), or `docker exec` into the production container (see [docs/DEPLOY.md](docs/DEPLOY.md)). Example daily run at 02:00:

```cron
0 2 * * * cd /path/to/databridge-cli && PYTHONPATH=. python3 src/data/make.py run-all
```

> On Windows, use [Task Scheduler](https://www.windowscentral.com/how-create-automated-task-using-task-scheduler-windows-10).
