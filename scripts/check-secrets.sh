#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PATTERN='(sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|AccountKey=[A-Za-z0-9+/=]{20,}|(PASSWORD|SECRET|API_KEY|TOKEN)[[:space:]]*=[[:space:]]*[^$<[:space:]]{12,})'

matches="$(
  git grep -n -I -E "$PATTERN" -- \
    ':!pnpm-lock.yaml' \
    ':!docs/**' \
    ':!tests/**' \
    ':!**/*.example' \
    ':!scripts/check-secrets.sh' || true
)"

if [ -n "$matches" ]; then
  echo "ERROR: se detectaron posibles secretos en archivos versionados:"
  printf '%s\n' "$matches"
  exit 1
fi

if git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$' >/dev/null; then
  echo "ERROR: existe un archivo .env real versionado."
  git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.example$'
  exit 1
fi

echo "✓ No se detectaron secretos ni archivos .env reales versionados."
