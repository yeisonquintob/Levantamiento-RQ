import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import type { DataSource as DataSourceType } from "typeorm";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";
import { SourceBlobStorage } from "../apps/sources-service/src/sources/source-blob-storage.service.js";
import { SourceEntity } from "../apps/sources-service/src/sources/source.entity.js";
import { SourceProcessingQueue } from "../apps/sources-service/src/sources/source-processing.queue.js";

loadEnvironmentFiles({
  paths: [
    ".env",
    "infrastructure/docker/.env",
    "apps/sources-service/.env",
  ],
});

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

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

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("El procesamiento no finalizó dentro del tiempo esperado.");
}

async function main(): Promise<void> {
  const appRequire = createRequire(
    resolve(process.cwd(), "apps/sources-service/package.json"),
  );
  const { NestFactory } = appRequire("@nestjs/core") as typeof import("@nestjs/core");
  const { DataSource } = appRequire("typeorm") as typeof import("typeorm");
  const { AppModule } = await import(
    "../apps/sources-service/src/app/app.module.js"
  );
  const app = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: ["error"],
  });
  const storage = app.get(SourceBlobStorage);
  const processingQueue = app.get(SourceProcessingQueue);
  const queue = processingQueue.bullQueue;
  const dataSource = app.get(DataSource);
  const sources = dataSource.getRepository(SourceEntity);
  const sourceId = randomUUID();
  const projectId = randomUUID();
  const actorId = randomUUID();
  const content = Buffer.from(
    `Smoke asíncrono de Sources ${sourceId}\nContenido TXT no vacío.`,
    "utf8",
  );
  const digest = sha256(content);
  const blobPath = `${projectId}/${sourceId}/${digest.slice(0, 16)}.txt`;
  let jobId: string | undefined;

  try {
    const initialCounts = await queue.getJobCounts(
      "active",
      "completed",
      "delayed",
      "failed",
      "paused",
      "prioritized",
      "waiting",
    );

    if (Object.values(initialCounts).some((count) => count !== 0)) {
      throw new Error(`La cola no está limpia: ${JSON.stringify(initialCounts)}`);
    }

    await storage.upload(
      blobPath,
      content,
      "text/plain; charset=utf-8",
      "smoke-async.txt",
      digest,
    );

    if (!(await storage.exists(blobPath))) {
      throw new Error("El blob no existe después de la carga.");
    }

    const properties = await storage.getProperties(blobPath);

    if (properties.contentLength !== content.length) {
      throw new Error(
        `Content-Length no coincide: esperado ${content.length}, recibido ${String(properties.contentLength)}.`,
      );
    }

    const downloaded = await storage.download(blobPath);

    if (!downloaded.equals(content) || sha256(downloaded) !== digest) {
      throw new Error("La descarga o su SHA-256 no coincide con la carga.");
    }

    const now = new Date();
    await sources.save(
      sources.create({
        id: sourceId,
        projectId,
        sourceType: "FILE",
        title: "Smoke asíncrono temporal",
        description: "Registro temporal del Paso 15",
        classification: "EVIDENCE",
        content: null,
        extractedText: null,
        processingStatus: "PENDING",
        processingMessage: "Pendiente de worker.",
        processedAt: null,
        status: "ACTIVE",
        originalFileName: "smoke-async.txt",
        fileExtension: "txt",
        mediaType: "text/plain; charset=utf-8",
        fileSizeBytes: String(content.length),
        sha256: digest,
        storageContainer: storage.containerName,
        storagePath: blobPath,
        pageCount: null,
        sheetCount: null,
        createdByUserId: actorId,
        updatedByUserId: actorId,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const job = await processingQueue.enqueue(sourceId, actorId);
    jobId = job.id;
    const ready = await waitForReady(dataSource, sourceId);
    const completedJob = jobId ? await queue.getJob(jobId) : null;

    if (!completedJob || (await completedJob.getState()) !== "completed") {
      throw new Error("BullMQ no marcó el trabajo como completed.");
    }

    if (completedJob.attemptsMade !== 1 || completedJob.failedReason) {
      throw new Error(
        `Intentos o error inesperado: attempts=${completedJob.attemptsMade}, error=${completedJob.failedReason}`,
      );
    }

    if (ready.extractedText !== content.toString("utf8")) {
      throw new Error("El texto extraído no coincide con el TXT original.");
    }

    await completedJob.remove();
    jobId = undefined;
    await sources.delete({ id: sourceId });
    await storage.deleteIfExists(blobPath);

    const finalCounts = await queue.getJobCounts(
      "active",
      "completed",
      "delayed",
      "failed",
      "paused",
      "prioritized",
      "waiting",
    );
    const remainingRows = await sources.count({ where: { id: sourceId } });

    if (
      Object.values(finalCounts).some((count) => count !== 0) ||
      remainingRows !== 0 ||
      (await storage.exists(blobPath))
    ) {
      throw new Error("La limpieza temporal del smoke no quedó completa.");
    }

    console.log("✓ Blob cargado, verificado y descargado con tamaño y SHA-256.");
    console.log("✓ Job recibido por Worker y completado en el primer intento.");
    console.log("✓ Fuente READY con texto extraído idéntico al TXT original.");
    console.log("✓ Job, fuente y blob temporales eliminados; cola limpia.");
  } finally {
    if (jobId) {
      const job = await queue.getJob(jobId);
      if (job && (await job.getState()) !== "active") await job.remove();
    }
    await sources.delete({ id: sourceId });
    await storage.deleteIfExists(blobPath);
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke asíncrono de Sources fallido: ${message}`);
  process.exitCode = 1;
});
