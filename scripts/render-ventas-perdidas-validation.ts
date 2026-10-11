import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { renderPdf } from "../apps/operations-service/src/operations/export-document.renderer.js";
import { buildVentasPerdidasExportFixture } from "../tests/operations/export-document.fixture.js";

async function main(): Promise<void> {
  const outputDirectory = resolve("output/pdf");
  const outputPath = resolve(
    outputDirectory,
    "RQ-2026-000033-Ventas-perdidas-reestructurado.pdf",
  );

  await mkdir(outputDirectory, { recursive: true });
  const artifact = await renderPdf(buildVentasPerdidasExportFixture());
  await writeFile(outputPath, artifact.buffer);

  process.stdout.write(`${outputPath}\n`);
}

void main();
