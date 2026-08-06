import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import type {
  AuthenticatedUser,
  SourceDetail,
} from "../libs/shared/contracts/src/index.js";
import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import dataSource from "../apps/ai-analysis-service/src/database/data-source.js";
import { AnalysisExecutionEntity } from "../apps/ai-analysis-service/src/analysis/analysis-execution.entity.js";
import { AnalysisRequestSourceEntity } from "../apps/ai-analysis-service/src/analysis/analysis-request-source.entity.js";
import { AnalysisRequestEntity } from "../apps/ai-analysis-service/src/analysis/analysis-request.entity.js";
import { AiAnalysisService } from "../apps/ai-analysis-service/src/analysis/ai-analysis.service.js";

loadEnvironmentFiles({
  paths: [".env", "apps/ai-analysis-service/.env"],
});

function readySource(
  id: string,
  projectId: string,
  actorId: string,
  position: number,
): SourceDetail {
  const timestamp = new Date(Date.now() + position).toISOString();

  return {
    id,
    projectId,
    sourceType: "NOTE",
    title: `Fuente smoke ${position}`,
    description: null,
    classification: "REQUIREMENT",
    contentPreview: "Contenido smoke",
    processingStatus: "READY",
    processingMessage: null,
    processedAt: timestamp,
    status: "ACTIVE",
    originalFileName: null,
    fileExtension: null,
    mediaType: null,
    fileSizeBytes: null,
    sha256: position === 1 ? "a".repeat(64) : null,
    pageCount: null,
    sheetCount: null,
    createdByUserId: actorId,
    updatedByUserId: actorId,
    createdAt: timestamp,
    updatedAt: timestamp,
    content: "Contenido smoke",
    extractedText: null,
    storageContainer: null,
    storagePath: null,
  };
}

async function main(): Promise<void> {
  await dataSource.initialize();

  const requests = dataSource.getRepository(AnalysisRequestEntity);
  const requestSources = dataSource.getRepository(
    AnalysisRequestSourceEntity,
  );
  const executions = dataSource.getRepository(AnalysisExecutionEntity);

  const projectId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const sourceIds = [randomUUID(), randomUUID()];
  const actor: AuthenticatedUser = {
    id: randomUUID(),
    email: "ai-analysis-smoke@local.invalid",
    displayName: "AI Analysis Smoke",
    roles: ["ADMIN"],
    permissions: ["system.admin"],
    mustChangePassword: false,
  };
  const sourceDetails = sourceIds.map((sourceId, index) =>
    readySource(sourceId, projectId, actor.id, index + 1),
  );

  const service = new AiAnalysisService(
    requests,
    requestSources,
    executions,
    dataSource,
    {
      requireCreate: async () => undefined,
      requireRead: async () => undefined,
      requireCancel: async () => undefined,
    } as never,
    {
      requireCurrentVersion: async () => undefined,
    } as never,
    {
      requireReadySources: async () => sourceDetails,
    } as never,
  );

  const context = {
    actor,
    accessToken: "smoke-token",
    correlationId: randomUUID(),
  };
  let analysisRequestId: string | null = null;

  try {
    const created = await service.create(context, projectId, {
      analysisType: "REQUIREMENT_DOCUMENT",
      documentId,
      documentVersionId,
      sourceIds,
    });
    analysisRequestId = created.id;

    assert.equal(created.status, "PENDING");
    assert.equal(created.sourceCount, 2);
    assert.equal(created.executionCount, 0);
    assert.equal(created.sources[0]?.position, 1);
    assert.equal(created.sources[1]?.position, 2);
    assert.equal(created.sources[0]?.sourceSha256, "a".repeat(64));

    const listed = await service.list(context, projectId, {
      status: "PENDING",
      page: 1,
      pageSize: 25,
    });

    assert.equal(listed.totalItems, 1);
    assert.equal(listed.items[0]?.id, analysisRequestId);

    const detail = await service.getById(
      context,
      projectId,
      analysisRequestId,
    );

    assert.equal(
      detail.documentId.toLowerCase(),
      documentId.toLowerCase(),
    );
    assert.equal(
      detail.documentVersionId.toLowerCase(),
      documentVersionId.toLowerCase(),
    );

    const cancelled = await service.cancel(
      context,
      projectId,
      analysisRequestId,
    );

    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.cancelledAt);

    const idempotent = await service.cancel(
      context,
      projectId,
      analysisRequestId,
    );

    assert.equal(idempotent.status, "CANCELLED");

    const rowCount = await requests.countBy({ id: analysisRequestId });
    const sourceCount = await requestSources.countBy({
      analysisRequestId,
    });
    const executionCount = await executions.countBy({
      analysisRequestId,
    });

    assert.equal(rowCount, 1);
    assert.equal(sourceCount, 2);
    assert.equal(executionCount, 0);

    console.log("✓ Solicitud PENDING creada en RqAiDb.");
    console.log("✓ Dos snapshots de fuentes guardados en orden.");
    console.log("✓ Listado y consulta individual verificados.");
    console.log("✓ Cancelación idempotente verificada.");
    console.log("✓ No se creó ninguna ejecución ni llamada a proveedor.");
  } finally {
    if (analysisRequestId) {
      await requests.delete({ id: analysisRequestId });
    }

    await dataSource.destroy();

    console.log("✓ Registro temporal eliminado.");
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`Smoke de solicitudes de análisis fallido: ${message}`);
  process.exitCode = 1;
});
