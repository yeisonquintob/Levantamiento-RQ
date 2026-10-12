#!/usr/bin/env bash
# Comandos de base de datos de Prototypes con las mismas credenciales SQL que usa local-auth-up.sh
# (la base RqPrototypesDb comparte servidor con Documents).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMMAND="${1:-}"

case "$COMMAND" in
  ensure) SCRIPT="$ROOT/scripts/prototypes-ensure-database.ts" ;;
  migration-run) SCRIPT="$ROOT/scripts/prototypes-run-migrations.ts" ;;
  verify) SCRIPT="$ROOT/scripts/prototypes-verify-database.ts" ;;
  *)
    echo "Uso: $0 <ensure|migration-run|verify>"
    exit 2
    ;;
esac

ENVIRONMENT_FILE="$ROOT/apps/documents-service/.env"
[ -f "$ENVIRONMENT_FILE" ] || {
  echo "ERROR: Falta apps/documents-service/.env (credenciales SQL locales)."
  exit 1
}

set -a
# shellcheck disable=SC1090
source "$ENVIRONMENT_FILE"
set +a

export DATABASE_ENABLED=true DB_NAME=RqPrototypesDb
# La creación de la base exige autorización explícita (solo para el comando «ensure»).
[ "$COMMAND" = "ensure" ] && export PROTOTYPES_CREATE_DATABASE="${PROTOTYPES_CREATE_DATABASE:-false}"

cd "$ROOT"
export TSX_TSCONFIG_PATH=apps/prototypes-service/tsconfig.app.json
exec node --import tsx "$SCRIPT"
