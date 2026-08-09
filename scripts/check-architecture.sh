#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rq-architecture.XXXXXX")"
GRAPH="$TMP_DIR/project-graph.json"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

cd "$ROOT"
NX_DAEMON=false pnpm nx graph --file="$GRAPH" >/dev/null

node - "$GRAPH" <<'NODE'
const { readFileSync } = require("node:fs");

const graph = JSON.parse(readFileSync(process.argv[2], "utf8")).graph;
const nodes = graph.nodes ?? {};
const dependencies = graph.dependencies ?? {};
const errors = [];

for (const [name, node] of Object.entries(nodes)) {
  const tags = node.data?.tags ?? [];
  if (!tags.some((tag) => tag.startsWith("scope:"))) {
    errors.push(`${name}: falta etiqueta scope:*.`);
  }
  if (!tags.some((tag) => tag.startsWith("type:"))) {
    errors.push(`${name}: falta etiqueta type:*.`);
  }

  if (node.type !== "app") continue;
  for (const dependency of dependencies[name] ?? []) {
    const target = nodes[dependency.target];
    if (target?.type === "app") {
      errors.push(
        `${name}: dependencia directa prohibida hacia la aplicación ${dependency.target}.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(
  `✓ Arquitectura Nx válida: ${Object.keys(nodes).length} proyectos etiquetados y sin acoplamiento directo entre aplicaciones.`,
);
NODE
