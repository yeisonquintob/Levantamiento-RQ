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

read_env() {
  local key="$1"
  awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Falta compose.yaml o .env."
  exit 1
fi

compose ps

echo
echo "RabbitMQ Management: http://127.0.0.1:$(read_env RQ_RABBITMQ_MANAGEMENT_PORT)"
echo "Azurite Blob:        http://127.0.0.1:$(read_env RQ_AZURITE_BLOB_PORT)/devstoreaccount1"
echo "Redis:               127.0.0.1:$(read_env RQ_REDIS_PORT)"
