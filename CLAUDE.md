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

## Four CLI commands

All commands run from project root. Set `PYTHONPATH=.`.

```bash
# 1. Fetch questions from Kobo/Ona form → writes into config.yml
python3 src/data/make.py fetch-questions

# 2. Auto-generate Word template from charts in config.yml → overwrites existing
python3 src/data/make.py generate-template
python3 src/data/make.py generate-template --out templates/custom.docx

# 3. Download submissions, apply filters, export to configured destination
python3 src/data/make.py download
python3 src/data/make.py download --sample 50   # first 50 rows only (for testing)

# 4. Build Word report from downloaded data
python3 src/data/make.py build-report
python3 src/data/make.py build-report --sample 100
python3 src/data/make.py build-report --sample 100 --random-sample
python3 src/data/make.py build-report --split-by Site                  # one report per Site value
python3 src/data/make.py build-report --split-by Site --split-sample 3 # first 3 sites only
```

The same four commands are exposed in the web UI as POST `/api/run/{command}` with
SSE-style streamed logs.

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

# AI narrative (fills {{ summary_text }}, {{ observations }}, {{ recommendations }})
ai:
  provider: openai                      # openai | anthropic
  model: gpt-4o
  api_key: env:OPENAI_API_KEY
  base_url: ""                          # optional — Azure, Groq, Mistral, Ollama
  language: English
  max_tokens: 1500

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
{{ summary_<name> }}    ← one per summary in config.yml summaries section
{{ chart_<n> }}         ← one per chart in config.yml
{{ split_value }}       ← when --split-by is set, the current group's value
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
Only 4 whitelisted commands can be triggered — no arbitrary shell execution.

The React side reads it with `fetch().body.getReader()` in `hooks/useCommand.js` (EventSource
is GET-only).

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
