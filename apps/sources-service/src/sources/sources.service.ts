import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import type {
  AuthenticatedUser,
  CreateTextSourceRequest,
  ProcessSourcesRequest,
  SourceBatchProcessingResponse,
  SourceBatchProcessingResult,
  SourceClassification,
  SourceDetail,
  SourceFileExtension,
  SourceProcessingStatus,
  SourceListResponse,
  SourceMetrics,
  SourceSummary,
  SourceUploadBatchResponse,
  SourceUploadRejected,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { ProjectsAccessClient } from "./projects-access.client";
import {
  SourceBlobNotFoundError,
  SourceBlobStorage,
} from "./source-blob-storage.service";
import { SourceEntity } from "./source.entity";
import { SourceProcessingQueue } from "./source-processing.queue";
import {
  titleFromFileName,
  validateSourceFile,
} from "./source-file-validation";
import type { SourceListQuery } from "./sources-input";
import {
  SOURCES_STORAGE_CONFIG,
  type SourcesStorageConfig,
} from "./sources-storage.config";

export interface IncomingSourceFile {
  fileName: string;
  mediaType: string;
  buffer: Buffer;
  classification?: SourceClassification | null | "";
  description: string | null;
}

export interface SourceDownloadPayload {
  buffer: Buffer;
  mediaType: string;
  fileName: string;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function textSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function contentPreview(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const normalized = content.replace(/\s+/g, " ").trim();

  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 2000);
  }

  return "No fue posible procesar el archivo.";
}

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(SourceEntity)
    private readonly sources: Repository<SourceEntity>,
    @Inject(ProjectsAccessClient)
    private readonly projectAccess: ProjectsAccessClient,
    @Inject(SourceBlobStorage)
    private readonly storage: SourceBlobStorage,
    @Inject(SourceProcessingQueue)
    private readonly processingQueue: SourceProcessingQueue,
    @Inject(SOURCES_STORAGE_CONFIG)
    private readonly storageConfig: SourcesStorageConfig,
  ) {}

  async createText(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    request: CreateTextSourceRequest,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);

    const now = new Date();
    const source = this.sources.create({
      id: randomUUID(),
      projectId,
      sourceType: request.sourceType,
      title: request.title,
      description: null,
      classification: null,
      content: request.content,
      extractedText: request.content,
      processingStatus: "READY",
      processingMessage: null,
      processedAt: now,
      status: "ACTIVE",
      originalFileName: null,
      fileExtension: null,
      mediaType: "text/plain; charset=utf-8",
      fileSizeBytes: String(Buffer.byteLength(request.content, "utf8")),
      sha256: textSha256(request.content),
      storageContainer: null,
      storagePath: null,
      pageCount: null,
      sheetCount: null,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    return this.toDetail(await this.sources.save(source));
  }

  async uploadFiles(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    files: readonly IncomingSourceFile[],
  ): Promise<SourceUploadBatchResponse> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);

    if (files.length === 0) {
      throw new BadRequestException("Debes seleccionar al menos un archivo.");
    }

    if (files.length > this.storageConfig.maxFilesPerUpload) {
      throw new BadRequestException(
        `Solo puedes cargar ${this.storageConfig.maxFilesPerUpload} archivos por operación.`,
      );
    }

    const totalBytes = files.reduce(
      (total, file) => total + file.buffer.length,
      0,
    );

    if (totalBytes > this.storageConfig.maxBatchBytes) {
      throw new BadRequestException(
        "El tamaño total de la carga supera el límite permitido.",
      );
    }

    const accepted: SourceDetail[] = [];
    const rejected: SourceUploadRejected[] = [];

    for (const incoming of files) {
      try {
        const validated = validateSourceFile(
          incoming.fileName,
          incoming.buffer,
          this.storageConfig.maxFileBytes,
        );
        const fileSha256 = sha256(validated.buffer);
        const duplicate = await this.sources.findOne({
          where: {
            projectId,
            sourceType: "FILE",
            status: "ACTIVE",
            sha256: fileSha256,
          },
        });

        if (duplicate) {
          rejected.push({
            fileName: validated.originalFileName,
            reason:
              "Ya existe un archivo activo con el mismo contenido en este proyecto.",
            duplicateSourceId: duplicate.id,
          });
          continue;
        }

        accepted.push(
          await this.persistFile(
            actor,
            projectId,
            validated.originalFileName,
            validated.extension,
            validated.mediaType,
            validated.buffer,
            fileSha256,
            incoming.classification || "OTHER",
            incoming.description,
          ),
        );
      } catch (error) {
        rejected.push({
          fileName: incoming.fileName || "Archivo sin nombre",
          reason: errorMessage(error),
        });
      }
    }

    return {
      accepted,
      rejected,
      totalFiles: files.length,
      acceptedFiles: accepted.length,
      rejectedFiles: rejected.length,
    };
  }

  async list(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    query: SourceListQuery,
  ): Promise<SourceListResponse> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);

    const builder = this.sources
      .createQueryBuilder("source")
      .where("source.projectId = :projectId", { projectId });

    if (query.search) {
      builder.andWhere(
        `(source.title LIKE :search
          OR source.content LIKE :search
          OR source.extractedText LIKE :search
          OR source.originalFileName LIKE :search
          OR source.description LIKE :search
          OR source.classification LIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    if (query.sourceType) {
      builder.andWhere("source.sourceType = :sourceType", {
        sourceType: query.sourceType,
      });
    }

    if (query.processingStatus) {
      builder.andWhere("source.processingStatus = :processingStatus", {
        processingStatus: query.processingStatus,
      });
    }

    if (query.status) {
      builder.andWhere("source.status = :status", {
        status: query.status,
      });
    }

    const totalItems = await builder.getCount();
    const rows = await builder
      .clone()
      .orderBy("source.updatedAt", "DESC")
      .addOrderBy("source.title", "ASC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getMany();

    return {
      items: rows.map((source) => this.toSummary(source)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    };
  }

  async metrics(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
  ): Promise<SourceMetrics> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);

    const row = await this.sources
      .createQueryBuilder("source")
      .select("COUNT(1)", "total")
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'FILE' THEN 1 ELSE 0 END)",
        "files",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'NOTE' THEN 1 ELSE 0 END)",
        "notes",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'CONVERSATION' THEN 1 ELSE 0 END)",
        "conversations",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'TRANSCRIPT' THEN 1 ELSE 0 END)",
        "transcripts",
      )
      .addSelect(
        "SUM(CASE WHEN source.processingStatus = 'READY' THEN 1 ELSE 0 END)",
        "ready",
      )
      .addSelect(
        `SUM(CASE WHEN source.processingStatus IN ('PENDING', 'PROCESSING')
          THEN 1 ELSE 0 END)`,
        "pending",
      )
      .addSelect(
        "SUM(CASE WHEN source.processingStatus = 'FAILED' THEN 1 ELSE 0 END)",
        "failed",
      )
      .addSelect(
        "SUM(CASE WHEN source.status = 'ARCHIVED' THEN 1 ELSE 0 END)",
        "archived",
      )
      .where("source.projectId = :projectId", { projectId })
      .getRawOne<Record<string, number | string | null>>();

    const numberValue = (name: string): number => {
      const value = Number(row?.[name] ?? 0);
      return Number.isFinite(value) ? value : 0;
    };

    return {
      total: numberValue("total"),
      files: numberValue("files"),
      notes: numberValue("notes"),
      conversations: numberValue("conversations"),
      transcripts: numberValue("transcripts"),
      ready: numberValue("ready"),
      pending: numberValue("pending"),
      failed: numberValue("failed"),
      archived: numberValue("archived"),
    };
  }

  async getById(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);
    return this.toDetail(await this.requireSource(projectId, sourceId));
  }

  async update(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
    request: UpdateSourceRequest,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);
    const source = await this.requireSource(projectId, sourceId);

    if (request.title !== undefined) {
      source.title = request.title;
    }

    if (request.content !== undefined) {
      if (source.sourceType === "FILE") {
        throw new BadRequestException(
          "El contenido extraído de un archivo no se edita manualmente.",
        );
      }

      source.content = request.content;
      source.extractedText = request.content;
      source.processingStatus = "READY";
      source.processingMessage = null;
      source.processedAt = new Date();
      source.mediaType = "text/plain; charset=utf-8";
      source.fileSizeBytes = String(Buffer.byteLength(request.content, "utf8"));
      source.sha256 = textSha256(request.content);
    }

    if (request.description !== undefined) {
      source.description = request.description;
    }

    if (request.classification !== undefined) {
      if (source.sourceType !== "FILE") {
        throw new BadRequestException(
          "La clasificación se aplica únicamente a archivos.",
        );
      }

      source.classification = request.classification;
    }

    source.updatedByUserId = actor.id;
    source.updatedAt = new Date();

    return this.toDetail(await this.sources.save(source));
  }

  async reprocess(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);
    const source = await this.requireFileSource(projectId, sourceId);

    if (!source.storagePath || !source.fileExtension) {
      throw new BadRequestException(
        "La fuente no contiene una referencia de almacenamiento válida.",
      );
    }

    source.processingStatus = "PENDING";
    source.processingMessage = "Reprocesamiento encolado.";
    source.processedAt = null;
    source.updatedByUserId = actor.id;
    source.updatedAt = new Date();
    await this.sources.save(source);
    await this.processingQueue.enqueue(source.id, actor.id);

    return this.toDetail(source);
  }

  async processSelected(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    request: ProcessSourcesRequest,
  ): Promise<SourceBatchProcessingResponse> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);

    return this.processFiles(actor, projectId, request.sourceIds, true);
  }

  async processAll(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
  ): Promise<SourceBatchProcessingResponse> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);

    const eligible = await this.sources.find({
      select: { id: true },
      where: {
        projectId,
        sourceType: "FILE",
        status: "ACTIVE",
        processingStatus: In(["PENDING", "FAILED"]),
      },
      order: { createdAt: "ASC" },
    });

    return this.processFiles(
      actor,
      projectId,
      eligible.map((source) => source.id),
      false,
    );
  }

  async download(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDownloadPayload> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);
    const source = await this.requireFileSource(projectId, sourceId);

    if (!source.storagePath || !source.originalFileName) {
      throw new BadRequestException(
        "La fuente no contiene un archivo descargable.",
      );
    }

    try {
      return {
        buffer: await this.storage.download(source.storagePath),
        mediaType: source.mediaType ?? "application/octet-stream",
        fileName: source.originalFileName,
      };
    } catch (error) {
      if (error instanceof SourceBlobNotFoundError) {
        throw new NotFoundException(
          "El archivo original ya no está disponible en el almacenamiento. Elimina esta fuente y carga el archivo nuevamente.",
        );
      }

      throw error;
    }
  }

  async archive(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);
    const source = await this.requireSource(projectId, sourceId);

    source.status = "ARCHIVED";
    source.updatedByUserId = actor.id;
    source.updatedAt = new Date();

    return this.toDetail(await this.sources.save(source));
  }

  private async persistFile(
    actor: AuthenticatedUser,
    projectId: string,
    originalFileName: string,
    extension: SourceFileExtension,
    mediaType: string,
    buffer: Buffer,
    fileSha256: string,
    classification: SourceClassification,
    description: string | null,
  ): Promise<SourceDetail> {
    const sourceId = randomUUID();
    const blobPath = `${projectId}/${sourceId}/${fileSha256.slice(0, 16)}.${extension}`;
    let blobUploaded = false;
    let sourceSaved = false;

    try {
      await this.storage.upload(
        blobPath,
        buffer,
        mediaType,
        originalFileName,
        fileSha256,
      );
      blobUploaded = true;

      const now = new Date();
      const source = this.sources.create({
        id: sourceId,
        projectId,
        sourceType: "FILE",
        title: titleFromFileName(originalFileName),
        description,
        classification,
        content: null,
        extractedText: null,
        processingStatus: "PENDING",
        processingMessage: "Archivo almacenado. Procesamiento pendiente.",
        processedAt: null,
        status: "ACTIVE",
        originalFileName,
        fileExtension: extension,
        mediaType,
        fileSizeBytes: String(buffer.length),
        sha256: fileSha256,
        storageContainer: this.storage.containerName,
        storagePath: blobPath,
        pageCount: null,
        sheetCount: null,
        createdByUserId: actor.id,
        updatedByUserId: actor.id,
        createdAt: now,
        updatedAt: now,
      });

      await this.sources.save(source);
      sourceSaved = true;
      return this.toDetail(source);
    } catch (error) {
      if (blobUploaded && !sourceSaved) {
        await this.storage.deleteIfExists(blobPath);
      }

      throw error;
    }
  }

  private async processFiles(
    actor: AuthenticatedUser,
    projectId: string,
    sourceIds: readonly string[],
    allowReady: boolean,
  ): Promise<SourceBatchProcessingResponse> {
    if (sourceIds.length === 0) {
      return {
        requested: 0,
        enqueued: 0,
        skipped: 0,
        failed: 0,
        results: [],
      };
    }

    const uniqueSourceIds = [...new Set(sourceIds)];
    const available = await this.sources.find({
      where: {
        projectId,
        id: In(uniqueSourceIds),
      },
    });
    const sourceById = new Map(available.map((source) => [source.id, source]));
    const results: SourceBatchProcessingResult[] = [];

    for (const sourceId of uniqueSourceIds) {
      const source = sourceById.get(sourceId);

      if (!source) {
        results.push({
          sourceId,
          status: "FAILED",
          message: "La fuente no existe en este proyecto.",
        });
        continue;
      }

      const skipMessage = this.batchSkipMessage(source, allowReady);

      if (skipMessage) {
        results.push({
          sourceId,
          status: "SKIPPED",
          message: skipMessage,
        });
        continue;
      }

      const now = new Date();
      const isReprocess = source.processingStatus === "READY";
      const claimableStatuses: readonly SourceProcessingStatus[] = allowReady
        ? ["PENDING", "FAILED", "READY"]
        : ["PENDING", "FAILED"];
      const claimed = await this.sources.update(
        {
          id: sourceId,
          projectId,
          sourceType: "FILE",
          status: "ACTIVE",
          processingStatus: In(claimableStatuses),
        },
        {
          processingStatus: "PROCESSING",
          processingMessage: isReprocess
            ? "Reprocesamiento encolado."
            : "Procesamiento encolado.",
          processedAt: null,
          updatedByUserId: actor.id,
          updatedAt: now,
        },
      );

      if (claimed.affected !== 1) {
        results.push({
          sourceId,
          status: "SKIPPED",
          message: "La fuente cambió de estado y ya no requiere procesamiento.",
        });
        continue;
      }

      try {
        await this.processingQueue.enqueue(sourceId, actor.id);
        results.push({
          sourceId,
          status: "ENQUEUED",
          message: isReprocess
            ? "Archivo encolado para reprocesamiento."
            : "Archivo encolado para procesamiento.",
        });
      } catch (error) {
        await this.sources.update(
          {
            id: sourceId,
            projectId,
            processingStatus: "PROCESSING",
          },
          {
            processingStatus: "FAILED",
            processingMessage: `No fue posible encolar el procesamiento: ${errorMessage(error)}`,
            processedAt: new Date(),
            updatedByUserId: actor.id,
            updatedAt: new Date(),
          },
        );
        results.push({
          sourceId,
          status: "FAILED",
          message: errorMessage(error),
        });
      }
    }

    return {
      requested: uniqueSourceIds.length,
      enqueued: results.filter((result) => result.status === "ENQUEUED").length,
      skipped: results.filter((result) => result.status === "SKIPPED").length,
      failed: results.filter((result) => result.status === "FAILED").length,
      results,
    };
  }

  private batchSkipMessage(
    source: SourceEntity,
    allowReady: boolean,
  ): string | null {
    if (source.sourceType !== "FILE") {
      return "La fuente no corresponde a un archivo.";
    }

    if (source.status !== "ACTIVE") {
      return "La fuente está archivada.";
    }

    if (source.processingStatus === "PROCESSING") {
      return "El archivo ya se está procesando.";
    }

    if (source.processingStatus === "READY" && !allowReady) {
      return "El archivo ya está listo.";
    }

    return null;
  }

  private async requireSource(
    projectId: string,
    sourceId: string,
  ): Promise<SourceEntity> {
    const source = await this.sources.findOne({
      where: {
        id: sourceId,
        projectId,
      },
    });

    if (!source) {
      throw new NotFoundException("La fuente no existe en este proyecto.");
    }

    return source;
  }

  private async requireFileSource(
    projectId: string,
    sourceId: string,
  ): Promise<SourceEntity> {
    const source = await this.requireSource(projectId, sourceId);

    if (source.sourceType !== "FILE") {
      throw new BadRequestException(
        "La fuente seleccionada no corresponde a un archivo.",
      );
    }

    return source;
  }

  private toSummary(source: SourceEntity): SourceSummary {
    return {
      id: source.id,
      projectId: source.projectId,
      sourceType: source.sourceType,
      title: source.title,
      description: source.description,
      classification: source.classification,
      contentPreview: contentPreview(source.extractedText ?? source.content),
      processingStatus: source.processingStatus,
      processingMessage: source.processingMessage,
      processedAt: optionalIso(source.processedAt),
      status: source.status,
      originalFileName: source.originalFileName,
      fileExtension: source.fileExtension,
      mediaType: source.mediaType,
      fileSizeBytes: source.fileSizeBytes,
      sha256: source.sha256,
      pageCount: source.pageCount,
      sheetCount: source.sheetCount,
      createdByUserId: source.createdByUserId,
      updatedByUserId: source.updatedByUserId,
      createdAt: toIso(source.createdAt),
      updatedAt: toIso(source.updatedAt),
    };
  }

  private toDetail(source: SourceEntity): SourceDetail {
    return {
      ...this.toSummary(source),
      content: source.content,
      extractedText: source.extractedText,
      storageContainer: source.storageContainer,
      storagePath: source.storagePath,
    };
  }
}
