# Dev Container: Postgres + Minio (compose-based) — Design

**Date:** 2026-06-03
**Status:** Approved (brainstorming) — implementing directly (config change, no TDD)

---

## Goal

Run **Postgres** and **Minio** alongside the dev container and wire them into the app
automatically, so a single "Rebuild Container" stands up the full local SaaS stack
(`./scripts/serve.sh` then just works — DB + object storage reachable, bucket + migrations
applied with no manual steps).

Docker is **not** available inside the current single-container devcontainer, so the dev
container is converted to a **docker-compose-based** devcontainer (sibling services on a
shared network).

### Out of scope
- **Zitadel** — it's a cloud SaaS (the user's `*.zitadel.cloud` instance); OIDC config stays
  in `.env`. Not run in the container.
- Auto-starting `./scripts/serve.sh` — the user still launches the app; this only provides
  its infra.

---

## Files

### `.devcontainer/docker-compose.yml` (new)
Services on one default network:
- **`app`** — `build: { context: ., dockerfile: Dockerfile }` (the existing Dockerfile,
  unchanged), mounts the workspace at `/workspaces/databridge-cli`, `command: sleep infinity`,
  the npm-global / zsh-history named volumes (migrated from `devcontainer.json` mounts),
  `depends_on: [db, minio]`, and the infra connection env (below).
- **`db`** — `postgres:16`; `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=dev`,
  `POSTGRES_DB=databridge`; volume `pgdata:/var/lib/postgresql/data`; healthcheck
  `pg_isready -U postgres`.
- **`minio`** — `minio/minio`, `command: server /data --console-address ":9001"`;
  `MINIO_ROOT_USER=minio`, `MINIO_ROOT_PASSWORD=minio12345`; volume `miniodata:/data`;
  healthcheck on `/minio/health/ready`.
- **`createbucket`** — one-shot `minio/mc`; `depends_on: minio (healthy)`; entrypoint:
  `mc alias set local http://minio:9000 minio minio12345` then
  `mc mb --ignore-existing local/databridge` (idempotent).

Named volumes: `pgdata`, `miniodata`, plus the existing `npm-global`, `zsh-history`.

### `.devcontainer/devcontainer.json` (modify)
- Replace `"build": {...}` with `"dockerComposeFile": "docker-compose.yml"`,
  `"service": "app"`, `"workspaceFolder": "/workspaces/databridge-cli"`.
- Remove the top-level `"mounts"` (the npm-global / zsh-history volumes move into the compose
  `app` service).
- Keep `features`, `containerEnv`, `customizations`, `postCreateCommand`, `postStartCommand`.
- `forwardPorts`: add `8000` (app/uvicorn), `51730` (vite), `9001` (Minio console), `5432`,
  `9000` (optional, for external DB/S3 clients); add `portsAttributes` labels.

### `.env` (modify)
Remove the `DATABASE_URL` and `S3_*` lines (added earlier with `localhost` values). They now
come from compose `app.environment` using **service hostnames** (`db`, `minio`), so a fresh
rebuild works without a `.env` and `serve.sh`'s `set -a; . .env` can't override them with
`localhost`. `.env` keeps OIDC + AI-provider secrets only.

---

## Auto-wiring (the connection env, in compose `app.environment`)
```
DATABASE_URL=postgresql+psycopg2://postgres:dev@db:5432/databridge
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_BUCKET=databridge
S3_REGION=us-east-1
```
Dev-only credentials → safe to commit; reproducible for anyone who rebuilds.

## Data flow on rebuild
1. Compose builds/starts `app`, `db`, `minio`; `createbucket` makes `databridge`.
2. `db`/`minio` data persist in named volumes across rebuilds.
3. User runs `./scripts/serve.sh` → FastAPI lifespan runs `alembic upgrade head` against `db`
   (reachable + healthy) and `get_storage()` talks to `minio` → app up, migrated, bucket ready.

## Verification
Docker isn't available inside the current container, so this can't be brought up from here.
Verification is a careful config review + the user's **Rebuild Container**, then `serve.sh` and
confirm: startup log shows migrations + `AUTH ENABLED`, and the app reaches DB + Minio. The
existing Dockerfile/build behavior is preserved (it has no repo `COPY`, so build context is
unaffected).

## Risks
- Rebuild required (one-time); subsequent restarts auto-bring-up the services.
- If the user's existing `.env` re-adds `DATABASE_URL`/`S3_*` with `localhost`, `serve.sh`
  would override the compose values and break connectivity — documented; keep them out of `.env`.
- `depends_on` waits for health, but `serve.sh` is user-run after the container is up, so the
  DB is ready by then; the app's lifespan also fails loudly if the DB is unreachable.
