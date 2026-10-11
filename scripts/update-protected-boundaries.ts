// Regenera docs/architecture/local-only-v2-protected-boundaries.json.
// Uso: pnpm boundaries:update  (revisar el diff del manifiesto antes de hacer commit).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const manifestPath =
  "docs/architecture/local-only-v2-protected-boundaries.json";

// Archivos cuyo cambio exige una decisión explícita: fronteras de seguridad
// y de modo de generación de IA. No se congelan aplicaciones completas.
const criticalFiles = [
  "apps/ai-analysis-service/src/execution/ai-document-generation-mode.ts",
  "apps/ai-analysis-service/src/providers/ai-provider.config.ts",
  "apps/ai-analysis-service/src/providers/ai-secret-vault.ts",
];

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

// Las migraciones ya aplicadas no se editan: solo se agregan nuevas.
function migrationFiles(): string[] {
  const files: string[] = [];
  for (const app of readdirSync("apps").sort()) {
    const dir = `apps/${app}/src/database/migrations`;
    let names: string[];
    try {
      names = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".ts")) files.push(`${dir}/${name}`);
    }
  }
  return files;
}

const manifest = {
  schemaVersion: 3,
  step: "LOCAL_ONLY_V2_00",
  purpose:
    "Protege migraciones ya aplicadas (inmutables; se permiten nuevas) y archivos críticos de seguridad/modo de generación de IA.",
  generatedAt: new Date().toISOString(),
  gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  migrations: migrationFiles().map((path) => ({ path, sha256: sha256(path) })),
  critical: criticalFiles.map((path) => ({ path, sha256: sha256(path) })),
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Manifiesto actualizado: ${manifest.migrations.length} migraciones, ${manifest.critical.length} archivos críticos.`,
);
