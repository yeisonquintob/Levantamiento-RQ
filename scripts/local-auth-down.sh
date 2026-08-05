#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/tmp/local-auth"

kill_tree() {
  local pid="$1"
  local child=""

  [ -n "$pid" ] || return 0
  kill -0 "$pid" >/dev/null 2>&1 || return 0

  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done

  kill "$pid" >/dev/null 2>&1 || true
}

if [ -d "$PID_DIR" ]; then
  for pid_file in "$PID_DIR"/*.pid; do
    [ -f "$pid_file" ] || continue
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    kill_tree "$pid"
  done
fi

sleep 1

pkill -TERM -f "nx( |.* )serve identity-service" >/dev/null 2>&1 || true
pkill -TERM -f "nx( |.* )serve projects-service" >/dev/null 2>&1 || true
pkill -TERM -f "nx( |.* )serve sources-service" >/dev/null 2>&1 || true
pkill -TERM -f "nx( |.* )serve documents-service" >/dev/null 2>&1 || true
pkill -TERM -f "nx( |.* )serve gateway" >/dev/null 2>&1 || true
pkill -TERM -f "nx( |.* )dev web.*4200" >/dev/null 2>&1 || true
pkill -TERM -f "identity-service:serve:development" >/dev/null 2>&1 || true
pkill -TERM -f "projects-service:serve:development" >/dev/null 2>&1 || true
pkill -TERM -f "sources-service:serve:development" >/dev/null 2>&1 || true
pkill -TERM -f "documents-service:serve:development" >/dev/null 2>&1 || true
pkill -TERM -f "gateway:serve:development" >/dev/null 2>&1 || true
pkill -TERM -f "apps/identity-service/dist/main.js" >/dev/null 2>&1 || true
pkill -TERM -f "apps/projects-service/dist/main.js" >/dev/null 2>&1 || true
pkill -TERM -f "apps/sources-service/dist/main.js" >/dev/null 2>&1 || true
pkill -TERM -f "apps/documents-service/dist/main.js" >/dev/null 2>&1 || true
pkill -TERM -f "apps/gateway/dist/main.js" >/dev/null 2>&1 || true

for port in 4200 3000 3001 3002 3003 3004; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs kill >/dev/null 2>&1 || true
  fi
done

sleep 1

for port in 4200 3000 3001 3002 3003 3004; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs kill -9 >/dev/null 2>&1 || true
  fi
done

rm -rf "$PID_DIR"
echo "✓ Identity, Projects, Sources, Documents, Gateway, frontend y procesos Nx detenidos."
