#!/bin/bash

set -euo pipefail

PROJECT_ROOT="/Users/luu/Desktop/Proyecto_Navi/Projects/Levantamiento-RQ"
INSTALLED_SCRIPT="$PROJECT_ROOT/scripts/exportar_codigo_completo_txt.sh"
STAMP="$(date +%Y%m%d_%H%M%S)"

current_script_path() {
  local directory
  directory="$(cd "$(dirname "$0")" && pwd)"
  printf '%s/%s\n' "$directory" "$(basename "$0")"
}

CURRENT_SCRIPT="$(current_script_path)"

if [ ! -d "$PROJECT_ROOT/.git" ]; then
  echo "ERROR: No se encontró el repositorio:"
  echo "$PROJECT_ROOT"
  exit 1
fi

# La primera ejecución desde Descargas instala una copia permanente dentro
# del proyecto. Las siguientes exportaciones se realizan desde scripts/.
if [ "$CURRENT_SCRIPT" != "$INSTALLED_SCRIPT" ]; then
  mkdir -p "$(dirname "$INSTALLED_SCRIPT")"

  if [ -f "$INSTALLED_SCRIPT" ] && ! cmp -s "$CURRENT_SCRIPT" "$INSTALLED_SCRIPT"; then
    BACKUP_DIR="$PROJECT_ROOT/local-backups/exportador-codigo"
    mkdir -p "$BACKUP_DIR"
    cp "$INSTALLED_SCRIPT" \
      "$BACKUP_DIR/exportar_codigo_completo_txt_${STAMP}.sh"
  fi

  cp "$CURRENT_SCRIPT" "$INSTALLED_SCRIPT"
  chmod +x "$INSTALLED_SCRIPT"

  echo "✓ Exportador instalado dentro del proyecto:"
  echo "$INSTALLED_SCRIPT"
  echo

  exec "$INSTALLED_SCRIPT" --installed
fi

EXPORT_DIR="$PROJECT_ROOT/export_codigo"
OUT_FILE="$EXPORT_DIR/PROYECTO_CODIGO_COMPLETO_${STAMP}.txt"
LATEST_LINK="$EXPORT_DIR/PROYECTO_CODIGO_COMPLETO_ULTIMO.txt"

mkdir -p "$EXPORT_DIR"

# Ignora localmente los archivos exportados y respaldos del exportador sin
# modificar el .gitignore compartido ni generar cambios para commit.
LOCAL_EXCLUDE="$PROJECT_ROOT/.git/info/exclude"
mkdir -p "$(dirname "$LOCAL_EXCLUDE")"
touch "$LOCAL_EXCLUDE"

for LOCAL_RULE in "/export_codigo/" "/local-backups/"; do
  if ! grep -Fxq "$LOCAL_RULE" "$LOCAL_EXCLUDE"; then
    {
      echo ""
      echo "# Archivos locales generados por el exportador de código"
      echo "$LOCAL_RULE"
    } >> "$LOCAL_EXCLUDE"
  fi
done

echo "============================================================"
echo "EXPORTANDO CÓDIGO COMPLETO DE LEVANTAMIENTO RQ"
echo "============================================================"
echo "Ruta proyecto: $PROJECT_ROOT"
echo "Script permanente: $INSTALLED_SCRIPT"
echo "Carpeta salida: $EXPORT_DIR"
echo "Archivo salida: $OUT_FILE"
echo ""

python3 - "$PROJECT_ROOT" "$OUT_FILE" <<'PY_EOF'
from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

root = Path(sys.argv[1]).resolve()
output_file = Path(sys.argv[2]).resolve()

excluded_directories = {
    ".git",
    ".nx",
    ".next",
    ".turbo",
    ".vercel",
    ".cache",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "out-tsc",
    "tmp",
    "temp",
    "backups",
    "backup",
    "local-backups",
    "export_codigo",
}

excluded_exact_names = {
    ".DS_Store",
    ".npmrc",
    ".yarnrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "credentials.json",
    "service-account.json",
    "secrets.json",
}

excluded_suffixes = {
    ".bak",
    ".old",
    ".tmp",
    ".temp",
    ".log",
    ".pem",
    ".key",
    ".pfx",
    ".p12",
    ".cer",
    ".crt",
    ".der",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".dmg",
}

supported_suffixes = {
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".jsonc",
    ".yaml",
    ".yml",
    ".md",
    ".txt",
    ".sh",
    ".zsh",
    ".sql",
    ".html",
    ".css",
    ".scss",
    ".sass",
    ".less",
    ".xml",
    ".config",
    ".toml",
    ".graphql",
    ".gql",
    ".prisma",
    ".svg",
    ".properties",
}

supported_exact_names = {
    "Dockerfile",
    "Makefile",
    "Procfile",
    ".editorconfig",
    ".gitignore",
    ".gitattributes",
    ".dockerignore",
    ".prettierignore",
    ".prettierrc",
    ".prettierrc.js",
    ".prettierrc.cjs",
    ".eslintrc",
    ".eslintignore",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "docker-compose.yml",
    "docker-compose.yaml",
}

def relative(path: Path) -> Path:
    return path.relative_to(root)

def is_real_environment_file(path: Path) -> bool:
    name = path.name

    if name == ".env.example" or name.endswith(".env.example"):
        return False

    if name == ".env" or name.startswith(".env."):
        return True

    return False

def is_secret(path: Path) -> bool:
    name = path.name
    lower_name = name.lower()
    relative_path = relative(path)

    if is_real_environment_file(path):
        return True

    if name in excluded_exact_names:
        return True

    if path.suffix.lower() in excluded_suffixes:
        return True

    if relative_path == Path("infrastructure/docker/.env"):
        return True

    secret_json_names = {
        "client-secret.json",
        "oauth-credentials.json",
        "azure-credentials.json",
    }

    if lower_name in secret_json_names:
        return True

    return False

def is_supported(path: Path) -> bool:
    if path.name in supported_exact_names:
        return True

    if path.name == ".env.example" or path.name.endswith(".env.example"):
        return True

    return path.suffix.lower() in supported_suffixes

def should_prune_directory(path: Path) -> bool:
    return path.name in excluded_directories

def collect_structure() -> list[str]:
    items: list[str] = []

    for current_root, directories, files in os.walk(root, topdown=True):
        current = Path(current_root)

        directories[:] = sorted(
            directory
            for directory in directories
            if not should_prune_directory(current / directory)
        )

        if current != root:
            items.append(str(relative(current)) + "/")

        for file_name in sorted(files):
            file_path = current / file_name

            if file_path.is_symlink():
                continue

            if is_secret(file_path):
                continue

            items.append(str(relative(file_path)))

    return sorted(set(items))

def collect_files() -> list[Path]:
    files_to_export: list[Path] = []

    for current_root, directories, files in os.walk(root, topdown=True):
        current = Path(current_root)

        directories[:] = sorted(
            directory
            for directory in directories
            if not should_prune_directory(current / directory)
        )

        for file_name in sorted(files):
            file_path = current / file_name

            if file_path.is_symlink():
                continue

            if is_secret(file_path):
                continue

            if not is_supported(file_path):
                continue

            files_to_export.append(file_path)

    return sorted(files_to_export, key=lambda path: str(relative(path)))

def run_command(command: list[str], timeout: int = 30) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return f"No disponible: {error}"

    output = (result.stdout or "").strip()

    if result.returncode != 0:
        error_output = (result.stderr or "").strip()
        return error_output or f"Comando finalizó con código {result.returncode}"

    return output or "(sin salida)"

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")

structure = collect_structure()
source_files = collect_files()

applications = sorted(
    path.name
    for path in (root / "apps").iterdir()
    if path.is_dir()
) if (root / "apps").is_dir() else []

packages = sorted(
    path.name
    for path in (root / "packages").iterdir()
    if path.is_dir()
) if (root / "packages").is_dir() else []

library_projects = sorted(
    str(relative(project_file.parent))
    for project_file in (root / "libs").glob("**/project.json")
) if (root / "libs").is_dir() else []

now = datetime.now().astimezone()

with output_file.open("w", encoding="utf-8", newline="\n") as output:
    write = output.write

    write("#" * 80 + "\n")
    write("PROYECTO LEVANTAMIENTO RQ\n")
    write(f"EXPORTADO: {now.isoformat()}\n")
    write(f"RUTA: {root}\n")
    write(f"CARPETA EXPORT: {output_file.parent}\n")
    write("#" * 80 + "\n\n")

    write("=" * 80 + "\n")
    write("1. ESTADO DEL REPOSITORIO\n")
    write("=" * 80 + "\n\n")
    write(f"RAMA:\n{run_command(['git', 'branch', '--show-current'])}\n\n")
    write(
        "COMMIT:\n"
        + run_command(["git", "log", "-1", "--pretty=format:%h - %s"])
        + "\n\n"
    )
    write(
        "REMOTO:\n"
        + run_command(["git", "remote", "get-url", "origin"])
        + "\n\n"
    )
    write("ESTADO GIT:\n")
    write(run_command(["git", "status", "--short"]) + "\n\n")

    write("=" * 80 + "\n")
    write("2. COMPONENTES INCLUIDOS\n")
    write("=" * 80 + "\n\n")
    write("- Aplicaciones Nx actuales y futuras ubicadas en apps/\n")
    write("- Librerías Nx actuales y futuras ubicadas en libs/\n")
    write("- Paquetes futuros ubicados en packages/\n")
    write("- Configuración raíz del monorepo\n")
    write("- Infraestructura, documentación, ADR y scripts\n")
    write("- Pruebas, contratos y archivos de configuración\n")
    write("- Copias o residuos de texto, cuando existan, para diagnóstico\n\n")
    write(
        "Cuando se agregue el frontend o cualquier nuevo servicio dentro "
        "del repositorio, se incluirá automáticamente si utiliza archivos "
        "de código o configuración compatibles.\n\n"
    )

    write("APLICACIONES DETECTADAS:\n")
    if applications:
        for application in applications:
            write(f"- apps/{application}\n")
    else:
        write("- Ninguna\n")

    write("\nPAQUETES DETECTADOS:\n")
    if packages:
        for package in packages:
            write(f"- packages/{package}\n")
    else:
        write("- Ninguno\n")

    write("\nLIBRERÍAS NX DETECTADAS:\n")
    if library_projects:
        for library in library_projects:
            write(f"- {library}\n")
    else:
        write("- Ninguna\n")

    write("\nPROYECTOS NX:\n")
    write(
        run_command(
            [
                "pnpm",
                "exec",
                "nx",
                "show",
                "projects",
            ],
            timeout=60,
        )
        + "\n\n"
    )

    write("=" * 80 + "\n")
    write("3. ESTRUCTURA DEL PROYECTO\n")
    write("=" * 80 + "\n\n")

    for item in structure:
        write(item + "\n")

    write("\n")
    write("=" * 80 + "\n")
    write("4. ARCHIVOS DE CÓDIGO, CONFIGURACIÓN Y DOCUMENTACIÓN\n")
    write("=" * 80 + "\n")

    for file_path in source_files:
        relative_path = relative(file_path)
        content = read_text(file_path)

        write("\n")
        write("#" * 80 + "\n")
        write(f"ARCHIVO: {relative_path}\n")
        write(f"TAMAÑO: {file_path.stat().st_size} bytes\n")
        write(f"SHA-256: {sha256(file_path)}\n")
        write("#" * 80 + "\n\n")
        write(content)

        if content and not content.endswith("\n"):
            write("\n")

    write("\n")
    write("=" * 80 + "\n")
    write("5. ELEMENTOS EXCLUIDOS\n")
    write("=" * 80 + "\n\n")
    write("- .git, node_modules, dist, .nx, .next y coverage\n")
    write("- export_codigo, respaldos, logs y temporales\n")
    write("- Archivos .env reales\n")
    write("- infrastructure/docker/.env\n")
    write("- .npmrc y archivos de credenciales\n")
    write("- Certificados, llaves privadas y archivos comprimidos\n\n")

    write("=" * 80 + "\n")
    write("6. RESUMEN DE LA EXPORTACIÓN\n")
    write("=" * 80 + "\n\n")
    write(f"Aplicaciones detectadas: {len(applications)}\n")
    write(f"Paquetes detectados: {len(packages)}\n")
    write(f"Librerías Nx detectadas: {len(library_projects)}\n")
    write(f"Elementos en la estructura: {len(structure)}\n")
    write(f"Archivos con contenido incluido: {len(source_files)}\n\n")

    write("#" * 80 + "\n")
    write("FIN DEL EXPORT COMPLETO\n")
    write("#" * 80 + "\n")

prefix_counts = {
    "apps": 0,
    "libs": 0,
    "packages": 0,
    "infrastructure": 0,
    "docs": 0,
    "scripts": 0,
}

for file_path in source_files:
    parts = relative(file_path).parts

    if parts and parts[0] in prefix_counts:
        prefix_counts[parts[0]] += 1

print(f"Archivos incluidos: {len(source_files)}")
print(f"Elementos de estructura: {len(structure)}")
for prefix, count in prefix_counts.items():
    print(f"{prefix}: {count}")
PY_EOF

rm -f "$LATEST_LINK"
ln -s "$(basename "$OUT_FILE")" "$LATEST_LINK"

FILE_HASH="$(shasum -a 256 "$OUT_FILE" | awk '{print $1}')"
FILE_SIZE="$(ls -lh "$OUT_FILE" | awk '{print $5}')"
TOTAL_LINES="$(wc -l < "$OUT_FILE" | tr -d ' ')"
TOTAL_FILES="$(grep -c '^ARCHIVO: ' "$OUT_FILE" || true)"

echo ""
echo "Exportación finalizada correctamente:"
echo "$OUT_FILE"

echo ""
echo "Acceso rápido al último export:"
echo "$LATEST_LINK"

echo ""
echo "Tamaño:"
echo "$FILE_SIZE"

echo ""
echo "Total de líneas:"
echo "$TOTAL_LINES"

echo ""
echo "Archivos incluidos:"
echo "$TOTAL_FILES"

echo ""
echo "SHA-256:"
echo "$FILE_HASH"

echo ""
echo "Para futuras exportaciones ejecuta:"
echo "$INSTALLED_SCRIPT"
