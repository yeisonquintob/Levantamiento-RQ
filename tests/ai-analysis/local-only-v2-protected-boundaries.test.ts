// LOCAL_ONLY_V2_00_PROTECTED_BOUNDARIES
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

import {
  assertAiDocumentGenerationBoundary,
  resolveAiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";

type HashedFile = { path: string; sha256: string };
type BoundaryManifest = {
  schemaVersion: number;
  step: string;
  migrations: HashedFile[];
  critical: HashedFile[];
};

const manifestPath =
  "docs/architecture/local-only-v2-protected-boundaries.json";
const manifest = JSON.parse(
  readFileSync(manifestPath, "utf8"),
) as BoundaryManifest;
const updateHint =
  "Si el cambio es intencional, revisa el diff y ejecuta `pnpm boundaries:update`.";

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function ignoreFile(filePath: string): boolean {
  return filePath.split(path.sep).join("/") === "apps/web/next-env.d.ts";
}

function migrationFilesOnDisk(): string[] {
  const files: string[] = [];
  for (const app of readdirSync("apps").sort()) {
    const dir = `apps/${app}/src/database/migrations`;
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.endsWith(".ts")) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

test("Paso 0 excluye únicamente next-env.d.ts porque Next.js lo regenera", () => {
  const generatedPath = "apps/web/next-env.d.ts";
  const gitignore = readFileSync(".gitignore", "utf8");

  assert.equal(ignoreFile(generatedPath), true);
  assert.ok(
    gitignore
      .split(/\r?\n/u)
      .some((line) => line.trim() === "/apps/web/next-env.d.ts"),
    "next-env.d.ts debe seguir declarado como archivo generado en .gitignore.",
  );

  // El archivo no está en Git: lo crea Next.js al compilar o arrancar la web. En una copia limpia
  // todavía no existe, así que su contenido solo se valida cuando ya fue generado.
  if (!existsSync(generatedPath)) return;
  const generated = readFileSync(generatedPath, "utf8");
  const generatedImport = generated
    .split(/\r?\n/u)
    .find((line) => line.startsWith('import "./.next/'));

  assert.ok(
    generatedImport === 'import "./.next/types/routes.d.ts";' ||
      generatedImport === 'import "./.next/dev/types/routes.d.ts";',
    `Import generado inesperado: ${generatedImport ?? "<ausente>"}`,
  );
  assert.match(generated, /NOTE: This file should not be edited/u);
});

test("las migraciones ya aplicadas no se modifican ni se eliminan (se permiten nuevas)", () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.step, "LOCAL_ONLY_V2_00");

  const onDisk = new Set(migrationFilesOnDisk());
  for (const entry of manifest.migrations) {
    assert.equal(
      onDisk.has(entry.path),
      true,
      `Se eliminó o movió una migración ya aplicada: ${entry.path}. Crea una migración nueva en su lugar.`,
    );
    assert.equal(
      sha256(entry.path),
      entry.sha256,
      `Se modificó una migración ya aplicada: ${entry.path}. Crea una migración nueva en su lugar.`,
    );
  }
});

test("los archivos críticos de seguridad y modo de generación de IA no cambian sin decisión explícita", () => {
  assert.ok(manifest.critical.length > 0);
  for (const entry of manifest.critical) {
    assert.equal(
      sha256(entry.path),
      entry.sha256,
      `Cambió un archivo crítico: ${entry.path}. ${updateHint}`,
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
