import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import type { SourceProcessingProgress } from "@levantamiento-rq/shared-contracts";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";

import { SourceBlobStorage } from "./source-blob-storage.service";
import { SourceExtractionService } from "./source-extraction.service";
import { MalwareDetectedError, SourceAntimalwareService } from "./source-antimalware.service";
import { SourceEntity } from "./source.entity";
import type { SourceProcessingJobData } from "./source-processing.queue";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 2000)
    : "No fue posible procesar el archivo.";
}

export type SourceProcessingProgressReporter = (
  progress: SourceProcessingProgress,
) => Promise<void>;

@Injectable()
export class SourceProcessingService {
  constructor(
    @InjectRepository(SourceEntity)
    private readonly sources: Repository<SourceEntity>,
    @Inject(SourceBlobStorage)
    private readonly storage: SourceBlobStorage,
    @Inject(SourceExtractionService)
    private readonly extraction: SourceExtractionService,
    @Inject(SourceAntimalwareService)
    private readonly antimalware: SourceAntimalwareService,
    @Inject(IntegrationEventsPublisher)
    private readonly events: IntegrationEventsPublisher,
  ) {}

  async process(
    data: SourceProcessingJobData,
    attempt: number,
    reportProgress?: SourceProcessingProgressReporter,
  ): Promise<void> {
    let lastPercentage = 0;

    const report = async (
      percentage: number,
      stage: SourceProcessingProgress["stage"],
      message: string,
    ): Promise<void> => {
      lastPercentage = Math.max(
        lastPercentage,
        Math.min(100, Math.round(percentage)),
      );

      if (!reportProgress) {
        return;
      }

      /*
       * El progreso es observabilidad.
       * Nunca debe hacer fallar la extracción del archivo.
       */
      try {
        await reportProgress({
          percentage: lastPercentage,
          stage,
          message,
        });
      } catch {
        // El procesamiento funcional continúa.
      }
    };

    await report(
      10,
      "PREPARING",
      "Preparando archivo",
    );

    const source = await this.sources.findOne({
      where: { id: data.sourceId },
    });

    if (!source) {
      throw new Error(`La fuente ${data.sourceId} no existe.`);
    }

    source.processingStatus = "PROCESSING";
    source.processingMessage =
      `Procesando archivo. Intento ${attempt}.`;
    source.updatedByUserId = data.actorId;
    source.updatedAt = new Date();
    await this.sources.save(source);

    try {
      if (!source.storagePath || !source.fileExtension) {
        throw new Error(
          "La fuente no contiene almacenamiento procesable.",
        );
      }

      await report(
        25,
        "DOWNLOADING",
        "Leyendo archivo almacenado",
      );

      const buffer = await this.storage.download(
        source.storagePath,
      );

      await report(
        40,
        "VALIDATING",
        "Verificando integridad del archivo",
      );

      const actualSha256 = createHash("sha256")
        .update(buffer)
        .digest("hex");

      if (source.fileSizeBytes !== String(buffer.length)) {
        throw new Error(
          "El tamaño descargado no coincide con la fuente.",
        );
      }

      if (source.sha256 !== actualSha256) {
        throw new Error(
          "El SHA-256 descargado no coincide con la fuente.",
        );
      }

      source.securityStatus = "SCANNING";
      source.updatedAt = new Date();
      await this.sources.save(source);
      const scan = await this.antimalware.scan(
        buffer,
        source.originalFileName ?? source.id,
        source.mediaType ?? "application/octet-stream",
      );
      source.securityScanner = `${scan.engine}${scan.signatureVersion ? `:${scan.signatureVersion}` : ""}`.slice(0, 100);
      source.securityScannedAt = new Date();
      if (scan.verdict === "INFECTED") {
        source.securityStatus = "INFECTED";
        await this.sources.save(source);
        throw new MalwareDetectedError();
      }
      source.securityStatus = "CLEAN";
      await this.sources.save(source);

      await report(
        55,
        "EXTRACTING",
        "Extrayendo contenido",
      );

      const result = await this.extraction.extract(
        source.fileExtension,
        buffer,
      );

      await report(
        80,
        "NORMALIZING",
        "Organizando contenido extraído",
      );

      source.extractedText = result.extractedText;
      source.processingStatus = "READY";
      source.processingMessage = result.processingMessage;
      source.processedAt = new Date();
      source.pageCount = result.pageCount;
      source.sheetCount = result.sheetCount;
      source.updatedByUserId = data.actorId;
      source.updatedAt = new Date();

      await report(
        90,
        "PERSISTING",
        "Guardando resultados",
      );

      await this.sources.save(source);

      await report(
        95,
        "FINALIZING",
        "Finalizando procesamiento",
      );

      await this.events.publish({
        eventName: "source.ready",
        correlationId: data.correlationId,
        data: {
          projectId: source.projectId,
          sourceId: source.id,
          processingStatus: source.processingStatus,
          processedAt: source.processedAt.toISOString(),
        },
      });

      await report(
        100,
        "COMPLETED",
        "Procesamiento completo",
      );
    } catch (error) {
      const failure = messageOf(error);

      await report(
        lastPercentage,
        "FAILED",
        failure,
      );

      source.extractedText = null;
      source.processingStatus = "FAILED";
      if (error instanceof MalwareDetectedError) {
        source.securityStatus = "INFECTED";
      }
      source.processingMessage = failure;
      source.processedAt = new Date();
      source.pageCount = null;
      source.sheetCount = null;
      source.updatedByUserId = data.actorId;
      source.updatedAt = new Date();
      await this.sources.save(source);

      throw error;
    }
  }
}
