#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$ROOT/tmp/swagger-validation"
LOG_DIR="$ROOT/logs/swagger-validation"

SERVICES=(
  "gateway:3000"
  "identity-service:3001"
  "projects-service:3002"
  "sources-service:3003"
  "documents-service:3004"
  "ai-analysis-service:3005"
  "erp-knowledge-service:3006"
  "workflow-service:3007"
  "operations-service:3008"
)

CURRENT_PID=""
CURRENT_PORT=""

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

stop_current() {
  local pids=""
  if [ -n "$CURRENT_PID" ]; then
    kill_tree "$CURRENT_PID"
  fi
  if [ -n "$CURRENT_PORT" ]; then
    pids="$(lsof -tiTCP:"$CURRENT_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      printf '%s\n' "$pids" | xargs kill >/dev/null 2>&1 || true
    fi
  fi
  sleep 1
  if [ -n "$CURRENT_PORT" ]; then
    pids="$(lsof -tiTCP:"$CURRENT_PORT" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      printf '%s\n' "$pids" | xargs kill -9 >/dev/null 2>&1 || true
    fi
  fi
  CURRENT_PID=""
  CURRENT_PORT=""
}

on_exit() {
  local exit_code=$?
  stop_current
  rm -rf "$TMP_DIR"
  exit "$exit_code"
}

trap on_exit EXIT INT TERM

mkdir -p "$TMP_DIR" "$LOG_DIR"
cd "$ROOT"

for entry in "${SERVICES[@]}"; do
  service="${entry%%:*}"
  port="${entry##*:}"
  log_file="$LOG_DIR/$service.log"
  json_file="$TMP_DIR/$service.json"
  CURRENT_PORT="$port"

  NX_DAEMON=false pnpm exec nx reset >/dev/null

  nohup env \
    NODE_ENV=development \
    NX_DAEMON=false \
    NX_INTERACTIVE=false \
    NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
    pnpm exec nx serve "$service" \
    > "$log_file" 2>&1 &

  CURRENT_PID=$!
  ready=0

  for _ in $(seq 1 120); do
    if curl -fsS "http://127.0.0.1:$port/api/docs-json" -o "$json_file" >/dev/null 2>&1; then
      ready=1
      break
    fi
    sleep 1
  done

  if [ "$ready" -ne 1 ]; then
    echo "ERROR: Swagger no respondió en $service."
    echo "Log: $log_file"
    tail -n 50 "$log_file" || true
    exit 1
  fi

  curl -fsS "http://127.0.0.1:$port/api/docs" >/dev/null

  swagger_assets=(
    "swagger-ui.css"
    "swagger-ui-bundle.js"
    "swagger-ui-standalone-preset.js"
    "swagger-ui-init.js"
    "favicon-32x32.png"
    "favicon-16x16.png"
  )

  for asset in "${swagger_assets[@]}"; do
    curl -fsS       "http://127.0.0.1:$port/api/docs/$asset"       >/dev/null
  done

  python3 - "$service" "$json_file" <<'PY_JSON'
from __future__ import annotations

import json
import sys
from pathlib import Path

service = sys.argv[1]
payload = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))

if not isinstance(payload.get("openapi"), str):
    raise SystemExit(f"{service}: falta versión OpenAPI.")
if not isinstance(payload.get("info"), dict) or not payload["info"].get("title"):
    raise SystemExit(f"{service}: falta título.")
paths = payload.get("paths")
if not isinstance(paths, dict) or "/api/v1/health" not in paths:
    raise SystemExit(f"{service}: falta /api/v1/health.")

if service in {"gateway", "identity-service"}:
    for route in (
        "/api/v1/auth/sign-in",
        "/api/v1/auth/refresh",
        "/api/v1/auth/sign-out",
        "/api/v1/auth/me",
    ):
        if route not in paths:
            raise SystemExit(f"{service}: falta {route}.")

if service in {"gateway", "projects-service"}:
    for route in (
        "/api/v1/projects",
        "/api/v1/projects/summary",
        "/api/v1/projects/{projectId}",
    ):
        if route not in paths:
            raise SystemExit(f"{service}: falta {route}.")

print(f"✓ {service}: OpenAPI, UI y recursos estáticos válidos.")
PY_JSON

  stop_current
done

echo
echo "✓ Swagger validado en los nueve servicios backend."
