#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/tmp/local-auth"
LOG_DIR="$ROOT/logs/local-auth"

mkdir -p "$PID_DIR" "$LOG_DIR"

required_files=(
  "$ROOT/apps/identity-service/.env"
  "$ROOT/apps/projects-service/.env"
  "$ROOT/apps/sources-service/.env"
  "$ROOT/apps/gateway/.env"
  "$ROOT/apps/web/.env.local"
)

for file in "${required_files[@]}"; do
  [ -f "$file" ] || {
    echo "ERROR: Falta $file"
    exit 1
  }
done

bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true

cd "$ROOT"
NX_DAEMON=false pnpm exec nx reset >/dev/null

mkdir -p "$PID_DIR" "$LOG_DIR"

for port in 3000 3001 3002 3003 4200; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: El puerto $port ya está ocupado."
    exit 1
  fi
done

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for _ in $(seq 1 120); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $name disponible."
      return 0
    fi
    sleep 1
  done

  echo "ERROR: $name no respondió."
  echo "Log: $log_file"
  tail -n 40 "$log_file" || true
  bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true
  exit 1
}

nohup env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx serve identity-service \
  > "$LOG_DIR/identity-service.log" 2>&1 &
echo $! > "$PID_DIR/identity-service.pid"

wait_for_url \
  "Identity Service" \
  "http://127.0.0.1:3001/api/v1/health" \
  "$LOG_DIR/identity-service.log"

nohup env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx serve projects-service \
  > "$LOG_DIR/projects-service.log" 2>&1 &
echo $! > "$PID_DIR/projects-service.pid"

wait_for_url \
  "Projects Service" \
  "http://127.0.0.1:3002/api/v1/health" \
  "$LOG_DIR/projects-service.log"

nohup env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx serve sources-service \
  > "$LOG_DIR/sources-service.log" 2>&1 &
echo $! > "$PID_DIR/sources-service.pid"

wait_for_url \
  "Sources Service" \
  "http://127.0.0.1:3003/api/v1/health" \
  "$LOG_DIR/sources-service.log"

nohup env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx serve gateway \
  > "$LOG_DIR/gateway.log" 2>&1 &
echo $! > "$PID_DIR/gateway.pid"

wait_for_url \
  "Gateway" \
  "http://127.0.0.1:3000/api/v1/health" \
  "$LOG_DIR/gateway.log"

nohup env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx dev web --port=4200 \
  > "$LOG_DIR/web.log" 2>&1 &
echo $! > "$PID_DIR/web.pid"

wait_for_url \
  "Frontend" \
  "http://127.0.0.1:4200/sign-in" \
  "$LOG_DIR/web.log"

echo
echo "Servicios ejecutándose:"
echo "  Acceso:    http://127.0.0.1:4200/sign-in"
echo "  Workspace: http://127.0.0.1:4200/workspace"
echo "  Gateway:   http://127.0.0.1:3000/api/v1/health"
echo "  Identity:  http://127.0.0.1:3001/api/v1/health"
echo "  Projects:  http://127.0.0.1:3002/api/v1/health"
echo "  Sources:   http://127.0.0.1:3003/api/v1/health"
echo
echo "Detener:"
echo "  pnpm auth:local:down"
