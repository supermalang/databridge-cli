#!/usr/bin/env bash
# Prod-like local run (no Docker): build the React app and let FastAPI serve
# everything on a single port (:8000). Good for quick demos, share via the dev
# container's forwarded port, or stick behind nginx/Traefik on a real host.
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-.}"

# Load .env if present, so env:VAR references in config.yml resolve.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

# Build the React app → frontend/dist/
echo "→ npm run build"
(cd frontend && [ -d node_modules ] || npm install)
(cd frontend && npm run build)

# Hand off to uvicorn (no --reload — this is the prod-like path).
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
echo "→ uvicorn  http://${HOST}:${PORT}  (FastAPI + built React app)"
exec uvicorn web.main:app --host "$HOST" --port "$PORT"
