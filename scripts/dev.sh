#!/usr/bin/env bash
# Dev mode: run FastAPI (uvicorn, :8000) and Vite (:51730) side-by-side.
# Vite proxies /api/* and /terminal/ to uvicorn, so you hit the frontend
# at the dev container's forwarded :51730 URL and everything just works.
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-.}"

[ -d frontend/node_modules ] || (cd frontend && npm install)

# Forward Ctrl-C / shell exit to both children.
trap 'kill 0 2>/dev/null || true' EXIT INT TERM

echo "→ uvicorn  http://0.0.0.0:8000   (FastAPI, --reload)"
uvicorn web.main:app --host 0.0.0.0 --port 8000 --reload &

echo "→ vite     http://0.0.0.0:51730  (React + HMR, proxies /api → :8000)"
(cd frontend && npm run dev) &

wait
