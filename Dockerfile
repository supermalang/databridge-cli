# syntax=docker/dockerfile:1
# Production image: build the React app, then run FastAPI (uvicorn) serving the built
# frontend + /api on a single port. Mirrors scripts/serve.sh. See docs/DEPLOY.md.

# ── Stage 1: build the React bundle ───────────────────────────────────────────
FROM node:20-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/tmp/matplotlib

# curl is only for the container HEALTHCHECK.
RUN apt-get update && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Application code (build context trimmed by .dockerignore).
COPY src/ ./src/
COPY web/ ./web/
COPY migrations/ ./migrations/
COPY alembic.ini ./

# Built frontend from stage 1 → served by FastAPI at "/".
COPY --from=frontend /app/frontend/dist ./frontend/dist

# Run as a non-root user; pre-create the local mirror dirs it writes to.
RUN useradd -m -u 10001 app \
 && mkdir -p data/processed/charts data/raw reports templates \
 && chown -R app:app /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

# DB migrations (alembic upgrade head) run automatically in the FastAPI startup lifespan.
CMD ["uvicorn", "web.main:app", "--host", "0.0.0.0", "--port", "8000"]
