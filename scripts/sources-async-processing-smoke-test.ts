import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import type { DataSource as DataSourceType } from "typeorm";

import type { AuthenticatedUser } from "../libs/shared/contracts/src/index.js";
import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { SourceBlobStorage } from "../apps/sources-service/src/sources/source-blob-storage.service.js";
import { SourceEntity } from "../apps/sources-service/src/sources/source.entity.js";
import { SourceProcessingQueue } from "../apps/sources-service/src/sources/source-processing.queue.js";
import { SourcesService } from "../apps/sources-service/src/sources/sources.service.js";
import {
  SOURCES_STORAGE_CONFIG,
  type SourcesStorageConfig,
} from "../apps/sources-service/src/sources/sources-storage.config.js";

loadEnvironmentFiles({
  paths: [".env", "infrastructure/docker/.env", "apps/sources-service/.env"],
});

process.env.SOURCES_PROCESSING_QUEUE = "source-processing-controlled-smoke";

async function waitForReady(
  dataSource: DataSourceType,
  sourceId: string,
): Promise<SourceEntity> {
  const sources = dataSource.getRepository(SourceEntity);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const source = await sources.findOne({ where: { id: sourceId } });

    if (source?.processingStatus === "READY") {
      return source;
    }

    if (source?.processingStatus === "FAILED") {
      throw new Error(source.processingMessage ?? "El worker reportó FAILED.");
    }

    await new Promise((done) => setTimeout(done, 250));
  }

  throw new Error("El procesamiento no finalizó dentro del tiempo esperado.");
}

async function queueCounts(queue: SourceProcessingQueue["bullQueue"]) {
  return queue.getJobCounts(
    "active",
    "completed",
    "delayed",
    "failed",
    "paused",
    "prioritized",
    "waiting",
  );
}

async function removeSmokeJobs(
  queue: SourceProcessingQueue["bullQueue"],
  sourceIds: readonly string[],
): Promise<void> {
  const jobs = await queue.getJobs([
    "completed",
    "failed",
    "waiting",
    "delayed",
    "paused",
    "prioritized",
  ]);

  for (const job of jobs) {
    if (sourceIds.includes(job.data.sourceId)) {
      await job.remove();
    }
  }
}

async function waitForSmokeJobsToSettle(
  queue: SourceProcessingQueue["bullQueue"],
  sourceIds: readonly string[],
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const jobs = await queue.getJobs([
      "active",
      "waiting",
      "delayed",
      "paused",
      "prioritized",
    ]);
    const pendingSmokeJob = jobs.some((job) =>
      sourceIds.includes(job.data.sourceId),
    );

    if (!pendingSmokeJob) return;
    await new Promise((done) => setTimeout(done, 100));
  }

  throw new Error(
    "Los trabajos temporales del smoke no finalizaron antes de la limpieza.",
  );
}

async function main(): Promise<void> {
  const appRequire = createRequire(
    resolve(process.cwd(), "apps/sources-service/package.json"),
  );
  const { NestFactory } = appRequire(
    "@nestjs/core",
  ) as typeof import("@nestjs/core");
  const { DataSource } = appRequire("typeorm") as typeof import("typeorm");
  const { AppModule } =
    await import("../apps/sources-service/src/app/app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: ["error"],
  });
  const storage = app.get(SourceBlobStorage);
  const processingQueue = app.get(SourceProcessingQueue);
  const storageConfig = app.get<SourcesStorageConfig>(SOURCES_STORAGE_CONFIG);
  const queue = processingQueue.bullQueue;
  const dataSource = app.get(DataSource);
  const sources = dataSource.getRepository(SourceEntity);
  const projectId = randomUUID();
  const actor: AuthenticatedUser = {
    id: randomUUID(),
    email: "sources-controlled-smoke@local.invalid",
    displayName: "Sources Controlled Smoke",
    roles: ["ADMIN"],
    permissions: ["system.admin"],
    mustChangePassword: false,
  };
  const service = new SourcesService(
    sources,
    { requireManage: async () => undefined } as never,
    storage,
    processingQueue,
    storageConfig,
  );
  const sourceIds: string[] = [];
  const blobPaths: string[] = [];

  try {
    const initialCounts = await queueCounts(queue);

    if (Object.values(initialCounts).some((count) => count !== 0)) {
      throw new Error(
        `La cola no está limpia: ${JSON.stringify(initialCounts)}`,
      );
    }

    const uploaded = await service.uploadFiles(
      actor,
      "smoke-token",
      projectId,
      [
        {
          fileName: "smoke-controlado-uno.txt",
          mediaType: "text/plain",
          buffer: Buffer.from(
            `Primera fuente del smoke controlado ${randomUUID()}.`,
            "utf8",
          ),
          description: null,
        },
        {
          fileName: "smoke-controlado-dos.txt",
          mediaType: "text/plain",
          buffer: Buffer.from(
            `Segunda fuente del smoke controlado ${randomUUID()}.`,
            "utf8",
          ),
          classification: "",
          description: null,
        },
      ],
    );

    if (uploaded.acceptedFiles !== 2 || uploaded.rejectedFiles !== 0) {
      throw new Error(
        `La carga no aceptó los dos archivos: ${JSON.stringify(uploaded)}`,
      );
    }

    for (const source of uploaded.accepted) {
      sourceIds.push(source.id);
      if (source.storagePath) blobPaths.push(source.storagePath);

      if (
        source.classification !== "OTHER" ||
        source.processingStatus !== "PENDING" ||
        source.processingMessage !==
          "Archivo almacenado. Procesamiento pendiente."
      ) {
        throw new Error(
          `Estado inicial inesperado para ${source.id}: ${JSON.stringify(source)}`,
        );
      }
    }

    await new Promise((done) => setTimeout(done, 750));
    const pendingRows = await sources.findBy({
      projectId,
      processingStatus: "PENDING",
    });
    const afterUploadCounts = await queueCounts(queue);

    if (
      pendingRows.length !== 2 ||
      Object.values(afterUploadCounts).some((count) => count !== 0)
    ) {
      throw new Error("La carga encoló o procesó archivos automáticamente.");
    }

    const selectedResult = await service.processSelected(
      actor,
      "smoke-token",
      projectId,
      { sourceIds: [sourceIds[0]!] },
    );

    if (selectedResult.enqueued !== 1 || selectedResult.failed !== 0) {
      throw new Error(
        `Procesar seleccionadas devolvió: ${JSON.stringify(selectedResult)}`,
      );
    }

    const firstReady = await waitForReady(dataSource, sourceIds[0]!);
    const secondPending = await sources.findOneByOrFail({ id: sourceIds[1]! });

    if (secondPending.processingStatus !== "PENDING") {
      throw new Error("La fuente no seleccionada dejó de estar PENDING.");
    }

    const firstProcessedAt = firstReady.processedAt?.getTime();
    const allResult = await service.processAll(actor, "smoke-token", projectId);

    if (allResult.enqueued !== 1 || allResult.failed !== 0) {
      throw new Error(`Procesar todos devolvió: ${JSON.stringify(allResult)}`);
    }

    await waitForReady(dataSource, sourceIds[1]!);
    const firstAfterProcessAll = await sources.findOneByOrFail({
      id: sourceIds[0]!,
    });

    if (firstAfterProcessAll.processedAt?.getTime() !== firstProcessedAt) {
      throw new Error("Procesar todos volvió a procesar la fuente READY.");
    }

    const idempotentResult = await service.processAll(
      actor,
      "smoke-token",
      projectId,
    );

    if (idempotentResult.requested !== 0 || idempotentResult.enqueued !== 0) {
      throw new Error(
        `La repetición no fue idempotente: ${JSON.stringify(idempotentResult)}`,
      );
    }

    await waitForSmokeJobsToSettle(queue, sourceIds);
    await removeSmokeJobs(queue, sourceIds);
    await queue.clean(0, 1000, "completed");
    await queue.clean(0, 1000, "failed");
    await sources.delete({ projectId });

    for (const blobPath of blobPaths) {
      await storage.deleteIfExists(blobPath);
    }

    const finalCounts = await queueCounts(queue);
    const remainingRows = await sources.count({ where: { projectId } });
    const blobsRemain = (
      await Promise.all(blobPaths.map((blobPath) => storage.exists(blobPath)))
    ).some(Boolean);

    if (
      Object.values(finalCounts).some((count) => count !== 0) ||
      remainingRows !== 0 ||
      blobsRemain
    ) {
      throw new Error(
        `La limpieza temporal del smoke no quedó completa: jobs=${JSON.stringify(finalCounts)}, rows=${remainingRows}, blobs=${blobsRemain}.`,
      );
    }

    console.log("✓ Dos archivos sin clasificación quedaron OTHER y PENDING.");
    console.log("✓ La carga no creó trabajos BullMQ automáticamente.");
    console.log("✓ Procesar seleccionadas dejó una READY y otra PENDING.");
    console.log("✓ Procesar todos completó solo la pendiente y omitió READY.");
    console.log("✓ Repetición idempotente, filas, blobs y jobs eliminados.");
  } finally {
    await waitForSmokeJobsToSettle(queue, sourceIds);
    await removeSmokeJobs(queue, sourceIds);
    await sources.delete({ projectId });

    for (const blobPath of blobPaths) {
      await storage.deleteIfExists(blobPath);
    }

    await queue.obliterate({ force: true });
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke controlado de Sources fallido: ${message}`);
  process.exitCode = 1;
});
