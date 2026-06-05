# Deploying databridge (single VPS + Docker Compose)

This app is designed to run as a **single instance** (the run registry and the local
read-mirror are per-process), with durable state in **Postgres** and **Minio/S3**. So the
recommended production topology is one small VM running Docker Compose:

```
            ┌──────────── your VM ────────────┐
 Internet ─▶│ Traefik (80/443, auto-HTTPS)    │
            │   └─▶ app (FastAPI + React)      │
            │         ├─▶ db    (Postgres)     │
            │         └─▶ minio (S3 storage)   │
            └─────────────────────────────────┘
            Auth: Zitadel Cloud (external OIDC)
```

Only Traefik is exposed publicly; Postgres and Minio stay on the internal network.

## Prerequisites
- A VM (1–2 vCPU / 2–4 GB RAM is plenty to start) with **Docker** + the **Compose plugin**.
- A **domain** with a DNS `A`/`AAAA` record pointing at the VM (Traefik gets TLS certs for it).
- A **Zitadel** application (Web / Code flow) — see the auth notes in `CLAUDE.md`.

## 1. Configure
```bash
git clone <repo> && cd databridge-cli
cp .env.prod.example .env
# edit .env — at minimum:
#   APP_DOMAIN, APP_BASE_URL (https://APP_DOMAIN), ACME_EMAIL (for Let's Encrypt)
#   OIDC_ISSUER / OIDC_CLIENT_ID / OIDC_CLIENT_SECRET, SESSION_SECRET (openssl rand -hex 32)
#   POSTGRES_PASSWORD, S3_ACCESS_KEY, S3_SECRET_KEY
#   SUPERADMIN_EMAILS (your email, to become superadmin on first login)
```
Keep `.env` **LF** line endings (a CRLF `.env` breaks env parsing).

## 2. Point Zitadel at the prod URL
In your Zitadel app, register:
- Redirect URI: `https://<APP_DOMAIN>/auth/callback`
- Post-logout URI: `https://<APP_DOMAIN>/`

## 3. Launch
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
On startup the app runs **Alembic migrations** automatically and the `createbucket` job
provisions the Minio bucket. Watch it come up:
```bash
docker compose -f docker-compose.prod.yml logs -f app traefik
```
Then open `https://<APP_DOMAIN>` → you'll be redirected to Zitadel to sign in.

## 4. Operate
```bash
# update to a new version
git pull && docker compose -f docker-compose.prod.yml up -d --build

# logs / status
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app

# backups (do these on a schedule)
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U postgres databridge | gzip > backup-$(date +%F).sql.gz
# Minio data lives in the `miniodata` volume — snapshot it or `mc mirror` to off-site.
```

## Notes & gotchas
- **Single instance only.** Do not scale `app` to multiple replicas — the in-memory run
  registry and the local mirror are not shared. Scale the VM up instead.
- **HTTPS cookies** turn on automatically because `APP_BASE_URL` is `https://` (override
  with `SESSION_COOKIE_SECURE=true|false`). Always terminate TLS (Traefik does this for you).
- **SSE run logs** stream through Traefik unbuffered by default — no extra config needed.
- **Traefik + Docker socket:** Traefik discovers the app via the read-only Docker socket it
  mounts. The app is matched by the `traefik.*` labels in the compose file (router →
  `Host(${APP_DOMAIN})`, service port 8000).
- **Local HTTP test** (no domain/cert): Traefik routes by hostname, so point a hostname at
  the VM (or add `127.0.0.1 app.localhost` to your hosts file) and set
  `APP_DOMAIN=app.localhost`; for real certs you need a public domain.
- **External managed services** instead of the bundled `db`/`minio`? Point `DATABASE_URL`
  and the `S3_*` vars at them and remove those services from the compose file (e.g. a managed
  Postgres + Cloudflare R2/Backblaze B2).
- `data/`, `reports/`, `templates/` inside the container are a regenerable mirror of Minio —
  they don't need a volume; durable copies live in Minio + Postgres.
