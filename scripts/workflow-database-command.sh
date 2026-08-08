#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"

case "$COMMAND" in
  ensure|state|verify|migration-run|migration-revert) ;;
  *)
    echo "Uso: $0 <ensure|state|verify|migration-run|migration-revert>"
    exit 2
    ;;
esac

if [ -f "$ROOT/apps/workflow-service/.env" ]; then
  ENVIRONMENT_FILE="$ROOT/apps/workflow-service/.env"
  USE_DOCUMENTS_DATABASE_CREDENTIALS=false
elif [ -f "$ROOT/apps/documents-service/.env" ]; then
  ENVIRONMENT_FILE="$ROOT/apps/documents-service/.env"
  USE_DOCUMENTS_DATABASE_CREDENTIALS=true
else
  echo "ERROR: Falta apps/workflow-service/.env y no existe la configuración SQL local de Documents."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENVIRONMENT_FILE"
set +a

if [ "$USE_DOCUMENTS_DATABASE_CREDENTIALS" = true ]; then
  export DATABASE_ENABLED=true
  export DB_NAME=RqWorkflowDb
fi

case "$COMMAND" in
  ensure) SCRIPT="$ROOT/scripts/workflow-ensure-database.ts" ;;
  state) SCRIPT="$ROOT/scripts/workflow-database-state.ts" ;;
  verify) SCRIPT="$ROOT/scripts/workflow-verify-database.ts" ;;
  migration-run) SCRIPT="$ROOT/scripts/workflow-run-migrations.ts" ;;
  migration-revert) SCRIPT="$ROOT/scripts/workflow-revert-migration.ts" ;;
esac

cd "$ROOT"
export TSX_TSCONFIG_PATH=apps/workflow-service/tsconfig.app.json
exec node --import tsx "$SCRIPT"
