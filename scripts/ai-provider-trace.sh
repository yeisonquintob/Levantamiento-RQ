#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MARKER="$ROOT/tmp/ai-provider-trace.enabled"
LOG_DIR="$ROOT/logs/ai-provider-trace"

COMMAND="${1:-status}"

case "$COMMAND" in
  on)
    mkdir -p "$ROOT/tmp" "$LOG_DIR"
    : > "$MARKER"
    chmod 600 "$MARKER"

    echo "✓ TRACE IA ACTIVADO"
    echo "Las próximas ejecuciones guardarán únicamente metadatos operativos saneados:"
    echo "  proveedor, modelo, fase, estado, duración, conteos y códigos de error."
    echo "Nunca se guardan prompts, fuentes, documentos, imágenes, respuestas o secretos."
    echo "Directorio:"
    echo "$LOG_DIR"
    ;;

  off)
    rm -f "$MARKER"

    echo "✓ TRACE IA DESACTIVADO"
    echo "Las próximas llamadas no generarán archivos de trace."
    ;;

  status)
    if [ -f "$MARKER" ]; then
      echo "TRACE IA: ACTIVADO"
    else
      echo "TRACE IA: DESACTIVADO"
    fi

    echo "Directorio:"
    echo "$LOG_DIR"
    if [ -d "$LOG_DIR" ]; then
      echo "Archivos actuales: $(find "$LOG_DIR" -maxdepth 1 -type f -name '*.json' | wc -l | tr -d ' ')"
    fi
    ;;

  list)
    if [ ! -d "$LOG_DIR" ]; then
      echo "No existen traces todavía."
      exit 0
    fi

    PROVIDER="${2:-ALL}"
    PROVIDER="$(printf '%s' "$PROVIDER" | tr '[:lower:]' '[:upper:]')"
    case "$PROVIDER" in
      ALL)
        find "$LOG_DIR" -maxdepth 1 -type f -name '*.json' \
          -exec ls -lht {} + 2>/dev/null || true
        ;;
      OLLAMA|OPENAI|LOCAL_PIPELINE)
        find "$LOG_DIR" -maxdepth 1 -type f -name "*_${PROVIDER}_*.json" \
          -exec ls -lht {} + 2>/dev/null || true
        ;;
      *)
        echo "Proveedor inválido: $PROVIDER"
        echo "Usa ALL, OLLAMA, LOCAL_PIPELINE u OPENAI."
        exit 1
        ;;
    esac
    ;;

  latest)
    PROVIDER="${2:-ALL}"
    PROVIDER="$(printf '%s' "$PROVIDER" | tr '[:lower:]' '[:upper:]')"
    case "$PROVIDER" in
      ALL) PATTERN='*.json' ;;
      OLLAMA|OPENAI|LOCAL_PIPELINE) PATTERN="*_${PROVIDER}_*.json" ;;
      *)
        echo "Proveedor inválido: $PROVIDER"
        echo "Usa ALL, OLLAMA, LOCAL_PIPELINE u OPENAI."
        exit 1
        ;;
    esac
    FILE="$(find "$LOG_DIR" -maxdepth 1 -type f -name "$PATTERN" -print 2>/dev/null | sort | tail -n 1)"
    if [ -z "$FILE" ]; then
      echo "No existen traces para $PROVIDER todavía."
      exit 0
    fi
    echo "$FILE"
    if command -v jq >/dev/null 2>&1; then
      jq . "$FILE"
    else
      sed -n '1,260p' "$FILE"
    fi
    ;;

  clear)
    mkdir -p "$LOG_DIR"
    find "$LOG_DIR" -type f -name '*.json' -delete
    echo "✓ Traces eliminados."
    ;;

  *)
    echo "Uso:"
    echo "  ./scripts/ai-provider-trace.sh on"
    echo "  ./scripts/ai-provider-trace.sh off"
    echo "  ./scripts/ai-provider-trace.sh status"
    echo "  ./scripts/ai-provider-trace.sh list [all|ollama|local_pipeline|openai]"
    echo "  ./scripts/ai-provider-trace.sh latest [all|ollama|local_pipeline|openai]"
    echo "  ./scripts/ai-provider-trace.sh clear"
    exit 1
    ;;
esac
