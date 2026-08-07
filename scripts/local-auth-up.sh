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
  "$ROOT/apps/documents-service/.env"
  "$ROOT/apps/ai-analysis-service/.env"
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
mkdir -p "$PID_DIR" "$LOG_DIR"

for port in 3000 3001 3002 3003 3004 3005 4200; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: El puerto $port ya está ocupado."
    exit 1
  fi
done

env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx run-many \
    --target=build \
    --projects=identity-service,projects-service,sources-service,documents-service,ai-analysis-service,gateway \
    --configuration=development \
    --skip-nx-cache \
  > "$LOG_DIR/local-services-build.log" 2>&1

echo "✓ Servicios locales compilados."

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for _ in $(seq 1 120); do
    if curl --max-time 3 -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $name disponible."
      return 0
    fi

    sleep 1
  done

  echo "ERROR: $name no respondió."
  echo "Log: $log_file"
  tail -n 60 "$log_file" || true
  bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true
  exit 1
}

start_detached() {
  local pid_file="$1"
  local log_file="$2"
  shift 2

  node "$ROOT/scripts/start-detached-process.mjs" "$log_file" "$@" \
    > "$pid_file"
}

NODE_ENV=development start_detached \
  "$PID_DIR/identity-service.pid" \
  "$LOG_DIR/identity-service.log" \
  node "$ROOT/apps/identity-service/dist/main.js"

wait_for_url \
  "Identity Service" \
  "http://127.0.0.1:3001/api/v1/health" \
  "$LOG_DIR/identity-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/projects-service.pid" \
  "$LOG_DIR/projects-service.log" \
  node "$ROOT/apps/projects-service/dist/main.js"

wait_for_url \
  "Projects Service" \
  "http://127.0.0.1:3002/api/v1/health" \
  "$LOG_DIR/projects-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/sources-service.pid" \
  "$LOG_DIR/sources-service.log" \
  node "$ROOT/apps/sources-service/dist/main.js"

wait_for_url \
  "Sources Service" \
  "http://127.0.0.1:3003/api/v1/health" \
  "$LOG_DIR/sources-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/documents-service.pid" \
  "$LOG_DIR/documents-service.log" \
  node "$ROOT/apps/documents-service/dist/main.js"

wait_for_url \
  "Documents Service" \
  "http://127.0.0.1:3004/api/v1/health" \
  "$LOG_DIR/documents-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/ai-analysis-service.pid" \
  "$LOG_DIR/ai-analysis-service.log" \
  node "$ROOT/apps/ai-analysis-service/dist/main.js"

wait_for_url \
  "AI Analysis Service" \
  "http://127.0.0.1:3005/api/v1/health" \
  "$LOG_DIR/ai-analysis-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/gateway.pid" \
  "$LOG_DIR/gateway.log" \
  node "$ROOT/apps/gateway/dist/main.js"

wait_for_url \
  "Gateway" \
  "http://127.0.0.1:3000/api/v1/health" \
  "$LOG_DIR/gateway.log"

env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx build shared-ui --skip-nx-cache \
  > "$LOG_DIR/shared-ui-build.log" 2>&1

echo "✓ Shared UI preparada."

env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  node "$ROOT/scripts/start-detached-process.mjs" \
    "$LOG_DIR/web.log" \
    pnpm exec nx dev web --port=4200 --skip-nx-cache \
  > "$PID_DIR/web.pid"

wait_for_url \
  "Frontend" \
  "http://127.0.0.1:4200/sign-in" \
  "$LOG_DIR/web.log"

echo
echo "Servicios ejecutándose:"
echo "  Acceso:      http://127.0.0.1:4200/sign-in"
echo "  Workspace:   http://127.0.0.1:4200/workspace"
echo "  Gateway:     http://127.0.0.1:3000/api/v1/health"
echo "  Identity:    http://127.0.0.1:3001/api/v1/health"
echo "  Projects:    http://127.0.0.1:3002/api/v1/health"
echo "  Sources:     http://127.0.0.1:3003/api/v1/health"
echo "  Documents:   http://127.0.0.1:3004/api/v1/health"
echo "  AI Analysis: http://127.0.0.1:3005/api/v1/health"
echo
echo "Detener:"
echo "  pnpm auth:local:down"
