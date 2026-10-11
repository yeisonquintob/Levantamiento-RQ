import assert from "node:assert/strict";
import test from "node:test";

import { DOCUMENT_SECTION_DEFINITIONS } from "../../libs/shared/contracts/src/index.js";
import { AiAnalysisService } from "../../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";
import type { AnalysisRequestSourceEntity } from "../../apps/ai-analysis-service/src/analysis/analysis-request-source.entity.js";
import { SourceLocalAnalysisEntity } from "../../apps/ai-analysis-service/src/local-ai/source-local-analysis.entity.js";
import { ProjectKnowledgeSnapshotEntity } from "../../apps/ai-analysis-service/src/local-ai/project-knowledge-snapshot.entity.js";
import { AiProviderConfigurationEntity } from "../../apps/ai-analysis-service/src/providers/ai-provider-configuration.entity.js";

function context() {
  return {
    actor: { id: "user-1" } as never,
    accessToken: "token-1",
    correlationId: "corr-1",
  };
}

function document() {
  const sections = DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
    key: section.key,
    title: section.title,
    order: index + 1,
    content: `Contenido ${section.key}`,
    templateControlled: false,
  }));
  return {
    id: "doc-1",
    projectId: "project-1",
    title: "Documento de prueba",
    status: "DRAFT",
    revision: 1,
    currentVersionNumber: 1,
    currentVersion: "1.0.0",
    template: { id: "t1", version: 1, templateType: "MEDIUM_REQUIREMENT" },
    createdByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    currentVersionDetail: {
      revision: 1,
      status: "DRAFT",
      sections,
      fields: [],
      requirements: [],
      evidence: [],
    },
  } as never;
}

function source(sha256: string) {
  return {
    id: "source-1",
    projectId: "project-1",
    sourceType: "FILE",
    title: "Fuente 1",
    description: null,
    classification: null,
    contentPreview: null,
    processingStatus: "READY",
    processingProgress: 100,
    processingStage: "DONE",
    processingMessage: null,
    processedAt: "2026-01-01T00:00:00.000Z",
    status: "ACTIVE",
    originalFileName: "fuente.txt",
    fileExtension: "TXT",
    mediaType: "text/plain",
    fileSizeBytes: "10",
    sha256,
    pageCount: null,
    sheetCount: null,
    createdByUserId: "user-1",
    updatedByUserId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    content: "El sistema debe registrar solicitudes.",
    extractedText: "El sistema debe registrar solicitudes.",
    storageContainer: null,
    storagePath: null,
  } as never;
}

// requestSources.create() solo necesita comportarse como un mapeador simple.
class RequestSourcesRepositoryStub {
  create(input: Record<string, unknown>): AnalysisRequestSourceEntity {
    return input as unknown as AnalysisRequestSourceEntity;
  }
}

function buildService(currentSourceSha: string, cachedEntitySha: string) {
  const dataSource = {
    getRepository: (entity: unknown) => {
      if (entity === AiProviderConfigurationEntity) {
        return {
          findOneBy: async () => ({
            model: "gpt-cloud-test",
            maxInputTokens: 100_000,
          }),
        };
      }
      if (entity === SourceLocalAnalysisEntity) {
        return {
          findOneBy: async (where: Record<string, unknown>) =>
            where.sourceSha256 === cachedEntitySha
              ? { estimatedAnalysisTokens: "42" }
              : null,
        };
      }
      if (entity === ProjectKnowledgeSnapshotEntity) {
        return { find: async () => [] };
      }
      throw new Error(`Repositorio inesperado solicitado: ${String(entity)}`);
    },
  };

  return new AiAnalysisService(
    {} as never,
    new RequestSourcesRepositoryStub() as never,
    {} as never,
    {} as never,
    dataSource as never,
    { requireCreate: async () => undefined } as never,
    { requireCurrentDocumentForEstimate: async () => document() } as never,
    { requireReadySources: async () => [source(currentSourceSha)] } as never,
    {} as never,
    { publish: async () => undefined } as never,
    {
      enabled: true,
      baseUrl: "http://127.0.0.1:11434",
      model: "local-model-test",
      maxConcurrentJobs: 1,
      timeoutMs: 120_000,
      contextTokens: 16_384,
      maxOutputTokens: 8_192,
      fallbackToRawSources: false,
      maxResponseBytes: 2_097_152,
    } as never,
  );
}

test("una fuente editada que conserva su sourceId invalida el análisis local cacheado", async () => {
  // Escenario A: la fuente actual tiene sha256=sha-v1 y existe un análisis
  // local cacheado para exactamente ese hash -> debe reutilizarse.
  const serviceWithMatch = buildService("sha-v1", "sha-v1");
  const resultWithMatch = await serviceWithMatch.estimateTokens(
    context(),
    "project-1",
    {
      documentId: "doc-1",
      sourceIds: ["source-1"],
      engines: ["LOCAL", "CLOUD"],
      purpose: "AI_VERSION",
    },
  );
  assert.equal(
    resultWithMatch.localAnalysisTokens,
    42,
    "debe reutilizar el análisis local cuando el hash de la fuente coincide",
  );

  // Escenario B: la fuente cambió de contenido (nuevo sha256=sha-v2) pero
  // conserva su sourceId; el análisis cacheado quedó bajo el hash anterior.
  const serviceWithStaleCache = buildService("sha-v2", "sha-v1");
  const resultStale = await serviceWithStaleCache.estimateTokens(
    context(),
    "project-1",
    {
      documentId: "doc-1",
      sourceIds: ["source-1"],
      engines: ["LOCAL", "CLOUD"],
      purpose: "AI_VERSION",
    },
  );
  assert.equal(
    resultStale.localAnalysisTokens,
    null,
    "no debe reutilizar un análisis local cacheado con un hash de fuente distinto",
  );
});
