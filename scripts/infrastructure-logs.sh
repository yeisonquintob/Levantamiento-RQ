#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_DIR="$PROJECT_ROOT/infrastructure/docker"
COMPOSE_FILE="$COMPOSE_DIR/compose.yaml"
ENV_FILE="$COMPOSE_DIR/.env"
SERVICE="${1:-}"

compose() {
  docker compose \
    --project-directory "$COMPOSE_DIR" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Falta compose.yaml o .env."
  exit 1
fi

if [ -z "$SERVICE" ]; then
  compose logs --follow --tail=100
  exit 0
fi

case "$SERVICE" in
  redis|rabbitmq|azurite)
    compose logs --follow --tail=100 "$SERVICE"
    ;;
  *)
    echo "ERROR: Servicio no válido: $SERVICE"
    echo "Valores: redis, rabbitmq, azurite"
    exit 1
    ;;
esac
