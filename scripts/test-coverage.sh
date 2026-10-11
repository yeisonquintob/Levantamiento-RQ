#!/usr/bin/env bash
# Cobertura de las pruebas unitarias por servicio, con umbrales mínimos de líneas.
# Los umbrales son modestos (por debajo de la cobertura actual): sirven para que no baje.
# Súbelos cuando la cobertura mejore. Uso: pnpm test:coverage [servicio...]
set -uo pipefail
cd "$(dirname "$0")/.."

# nombre|tsconfig|include|umbral de líneas|pruebas...
SUITES=(
  "identity|apps/identity-service/tsconfig.app.json|apps/identity-service/src/**/*.ts|70|tests/identity/*.test.ts"
  "projects|apps/projects-service/tsconfig.app.json|apps/projects-service/src/**/*.ts|80|tests/projects/projects-foundation.test.ts"
  "sources|apps/sources-service/tsconfig.app.json|apps/sources-service/src/**/*.ts|65|tests/sources/sources-foundation.test.ts"
  "workflow|apps/workflow-service/tsconfig.app.json|apps/workflow-service/src/**/*.ts|75|tests/workflow/*.test.ts"
  "operations|apps/operations-service/tsconfig.app.json|apps/operations-service/src/**/*.ts|80|tests/operations/*.test.ts"
  "prototypes|apps/prototypes-service/tsconfig.app.json|apps/prototypes-service/src/**/*.ts|85|tests/prototypes/*.test.ts"
  "ai-analysis|apps/ai-analysis-service/tsconfig.app.json|apps/ai-analysis-service/src/**/*.ts|80|tests/ai-analysis/*.test.ts"
)

selected=("$@")
failed=0
for suite in "${SUITES[@]}"; do
  IFS='|' read -r name tsconfig include threshold tests <<<"$suite"
  if [ ${#selected[@]} -gt 0 ] && [[ ! " ${selected[*]} " =~ " $name " ]]; then continue; fi
  echo "==> $name (líneas ≥ ${threshold}%)"
  # shellcheck disable=SC2086
  TSX_TSCONFIG_PATH="$tsconfig" node --import tsx --test \
    --experimental-test-coverage \
    --test-coverage-include="$include" \
    --test-coverage-exclude='**/*.test.ts' \
    --test-coverage-exclude='**/migrations/**' \
    --test-coverage-lines="$threshold" \
    $tests 2>&1 | grep -E "all files|✖|^ℹ (fail|pass)|Error|threshold" 
  if [ "${PIPESTATUS[0]}" -ne 0 ]; then
    echo "!! $name: pruebas fallidas o cobertura por debajo del umbral"
    failed=1
  fi
done
exit "$failed"
