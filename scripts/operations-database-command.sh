#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"

case "$COMMAND" in
  ensure|state|verify|migration-run|migration-revert|smoke) ;;
  *)
    echo "Uso: $0 <ensure|state|verify|migration-run|migration-revert|smoke>"
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
esac

cd "$ROOT"
export TSX_TSCONFIG_PATH=apps/operations-service/tsconfig.app.json
exec node --import tsx "$SCRIPT"
