import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import dataSource from "../apps/ai-analysis-service/src/database/data-source.js";
import {
  buildCanonicalKnowledgeSummary,
  consolidateLocalAnalyses,
} from "../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.js";
import {
  LOCAL_AI_PROMPT_VERSION,
  parseLocalSourceAnalysis,
} from "../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import { SourceLocalAnalysisEntity } from "../apps/ai-analysis-service/src/local-ai/source-local-analysis.entity.js";

async function main(): Promise<void> {
  await dataSource.initialize();

  try {
    const repository = dataSource.getRepository(SourceLocalAnalysisEntity);
    const requestedProject = process.argv[2]?.trim();

    let projectId = requestedProject && requestedProject !== "latest"
      ? requestedProject
      : null;

    if (!projectId) {
      const latest = await repository.findOne({
        where: { status: "COMPLETED" },
        order: { updatedAt: "DESC" },
      });
      if (!latest) {
        throw new Error("No existen análisis locales COMPLETED para exportar.");
      }
      projectId = latest.projectId;
    }

    const rows = await repository.find({
      where: { projectId, status: "COMPLETED" },
      order: { updatedAt: "DESC" },
    });

    const latestBySource = new Map<string, SourceLocalAnalysisEntity>();
    for (const row of rows) {
      if (!row.promptVersion.startsWith(LOCAL_AI_PROMPT_VERSION)) continue;
      if (!row.analysisJson) continue;
      if (!latestBySource.has(row.sourceId)) {
        latestBySource.set(row.sourceId, row);
      }
    }

    const selected = [...latestBySource.values()].sort((a, b) =>
      a.sourceId.localeCompare(b.sourceId),
    );
    if (selected.length === 0) {
      throw new Error(
        `No existen análisis locales ${LOCAL_AI_PROMPT_VERSION} COMPLETED para el proyecto ${projectId}.`,
      );
    }

    const analyses = selected.map((row) =>
      parseLocalSourceAnalysis(JSON.parse(row.analysisJson!), row.sourceId),
    );
    const originalCharacters = selected.reduce(
      (total, row) => total + Number(row.originalCharacters || 0),
      0,
    );
    const snapshot = consolidateLocalAnalyses(
      projectId,
      analyses,
      originalCharacters,
    );
    const summary = buildCanonicalKnowledgeSummary(snapshot);

    const directory = resolve(process.cwd(), "tmp");
    await mkdir(directory, { recursive: true });
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const output = resolve(
      directory,
      `local-ai-consolidated-${projectId}-${timestamp}.txt`,
    );
    await writeFile(output, `${summary}\n`, "utf8");

    console.log("EXPORT_LOCAL_AI_CANONICAL_OK");
    console.log(`Proyecto: ${projectId}`);
    console.log(`Prompt local: ${LOCAL_AI_PROMPT_VERSION}`);
    console.log(`Fuentes consolidadas: ${selected.length}`);
    console.log(`Hallazgos antes: ${snapshot.metrics.findingsBefore}`);
    console.log(
      `Hallazgos después de deduplicación: ${snapshot.metrics.findingsAfterSemanticDedup}`,
    );
    console.log(`Cobertura de fuentes: ${snapshot.metrics.sourceCoverage}%`);
    console.log(`Tokens originales estimados: ${snapshot.metrics.originalTokens}`);
    console.log(`Tokens snapshot JSON estimados: ${snapshot.metrics.snapshotTokens}`);
    console.log(`Tokens resumen TXT estimados: ${Math.ceil(summary.length / 4)}`);
    console.log(`Archivo: ${output}`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`No se pudo exportar el consolidado local: ${message}`);
  process.exitCode = 1;
});
