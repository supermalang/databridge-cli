# CLAUDE.md — kobo-reporter / databridge-cli

This file gives Claude Code full context about this project.

---

## What this project does

**kobo-reporter** is a CLI tool that:
1. Fetches survey form schemas from Kobo/Ona platforms
2. Lets the user configure which questions to extract, how to visualize them, and where to export
3. Downloads submission data, applies filters, and exports to file or database
4. Generates Word reports (.docx) with embedded charts and editable text sections

Everything is driven by a single `config.yml` file.

---

## Project structure

```
databridge-cli/
├── CLAUDE.md                         ← you are here
├── Dockerfile                        ← web files (main.py, index.html) generated inline via heredoc
├── docker-compose.yml                ← app + ttyd terminal, Traefik labels (no Traefik service)
├── requirements.txt                  ← Python deps
├── sample.config.yml                 ← config template (copy to config.yml)
├── .env.example                      ← env vars template (copy to .env)
├── TEMPLATE_GUIDE.md                 ← manual Word template instructions
│
├── src/
│   ├── data/
│   │   ├── make.py                   ← CLI entry point (click group, 4 commands)
│   │   ├── extract.py                ← KoboClient — API auth, pagination, schema fetch
│   │   ├── questions.py              ← fetch schema → auto-categorize → write to config.yml
│   │   └── transform.py             ← flatten submissions, apply filters, multi-target export
│   ├── reports/
│   │   ├── builder.py                ← ReportBuilder — renders Word template via docxtpl
│   │   ├── charts.py                 ← 21 chart types via matplotlib (CHART_DISPATCH dict)
│   │   └── template_generator.py    ← auto-generates starter .docx from config
│   └── utils/
│       └── config.py                 ← load_config(), write_config(), env: var resolution
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

## Four CLI commands

All commands run from project root. Set `PYTHONPATH=.` or run via Docker.

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

---

## config.yml — full annotated structure

```yaml
api:
  url: https://kf.kobotoolbox.org/api/v2   # or https://api.ona.io/api/v1
  token: env:KOBO_TOKEN                    # env: prefix reads from environment variable

form:
  uid: aAbBcCdDeEfFgGhH                   # Kobo/Ona asset UID
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
# Eliminates redundant join+filter work when multiple items share the same source.
# Reference a view with source: <view_name> on any chart, summary, or indicator.
views:
  - name: villages_with_dept            # enriched view: repeat + parent fields joined in
    source: villages                    # repeat group path (or "main")
    join_parent: [Departement, Region]  # columns to bring in from main table
    filter: "Number of Students > 0"   # optional pandas .query() filter

  - name: dept_student_totals           # aggregated view: one row per department
    source: villages
    join_parent: [Departement]
    group_by: Departement
    question: Number of Students        # column to aggregate
    agg: sum                            # sum | mean | count | max | min (default: sum)

# Each chart → {{ chart_<n> }} placeholder in Word template
charts:
  - name: satisfaction_overview            # → {{ chart_satisfaction_overview }} in template
    title: Overall satisfaction
    type: horizontal_bar                   # see full list below
    questions: [Satisfaction]              # references export_label values
    options:
      top_n: 10
      width_inches: 5.5

export:
  format: csv                              # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432                             # 5432 postgres, 3306 mysql
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions
    # supabase_url: https://xxx.supabase.co
    # supabase_key: env:SUPABASE_KEY

report:
  template: templates/report_template.docx
  output_dir: reports
  title: Monitoring Report
  period: Q1 2025
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
{{ summary_text }}         ← intentionally left empty for collaborator editing
{{ observations }}         ← intentionally left empty
{{ recommendations }}      ← intentionally left empty

{{ ind_<name> }}        ← one per indicator in config.yml indicators section
                            e.g. {{ ind_total_beneficiaries }} → "4,832"
                                 {{ ind_pct_female }}          → "58.3%"
                                 {{ ind_top_region }}          → "Nouakchott"

{{ summary_<name> }}    ← one per summary in config.yml summaries section
                            e.g. {{ summary_region_breakdown }} → "Leading response: North (45%). Others: South (30%)."
                                 {{ summary_age_profile }}      → "n=382, mean=34.5, median=32.0, range 18.0–65.0."
                                 {{ summary_context_analysis }} → AI-generated paragraph

{{ chart_<n> }}         ← one per chart in config.yml
                            e.g. {{ chart_satisfaction_overview }}

{% for row in stats_table %}
  {{ row.label }}  n={{ row.n }}  mean={{ row.mean }}  median={{ row.median }}
{% endfor %}
```

**Critical rule:** each `{{ chart_... }}` must be a single unbroken XML run in the .docx.
Use `generate-template` command to auto-generate correct placeholders — never type them manually.

---

## Docker deployment

```bash
cp .env.example .env              # fill KOBO_TOKEN, APP_DOMAIN, BASIC_AUTH_USERS
cp sample.config.yml config.yml   # fill api.token, form.uid
docker compose up -d --build
```

- Web UI: `https://<APP_DOMAIN>` — Dashboard / Config editor / Reports / Terminal tabs
- Terminal: `https://<APP_DOMAIN>/terminal/` — ttyd web terminal, working dir `/app`
- Requires existing Traefik with external network `traefik-public` and `websecure` entrypoint
- `web/main.py` and `web/static/index.html` are generated inside the image via Dockerfile heredoc
  — do **not** create a `web/` directory locally, it will conflict with the build

Volumes mounted at runtime:
```
./config.yml   → /app/config.yml
./data/        → /app/data/
./reports/     → /app/reports/
./templates/   → /app/templates/
```

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

### SSE log streaming (web/main.py — embedded in Dockerfile)
CLI commands run as subprocesses via `asyncio.create_subprocess_exec`.
stdout/stderr merged and streamed line-by-line via Server-Sent Events.
`X-Accel-Buffering: no` header prevents Traefik from buffering the SSE stream.
Only 4 whitelisted commands can be triggered — no arbitrary shell execution.

### Filter syntax (src/data/transform.py)
Filters use `pandas.DataFrame.query()` — SQL-like expressions.
Column names reference `export_label` values, not original `kobo_key` paths.

### Export routing (src/data/transform.py)
```python
export_data() → _export_file()     # csv, json, xlsx
             → _export_sql()       # mysql, postgres (requires sqlalchemy)
             → _export_supabase()  # supabase (requires supabase-py)
```
Database drivers are optional imports — only install what you need.

### Chart output path
Charts are saved to `data/processed/charts/<chart_name>.png` at `build-report` time.
The `CHART_DIR` constant in `charts.py` controls this.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `KOBO_TOKEN` | Yes | Kobo or Ona API token |
| `APP_DOMAIN` | Docker only | Domain for Traefik routing |
| `BASIC_AUTH_USERS` | Docker only | htpasswd format for basic auth |
| `DB_USER` | DB export only | Database username |
| `DB_PASSWORD` | DB export only | Database password |
| `SUPABASE_KEY` | Supabase only | Supabase service role key |

---

## Common tasks for Claude Code

### Add a new chart type
1. Add function to `src/reports/charts.py` with signature `fn(df, questions, title, out_path, opts)`
2. Add entry to `CHART_DISPATCH` dict at the bottom of the file
3. Update chart type table in `TEMPLATE_GUIDE.md` and `README.md`

### Add a new export target
1. Add `_export_<target>()` function in `src/data/transform.py`
2. Add branch in `export_data()` routing function
3. Add optional import at top of the new function (not module level)
4. Document new env vars in `.env.example` and `README.md`

### Add a new CLI command
1. Add `@cli.command("command-name")` function in `src/data/make.py`
2. Add command to `ALLOWED_COMMANDS` dict in `web/main.py` (in the Dockerfile heredoc)
3. Add a button card in `web/static/index.html` (in the Dockerfile heredoc)

### Modify the web UI or FastAPI backend
Both `web/main.py` and `web/static/index.html` live inside the Dockerfile as heredoc blocks.
Edit them there directly — they do not exist as separate files on disk.

### Test locally without Docker
```bash
pip3 install -r requirements.txt
pip3 install fastapi uvicorn aiofiles python-multipart
# The web UI won't work locally (web/ isn't a real folder)
# But the CLI works:
PYTHONPATH=. KOBO_TOKEN=xxx python3 src/data/make.py --help
```