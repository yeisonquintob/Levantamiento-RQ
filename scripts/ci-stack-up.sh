#!/usr/bin/env bash
# Levanta el stack completo para integración y E2E en CI: infraestructura (Redis, RabbitMQ, Azurite),
# bases de datos con migraciones, usuario administrador de prueba y todos los servicios + web.
#
# Requisitos: SQL Server accesible, y las variables CI_SQL_PASSWORD, E2E_EMAIL y E2E_PASSWORD.
# Pensado para CI: no sobrescribe archivos .env existentes.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

: "${CI_SQL_PASSWORD:?CI_SQL_PASSWORD es obligatorio}"
: "${E2E_EMAIL:?E2E_EMAIL es obligatorio}"
: "${E2E_PASSWORD:?E2E_PASSWORD es obligatorio}"

LOG_DIR="$ROOT/logs/ci-stack"
mkdir -p "$LOG_DIR"

echo "==> Configuración local de CI"
node scripts/ci-prepare-env.mjs

echo "==> Infraestructura (Redis, RabbitMQ, Azurite)"
bash scripts/infrastructure-up.sh

echo "==> Esperando a SQL Server"
for attempt in $(seq 1 60); do
  if (exec 3<>"/dev/tcp/${CI_SQL_HOST:-127.0.0.1}/${CI_SQL_PORT:-1433}") 2>/dev/null; then break; fi
  [ "$attempt" -lt 60 ] || { echo "ERROR: SQL Server no responde."; exit 1; }
  sleep 2
done

echo "==> Bases de datos y migraciones"
# La creación de bases exige autorización explícita por servicio; solo se concede aquí (BD efímera de CI).
export IDENTITY_CREATE_DATABASE=true PROJECTS_CREATE_DATABASE=true SOURCES_CREATE_DATABASE=true \
  DOCUMENTS_CREATE_DATABASE=true OPERATIONS_CREATE_DATABASE=true PROTOTYPES_CREATE_DATABASE=true
for service in identity projects sources documents ai workflow operations; do
  echo "  - $service"
  pnpm "$service:db:ensure" > "$LOG_DIR/$service-ensure.log" 2>&1 \
    || { tail -n 40 "$LOG_DIR/$service-ensure.log"; exit 1; }
  pnpm "$service:migration:run" > "$LOG_DIR/$service-migrations.log" 2>&1 \
    || { tail -n 40 "$LOG_DIR/$service-migrations.log"; exit 1; }
done

echo "==> Usuario administrador de prueba"
IDENTITY_ADMIN_EMAIL="$E2E_EMAIL" \
IDENTITY_ADMIN_NAME="Administrador E2E" \
IDENTITY_ADMIN_PASSWORD="$E2E_PASSWORD" \
  pnpm identity:bootstrap-admin > "$LOG_DIR/identity-bootstrap.log" 2>&1 \
  || { tail -n 40 "$LOG_DIR/identity-bootstrap.log"; exit 1; }

echo "==> Servicios y frontend"
bash scripts/local-auth-up.sh
