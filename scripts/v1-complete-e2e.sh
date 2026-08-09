#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INFRA_ENV="$ROOT/infrastructure/docker/.env"

if [ ! -f "$INFRA_ENV" ]; then
  echo "ERROR: No existe $INFRA_ENV"
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$INFRA_ENV"
set +a

export REDIS_PORT="${RQ_REDIS_PORT:-6381}"
export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT_NAME};AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${RQ_AZURITE_BLOB_PORT}/devstoreaccount1;QueueEndpoint=http://127.0.0.1:${RQ_AZURITE_QUEUE_PORT}/devstoreaccount1;TableEndpoint=http://127.0.0.1:${RQ_AZURITE_TABLE_PORT}/devstoreaccount1;"
export TSX_TSCONFIG_PATH=apps/operations-service/tsconfig.app.json

cd "$ROOT"
exec node --import tsx scripts/v1-complete-e2e.ts
