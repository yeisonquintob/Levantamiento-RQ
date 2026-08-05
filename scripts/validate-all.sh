#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

cleanup() {
  bash scripts/local-auth-down.sh >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

CI=1 pnpm install --frozen-lockfile
pnpm lint:all
pnpm typecheck:all
pnpm build:all
pnpm test:unit
pnpm test:structural
pnpm test:integration
pnpm identity:migration:run
pnpm identity:db:verify
pnpm sources:migration:run
pnpm sources:db:verify
pnpm sources:queue:verify
pnpm sources:storage:verify
pnpm test:smoke
git diff --check

for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008 4200; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ERROR: El puerto $port permanece ocupado."
    exit 1
  fi
done

echo "✓ Validación completa finalizada; servicios detenidos y puertos libres."
