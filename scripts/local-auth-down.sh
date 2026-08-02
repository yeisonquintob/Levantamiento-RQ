#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/tmp/local-auth"

for port in 4200 3000 3001; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs kill >/dev/null 2>&1 || true
  fi
done

sleep 1

for port in 4200 3000 3001; do
  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [ -n "$pids" ]; then
    printf '%s\n' "$pids" | xargs kill -9 >/dev/null 2>&1 || true
  fi
done

rm -rf "$PID_DIR"
echo "✓ Identity Service, Gateway y frontend detenidos."
