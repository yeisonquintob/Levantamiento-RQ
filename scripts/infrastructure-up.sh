#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/infrastructure/docker"
COMPOSE_FILE="$COMPOSE_DIR/compose.yaml"
ENV_FILE="$COMPOSE_DIR/.env"

compose() {
  docker compose \
    --project-directory "$COMPOSE_DIR" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

wait_for_health() {
  local service="$1"
  local timeout_seconds="${2:-120}"
  local elapsed=0
  local container_id=""
  local status=""

  while [ "$elapsed" -lt "$timeout_seconds" ]; do
    container_id="$(compose ps -q "$service")"

    if [ -n "$container_id" ]; then
      status="$(docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container_id" 2>/dev/null || true)"

      if [ "$status" = "healthy" ]; then
        echo "✓ $service saludable."
        return 0
      fi

      if [ "$status" = "unhealthy" ] || [ "$status" = "exited" ]; then
        echo "ERROR: $service quedó en estado $status."
        compose logs --tail=100 "$service" || true
        return 1
      fi
    fi

    sleep 3
    elapsed=$((elapsed + 3))
  done

  echo "ERROR: $service no quedó saludable en ${timeout_seconds}s."
  compose logs --tail=100 "$service" || true
  return 1
}

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: No existe $COMPOSE_FILE"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: No existe $ENV_FILE"
  echo "Ejecuta primero el script del Paso 4."
  exit 1
fi

if grep -q 'CHANGE_ME' "$ENV_FILE"; then
  echo "ERROR: El archivo .env conserva valores CHANGE_ME."
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker Desktop no está iniciado."
  exit 1
fi

compose config --quiet
compose up -d

wait_for_health redis
wait_for_health rabbitmq
wait_for_health azurite

compose ps
