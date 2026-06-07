# CLAUDE.md — kobo-reporter / databridge-cli

This file gives Claude Code full context about this project.

---

## What this project does

**kobo-reporter** is a CLI + web tool that:
1. Fetches survey form schemas from Kobo/Ona platforms
2. Lets the user configure which questions to extract, how to visualize them, and where to export
3. Downloads submission data, applies filters, and exports to file or database
4. Generates Word reports (.docx) with embedded charts and editable text sections

Everything is driven by a single `config.yml` file. The web UI is a React app talking to a FastAPI backend; both run on the same host (no Docker required).

---

## Architecture at a glance

Three layers in two languages, all running on the same machine inside the dev container.

| Layer | Language | Lives in | What it does |
|---|---|---|---|
| **CLI + data + reports** | Python (pandas, matplotlib, docxtpl) | `src/` | All real work: fetch schemas, download submissions, apply filters, render 21 chart types, fill Word templates |
| **HTTP API + log streamer** | Python (FastAPI + uvicorn) | `web/main.py` | Exposes `/api/*` REST endpoints, runs CLI commands as subprocesses and streams stdout as SSE |
| **Web UI** | JSX/React (compiled by Vite) | `frontend/src/` → `frontend/dist/` | Six-tab dashboard that calls `/api/*`; authored as `.jsx` + `styles.css`, shipped as plain HTML/JS |

**Why `web/` and `frontend/` are separate folders:**
- `web/` is a Python package — FastAPI imports it (`from web.main import app`). It needs `__init__.py` and Python-importable structure.
- `frontend/` is a Vite project root — owns `package.json`, `node_modules/`, `vite.config.js`, and its own entry `index.html`. Vite assumes it owns its directory.

Mixing them would mean either npm crawling Python files or Python's import machinery sitting next to `node_modules/`. The split is the standard layout for a Python-backend + JS-frontend project.

**Two run modes, no Docker:**

| Mode | Command | Ports | When to use |
|---|---|---|---|
| Dev (HMR) | `./scripts/dev.sh` | uvicorn `:8000` + vite `:51730` (proxies `/api`) | UI iteration — saves rebuild in ~2s |
| Prod-like | `./scripts/serve.sh` | uvicorn `:8000` only (serves built React + API) | Demo, share, pre-deploy |

---

## Project structure

```
databridge-cli/
├── CLAUDE.md                         ← you are here
├── requirements.txt                  ← Python deps (CLI + FastAPI)
├── sample.config.yml                 ← config template (copy to config.yml)
├── .env.example                      ← env vars template (copy to .env)
├── TEMPLATE_GUIDE.md                 ← manual Word template instructions
│
├── src/                              ← CLI code
│   ├── data/
│   │   ├── make.py                   ← CLI entry point (click group, 4 commands)
│   │   ├── extract.py                ← KoboClient — API auth, pagination, schema fetch
│   │   ├── questions.py              ← fetch schema → auto-categorize → write to config.yml
│   │   └── transform.py              ← flatten submissions, apply filters, multi-target export
│   ├── reports/
│   │   ├── builder.py                ← ReportBuilder — renders Word template via docxtpl
│   │   ├── charts.py                 ← 21 chart types via matplotlib (CHART_DISPATCH dict)
│   │   └── template_generator.py     ← auto-generates starter .docx from config
│   └── utils/
│       └── config.py                 ← load_config(), write_config(), env: var resolution
│
├── web/
│   ├── __init__.py
│   └── main.py                       ← FastAPI app: /api/* endpoints, SSE log streaming,
│                                       serves frontend/dist/ in prod-like mode
│
├── frontend/                         ← React + Vite (the UI)
│   ├── package.json                  ← deps: react, react-dom, vite, js-yaml
│   ├── vite.config.js                ← dev server on :51730, proxies /api & /terminal → :8000
│   ├── index.html                    ← Vite entry — mounts <App />
│   └── src/
│       ├── main.jsx                  ← ReactDOM root + ToastProvider
│       ├── App.jsx                   ← Topbar + tab nav + project switcher
│       ├── styles.css                ← Design tokens + component styles (all CSS lives here)
│       ├── lib/config.js             ← loadConfig / saveConfigPatch / saveConfigText helpers
│       ├── hooks/useCommand.js       ← POST /api/run/* + parse SSE stream into log lines
│       ├── components/
│       │   ├── BottomTerminal.jsx    ← sticky bottom log/terminal with sessions + filter
│       │   ├── FileTable.jsx         ← reusable file-listing table
│       │   ├── Modal.jsx             ← reusable modal overlay
│       │   ├── Sparkline.jsx         ← small SVG sparkline
│       │   └── Toast.jsx             ← ToastProvider + useToast() hook
│       └── pages/
│           ├── Dashboard.jsx         ← greeting + pipeline strip + KPIs + runs + AI queue + usage
│           ├── Sources.jsx           ← platform picker + connection + AI narrative + output
│           ├── Questions.jsx         ← group tree + searchable, inline-editable export labels
│           ├── Composition.jsx       ← filters + charts + indicators + summaries + views + templates
│           ├── Reports.jsx           ← generated .docx files + data sessions
│           └── Templates.jsx         ← .docx template list (standalone tab)
│
├── scripts/
│   ├── dev.sh                        ← uvicorn (:8000) + vite (:51730) together with HMR
│   └── serve.sh                      ← npm run build + uvicorn — single-port prod-like
│
├── data/
│   ├── raw/                          ← gitignored
│   └── processed/
│       └── charts/                   ← PNG chart files generated at build-report time
├── reports/                          ← gitignored — generated .docx files
├── templates/                        ← Word templates (.docx) — user creates/edits here
└── references/                       ← API docs, field dictionaries, notes
```

---

## Dev workflow

**For UI work** — both servers, HMR on the React side:

```bash
./scripts/dev.sh
```

Runs FastAPI on `:8000` (with `--reload`) and Vite on `:51730` (with HMR). Vite proxies
`/api/*` and `/terminal/` to uvicorn, so you hit `:51730` from the dev container's
forwarded port and everything works end-to-end. First run installs npm deps automatically.

**For a prod-like local run** — single port, no HMR:

```bash
./scripts/serve.sh
```

Runs `npm run build` once, then uvicorn on `:8000` serving the built React bundle from
`frontend/dist/` plus all `/api/*` routes. Override with `HOST=… PORT=…` env vars.

**First-time setup in this dev container:**

```bash
pip install -r requirements.txt
# (npm deps install automatically the first time you run dev.sh / serve.sh)
```

---

## CLI commands

All commands run from project root. Set `PYTHONPATH=.`.

```bash
# 1. Fetch questions from Kobo/Ona form → writes into config.yml
python3 src/data/make.py fetch-questions

# 2. Auto-generate Word template from charts in config.yml → overwrites existing
python3 src/data/make.py generate-template
python3 src/data/make.py generate-template --out templates/custom.docx

# 3. Download submissions, apply filters, export to configured destination
python3 src/data/make.py download
python3 src/data/make.py download --sample 50          # first 50 rows only (for testing)
python3 src/data/make.py download --period "Q3 2026"   # tag download with a period (auto-registers if new)

# 4. Build Word report from downloaded data
python3 src/data/make.py build-report
python3 src/data/make.py build-report --sample 100
python3 src/data/make.py build-report --sample 100 --random-sample
python3 src/data/make.py build-report --split-by Site                   # one report per Site value
python3 src/data/make.py build-report --split-by Site --split-sample 3  # first 3 sites only
python3 src/data/make.py build-report --period "Q2 2026"                # report for a specific period
python3 src/data/make.py build-report --compare "Q1 2026,Q2 2026"       # comparison report across periods

# 5. Switch the active period (updates periods.current in config.yml)
python3 src/data/make.py set-period "Q3 2026"

# 6. Push bundled seed prompts to Langfuse (create-if-missing; --force overwrites)
python3 src/data/make.py push-prompts

# 7. Run the whole pipeline in order: download -> generate-template (if missing) -> build-report
python3 src/data/make.py run-all
python3 src/data/make.py run-all --sample 50 --period "Q3 2026"
python3 src/data/make.py run-all --force         # rebuild even if data + config are unchanged
python3 src/data/make.py run-all --auto-charts   # if no charts configured, derive a starter set from questions
```

> **Validation and classification are not standalone CLI commands.**
> - *Validation* (missingness, outliers, duplicates, type issues) runs in the web **Validate** tab via `POST /api/validate`; the detectors live in `src/data/validate.py`.
> - *Data-quality overview* (per-column completeness / outlier-rate / duplicate-rate for the main table) is served read-only at `GET /api/data-quality` and rendered as a threshold-colored, sortable panel atop the **Validate** tab. It reuses `compute_data_quality` in `src/reports/data_quality.py` — the same numeric core the report's `{{ data_quality }}` section formats.
> - *Classification* of open-text responses runs **automatically at the end of `download`** (`_run_classify` in `src/data/make.py`) when `ai:` is configured and a question sets `classify.enabled: true`; discovered themes are written back to `config.yml`.

```bash
python3 src/data/make.py push-prompts --force
```

The same commands are exposed in the web UI as POST `/api/run/{command}` with
SSE-style streamed logs.

`run-all` chains the existing commands via Click's `ctx.invoke` with precondition checks (questions + charts must be configured) and stop-on-failure; it is exposed at `POST /api/run/run-all` and the Dashboard "Run pipeline" button. It adds **build-report staleness**: the build-report stage is skipped when the downloaded data content + report-relevant config are unchanged since the last build (content fingerprints recorded in `reports/.run_all_state.json` by `src/data/run_state.py`); pass `--force` to rebuild regardless. Skipping the *download* itself when the remote is unchanged is a later slice. With `--auto-charts`, an empty `charts:` config is filled with a **deterministic** starter set derived from the saved questions (`categorical → bar`, `quantitative → histogram`, capped at 25; via `src/reports/default_charts.py`), persisted to `config.yml` before the template/build stages. Other categories are skipped; if nothing is chartable the run stops with a clear message. (An *existing* template won't gain placeholders for the new charts — `--auto-charts` targets fresh configs where `generate-template` still runs.) The flag is whitelisted/forwarded by `POST /api/run/run-all` and surfaced as the "Auto-create charts" checkbox beside the Dashboard "Run pipeline" button.

---

## config.yml — full annotated structure

```yaml
api:
  url: https://kf.kobotoolbox.org/api/v2   # or https://api.ona.io/api/v1
  token: env:KOBO_TOKEN                    # env: prefix reads from environment variable

form:
  uid: aAbBcCdDeEfFgGhH                    # Kobo/Ona asset UID
  alias: monitoring_survey                 # used as filename prefix in exports

# Auto-filled by fetch-questions — user then edits (delete unwanted, fix categories)
questions:
  - kobo_key: region                       # dot-path from Kobo API response
    label: Region                          # label from XLSForm
    type: select_one                       # raw XLSForm type
    category: categorical                  # qualitative|quantitative|categorical|geographical|date|undefined
    group: ""                              # XLSForm group path if nested
    choice_list: regions                   # choice list name for select questions
    export_label: Region                   # column name in export — user can rename

# pandas .query() syntax — applied to all data before export and chart generation
filters:
  - "Age > 0"
  - "Region != 'Test'"
  - "submission_date >= '2025-01-01'"

# Named virtual tables — computed once per render, reused by charts/summaries/indicators.
views:
  - name: villages_with_dept
    source: villages                    # repeat group path (or "main")
    join_parent: [Departement, Region]
    filter: "Number of Students > 0"

  - name: dept_student_totals           # aggregated view
    source: villages
    join_parent: [Departement]
    group_by: Departement
    question: Number of Students
    agg: sum                            # sum | mean | count | max | min

# Each chart → {{ chart_<n> }} placeholder in Word template
charts:
  - name: satisfaction_overview
    title: Overall satisfaction
    type: horizontal_bar
    questions: [Satisfaction]
    options:
      top_n: 10
      width_inches: 5.5

# Each indicator → {{ ind_<name> }} placeholder; framework_ref links it to a framework node
# stat: count | count_distinct | sum | mean | median | min | max | percent | most_common | grouped_agg |
#       completeness (% present, non-blank) | outlier_rate (% beyond 3xIQR) | duplicate_rate (% redundant)
#       — the latter three are data-quality stats; pair with format: percent
# direction: increase (default, higher-is-better → pct_achievement = value/target)
#            | decrease (lower-is-better → target/value). Set on "reduce X" indicators
#            so achievement is correct when the goal is to bring a number down.
indicators:
  - name: vaccinations_administered
    stat: sum
    question: Number of doses
    framework_ref: OP1.1     # optional — links indicator to a results-framework node
    disaggregate_by: [Region, Sex]   # optional — also compute this stat per group;
                                     # adds ind_<name>_breakdown (list) + ind_<name>_table (text)
    primary: true                    # optional — headline indicator for its framework node;
                                     # drives the node's achievement in the logframe rows

# AI narrative (fills {{ summary_text }}, {{ observations }}, {{ recommendations }})
ai:
  provider: openai                      # openai | anthropic
  model: gpt-4o
  api_key: env:OPENAI_API_KEY
  base_url: ""                          # optional — Azure, Groq, Mistral, Ollama
  language: English
  max_tokens: 1500

# Optional — multi-period support. When absent, single-period mode applies.
# A registry entry has two flavors, distinguished by whether it carries dates:
#   • date-range (has started/ended) — set from the Deliver→Output "Reporting
#     period" control (Year/Quarter/Month or a custom range). ONE plain download
#     is sliced at report time: build-report keeps only rows whose
#     `_submission_time` falls in [started, ended] (see filter_to_period in
#     src/data/transform.py). Files are NOT slug-separated.
#   • label-only (no started/ended) — legacy per-period downloads, where each
#     period writes slug-prefixed files `{alias}_{slug}_data_*` and build-report
#     --period loads just that period's files.
periods:
  current:  "Q2 2026"                    # active period
  baseline: "Q1 2026"                    # canonical comparison anchor
  registry:
    - label: "Q1 2026"
      slug:  "q1_2026"                   # filesystem-safe; auto-derived from label
      started: 2026-01-01                # set ⇒ date-range period (filters by _submission_time)
      ended:   2026-03-31
    - label: "Q2 2026"
      slug:  "q2_2026"

# Optional — results framework (logframe). When absent, no framework rendering.
framework:
  goal:
    id:    GOAL
    label: "Reduce child mortality by 25% in target districts by 2030"
  outcomes:
    - id: OC1
      label: "80% of children under 5 fully vaccinated"
      parent: GOAL
  outputs:
    - id: OP1.1
      label: "10,000 vaccination doses administered"
      parent: OC1

# Optional — PII redaction + consent gating. When absent, no redaction.
pii:
  consent_column: "Consent_to_share_data"   # rows must have this == consent_value
  consent_value:  "yes"
  redact:
    - column: "Respondent_name"
      strategy: drop
    - column: "Phone_number"
      strategy: hash
    - column: "GPS"
      strategy: generalize_geo
      decimals: 2

export:
  format: csv                              # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions

report:
  template: templates/report_template.docx
  output_dir: reports
  title: Monitoring Report
  period: Q1 2025
  filename_pattern: "{form.alias}_{period}_{split}.docx"
  split_by: region                       # optional — generate one .docx per unique value
```

---

## Auto-categorization rules (src/data/questions.py)

XLSForm question type → category mapping at fetch-questions time:

| XLSForm type | Category |
|---|---|
| `select_one`, `select_multiple` | `categorical` |
| `integer`, `decimal`, `range` | `quantitative` |
| `text`, `note` | `qualitative` |
| `gps`, `geotrace`, `geoshape` | `geographical` |
| `date`, `datetime`, `time` | `date` |
| anything else | `undefined` |

On re-run, user-edited `category` and `export_label` values are preserved.

---

## Chart types (src/reports/charts.py)

21 types registered in `CHART_DISPATCH`. All functions share the same signature:
`fn(df, questions, title, out_path, opts)`

| type | questions needed | notes |
|---|---|---|
| `bar` | 1 categorical | |
| `horizontal_bar` | 1 categorical | best for long labels |
| `stacked_bar` | 2 categorical | `[x_axis, stack_by]`; option: `normalize: true` |
| `grouped_bar` | 2 categorical | `[category, group_by]` — side-by-side groups |
| `pie` | 1 categorical | |
| `donut` | 1 categorical | |
| `line` | 1–2 | date + numeric; option: `freq: month` |
| `area` | 1–2 | date + numeric; option: `freq: month` |
| `histogram` | 1 numeric | option: `bins` |
| `scatter` | 2 numeric | |
| `box_plot` | 1 categorical + 1 numeric | |
| `heatmap` | 2 categorical | |
| `treemap` | 1 categorical | requires `squarify` |
| `waterfall` | 1 categorical | |
| `funnel` | 1 categorical | |
| `table` | 1 categorical | renders as PNG |
| `bullet_chart` | 1 numeric | option: `target` (required) — achieved vs target |
| `likert` | 1 categorical | diverging bar; options: `scale`, `neutral` |
| `scorecard` | 1+ any | KPI cards grid; options: `columns`, `stat: count\|mean\|sum` |
| `pyramid` | age_group + gender | demographic pyramid; options: `male_value`, `female_value` |
| `dot_map` | lat + lon | GPS dot map; options: `basemap`, `color_by`, `size` |

Common options: `top_n`, `width_inches`, `height_inches`, `color`, `xlabel`, `ylabel`
Sort options (`bar`, `horizontal_bar`, `grouped_bar`, `waterfall`): `sort: value|label|none`

To add a new chart type: add a function with the standard signature, add it to `CHART_DISPATCH`.

---

## Prompt management (Langfuse)

Prompts live in [Langfuse Cloud](https://cloud.langfuse.com) (or a self-hosted Langfuse instance). Each AI feature fetches its prompt by name at runtime via `src/utils/lf_client.py`.

### Prompt names and consuming files

| Prompt name | Consuming file | Output contract |
|---|---|---|
| `narrator` | [src/reports/narrator.py](src/reports/narrator.py) | JSON: `summary_text` / `observations` / `recommendations` |
| `summaries` | `stat: ai` blocks in [src/reports/summaries.py](src/reports/summaries.py) | Plain text |
| `chart_suggester` | [src/reports/ai_chart_suggester.py](src/reports/ai_chart_suggester.py) | JSON: `{"charts": [...]}` |
| `template_generator` | [src/reports/ai_template_generator.py](src/reports/ai_template_generator.py) | JSON: layout spec |
| `summary_suggester` | [src/reports/ai_summary_suggester.py](src/reports/ai_summary_suggester.py) | JSON: suggested summaries |
| `view_suggester` | [src/reports/ai_view_suggester.py](src/reports/ai_view_suggester.py) | JSON: suggested views |
| `table_suggester` | [src/reports/ai_table_suggester.py](src/reports/ai_table_suggester.py) | JSON: `{"tables": [...]}` |
| `indicator_suggester` | [src/reports/ai_indicator_suggester.py](src/reports/ai_indicator_suggester.py) | JSON: `{"indicators": [...]}` |
| `hidden_suggester` | [src/reports/ai_hidden_suggester.py](src/reports/ai_hidden_suggester.py) | JSON: `{"suggestions": [...]}` |
| `pii_suggester` | [src/reports/ai_pii_suggester.py](src/reports/ai_pii_suggester.py) | JSON: `{"suggestions": [...]}` |
| `classifier_discover` | [src/data/classifier.py](src/data/classifier.py) | JSON: discovered themes |
| `classifier_classify` | [src/data/classifier.py](src/data/classifier.py) | JSON: per-row classifications |
| `ask_propose` | `src/reports/ask_engine.py` | JSON: `{"items": [{"kind": ...}]}` |
| `ask_caption` | `src/reports/ask_engine.py` | JSON: `{"captions": {...}}` |
| `ask_refine` | `src/reports/ask_engine.py` | JSON: `{"item": {"kind": ...}}` |
| `ask_examples` | [src/reports/ai_ask_examples.py](src/reports/ai_ask_examples.py) | JSON: `{"questions": [...]}` |

### Setup

1. Create a free account at [cloud.langfuse.com](https://cloud.langfuse.com) (or use a self-hosted instance).
2. Copy your public key, secret key, and host URL into `.env`:
   ```
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_HOST=https://cloud.langfuse.com   # default; omit for cloud
   # LANGFUSE_BASE_URL is accepted as an alias if LANGFUSE_HOST is unset
   ```
3. Seed the bundled default prompts into Langfuse:
   ```bash
   python3 src/data/make.py push-prompts          # create-if-missing
   python3 src/data/make.py push-prompts --force  # overwrite existing
   ```
4. Edit prompts directly in the Langfuse UI — version history is tracked automatically.

### Offline / fallback behavior

Prompts are resolved in this order:
1. **Cache-first** — `~/.cache/databridge/prompts/` (1-hour TTL)
2. **Langfuse** — fetched over HTTPS if the cache is stale or missing
3. **Bundled seeds** — `src/utils/seed_prompts.py` (always present, no network needed)

AI features keep working with no Langfuse keys (they use the bundled seeds) and with no AI provider keys (the feature no-ops gracefully).

### Tracing

Every LLM call is recorded as a Langfuse generation with cost, latency, and token counts. CLI commands group all their calls under a single trace so you can follow the full pipeline run in the Langfuse UI.

### To add a new prompt site

1. Add an entry to `SEED_PROMPTS` in [src/utils/seed_prompts.py](src/utils/seed_prompts.py) with the prompt name, system message, and any variable placeholders.
2. In your feature file, build a `variables` dict and call:
   ```python
   prompt = lf_client.get_prompt("<name>", variables)
   response = lf_client.chat(..., trace_name="<name>")
   ```
3. Run `python3 src/data/make.py push-prompts` to seed the new prompt in Langfuse.
4. Document the new prompt name in the table above.

### Output schemas (structured outputs)

Twelve of the sixteen prompts produce JSON and have an `output_schema` in their seed's `config`
(all except `summaries`, `ask_propose`, `ask_caption`, and `ask_refine`).
The schema travels with the prompt (stored in Langfuse's per-prompt `config` field) and
is enforced at the LLM call:

- **OpenAI** — sent via `response_format={"type":"json_schema", ...}` (Structured Outputs).
  The model is guaranteed to return JSON matching the schema.
- **Anthropic** — sent via a forced tool-use call (`tools=[{input_schema=...}]` + `tool_choice`).
  The model's response is the tool's `input` dict.

Editing a schema in the Langfuse UI updates both providers' enforcement on the next fetch.
If you write an invalid schema (not a dict, or missing `"type"`), the next call logs a WARNING
and falls back to no-schema mode for that one prompt — the feature still runs.

To add a schema to a new prompt:
1. Add `_<NAME>_OUTPUT_SCHEMA` literal in `src/utils/seed_prompts.py` (Strict-mode rules:
   `additionalProperties: false`, every property listed in `required`, no `oneOf`).
2. Reference it in the entry's `config={"output_schema": ...}`.
3. `python3 src/data/make.py push-prompts --force` to update Langfuse.

The seed-validation test (`tests/test_seed_prompts.py`) enforces meta-schema validity
and the Strict-mode contract; intentional open maps are listed in `_ALLOWED_OPEN_MAPS`.

---

## Word template placeholders

Templates use Jinja2 syntax via `docxtpl`. Available placeholders:

```
{{ report_title }}
{{ period }}
{{ n_submissions }}
{{ generated_at }}
{{ summary_text }}         ← AI-filled if ai: is configured, else left blank
{{ observations }}
{{ recommendations }}

{{ ind_<name> }}        ← one per indicator in config.yml indicators section
{{ ind_<name>_breakdown }}  ← list of {group,value,formatted} when the indicator sets disaggregate_by (loop in the template)
{{ ind_<name>_table }}      ← plain-text "group: value" fallback for the same breakdown
{{ summary_<name> }}    ← one per summary in config.yml summaries section
{{ chart_<n> }}         ← one per chart in config.yml
{{ split_value }}       ← when --split-by is set, the current group's value
{{ data_quality }}      ← auto DQ overview (has_data / rows of {column, completeness, outlier_rate, duplicate_rate}) for the main table, plus tables: [{name, rows}] — one entry per non-empty repeat table. Rendered in the auto-template and the web Validate-tab panel.
{{ logframe }}          ← results framework hierarchy (has_framework / rows); present only when framework: is configured.
                          Each row's indicators carry {name, value, baseline, target, pct_achievement} (latter three "" when not set);
                          rows also carry primary_indicator + node_value/node_target/node_pct_achievement from the indicator flagged primary: true
{{ provenance.footer }}  ← one-line audit footer; includes "pii: consent=<col>, <N> columns redacted" when pii: rules are configured
```

**Critical rule:** each `{{ chart_... }}` must be a single unbroken XML run in the .docx.
Use `generate-template` to auto-generate correct placeholders — never type them manually.

---

## Web UI

The React app under `frontend/src/pages/` has six tabs that mirror the pipeline:

| Tab | Purpose | Backend endpoints |
|---|---|---|
| Dashboard | Greeting + pipeline strip + KPIs + runs + AI queue + project usage | `/api/state`, `/api/run/{cmd}`, `/api/data/sessions` |
| ① Sources | Platform picker (Ona/Kobo) · API & form · AI Narrative · Output formats | `/api/config`, `/api/ai/test` |
| ② Questions | Group accordions with inline `export_label` editing, bulk keep/delete | `/api/questions` |
| ③ Composition | Filters · Charts · Indicators · Summaries · Views · Templates | `/api/config`, `/api/templates` |
| ④ Reports | Generated `.docx` reports + downloaded data sessions | `/api/reports`, `/api/data/sessions` |
| Templates | Standalone template management (also embedded in Composition) | `/api/templates*` |

The **BottomTerminal** is a sticky bottom drawer rendered on the Dashboard page: pipeline-
run / fetch-questions log sessions plus a ttyd `shell` session (only works if you also run
ttyd separately — not required).

---

## Key implementation details

### App database & project model (web/db/)
App state (users ↔ orgs ↔ projects) lives in **Postgres** via SQLAlchemy 2.0 (`web/db/`:
`models.py`, `session.py`, `repository.py`, `provision.py`, `bridge.py`, `bootstrap.py`).
Each project's config is stored as a `jsonb` column (source of truth); every project/org
query is **membership-scoped** so a user only sees their orgs' projects. Users + a personal
org are auto-provisioned from the Zitadel identity on login (and for the dev user at startup).
`DATABASE_URL` is **required** — e.g. a local Postgres via
`docker run --rm -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=databridge -p 5432:5432 postgres:16`.
Migrations are **Alembic** (`alembic upgrade head`), run automatically by the FastAPI startup
lifespan; tests run against SQLite (`DATABRIDGE_SKIP_MIGRATIONS=1` → `init_schema`).
`/api/config` reads/writes the caller's **active project** (`users.active_project_id`); on save
or project switch the config is mirrored to `config.yml` so the file-based CLI and the existing
config-reading endpoints stay consistent. The repo's existing `config.yml` is imported once
at startup as the first project.

### Per-project RBAC, invitations & superadmins (web/db/ + web/main.py + web/zitadel_admin.py)
Access is **per-project**, not org-wide. `ProjectMembership(user_id, project_id, role)` is the
authority (`role ∈ viewer|editor|admin`); each project has an `owner_id` (creator, an implicit
admin), and `users.is_superadmin` is a global override. The rank is
`viewer<editor<admin<superadmin` (`repository.ROLE_RANK` / `role_for` / `role_at_least`).
`list_projects_for_user`/`get_project_for_user` consult ProjectMembership (superadmins see all).
- **Gating:** `web/main.py:require_role(request, db, minimum)` (and the session-opening wrapper
  `_require`) resolve the **active** project and 403 if under-rank. Applied to every mutating
  endpoint: config/questions/periods(POST)/framework/pii/ask-save/run → **editor**; delete
  reports/sessions/data → **editor**; delete templates/periods, upload/set-active template,
  `DELETE /api/projects` → **admin**. Previews/suggest/AI-test stay ungated.
- **Members:** `GET/POST /api/projects/{id}/members*`, `PATCH`/`DELETE .../members/{user_id}` —
  admin-gated. Guards: a non-owner admin can't remove/demote the **owner** (`#6`); a superadmin
  can't revoke **another** superadmin via `POST /api/admin/superadmins` (`#10`).
- **Invitations:** `Invitation(project_id, email, role, status)`. An admin invite records a
  pending row and (if `ZITADEL_API_TOKEN` is set) creates the user in Zitadel + emails them via
  `web/zitadel_admin.py` (Management v2). `provision.ensure_user` calls
  `repo.consume_invitations_for` on login → turns pending invites (matched by email) into
  ProjectMemberships. Superadmins are bootstrapped from `SUPERADMIN_EMAILS` (env) at startup and
  on first login.
- **Frontend:** `GET /api/projects` returns each project's `role`/`is_owner` + `is_superadmin`;
  `lib/perms.js` (`PermsProvider`/`usePerms` → `canEdit`/`canAdmin`) hides destructive controls
  (server still enforces). `components/ProjectMembersModal.jsx` manages members; the project
  switcher hosts the new-project **Modal**, "Manage members", and admin-only "Delete project".

### Object storage & project workspace (web/storage/)
Project **files** (data sessions, reports, templates) are stored durably per project in
**Minio/S3** (`web/storage/`: `Storage` interface, `s3.py`/`local.py` backends, `storage_key`,
lazy `factory.get_storage()`). The local `data/processed`/`reports`/`templates` dirs are a
**materialized mirror of the active project** (`web/storage/workspace.py`): `pull_workspace`
runs on project **activate** (clear local dirs → download the project's files from Minio), and
`push_outputs` runs after a **successful run** (upload outputs back). `data/raw` and
`data/processed/charts` are **not** synced (regenerable). The ~8 on-demand read endpoints +
reports/templates/sessions listing/downloads read the local mirror unchanged. `S3_*` env is
**required** — local Minio via
`docker run --rm -p 9000:9000 -p 9001:9001 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 minio/minio server /data --console-address ":9001"`;
tests use the local-fs backend (`STORAGE_BACKEND=local`).

**Per-run isolation:** each `/api/run/{command}` executes in its own **temp directory**.
`workspace.hydrate_run_dir` writes the project's config + pulls the command's input categories
(the `RUN_INPUTS` manifest) from Minio into the tempdir; the CLI runs with `cwd=<tempdir>`
(absolute `make.py` path). On success, `_persist_run_outputs` pushes outputs to Minio, syncs a
changed `config.yml` back to the DB, and refreshes the active `BASE_DIR` read-mirror; the tempdir
is removed afterward. The read endpoints + the activate-pull still use the `BASE_DIR` mirror.

**Run concurrency:** runs are tracked by an in-memory `RunRegistry` (`web/runs.py`), not a global
single-flight lock. **One run per project at a time** (a second run for a busy project → `409`);
**different projects run concurrently** up to `MAX_CONCURRENT_RUNS` (env, default 4; over the cap →
`429` + `Retry-After`). No-active-project runs serialize on a `"__base__"` key (shared `BASE_DIR`).
Each run has a `run_id` (in the first SSE `status` event); `GET /api/status` lists active runs and
`POST /api/stop/{run_id}` stops a specific one. **Reads remain process-wide:** concurrent users with
different active projects share the one `BASE_DIR` read-mirror (best-effort, last-writer-wins) —
durable Minio/DB data is always correct; true multi-user read isolation is out of scope.

### env: variable resolution (src/utils/config.py)
Config values starting with `env:` are resolved from environment at load time.
```python
if isinstance(obj, str) and obj.startswith("env:"):
    var = obj[4:].strip()
    return os.environ.get(var) or obj
```

### fetch-questions preserves user edits (src/data/questions.py)
On re-run, existing `category` and `export_label` per `kobo_key` are carried over.
New questions from the schema are appended with fresh defaults.

### SSE log streaming (web/main.py)
CLI commands run as subprocesses via `asyncio.create_subprocess_exec`. stdout/stderr
merged and streamed line-by-line via SSE-style frames (event: log/status/done + data: JSON).
Only whitelisted commands (`ALLOWED_COMMANDS`) can be triggered — no arbitrary shell execution.

Runs are **single-flight**: while one command is active, a second `POST /api/run/{command}`
is rejected with **HTTP 409** (the in-flight command is tracked in `_running_command`, reserved
synchronously in `run_command` and released in `_stream`'s `finally`); `GET /api/status` reports
`running`. This prevents two pipeline runs from clobbering the shared `_proc` and `config.yml`/`data/`.

The React side reads it with `fetch().body.getReader()` in `hooks/useCommand.js` (EventSource
is GET-only); a non-OK response (e.g. the 409) is surfaced as an error log line.

### Frontend ↔ backend wiring in dev
Vite (`:51730`) proxies `/api/*` → uvicorn (`:8000`). All `fetch('/api/…')` calls in the
React app go through the proxy. Same code paths work in prod-like mode (single port).

### Filter syntax (src/data/transform.py)
Filters use `pandas.DataFrame.query()` — SQL-like expressions. Column names reference
`export_label` values, not original `kobo_key` paths.

### Export routing (src/data/transform.py)
```python
export_data() → _export_file()     # csv, json, xlsx
             → _export_sql()       # mysql, postgres (requires sqlalchemy)
             → _export_supabase()  # supabase (requires supabase-py)
```
Database drivers are optional imports — only install what you need.

### Base-table linkage columns (src/data/flatten.py)
`load_data` flattens submissions into a main table plus one base table per repeat
level (including nested sub-repeats) via `build_repeat_tables`. Every repeat row
carries linkage columns:

- `_root_id` — id of the root submission the row descends from
- `_parent_index` — alias of `_root_id` (kept for backward-compat with filters,
  computed columns, `join_repeat_to_main`, and split reports)
- `_parent_row_id` — `_row_id` of the immediate parent repeat row
  (equals `_root_id` for top-level repeats)
- `_row_id` — stable composite id, e.g. `"12.0.1"` (root 12 → member 0 → illness 1)
- `_row_index` — position within the immediate parent

Join any level to its parent on `_parent_row_id == parent._row_id`, or to the
root on `_root_id == main._id`. The catalog is exposed read-only at
`GET /api/base-tables`.

### Data profiling (src/data/profile.py)
`profile_dataset(cfg, main_df, repeat_tables)` computes a deterministic, structured
EDA profile for every base table — per-column `role`, completeness, cardinality,
numeric stats + 3×IQR outliers, date ranges, low-cardinality top values, plus
per-table numeric correlations and duplicate-id info. It is the single source of
truth for these signals: `validate.py` (findings) and `summaries.py` (narrative)
derive their numbers from `profile.py`'s primitives (`null_stats`, `iqr_bounds`,
`numeric_outliers`, `correlations`). No LLM, no I/O.

`top_values` are computed only for low-cardinality columns (≤ `LOW_CARDINALITY_MAX`,
default 20) so the profile never surfaces individual free-text/PII values.

Exposed read-only at `GET /api/profile`; rendered in the **Profile** tab.

### PII gate (src/utils/pii.py)
PII has two tiers:
- **Strict export gate** — `enforce_pii` runs inside `export_data` (default `redact=True`).
  It calls `validate_pii_config` (fail-closed: a configured `consent_column` or `redact`
  column missing from the data, or an unknown strategy, raises `PIIConfigError` and
  aborts the download), consent-gates the main table, prunes orphaned repeat rows
  (parents filtered out by consent, via `_parent_index`), then applies redaction.
  So `data/processed` + DB/Supabase are always redacted + consent-gated.
- **Lenient render net** — the existing `apply_pii` still runs at report/preview time
  as defense-in-depth (log-and-skip on missing columns); it operates on already-gated data.

`download --no-redact` is an explicit, off-by-default escape hatch that writes RAW data
(internal/secure use only) and logs a warning; it is CLI-only (not in the web UI's
ALLOWED_COMMANDS flag whitelist). Reports built from a raw session are still redacted by
the lenient render net. The post-download classification re-export passes `redact=False`
(its data was already gated by the primary export).

### Ask question-engine (src/reports/ask_engine.py)
`ask(question, cfg, df, repeat_tables)` answers a natural-language question with 1–3
locally-computed answers — each either a **chart** or a scalar **indicator** (the LLM
picks per item):
1. `build_catalog` condenses the Layer 2 profile into a data-aware catalog (roles,
   cardinality, low-cardinality top-values, numeric ranges; linkage columns excluded).
2. `propose_items` asks the LLM (`ask_propose` prompt) for `kind`-tagged recipes
   (`{"items": [{"kind": "chart"|"indicator", ...}]}`).
3. `validate_recipe` dispatches by kind: charts → `CHART_REQS` role checks; indicators →
   `INDICATOR_STATS` + stat/column/role checks. Invalid recipes are dropped with a reason.
4. Execute locally: charts → `render_recipe` (chart engine); indicators →
   `compute_indicator` (the `compute_indicators` engine).
5. `ground_captions` (`ask_caption` prompt) writes one-line captions from each answer's
   ACTUAL computed values (chart stats block / indicator value+stat); falls back to the
   title if AI is off.
Duplicate names within a batch are disambiguated. `save_recipe(recipe, cfg, kind)` appends
a chosen recipe to `config.charts` (chart) or `config.indicators` (indicator). Exposed at
`POST /api/ask` and `POST /api/ask/save` (`{recipe, kind}`); surfaced in the **Ask** tab
(charts as images, indicators as big-number cards). Needs an AI provider and downloaded data.

A returned answer can be **refined** in plain language ("make it a line chart", "split by
sex", "just give me the number") via `refine_item` (the `ask_refine` prompt) → `POST
/api/ask/refine`; the revised recipe is re-validated/executed (it may switch chart↔indicator)
and the Ask tab replaces the card in place. `_execute_item` is the shared
validate→execute helper used by both `ask` and `refine_item`, so a refined answer behaves
identically to an asked one.

### Chart output path
Charts are saved to `data/processed/charts/<chart_name>.png` at `build-report` time.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `KOBO_TOKEN` | Yes | Kobo or Ona API token |
| `DB_USER` | DB export only | Database username |
| `DB_PASSWORD` | DB export only | Database password |
| `SUPABASE_KEY` | Supabase only | Supabase service role key |
| `OPENAI_API_KEY` | AI narrative (OpenAI) | API key for the AI provider |

---

## Common tasks

### Add a new chart type
1. Add function to `src/reports/charts.py` with signature `fn(df, questions, title, out_path, opts)`
2. Add entry to `CHART_DISPATCH` dict
3. Add the type to the `CHART_TYPES` list in `frontend/src/pages/Composition.jsx`
4. Update the chart-type table here and in `README.md`

### Add a new export target
1. Add `_export_<target>()` function in `src/data/transform.py`
2. Add branch in `export_data()` routing function
3. Add optional import inside the function (not module level)
4. Add a chip in the format chip-tabs in `frontend/src/pages/Sources.jsx`
5. Document new env vars in `.env.example`

### Add a new CLI command
1. Add `@cli.command("command-name")` function in `src/data/make.py`
2. Add the command name to `ALLOWED_COMMANDS` dict in `web/main.py`
3. Expose it from the UI — either as a button in the Run-pipeline wizard
   (`frontend/src/pages/Dashboard.jsx`) or wherever it fits

### Modify the web UI
React components are real files in `frontend/src/`. Edit them, Vite picks up the change
via HMR (in dev). All CSS lives in `frontend/src/styles.css` — design tokens at the top,
component styles below.

### Modify the FastAPI backend
`web/main.py` is a real file. `uvicorn --reload` (started by `dev.sh`) restarts on save.
