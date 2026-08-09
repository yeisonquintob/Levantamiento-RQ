#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"
INFRA_ENV="$ROOT/infrastructure/docker/.env"

case "$COMMAND" in
  ensure|state|verify|migration-run|migration-revert|smoke|artifacts-smoke|gateway-e2e|notifications-e2e) ;;
  *)
    echo "Uso: $0 <ensure|state|verify|migration-run|migration-revert|smoke|artifacts-smoke|gateway-e2e|notifications-e2e>"
    exit 2
    ;;
esac

if [ -f "$ROOT/apps/operations-service/.env" ]; then
  ENVIRONMENT_FILE="$ROOT/apps/operations-service/.env"
  USE_SHARED_CREDENTIALS=false
elif [ -f "$ROOT/apps/documents-service/.env" ]; then
  ENVIRONMENT_FILE="$ROOT/apps/documents-service/.env"
  USE_SHARED_CREDENTIALS=true
else
  echo "ERROR: No existe configuración SQL local para Operations."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENVIRONMENT_FILE"
set +a

if [ -f "$INFRA_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$INFRA_ENV"
  set +a
  export REDIS_PORT="${RQ_REDIS_PORT:-6381}"
  export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT_NAME};AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${RQ_AZURITE_BLOB_PORT}/devstoreaccount1;QueueEndpoint=http://127.0.0.1:${RQ_AZURITE_QUEUE_PORT}/devstoreaccount1;TableEndpoint=http://127.0.0.1:${RQ_AZURITE_TABLE_PORT}/devstoreaccount1;"
fi

if [ "$USE_SHARED_CREDENTIALS" = true ]; then
  export DATABASE_ENABLED=true
  export DB_NAME=RqOperationsDb
fi

case "$COMMAND" in
  ensure) SCRIPT="$ROOT/scripts/operations-ensure-database.ts" ;;
  state) SCRIPT="$ROOT/scripts/operations-database-state.ts" ;;
  verify) SCRIPT="$ROOT/scripts/operations-verify-database.ts" ;;
  migration-run) SCRIPT="$ROOT/scripts/operations-run-migrations.ts" ;;
  migration-revert) SCRIPT="$ROOT/scripts/operations-revert-migration.ts" ;;
  smoke) SCRIPT="$ROOT/scripts/operations-export-requests-smoke.ts" ;;
  artifacts-smoke) SCRIPT="$ROOT/scripts/operations-export-artifacts-smoke.ts" ;;
  gateway-e2e) SCRIPT="$ROOT/scripts/operations-gateway-e2e.ts" ;;
  notifications-e2e) SCRIPT="$ROOT/scripts/operations-notifications-gateway-e2e.ts" ;;
esac

cd "$ROOT"
export TSX_TSCONFIG_PATH=apps/operations-service/tsconfig.app.json
exec node --import tsx "$SCRIPT"
