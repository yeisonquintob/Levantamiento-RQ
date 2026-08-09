import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { Queue } from "bullmq";

import { DOCUMENT_SECTION_DEFINITIONS } from "../libs/shared/contracts/src/index.js";

import dataSource from "../apps/operations-service/src/database/data-source.js";
import { ExportArtifactStorage } from "../apps/operations-service/src/operations/export-artifact-storage.service.js";
import { ExportProcessingQueue } from "../apps/operations-service/src/operations/export-processing.queue.js";
import { ExportProcessingService } from "../apps/operations-service/src/operations/export-processing.service.js";
import { ExportProcessingWorker } from "../apps/operations-service/src/operations/export-processing.worker.js";
import {
  AuditEventEntity,
  ExportArtifactEntity,
  ExportRequestEntity,
} from "../apps/operations-service/src/operations/operation.entities.js";
import { loadOperationsProcessingConfig } from "../apps/operations-service/src/operations/operations-processing.config.js";
import { loadOperationsStorageConfig } from "../apps/operations-service/src/operations/operations-storage.config.js";

async function waitForExports(ids: readonly string[]): Promise<void> {
  const exports = dataSource.getRepository(ExportRequestEntity);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const rows = await Promise.all(ids.map((id) => exports.findOneBy({ id })));
    if (rows.every((row) => row?.status === "COMPLETED")) return;
    const failed = rows.find((row) => row?.status === "FAILED");
    if (failed) throw new Error(failed.errorMessage ?? "Exportación fallida.");
    await delay(200);
  }
  throw new Error("Las exportaciones no terminaron dentro del tiempo límite.");
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const exports = dataSource.getRepository(ExportRequestEntity);
  const artifacts = dataSource.getRepository(ExportArtifactEntity);
  const audits = dataSource.getRepository(AuditEventEntity);
  const projectId = randomUUID();
  const documentId = randomUUID();
  const documentVersionId = randomUUID();
  const actorId = randomUUID();
  const requestIds = [randomUUID(), randomUUID()];
  const processingConfig = {
    ...loadOperationsProcessingConfig(process.env),
    queueName: `rq-exports-smoke-${randomUUID()}`,
  };
  const storage = new ExportArtifactStorage(
    loadOperationsStorageConfig(process.env),
  );
  const project = {
    id: projectId,
    code: "RQ-SMOKE-EXPORT",
    title: "Validación de artefactos",
    requestingArea: "Calidad",
  };
  const version = {
    id: documentVersionId,
    versionNumber: 1,
    version: "1.0.0",
    status: "APPROVED",
    revision: 1,
    changeSummary: "Fixture temporal de exportación",
    createdByUserId: actorId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approvedByUserId: actorId,
    approvedAt: new Date().toISOString(),
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
      id: randomUUID(),
      key: section.key,
      title: section.title,
      order: index + 1,
      content: {
        description: `Contenido de validación para ${section.title}.`,
        result: "Aprobado y trazable",
      },
      templateControlled: index >= 10,
    })),
    fields: [],
    requirements: [
      {
        id: randomUUID(),
        sectionKey: "milestones",
        code: "RF-SMOKE-001",
        title: "Generar archivos reales",
        description: "El sistema genera PDF y DOCX desde la versión aprobada.",
        requirementType: "FUNCTIONAL",
        status: "APPROVED",
        order: 1,
        acceptanceCriteria: [
          {
            id: randomUUID(),
            description: "Ambos artefactos superan la validación de firma.",
            order: 1,
          },
        ],
      },
    ],
    evidence: [],
  };
  const document = {
    id: documentId,
    projectId,
    title: "Documento temporal de exportación",
    currentVersionDetail: version,
  };
  const events: string[] = [];
  const processing = new ExportProcessingService(
    exports,
    artifacts,
    dataSource,
    { requireRead: async () => project } as never,
    {
      requireApprovedVersion: async () => ({ document, version }),
    } as never,
    { issue: async () => "short-lived-internal-token" } as never,
    storage,
    {
      publish: async (event: { eventName: string }) => {
        events.push(event.eventName);
        return true;
      },
    } as never,
  );
  const worker = new ExportProcessingWorker(processingConfig, processing);
  const queue = new ExportProcessingQueue(processingConfig);
  let storedPaths: string[] = [];
  try {
    const now = new Date();
    await exports.save(
      (["PDF", "DOCX"] as const).map((format, index) =>
        exports.create({
          id: requestIds[index],
          projectId,
          documentId,
          documentVersionId,
          versionNumber: 1,
          format,
          status: "PENDING",
          requestedByUserId: actorId,
          correlationId: randomUUID(),
          idempotencyKey: `artifact-smoke-${randomUUID()}`,
          attemptCount: 0,
          errorCode: null,
          errorMessage: null,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        }),
      ),
    );
    worker.onModuleInit();
    await Promise.all(requestIds.map((id) => queue.enqueue(id, randomUUID())));
    await waitForExports(requestIds);

    const stored = await artifacts.findBy(
      requestIds.map((exportRequestId) => ({ exportRequestId })),
    );
    assert.equal(stored.length, 2);
    storedPaths = stored.map((item) => item.storagePath);
    const files = await Promise.all(
      stored.map(async (artifact) => ({
        artifact,
        buffer: await storage.download(artifact.storagePath),
      })),
    );
    for (const { artifact, buffer } of files) {
      assert.equal(
        createHash("sha256").update(buffer).digest("hex"),
        artifact.sha256,
      );
      assert.equal(String(buffer.length), artifact.sizeBytes);
    }
    const pdf = files.find(({ artifact }) =>
      artifact.fileName.endsWith(".pdf"),
    );
    const docx = files.find(({ artifact }) =>
      artifact.fileName.endsWith(".docx"),
    );
    assert.equal(pdf?.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
    assert.equal(docx?.buffer.subarray(0, 2).toString("ascii"), "PK");
    assert.equal(
      events.filter((name) => name === "export.completed").length,
      2,
    );
    console.log("✓ BullMQ procesó las exportaciones PDF y DOCX.");
    console.log("✓ Azurite conservó artefactos privados con SHA-256 válido.");
  } finally {
    await worker.onModuleDestroy();
    await queue.onModuleDestroy();
    const cleanupQueue = new Queue(processingConfig.queueName, {
      connection: processingConfig.connection,
    });
    await cleanupQueue.obliterate({ force: true });
    await cleanupQueue.close();
    await Promise.all(storedPaths.map((path) => storage.deleteIfExists(path)));
    await audits.delete(requestIds.map((resourceId) => ({ resourceId })));
    await artifacts.delete(
      requestIds.map((exportRequestId) => ({ exportRequestId })),
    );
    await exports.delete(requestIds.map((id) => ({ id })));
    await dataSource.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error(
    `No se pudo validar la generación de artefactos: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
