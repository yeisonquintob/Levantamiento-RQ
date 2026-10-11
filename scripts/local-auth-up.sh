#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/tmp/local-auth"
LOG_DIR="$ROOT/logs/local-auth"
INFRA_ENV="$ROOT/infrastructure/docker/.env"

mkdir -p "$PID_DIR" "$LOG_DIR"

JWT_KEYS_ENV="$PID_DIR/jwt-keys.env"
JWT_KEY_ARGS=("$JWT_KEYS_ENV")

if [ "${1:-}" = "--rotate" ]; then
  JWT_KEY_ARGS+=("--rotate")
elif [ "$#" -gt 0 ]; then
  echo "Uso: bash scripts/local-auth-up.sh [--rotate]"
  exit 2
fi

node "$ROOT/scripts/generate-local-jwt-keys.mjs" "${JWT_KEY_ARGS[@]}"
source "$JWT_KEYS_ENV"
export JWT_ACCESS_PUBLIC_JWKS_BASE64

set -a
source "$INFRA_ENV"
set +a
export REDIS_PORT="${RQ_REDIS_PORT:-6381}"
export AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=${AZURITE_ACCOUNT_NAME};AccountKey=${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:${RQ_AZURITE_BLOB_PORT}/devstoreaccount1;QueueEndpoint=http://127.0.0.1:${RQ_AZURITE_QUEUE_PORT}/devstoreaccount1;TableEndpoint=http://127.0.0.1:${RQ_AZURITE_TABLE_PORT}/devstoreaccount1;"
RABBITMQ_URL="$(node -e 'const u=encodeURIComponent(process.env.RABBITMQ_DEFAULT_USER);const p=encodeURIComponent(process.env.RABBITMQ_DEFAULT_PASS);const port=process.env.RQ_RABBITMQ_AMQP_PORT||"5673";process.stdout.write(`amqp://${u}:${p}@127.0.0.1:${port}`)')"
export RABBITMQ_ENABLED=true RABBITMQ_URL
export RABBITMQ_EXCHANGE="${RABBITMQ_EXCHANGE:-rq.integration.v1}"

is_private_ipv4() {
  local ip="${1:-}"
  local second=""

  [[ "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1

  case "$ip" in
    10.*|192.168.*) return 0 ;;
    172.*)
      second="${ip#172.}"
      second="${second%%.*}"
      [ "$second" -ge 16 ] 2>/dev/null && [ "$second" -le 31 ] 2>/dev/null
      return
      ;;
    *) return 1 ;;
  esac
}

detect_lan_ips() {
  local interface=""
  local ip=""
  local candidates=""

  if command -v route >/dev/null 2>&1; then
    interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
  fi

  if [ -n "$interface" ] && command -v ipconfig >/dev/null 2>&1; then
    ip="$(ipconfig getifaddr "$interface" 2>/dev/null || true)"
    if is_private_ipv4 "$ip"; then
      candidates="${candidates}${ip}"$'\n'
    fi
  fi

  if command -v ifconfig >/dev/null 2>&1; then
    while IFS= read -r ip; do
      if is_private_ipv4 "$ip"; then
        candidates="${candidates}${ip}"$'\n'
      fi
    done < <(ifconfig 2>/dev/null | awk '/inet /{print $2}')
  fi

  while IFS= read -r ip; do
    if is_private_ipv4 "$ip"; then
      candidates="${candidates}${ip}"$'\n'
    fi
  done < <(node -e '
const os = require("node:os");
const interfaces = os.networkInterfaces();
for (const name of Object.keys(interfaces)) {
  for (const info of interfaces[name] || []) {
    if (info.family === "IPv4" || info.family === 4) {
      console.log(info.address);
    }
  }
}
' 2>/dev/null)

  printf '%s' "$candidates" | awk 'NF && !seen[$0]++'
}

LAN_IPS="$(detect_lan_ips || true)"
WEB_ORIGINS_RUNTIME="http://127.0.0.1:4200,http://localhost:4200"
RQ_ALLOWED_DEV_ORIGINS_RUNTIME="127.0.0.1,localhost"

if [ -n "$LAN_IPS" ]; then
  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    WEB_ORIGINS_RUNTIME="${WEB_ORIGINS_RUNTIME},http://${ip}:4200"
    RQ_ALLOWED_DEV_ORIGINS_RUNTIME="${RQ_ALLOWED_DEV_ORIGINS_RUNTIME},${ip}"
  done <<< "$LAN_IPS"
fi

required_files=(
  "$ROOT/apps/identity-service/.env"
  "$ROOT/apps/projects-service/.env"
  "$ROOT/apps/sources-service/.env"
  "$ROOT/apps/documents-service/.env"
  "$ROOT/apps/ai-analysis-service/.env"
  "$ROOT/apps/gateway/.env"
  "$ROOT/apps/web/.env.local"
)

for file in "${required_files[@]}"; do
  [ -f "$file" ] || {
    echo "ERROR: Falta $file"
    exit 1
  }
done

bash "$ROOT/scripts/infrastructure-up.sh"
echo "✓ Redis, RabbitMQ y Azurite disponibles."

bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true

cd "$ROOT"
mkdir -p "$PID_DIR" "$LOG_DIR"

# Mantiene disponible el catálogo completo de estados del flujo antes de
# iniciar Projects Service. TypeORM aplica únicamente migraciones pendientes.
pnpm projects:migration:run > "$LOG_DIR/projects-migrations.log" 2>&1
echo "✓ Migraciones de estados de proyectos verificadas."

# RQ_PROTOTYPES_LOCAL_V1_START
bash -lc   "set -euo pipefail; set -a; source '$ROOT/apps/documents-service/.env'; set +a;    export DATABASE_ENABLED=true DB_NAME=RqPrototypesDb PROTOTYPES_CREATE_DATABASE=true    TSX_TSCONFIG_PATH=apps/prototypes-service/tsconfig.app.json;    node --import tsx '$ROOT/scripts/prototypes-ensure-database.ts';    node --import tsx '$ROOT/scripts/prototypes-run-migrations.ts'"
echo "✓ RqPrototypesDb y migraciones verificadas."
# RQ_PROTOTYPES_LOCAL_V1_END

for port in 3000 3001 3002 3003 3004 3005 3007 3008 3009 4200; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: El puerto $port ya está ocupado."
    exit 1
  fi
done

env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx run-many \
    --target=build \
    --projects=identity-service,projects-service,sources-service,documents-service,ai-analysis-service,workflow-service,operations-service,prototypes-service,gateway \
    --configuration=development \
    --skip-nx-cache \
  > "$LOG_DIR/local-services-build.log" 2>&1

echo "✓ Servicios locales compilados."

wait_for_url() {
  local name="$1"
  local url="$2"
  local log_file="$3"

  for _ in $(seq 1 120); do
    if curl --max-time 3 -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $name disponible."
      return 0
    fi

    sleep 1
  done

  echo "ERROR: $name no respondió."
  echo "Log: $log_file"
  tail -n 60 "$log_file" || true
  bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true
  exit 1
}

start_detached() {
  local pid_file="$1"
  local log_file="$2"
  shift 2

  node "$ROOT/scripts/start-detached-process.mjs" "$log_file" "$@" \
    > "$pid_file"
}

NODE_ENV=development \
JWT_ACCESS_KEY_ID="$LOCAL_IDENTITY_JWT_KEY_ID" \
JWT_ACCESS_PRIVATE_JWK_BASE64="$LOCAL_IDENTITY_JWT_PRIVATE_JWK_BASE64" \
start_detached \
  "$PID_DIR/identity-service.pid" \
  "$LOG_DIR/identity-service.log" \
  node "$ROOT/apps/identity-service/dist/main.js"

wait_for_url \
  "Identity Service" \
  "http://127.0.0.1:3001/api/v1/health" \
  "$LOG_DIR/identity-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/projects-service.pid" \
  "$LOG_DIR/projects-service.log" \
  node "$ROOT/apps/projects-service/dist/main.js"

wait_for_url \
  "Projects Service" \
  "http://127.0.0.1:3002/api/v1/health" \
  "$LOG_DIR/projects-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/sources-service.pid" \
  "$LOG_DIR/sources-service.log" \
  node "$ROOT/apps/sources-service/dist/main.js"

wait_for_url \
  "Sources Service" \
  "http://127.0.0.1:3003/api/v1/health" \
  "$LOG_DIR/sources-service.log"

NODE_ENV=development start_detached \
  "$PID_DIR/documents-service.pid" \
  "$LOG_DIR/documents-service.log" \
  node "$ROOT/apps/documents-service/dist/main.js"

wait_for_url \
  "Documents Service" \
  "http://127.0.0.1:3004/api/v1/health" \
  "$LOG_DIR/documents-service.log"

NODE_ENV=development \
WORKLOAD_JWT_KEY_ID="$LOCAL_AI_WORKLOAD_JWT_KEY_ID" \
WORKLOAD_JWT_PRIVATE_JWK_BASE64="$LOCAL_AI_WORKLOAD_JWT_PRIVATE_JWK_BASE64" \
start_detached \
  "$PID_DIR/ai-analysis-service.pid" \
  "$LOG_DIR/ai-analysis-service.log" \
  node "$ROOT/apps/ai-analysis-service/dist/main.js"

wait_for_url \
  "AI Analysis Service" \
  "http://127.0.0.1:3005/api/v1/health" \
  "$LOG_DIR/ai-analysis-service.log"

start_detached \
  "$PID_DIR/workflow-service.pid" \
  "$LOG_DIR/workflow-service.log" \
  bash -lc \
  "set -a; source '$ROOT/apps/documents-service/.env'; set +a; export SERVICE_NAME=workflow-service PORT=3007 DB_NAME=RqWorkflowDb DATABASE_ENABLED=true NODE_ENV=development; exec node '$ROOT/apps/workflow-service/dist/main.js'"

wait_for_url \
  "Workflow Service" \
  "http://127.0.0.1:3007/api/v1/health" \
  "$LOG_DIR/workflow-service.log"

start_detached \
  "$PID_DIR/operations-service.pid" \
  "$LOG_DIR/operations-service.log" \
  bash -lc \
  "set -a; source '$ROOT/apps/documents-service/.env'; source '$ROOT/infrastructure/docker/.env'; set +a; export WORKLOAD_JWT_KEY_ID='$LOCAL_OPERATIONS_WORKLOAD_JWT_KEY_ID' WORKLOAD_JWT_PRIVATE_JWK_BASE64='$LOCAL_OPERATIONS_WORKLOAD_JWT_PRIVATE_JWK_BASE64' SERVICE_NAME=operations-service PORT=3008 DB_NAME=RqOperationsDb DATABASE_ENABLED=true NODE_ENV=development REDIS_PORT=\"\${RQ_REDIS_PORT:-6381}\" AZURE_STORAGE_CONNECTION_STRING=\"DefaultEndpointsProtocol=http;AccountName=\${AZURITE_ACCOUNT_NAME};AccountKey=\${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:\${RQ_AZURITE_BLOB_PORT}/devstoreaccount1;QueueEndpoint=http://127.0.0.1:\${RQ_AZURITE_QUEUE_PORT}/devstoreaccount1;TableEndpoint=http://127.0.0.1:\${RQ_AZURITE_TABLE_PORT}/devstoreaccount1;\"; exec node '$ROOT/apps/operations-service/dist/main.js'"

wait_for_url \
  "Operations Service" \
  "http://127.0.0.1:3008/api/v1/health" \
  "$LOG_DIR/operations-service.log"

start_detached \
  "$PID_DIR/prototypes-service.pid" \
  "$LOG_DIR/prototypes-service.log" \
  bash -lc \
  "set -a; source '$ROOT/apps/documents-service/.env'; source '$ROOT/infrastructure/docker/.env'; set +a; \
   export WORKLOAD_JWT_KEY_ID='$LOCAL_PROTOTYPES_WORKLOAD_JWT_KEY_ID' \
   WORKLOAD_JWT_PRIVATE_JWK_BASE64='$LOCAL_PROTOTYPES_WORKLOAD_JWT_PRIVATE_JWK_BASE64' \
   SERVICE_NAME=prototypes-service PORT=3009 DB_NAME=RqPrototypesDb DATABASE_ENABLED=true \
   NODE_ENV=development AI_ANALYSIS_SERVICE_URL=http://127.0.0.1:3005 \
   PROTOTYPE_REDIS_HOST=127.0.0.1 PROTOTYPE_REDIS_PORT=\"\${RQ_REDIS_PORT:-6381}\" \
   AZURE_STORAGE_CONNECTION_STRING=\"DefaultEndpointsProtocol=http;AccountName=\${AZURITE_ACCOUNT_NAME};AccountKey=\${AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:\${RQ_AZURITE_BLOB_PORT}/devstoreaccount1;QueueEndpoint=http://127.0.0.1:\${RQ_AZURITE_QUEUE_PORT}/devstoreaccount1;TableEndpoint=http://127.0.0.1:\${RQ_AZURITE_TABLE_PORT}/devstoreaccount1;\"; \
   exec node '$ROOT/apps/prototypes-service/dist/main.js'"

wait_for_url \
  "Prototypes Service" \
  "http://127.0.0.1:3009/api/v1/health" \
  "$LOG_DIR/prototypes-service.log"

start_detached \
  "$PID_DIR/gateway.pid" \
  "$LOG_DIR/gateway.log" \
  env \
  NODE_ENV=development \
  HOST=0.0.0.0 \
  WEB_ORIGINS="$WEB_ORIGINS_RUNTIME" \
  node "$ROOT/apps/gateway/dist/main.js"

wait_for_url \
  "Gateway" \
  "http://127.0.0.1:3000/api/v1/health" \
  "$LOG_DIR/gateway.log"

env \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  pnpm exec nx build shared-ui --skip-nx-cache \
  > "$LOG_DIR/shared-ui-build.log" 2>&1

echo "✓ Shared UI preparada."

env \
  RQ_ALLOWED_DEV_ORIGINS="$RQ_ALLOWED_DEV_ORIGINS_RUNTIME" \
  NX_DAEMON=false \
  NX_INTERACTIVE=false \
  NX_TASKS_RUNNER_DYNAMIC_OUTPUT=false \
  node "$ROOT/scripts/start-detached-process.mjs" \
    "$LOG_DIR/web.log" \
    pnpm exec nx dev web --port=4200 --skip-nx-cache \
  > "$PID_DIR/web.pid"

wait_for_url \
  "Frontend" \
  "http://127.0.0.1:4200/sign-in" \
  "$LOG_DIR/web.log"

echo
echo "Servicios ejecutándose:"
echo "  Acceso local:    http://127.0.0.1:4200/sign-in"
echo "  Workspace local: http://127.0.0.1:4200/workspace"
echo "  Gateway local:   http://127.0.0.1:3000/api/v1/health"
if [ -n "$LAN_IPS" ]; then
  while IFS= read -r ip; do
    [ -n "$ip" ] || continue
    echo "  Acceso LAN:      http://${ip}:4200/sign-in"
    echo "  Workspace LAN:   http://${ip}:4200/workspace"
    echo "  Gateway LAN:     http://${ip}:3000/api/v1/health"
  done <<< "$LAN_IPS"
else
  echo "  LAN:             no se detectó IPv4 privada; localhost sigue disponible."
fi
echo "  Identity:    http://127.0.0.1:3001/api/v1/health"
echo "  Projects:    http://127.0.0.1:3002/api/v1/health"
echo "  Sources:     http://127.0.0.1:3003/api/v1/health"
echo "  Documents:   http://127.0.0.1:3004/api/v1/health"
echo "  AI Analysis: http://127.0.0.1:3005/api/v1/health"
echo "  Workflow:    http://127.0.0.1:3007/api/v1/health"
echo "  Operations:  http://127.0.0.1:3008/api/v1/health"
echo "  Prototypes:  http://127.0.0.1:3009/api/v1/health"
echo
echo "Detener:"
echo "  pnpm auth:local:down"
