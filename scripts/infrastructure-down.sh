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

if [ ! -f "$COMPOSE_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: Falta compose.yaml o .env."
  exit 1
fi

case "${1:-}" in
  "")
    compose down
    ;;
  --volumes)
    compose down --volumes
    ;;
  *)
    echo "Uso: bash scripts/infrastructure-down.sh [--volumes]"
    exit 1
    ;;
esac
