#!/usr/bin/env bash
# Start Postgres (Homebrew @14), backend (Flask :5000), frontend (Vite :3000).
# From prior setup: backend needs PostgreSQL; frontend should use localhost API for local dev.

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
DATA_DIR="${POSTGRES_DATA_DIR:-/opt/homebrew/var/postgresql@14}"

export DATABASE_URL="${DATABASE_URL:-postgresql://alertuser:alertpass@127.0.0.1:5432/alerts}"

# If postmaster.pid points at a non-postgres PID (e.g. stale lock), remove it then start.
if [ -d "$DATA_DIR" ] && command -v pg_ctl >/dev/null 2>&1; then
  if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
    if [ -f "$DATA_DIR/postmaster.pid" ]; then
      OLD_PID="$(head -1 "$DATA_DIR/postmaster.pid" 2>/dev/null || true)"
      if [ -n "$OLD_PID" ] && ! ps -p "$OLD_PID" -o command= 2>/dev/null | grep -q postgres; then
        echo "Removing stale postmaster.pid (PID $OLD_PID is not postgres)..."
        rm -f "$DATA_DIR/postmaster.pid"
      fi
    fi
    echo "Starting PostgreSQL ($DATA_DIR)..."
    pg_ctl -D "$DATA_DIR" -l "$DATA_DIR/server.log" start -w -t 30 || true
  fi
fi

if ! pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "ERROR: PostgreSQL is not accepting connections on localhost:5432."
  echo "Fix: start Postgres (e.g. pg_ctl -D \"$DATA_DIR\" start) or use Docker, then re-run."
  exit 1
fi

echo "PostgreSQL: OK"

# Free ports if something left running
lsof -ti :5000 | xargs kill -9 2>/dev/null || true
lsof -ti :3000 | xargs kill -9 2>/dev/null || true

cd "$BACKEND"
echo "Starting backend http://localhost:5000 ..."
nohup python3 app.py >> /tmp/nmt-backend.log 2>&1 &
echo $! > /tmp/nmt-backend.pid

cd "$ROOT"
# Default: no VITE_* URL — browser calls /api and Vite proxies to :5000 (see vite.config.ts).
# To hit the backend directly: VITE_API_BASE_URL=http://127.0.0.1:5000 npm run dev
echo "Starting frontend (Vite :3000, /api proxied to :5000 unless VITE_API_BASE_URL is set) ..."
nohup npm run dev >> /tmp/nmt-frontend.log 2>&1 &
echo $! > /tmp/nmt-frontend.pid

echo "Backend PID $(cat /tmp/nmt-backend.pid) — logs: /tmp/nmt-backend.log"
echo "Frontend PID $(cat /tmp/nmt-frontend.pid) — logs: /tmp/nmt-frontend.log"
echo "Open http://localhost:3000"
