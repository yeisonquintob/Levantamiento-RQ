#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/tmp/local-auth"
LOG_DIR="$ROOT/logs/local-auth"

mkdir -p "$PID_DIR" "$LOG_DIR"

required_files=(
  "$ROOT/apps/identity-service/.env"
  "$ROOT/apps/gateway/.env"
  "$ROOT/apps/web/.env.local"
)

for file in "${required_files[@]}"; do
  [ -f "$file" ] || {
    echo "ERROR: Falta $file"
    exit 1
  }
done

for port in 3000 3001 4200; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: El puerto $port ya está ocupado."
    exit 1
  fi
done

cd "$ROOT"

nohup env NX_DAEMON=false NX_INTERACTIVE=false \
  pnpm exec nx serve identity-service \
  > "$LOG_DIR/identity-service.log" 2>&1 &
echo $! > "$PID_DIR/identity-service.pid"

nohup env NX_DAEMON=false NX_INTERACTIVE=false \
  pnpm exec nx serve gateway \
  > "$LOG_DIR/gateway.log" 2>&1 &
echo $! > "$PID_DIR/gateway.pid"

nohup env NX_DAEMON=false NX_INTERACTIVE=false \
  pnpm exec nx dev web --port=4200 \
  > "$LOG_DIR/web.log" 2>&1 &
echo $! > "$PID_DIR/web.pid"

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for _ in $(seq 1 90); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $name disponible."
      return 0
    fi
    sleep 1
  done

  echo "ERROR: $name no respondió."
  echo "Log: $log_file"
  tail -n 30 "$log_file" || true
  bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true
  exit 1
}

wait_for_url \
  "Identity Service" \
  "http://127.0.0.1:3001/api/v1/health" \
  "$LOG_DIR/identity-service.log"

wait_for_url \
  "Gateway" \
  "http://127.0.0.1:3000/api/v1/health" \
  "$LOG_DIR/gateway.log"

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
echo
echo "Detener:"
echo "  pnpm auth:local:down"
