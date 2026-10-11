// LOCAL_ONLY_V2_00_PROTECTED_BOUNDARIES
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

import {
  assertAiDocumentGenerationBoundary,
  resolveAiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";

type BoundaryManifest = {
  schemaVersion: number;
  step: string;
  groups: Record<string, string[]>;
  excludedDirs: string[];
  files: Array<{ path: string; sha256: string; groups: string[] }>;
};

const manifestPath =
  "docs/architecture/local-only-v2-protected-boundaries.json";
const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as BoundaryManifest;

function ignoreFile(filePath: string): boolean {
  const normalized = filePath.split(path.sep).join("/");
  if (normalized === "apps/web/next-env.d.ts") return true;

  const base = path.basename(filePath);
  if (base === ".DS_Store") return true;
  return base.startsWith(".env") && base !== ".env.example";
}

function walk(root: string): string[] {
  assert.equal(existsSync(root), true, `Ruta protegida inexistente: ${root}`);
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) return [];
  if (stat.isFile()) return ignoreFile(root) ? [] : [root];
  if (!stat.isDirectory()) return [];

  const excluded = new Set(manifest.excludedDirs);
  const result: string[] = [];
  for (const name of readdirSync(root).sort()) {
    if (excluded.has(name)) continue;
    const child = path.join(root, name);
    const childStat = lstatSync(child);
    if (childStat.isSymbolicLink()) continue;
    if (childStat.isDirectory()) result.push(...walk(child));
    else if (childStat.isFile() && !ignoreFile(child)) result.push(child);
  }
  return result;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

test("Paso 0 excluye únicamente next-env.d.ts porque Next.js lo regenera", () => {
  const generatedPath = "apps/web/next-env.d.ts";
  const generated = readFileSync(generatedPath, "utf8");
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.equal(ignoreFile(generatedPath), true);
  assert.equal(
    manifest.files.some((entry) => entry.path === generatedPath),
    false,
  );
  const generatedImport = generated
    .split(/\r?\n/u)
    .find((line) => line.startsWith('import "./.next/'));

  assert.ok(
    generatedImport === 'import "./.next/types/routes.d.ts";' ||
      generatedImport === 'import "./.next/dev/types/routes.d.ts";',
    `Import generado inesperado: ${generatedImport ?? "<ausente>"}`,
  );
  assert.match(generated, /NOTE: This file should not be edited/u);
  assert.ok(
    gitignore
      .split(/\r?\n/u)
      .some((line) => line.trim() === "/apps/web/next-env.d.ts"),
    "next-env.d.ts debe seguir declarado como archivo generado en .gitignore.",
  );
});

test("Paso 0 mantiene intactas todas las fronteras fuera de alcance", () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.step, "LOCAL_ONLY_V2_00");

  const actual = new Set<string>();
  for (const roots of Object.values(manifest.groups)) {
    for (const root of roots) {
      for (const file of walk(root)) actual.add(file.split(path.sep).join("/"));
    }
  }

  const expected = new Set(manifest.files.map((entry) => entry.path));
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "Se agregó, eliminó o movió un archivo dentro de una frontera protegida.",
  );

  for (const entry of manifest.files) {
    assert.equal(
      sha256(entry.path),
      entry.sha256,
      `Cambió una frontera protegida: ${entry.path}`,
    );
  }
});

test("Paso 0 conserva las fronteras funcionales de los tres modos existentes", () => {
  assert.equal(resolveAiDocumentGenerationMode(true, false), "LOCAL_ONLY");
  assert.equal(resolveAiDocumentGenerationMode(true, true), "LOCAL_CLOUD");
  assert.equal(resolveAiDocumentGenerationMode(false, true), "CLOUD_ONLY");

  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "LOCAL_ONLY",
      provider: "OLLAMA",
      hasKnowledgeSnapshot: true,
      snapshotPromptReady: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "LOCAL_CLOUD",
      provider: "OPENAI",
      hasKnowledgeSnapshot: true,
      snapshotPromptReady: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "CLOUD_ONLY",
      provider: "OPENAI",
      hasKnowledgeSnapshot: false,
      snapshotPromptReady: false,
    }),
  );
});
