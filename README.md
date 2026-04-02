[![forthebadge made-with-python](http://ForTheBadge.com/images/badges/made-with-python.svg)](https://www.python.org/)  
[![GitHub license](https://img.shields.io/github/license/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/LICENSE)
[![GitHub tag](https://img.shields.io/github/tag/supermalang/databridge-cli)](https://github.com/supermalang/databridge-cli/tags/)



kobo-reporter
==============================

kobo-reporter is a web-based report generation platform that connects to [Kobo Toolbox](https://www.kobotoolbox.org/) or [Ona](https://ona.io/) data collection services. It automates the full pipeline from fetching survey questions, generating Word templates, downloading submission data, to building Word (.docx) reports with embedded charts — all from a browser-based interface.

# Features
- Web UI with dashboard, config editor, report manager, and embedded terminal
- 4-step automated pipeline: fetch questions → generate template → download data → build report
- YAML-based configuration editable from the browser (CodeMirror syntax-highlighted editor)
- Real-time log streaming via Server-Sent Events (SSE)
- Word (.docx) report generation with embedded charts
- Platform selection: supports both **Kobo Toolbox** and **Ona**, with custom/self-hosted URLs
- Automatic repeat group handling — repeat data is exported as separate linked tables
- Docker Compose deployment with Traefik HTTPS
- Web terminal (ttyd) for direct CLI access from the browser
- Export to CSV, JSON, XLSX, MySQL, PostgreSQL, or Supabase

# Installation
## Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- A running [Traefik](https://doc.traefik.io/traefik/) reverse proxy with the `xayma_webservers` Docker network created
- A [Kobo Toolbox](https://www.kobotoolbox.org/) or [Ona](https://ona.io/) API token

## The easy way
The easiest way to install kobo-reporter is to clone it from GitHub:
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
| `APP_DOMAIN` | Yes | Domain name for Traefik routing (e.g. `kobo-reporter.yourdomain.com`) |
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

You can also set an optional `api.timeout` (in seconds, default 120) for slow connections or large forms.

**The full config file has the following sections:**

#### Questions
Auto-populated by the `fetch-questions` command. Each question has:
- `kobo_key` — the field path in the API response (e.g., `group_name/field_name`)
- `label` — human-readable label from the form
- `type` — field type (select_one, integer, text, etc.)
- `category` — auto-assigned: `categorical`, `quantitative`, `qualitative`, `geographical`, `date`, or `undefined`
- `export_label` — column name in the exported data (editable)
- `repeat_group` — name of the repeat group if the field belongs to one, otherwise `null`

> After running `fetch-questions`, review the questions and adjust `category` and `export_label` as needed before downloading data.

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

  - name: age_distribution
    title: Age distribution
    type: histogram
    questions: [Age]
    options:
      bins: 12
```

Supported chart types: `bar`, `horizontal_bar`, `stacked_bar`, `pie`, `donut`, `line`, `area`, `histogram`, `scatter`, `box_plot`, `heatmap`, `treemap`, `waterfall`, `funnel`, `table`

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
```

The template is a `.docx` file with Jinja2-style placeholders: `{{ report_title }}`, `{{ period }}`, `{{ n_submissions }}`, `{{ generated_at }}`, `{{ chart_<name> }}`, etc. Run `generate-template` to create a starter template automatically.

---

You can edit `config.yml` in two ways:
1. **From the browser** — use the **Config** tab in the web UI (includes syntax highlighting and YAML validation on save)
2. **From disk** — edit the file directly; changes are picked up immediately since the file is volume-mounted

> The web UI validates YAML before saving — if the syntax is invalid, the save will be rejected with an error message.


## Customize Traefik
> *This part is optional*

The `docker-compose.yml` configures two Traefik routers on the `xayma_webservers` external network:
- **kobo-reporter** — serves the web UI on your `APP_DOMAIN`
- **kobo-terminal** — serves the web terminal at the `/terminal` path

Both use HTTPS via Let's Encrypt (`certresolver=letsencrypt`). To add basic authentication, add `basicauth` middleware labels to the services in `docker-compose.yml`.

> ⚠️ *It is recommended to add basic auth for public-facing deployments.*


# Usage
#### Command line
The CLI entry point runs inside the Docker container. You can execute commands from the **web UI Dashboard** (recommended), the **web terminal** at `/terminal`, or directly via `docker exec`:

```bash
$ docker exec -it kobo-reporter-app python3 src/data/make.py [COMMAND] [OPTIONS]
```

The 4-step workflow:

| Step | Command | Description | Options |
|------|---------|-------------|---------|
| 1 | `fetch-questions` | Fetch form schema from Kobo/Ona and write questions into `config.yml` | — |
| 2 | `generate-template` | Build a starter Word template from chart definitions in `config.yml` | — |
| 3 | `download` | Download form submissions, apply filters, and export data | `--sample N` |
| 4 | `build-report` | Generate Word (.docx) report with embedded charts | `--sample N` |

**Run the full pipeline:**
```bash
$ python3 src/data/make.py fetch-questions
$ python3 src/data/make.py generate-template
$ python3 src/data/make.py download
$ python3 src/data/make.py build-report
```

**Test with a sample of 50 submissions:**
```bash
$ python3 src/data/make.py download --sample 50
$ python3 src/data/make.py build-report --sample 50
```

> ⚠️ *Depending on your environment you might need to use `python` (with version 3) instead of `python3`*


#### Web UI
Once the services are running, open `https://your-app-domain.com` in a browser. The interface has four tabs:

- **Dashboard** — Run the 4 pipeline steps with one click and view real-time logs streamed via SSE
- **Config** — Edit `config.yml` with a CodeMirror YAML editor (syntax highlighting, validation on save)
- **Reports** — Browse, download, and delete generated `.docx` reports
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
| `app` | `kobo-reporter-app` | 8000 | FastAPI backend + web UI (served via Traefik with HTTPS) |
| `terminal` | `kobo-reporter-terminal` | 7681 | ttyd web shell accessible at `/terminal` path |

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
$ echo "docker exec kobo-reporter-app python3 src/data/make.py fetch-questions && docker exec kobo-reporter-app python3 src/data/make.py download && docker exec kobo-reporter-app python3 src/data/make.py build-report"
```

2. Edit the `crontab` file:
> *The `crontab` file contains instructions for the cron daemon in the following simplified manner: "**run this command on this date at this time**".*

```bash
$ crontab -e
```

Add at the end of the file the command you have copied from the previous step in this way and save and close the file:
```
0 2 * * * docker exec kobo-reporter-app python3 src/data/make.py fetch-questions && docker exec kobo-reporter-app python3 src/data/make.py download && docker exec kobo-reporter-app python3 src/data/make.py build-report
```
This gives instruction to the cron daemon to run the full pipeline every day at 2:00 AM.

> ⚠️ *On Windows, use [Task Scheduler](https://www.windowscentral.com/how-create-automated-task-using-task-scheduler-windows-10) instead.*
