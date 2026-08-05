#!/usr/bin/env bash
set -euo pipefail

check() {
  local name="$1"
  local port="$2"
  local url="$3"

  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "✓ $name: activo en $port"
    else
      echo "! $name: puerto $port ocupado, pero no responde correctamente"
    fi
  else
    echo "- $name: detenido"
  fi
}

check "Identity Service" 3001 "http://127.0.0.1:3001/api/v1/health"
check "Projects Service" 3002 "http://127.0.0.1:3002/api/v1/health"
check "Sources Service" 3003 "http://127.0.0.1:3003/api/v1/health"
check "Documents Service" 3004 "http://127.0.0.1:3004/api/v1/health"
check "Gateway" 3000 "http://127.0.0.1:3000/api/v1/health"
check "Frontend" 4200 "http://127.0.0.1:4200/sign-in"
