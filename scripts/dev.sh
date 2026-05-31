#!/usr/bin/env bash
# Dev manager: run FastAPI (uvicorn :8000) + Vite (React :51730) together.
#
# No args  → foreground mode (Ctrl-C cleans up uvicorn, Vite, and any leftover
#            holders of ports 8000 / 51730).
# start    → background mode (writes PIDs + logs under .dev/)
# stop     → stop background services; also frees ports 8000 / 51730 as a safety net
# restart  → stop + start
# status   → show what's running
# logs     → tail -f the log of one or both services
set -euo pipefail

cd "$(dirname "$0")/.."
export PYTHONPATH="${PYTHONPATH:-.}"

PID_DIR=".dev"
LOG_DIR=".dev/logs"
UVICORN_PID="$PID_DIR/uvicorn.pid"
VITE_PID="$PID_DIR/vite.pid"
UVICORN_LOG="$LOG_DIR/uvicorn.log"
VITE_LOG="$LOG_DIR/vite.log"
API_PORT=8000
UI_PORT=51730

mkdir -p "$PID_DIR" "$LOG_DIR"

is_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

kill_pgroup() {
  # Send TERM to the whole process group (negative PID), then KILL if still up.
  # This catches uvicorn --reload's worker child and Vite's esbuild child, which
  # `kill 0` from the parent shell often misses.
  local pid=$1
  is_alive "$pid" || return 0
  kill -TERM -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8; do
    is_alive "$pid" || return 0
    sleep 0.25
  done
  kill -KILL -"$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
}

kill_port() {
  # Safety net for processes that escape pgroup tracking (orphaned reload workers).
  local port=$1
  local pids
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  [ -z "$pids" ] && return 0
  echo "  freeing port $port (PIDs: $pids)"
  echo "$pids" | xargs kill 2>/dev/null || true
  sleep 0.5
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  [ -n "$pids" ] && echo "$pids" | xargs kill -9 2>/dev/null || true
}

load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
  fi
}

ensure_node_modules() {
  [ -d frontend/node_modules ] || (cd frontend && npm install)
}

start_background() {
  ensure_node_modules
  load_env

  if is_alive "$(cat "$UVICORN_PID" 2>/dev/null || true)"; then
    echo "→ uvicorn already running (PID $(cat "$UVICORN_PID"))"
  else
    # setsid puts uvicorn in its own session/pgroup so we can kill the whole tree.
    setsid bash -c "exec uvicorn web.main:app --host 0.0.0.0 --port $API_PORT --reload" \
      </dev/null >"$UVICORN_LOG" 2>&1 &
    echo $! > "$UVICORN_PID"
    echo "→ uvicorn  http://localhost:$API_PORT   PID $(cat "$UVICORN_PID")  log: $UVICORN_LOG"
  fi

  if is_alive "$(cat "$VITE_PID" 2>/dev/null || true)"; then
    echo "→ vite already running (PID $(cat "$VITE_PID"))"
  else
    setsid bash -c "cd frontend && exec npm run dev" \
      </dev/null >"$VITE_LOG" 2>&1 &
    echo $! > "$VITE_PID"
    echo "→ vite     http://localhost:$UI_PORT  PID $(cat "$VITE_PID")  log: $VITE_LOG"
  fi
}

stop_background() {
  local u v
  u=$(cat "$UVICORN_PID" 2>/dev/null || true)
  v=$(cat "$VITE_PID" 2>/dev/null || true)
  if is_alive "$u"; then echo "stopping uvicorn (PID $u)"; kill_pgroup "$u"; fi
  if is_alive "$v"; then echo "stopping vite    (PID $v)"; kill_pgroup "$v"; fi
  rm -f "$UVICORN_PID" "$VITE_PID"
  kill_port "$API_PORT"
  kill_port "$UI_PORT"
}

status() {
  local u v
  u=$(cat "$UVICORN_PID" 2>/dev/null || true)
  v=$(cat "$VITE_PID" 2>/dev/null || true)
  if is_alive "$u"; then echo "uvicorn  running PID $u   → http://localhost:$API_PORT"
  else                   echo "uvicorn  stopped"; fi
  if is_alive "$v"; then echo "vite     running PID $v   → http://localhost:$UI_PORT"
  else                   echo "vite     stopped"; fi
  # Highlight orphans (port held but no PID file)
  for port in "$API_PORT" "$UI_PORT"; do
    local owner
    owner=$(lsof -ti:"$port" 2>/dev/null || true)
    if [ -n "$owner" ] && ! is_alive "$u" && ! is_alive "$v"; then
      echo "  ⚠ port $port is held by PID(s) $owner but no service is tracked — run 'stop' to clean up"
    fi
  done
}

logs() {
  local svc=${1:-}
  case "$svc" in
    ""|all|both)       tail -F "$UVICORN_LOG" "$VITE_LOG" ;;
    api|backend|uvicorn) tail -F "$UVICORN_LOG" ;;
    ui|frontend|vite)    tail -F "$VITE_LOG" ;;
    *) echo "usage: $0 logs [api|ui|all]"; exit 2 ;;
  esac
}

run_foreground() {
  ensure_node_modules
  load_env

  # Use the same setsid trick in the foreground path so Ctrl-C kills the whole
  # tree, not just the immediate child shells.
  setsid bash -c "exec uvicorn web.main:app --host 0.0.0.0 --port $API_PORT --reload" \
    </dev/null &
  local upid=$!
  setsid bash -c "cd frontend && exec npm run dev" \
    </dev/null &
  local vpid=$!

  cleanup() {
    echo ""
    echo "stopping services…"
    kill_pgroup "$upid"
    kill_pgroup "$vpid"
    kill_port "$API_PORT"
    kill_port "$UI_PORT"
    exit 0
  }
  trap cleanup INT TERM EXIT

  echo "→ uvicorn  http://localhost:$API_PORT  (FastAPI, --reload)        PID $upid"
  echo "→ vite     http://localhost:$UI_PORT (React + HMR, proxies /api) PID $vpid"
  echo "   (Ctrl-C to stop both)"
  wait
}

cmd=${1:-}
case "$cmd" in
  ""|fg|foreground) run_foreground ;;
  start)            start_background; sleep 1; status ;;
  stop)             stop_background ;;
  restart)          stop_background; sleep 0.5; start_background; sleep 1; status ;;
  status)           status ;;
  logs)             shift; logs "${1:-}" ;;
  -h|--help|help)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *)
    echo "usage: $0 [start|stop|restart|status|logs [api|ui|all]]"
    echo "       $0                # foreground (Ctrl-C cleans up)"
    exit 2
    ;;
esac
