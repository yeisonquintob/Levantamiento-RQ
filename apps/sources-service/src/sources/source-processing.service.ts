import { createHash } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import { SourceBlobStorage } from "./source-blob-storage.service";
import { SourceExtractionService } from "./source-extraction.service";
import { SourceEntity } from "./source.entity";
import type { SourceProcessingJobData } from "./source-processing.queue";

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim().slice(0, 2000)
    : "No fue posible procesar el archivo.";
}

@Injectable()
export class SourceProcessingService {
  constructor(
    @InjectRepository(SourceEntity)
    private readonly sources: Repository<SourceEntity>,
    @Inject(SourceBlobStorage)
    private readonly storage: SourceBlobStorage,
    @Inject(SourceExtractionService)
    private readonly extraction: SourceExtractionService,
  ) {}

  async process(data: SourceProcessingJobData, attempt: number): Promise<void> {
    const source = await this.sources.findOne({ where: { id: data.sourceId } });

    if (!source) {
      throw new Error(`La fuente ${data.sourceId} no existe.`);
    }

    source.processingStatus = "PROCESSING";
    source.processingMessage = `Extrayendo contenido. Intento ${attempt}.`;
    source.updatedByUserId = data.actorId;
    source.updatedAt = new Date();
    await this.sources.save(source);

    try {
      if (!source.storagePath || !source.fileExtension) {
        throw new Error("La fuente no contiene almacenamiento procesable.");
      }

      const buffer = await this.storage.download(source.storagePath);
      const actualSha256 = createHash("sha256").update(buffer).digest("hex");

      if (source.fileSizeBytes !== String(buffer.length)) {
        throw new Error("El tamaño descargado no coincide con la fuente.");
      }

      if (source.sha256 !== actualSha256) {
        throw new Error("El SHA-256 descargado no coincide con la fuente.");
      }

      const result = await this.extraction.extract(source.fileExtension, buffer);

      source.extractedText = result.extractedText;
      source.processingStatus = "READY";
      source.processingMessage = result.processingMessage;
      source.processedAt = new Date();
      source.pageCount = result.pageCount;
      source.sheetCount = result.sheetCount;
      source.updatedByUserId = data.actorId;
      source.updatedAt = new Date();
      await this.sources.save(source);
    } catch (error) {
      source.extractedText = null;
      source.processingStatus = "FAILED";
      source.processingMessage = messageOf(error);
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
