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
- Docker Compose deployment with Traefik HTTPS and optional basic authentication
- Web terminal (ttyd) for direct CLI access from the browser
- Optional database export (Supabase)
- Works with both Kobo Toolbox and Ona APIs

# Installation
## Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)
- A running [Traefik](https://doc.traefik.io/traefik/) reverse proxy with the `traefik-public` Docker network created
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
$ docker network create traefik-public
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
| `BASIC_AUTH_USERS` | No | htpasswd-formatted credentials for basic authentication |
| `DB_USER` | No | Database username (for optional database export) |
| `DB_PASSWORD` | No | Database password (for optional database export) |
| `SUPABASE_KEY` | No | Supabase API key (for optional database export) |

- 🆘 *If you do not have a Kobo token, go to your Kobo Toolbox account settings to generate one.*
- 🆗 *If you do not export to a database you can ignore `DB_USER`, `DB_PASSWORD` and `SUPABASE_KEY`.*

> ⚠️ *In the `.env` file, escape `$` characters in `BASIC_AUTH_USERS` by doubling them (`$$`). Generate the htpasswd string with: `htpasswd -nb username password`*


## Update the config file
Create a `config.yml` file in the project root directory. This file is mounted into the container and defines the pipeline behavior: form URL, chart definitions, field mappings, filters, and export settings.

You can edit `config.yml` in two ways:
1. **From the browser** — use the **Config** tab in the web UI (includes syntax highlighting and YAML validation on save)
2. **From disk** — edit the file directly; changes are picked up immediately since the file is volume-mounted

> The web UI validates YAML before saving — if the syntax is invalid, the save will be rejected with an error message.


## Customize Traefik and basic auth
> *This part is optional*

The `docker-compose.yml` configures two Traefik routers:
- **kobo-reporter** — serves the web UI on your `APP_DOMAIN`
- **kobo-terminal** — serves the web terminal at the `/terminal` path

Both use HTTPS via Let's Encrypt (`certresolver=letsencrypt`) and share the same basic auth middleware. To disable authentication, comment out or remove the `basicauth` middleware labels in `docker-compose.yml`.

> ⚠️ *It is not recommended to disable basic auth for public-facing deployments.*


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
