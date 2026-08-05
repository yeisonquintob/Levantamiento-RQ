#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cleanup() {
  bash "$ROOT/scripts/local-auth-down.sh" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

bash "$ROOT/scripts/local-auth-up.sh"

cd "$ROOT"
pnpm documents:domain:smoke
pnpm documents:domain:smoke
