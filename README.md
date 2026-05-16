[![forthebadge made-with-python](http://ForTheBadge.com/images/badges/made-with-python.svg)](https://www.python.org/)  
[![GitHub license](https://img.shields.io/github/license/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/LICENSE)
[![GitHub tag](https://img.shields.io/github/tag/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/tags/)



databridge-cli
==============================

**databridge-cli** is a web-based report generation platform that connects to [Kobo Toolbox](https://www.kobotoolbox.org/) or [Ona](https://ona.io/) data collection services. It automates the full pipeline from fetching survey questions, generating Word templates, downloading submission data, to building Word (.docx) reports with embedded charts — all from a browser-based interface.

# Features
- Web UI with dashboard, config editor, questions editor, report manager, and embedded terminal
- 4-step automated pipeline: fetch questions → generate template → download data → build report
- YAML-based configuration editable from the browser (CodeMirror syntax-highlighted editor)
- **Questions tab** — inline `export_label` editing table: rename columns used in charts and templates without touching YAML
- Real-time log streaming via Server-Sent Events (SSE)
- Word (.docx) report generation with embedded charts and text/number indicators
- **21 chart types** including NGO-specific: grouped bar, bullet chart, Likert scale, scorecard, population pyramid, dot map
- **Indicators** — text/number/percentage values rendered inline in Word (`{{ ind_<name> }}` placeholders)
- **Split-by reports** — generate one report per unique value of any question (e.g., one per region)
- Platform selection: supports both **Kobo Toolbox** and **Ona**, with custom/self-hosted URLs
- Automatic repeat group handling — repeat data is exported as separate linked tables
- Docker Compose deployment with Traefik HTTPS
- Web terminal (ttyd) for direct CLI access from the browser
- Export to CSV, JSON, XLSX, MySQL, PostgreSQL, or Supabase

### Trust & audit

- Every value shown in the Composition tab — indicator "Latest", view dimensions — is computed live from your downloaded data. No placeholders.
- Generated `.docx` reports include a provenance footer: when the report was generated, when the underlying data was downloaded, the number of submissions, the active filters, and a short hash of the config that produced the report. Two reports from the same config + data set have the same hash; if they differ, something in the inputs changed.
- A pytest suite under `tests/` covers the provenance helper and a build-report smoke path. Run `pytest -v` to verify.

### Validate (data quality)

The **Validate** tab (step 3 of 5) scans your downloaded submissions and surfaces:

- **Missingness** — columns where ≥5% of rows are blank or NaN, with severity escalating at 20% and 50%.
- **Numeric outliers** — quantitative columns with values outside `Q1 − 3·IQR` to `Q3 + 3·IQR`. Catches mistyped Age=999 or NumStudents=-1 without flooding on legitimate skew.
- **Duplicate identifiers** — rows that share `_uuid`, `_id`, or `_index` (whichever the data uses).
- **Type-coercion issues** — quantitative columns containing non-numeric strings like `"n/a"` or `"TBD"`.

Findings are computed by `src/data/validate.py` and served by `POST /api/validate`. There are no user-configurable thresholds in this MVP — the defaults are tuned for typical M&E survey data.

# Installation
## Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- A running [Traefik](https://doc.traefik.io/traefik/) reverse proxy with the `xayma_webservers` Docker network created
- A [Kobo Toolbox](https://www.kobotoolbox.org/) or [Ona](https://ona.io/) API token

## The easy way
The easiest way to install databridge-cli is to clone it from GitHub:
```bash
$ git clone https://github.com/supermalang/databridge-cli.git
```

Navigate to the directory:
```bash
$ cd databridge-cli
```

Copy the sample environment file and fill in your values:
```bash
$ cp .env.example .env
```

Create the external Docker network (if not already created):
```bash
$ docker network create xayma_webservers
```

Then start the services:
```bash
$ docker compose up -d --build
```

The web UI will be available at `https://your-app-domain.com` once Traefik routes the traffic.

# Configuration
## Create the .env file
Create the `.env` file from the `.env.example` file:
```bash
$ cp .env.example .env
```

Now open the `.env` file and configure it with the appropriate values:

| Variable | Required | Description |
|---|---|---|
| `KOBO_TOKEN` | Yes | Your Kobo Toolbox or Ona API token |
| `APP_DOMAIN` | Yes | Domain name for Traefik routing (e.g. `databridge.yourdomain.com`) |
| `DB_USER` | No | Database username (for optional database export) |
| `DB_PASSWORD` | No | Database password (for optional database export) |
| `SUPABASE_KEY` | No | Supabase API key (for optional database export) |

- 🆘 *If you do not have a Kobo token, go to your Kobo Toolbox account settings to generate one. For Ona, go to Settings → API Access.*
- 🆗 *If you do not export to a database you can ignore `DB_USER`, `DB_PASSWORD` and `SUPABASE_KEY`.*


## Update the config file
Create the `config.yml` file from the sample:
```bash
$ cp sample.config.yml config.yml
```

Open `config.yml` and configure the API connection:

```yaml
api:
  platform: kobo            # kobo | ona
  url: https://kf.kobotoolbox.org/api/v2
  token: env:KOBO_TOKEN

form:
  uid: aAbBcCdDeEfFgGhH     # your form ID
  alias: monitoring_survey   # used for output file names
```

**Platform selection:**

| Platform | `api.platform` | Example `api.url` |
|----------|---------------|-------------------|
| Kobo Toolbox | `kobo` | `https://kf.kobotoolbox.org/api/v2` |
| Kobo (self-hosted) | `kobo` | `https://kobo.yourdomain.com/api/v2` |
| Ona | `ona` | `https://api.ona.io/api/v1` |
| Ona (self-hosted) | `ona` | `https://ona.yourdomain.com/api/v1` |

- 🆘 *To find your form UID: on Kobo, go to your form's Settings → REST Services and copy the asset UID from the URL. On Ona, the form ID is the numeric ID visible in the form URL.*

**The full config file has the following sections:**

#### Questions
Auto-populated by the `fetch-questions` command. Each question has:
- `kobo_key` — the field path in the API response (e.g., `group_name/field_name`)
- `label` — human-readable label from the form
- `type` — field type (select_one, integer, text, etc.)
- `category` — auto-assigned: `categorical`, `quantitative`, `qualitative`, `geographical`, `date`, or `undefined`
- `export_label` — column name in the exported data (editable — this is what charts and templates reference)
- `repeat_group` — name of the repeat group if the field belongs to one, otherwise `null`

> After running `fetch-questions`, use the **Questions tab** in the web UI to rename `export_label` values to short, clean column names. These names are used in chart `questions:` lists and template placeholders.

#### Filters
Apply filters to downloaded data using [pandas query syntax](https://pandas.pydata.org/docs/reference/api/pandas.DataFrame.query.html):
```yaml
filters:
  - "Age > 0"
  - "Region != 'Test'"
  - "submission_date >= '2025-01-01'"
```

> Filters are applied sequentially. Filtered-out submissions also remove their repeat group entries.

#### Charts
Define charts to embed in the Word report. Each chart maps to a `{{ chart_<name> }}` placeholder in the template:
```yaml
charts:
  - name: satisfaction_overview
    title: Overall satisfaction
    type: horizontal_bar
    questions: [Satisfaction]
    options:
      top_n: 10
      width_inches: 5.5
      color: "#378ADD"
      sort: value           # value | label | none

  - name: age_distribution
    title: Age distribution
    type: histogram
    questions: [Age]
    options:
      bins: 12

  - name: community_by_region
    title: Community breakdown by region
    type: stacked_bar
    questions: [Region, Community]
    options:
      normalize: true       # 100% stacked

  - name: beneficiaries_target
    title: Beneficiaries reached vs target
    type: bullet_chart
    questions: [Beneficiary_ID]
    options:
      target: 5000

  - name: site_map
    title: Survey site locations
    type: dot_map
    questions: [gps_latitude, gps_longitude]
    options:
      color_by: Region
```

**Supported chart types (21 total):**

| Type | Questions needed | Notes |
|------|-----------------|-------|
| `bar` | 1 categorical | |
| `horizontal_bar` | 1 categorical | Best for long labels |
| `stacked_bar` | 2 categorical | `normalize: true` for 100% stacked |
| `grouped_bar` | 2 categorical | `[category, group_by]` |
| `pie` | 1 categorical | |
| `donut` | 1 categorical | |
| `line` | 1 date/numeric | `freq: day\|week\|month\|year` |
| `area` | 1 date/numeric | `freq: day\|week\|month\|year` |
| `histogram` | 1 numeric | `bins: N` |
| `scatter` | 2 numeric | |
| `box_plot` | 1 categorical + 1 numeric | |
| `heatmap` | 2 categorical | |
| `treemap` | 1 categorical | Requires `squarify` |
| `waterfall` | 1 categorical | |
| `funnel` | 1 categorical | |
| `table` | 1 categorical | Renders as PNG |
| `bullet_chart` | 1 numeric | `target: N` required |
| `likert` | 1 categorical | `scale: [...]`, `neutral: "..."` |
| `scorecard` | 1+ questions | One KPI card per question |
| `pyramid` | 2 categorical | `[age_group, gender]` |
| `dot_map` | 2 numeric | `[latitude, longitude]`, optional basemap |

**Common chart options (all types):**
- `top_n` — max categories to show (default 15, pie/donut default 8)
- `width_inches` / `height_inches` — chart dimensions
- `color` — hex color for single-series charts (e.g. `"#D85A30"`)
- `xlabel` / `ylabel` — axis label overrides
- `sort` — `value` (default) | `label` | `none` (bar, horizontal_bar, grouped_bar, waterfall)

#### Indicators
Define text/number values that appear inline in report text as `{{ ind_<name> }}` placeholders:
```yaml
indicators:
  - name: total_beneficiaries
    label: Total beneficiaries
    question: Beneficiary_ID
    stat: count              # count|sum|mean|median|min|max|percent|most_common
    format: number           # number|decimal|percent|text

  - name: pct_female
    label: Female beneficiaries
    question: Gender
    stat: percent
    filter_value: "Female"   # required for stat: percent
    format: percent
    decimals: 1

  - name: top_region
    label: Most represented region
    question: Region
    stat: most_common
    format: text
```

In your Word template: `"This report covers {{ ind_total_beneficiaries }} beneficiaries. {{ ind_pct_female }} are female."`

#### Export
Configure the output format and destination:
```yaml
export:
  format: csv   # csv | json | xlsx | mysql | postgres | supabase
  output_dir: data/processed
  database:
    host: localhost
    port: 5432
    name: kobo_reports
    user: env:DB_USER
    password: env:DB_PASSWORD
    table: submissions
    # supabase_url: https://yourproject.supabase.co
    # supabase_key: env:SUPABASE_KEY
```

> For file exports (csv, json, xlsx), data is written to `output_dir`. For database exports, configure the `database` section. Use the `env:` prefix to reference environment variables.

#### Report
Configure the Word report generation:
```yaml
report:
  template: templates/report_template.docx
  output_dir: reports
  title: Monitoring Report
  period: Q1 2025
  # split_by: Village   # generate one report per unique value of this column
```

The template is a `.docx` file with Jinja2-style placeholders: `{{ report_title }}`, `{{ period }}`, `{{ n_submissions }}`, `{{ generated_at }}`, `{{ chart_<name> }}`, `{{ ind_<name> }}`, etc. Run `generate-template` to create a starter template automatically.

---

You can edit `config.yml` in two ways:
1. **From the browser** — use the **Config** tab in the web UI (includes syntax highlighting and YAML validation on save)
2. **From disk** — edit the file directly; changes are picked up immediately since the file is volume-mounted

> The web UI validates YAML before saving — if the syntax is invalid, the save will be rejected with an error message.


## Customize Traefik
> *This part is optional*

The `docker-compose.yml` configures two Traefik routers on the `xayma_webservers` external network:
- **databridge** — serves the web UI on your `APP_DOMAIN`
- **databridge-terminal** — serves the web terminal at the `/terminal` path

Both use HTTPS via Let's Encrypt (`certresolver=letsencrypt`). To add basic authentication, add `basicauth` middleware labels to the services in `docker-compose.yml`.

> ⚠️ *It is recommended to add basic auth for public-facing deployments.*


# Usage
#### Command line
The CLI entry point runs inside the Docker container. You can execute commands from the **web UI Dashboard** (recommended), the **web terminal** at `/terminal`, or directly via `docker exec`:

```bash
$ docker exec -it databridge-cli-app python3 src/data/make.py [COMMAND] [OPTIONS]
```

The 4-step workflow:

| Step | Command | Description | Options |
|------|---------|-------------|---------|
| 1 | `fetch-questions` | Fetch form schema from Kobo/Ona and write questions into `config.yml` | — |
| 2 | `generate-template` | Build a starter Word template from chart and indicator definitions in `config.yml` | `--out <path>` |
| 3 | `download` | Download form submissions, apply filters, and export data | `--sample N` |
| 4 | `build-report` | Generate Word (.docx) report with embedded charts | `--sample N`, `--split-by <column>` |

**Run the full pipeline:**
```bash
$ python3 src/data/make.py fetch-questions
$ python3 src/data/make.py generate-template
$ python3 src/data/make.py download
$ python3 src/data/make.py build-report
```

**Generate one report per region:**
```bash
$ python3 src/data/make.py build-report --split-by Region
```

**Test with a sample of 50 submissions:**
```bash
$ python3 src/data/make.py download --sample 50
$ python3 src/data/make.py build-report --sample 50
```

> ⚠️ *Depending on your environment you might need to use `python` (with version 3) instead of `python3`*


#### Web UI
Once the services are running, open `https://your-app-domain.com` in a browser. The interface has six tabs:

- **Dashboard** — Run the 4 pipeline steps with one click and view real-time logs streamed via SSE. Build Report supports split-by from a dropdown.
- **Config** — Edit `config.yml` with a CodeMirror YAML editor (syntax highlighting, validation on save)
- **Questions** — Browse all fetched questions in a table and edit `export_label` inline. Save changes back to `config.yml` without touching YAML.
- **Reports** — Browse, download, and delete generated `.docx` reports; also shows downloaded data files
- **Templates** — Manage Word templates: upload, download, generate, preview placeholders, and set the active template for report generation
- **Terminal** — Full web terminal (ttyd) for direct CLI access at `/terminal`


#### API endpoints
The FastAPI backend exposes the following REST API:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serve the web UI |
| `GET` | `/api/config` | Read `config.yml` content |
| `POST` | `/api/config` | Write `config.yml` (validates YAML before saving) |
| `POST` | `/api/run/{command}` | Run a CLI command, stream logs via SSE |
| `GET` | `/api/status` | Get last command run status |
| `GET` | `/api/reports` | List generated reports |
| `GET` | `/api/reports/download/{filename}` | Download a report file |
| `DELETE` | `/api/reports/{filename}` | Delete a report file |
| `GET` | `/api/data` | List downloaded data files |
| `GET` | `/api/data/download/{filename}` | Download a data file |
| `GET` | `/api/questions` | Read questions list from `config.yml` |
| `POST` | `/api/questions` | Save updated questions list to `config.yml` |
| `GET` | `/api/templates` | List template files |
| `GET` | `/api/templates/download/{filename}` | Download a template |
| `POST` | `/api/templates/upload` | Upload a `.docx` template |
| `DELETE` | `/api/templates/{filename}` | Delete a template |
| `GET` | `/api/templates/active` | Get active template name |
| `POST` | `/api/templates/set-active/{filename}` | Set active template in config |
| `GET` | `/api/templates/preview/{filename}` | List template placeholders |


# Repeat groups

Forms with repeat groups (e.g., listing household members within a household survey) are automatically detected during `fetch-questions`. Repeat data is exported as **separate tables** linked to the main table.

**Output structure:**

| Table | Columns | Description |
|-------|---------|-------------|
| Main table | `_id`, all non-repeat questions | One row per submission |
| Repeat table (one per group) | `_parent_index`, `_row_index`, repeat fields | One row per repeat entry |

- `_parent_index` links back to the parent submission's `_id`
- `_row_index` is the position within the repeat (0, 1, 2, ...)

**Export behavior by format:**

| Format | Main table | Repeat tables |
|--------|-----------|---------------|
| CSV | `alias_data.csv` | `alias_groupname.csv` (one file per group) |
| JSON | `alias_data.json` | `alias_groupname.json` (one file per group) |
| XLSX | `main` sheet | One sheet per group (in the same file) |
| SQL | `submissions` table | `submissions_groupname` table |
| Supabase | `submissions` table | `submissions_groupname` table |

> Filters applied to the main table automatically remove orphaned repeat rows whose parent submission was filtered out.


# Docker services

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| `app` | `databridge-cli-app` | 8000 | FastAPI backend + web UI (served via Traefik with HTTPS) |
| `terminal` | `databridge-cli-terminal` | 7681 | ttyd web shell accessible at `/terminal` path |

**Volume mounts** (shared by both services):

| Host path | Container path | Purpose |
|-----------|---------------|---------|
| `./config.yml` | `/app/config.yml` | Pipeline configuration |
| `./data/` | `/app/data/` | Raw and processed data, charts |
| `./reports/` | `/app/reports/` | Generated Word reports |
| `./templates/` | `/app/templates/` | Word templates |
| `./references/` | `/app/references/` | Reference documents |


# Schedule automatic execution
> *This part is optional*

You can schedule the automatic execution of the pipeline by creating a cron task on the host machine. The commands run inside the Docker container via `docker exec`.

1. Display and copy the command to be executed by the cron task:

```bash
$ echo "docker exec databridge-cli-app python3 src/data/make.py fetch-questions && docker exec databridge-cli-app python3 src/data/make.py download && docker exec databridge-cli-app python3 src/data/make.py build-report"
```

2. Edit the `crontab` file:
> *The `crontab` file contains instructions for the cron daemon in the following simplified manner: "**run this command on this date at this time**".*

```bash
$ crontab -e
```

Add at the end of the file the command you have copied from the previous step in this way and save and close the file:
```
0 2 * * * docker exec databridge-cli-app python3 src/data/make.py fetch-questions && docker exec databridge-cli-app python3 src/data/make.py download && docker exec databridge-cli-app python3 src/data/make.py build-report
```
This gives instruction to the cron daemon to run the full pipeline every day at 2:00 AM.

> ⚠️ *On Windows, use [Task Scheduler](https://www.windowscentral.com/how-create-automated-task-using-task-scheduler-windows-10) instead.*
