import { randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type {
  AuthenticatedUser,
  CreateExportRequest,
  ExportArtifactDetail,
  ExportRequestDetail,
  ExportRequestListResponse,
} from "@levantamiento-rq/shared-contracts";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";

import { OperationsDocumentsAccessClient } from "./documents-access.client";
import { ExportProcessingQueue } from "./export-processing.queue";
import {
  AuditEventEntity,
  ExportArtifactEntity,
  ExportRequestEntity,
} from "./operation.entities";
import { OperationsProjectsAccessClient } from "./projects-access.client";

export interface OperationsActorContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
  idempotencyKey: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const iso = (value: Date) => value.toISOString();
const optionalIso = (value: Date | null) =>
  value ? value.toISOString() : null;

@Injectable()
export class ExportRequestsService {
  constructor(
    @InjectRepository(ExportRequestEntity)
    private readonly exports: Repository<ExportRequestEntity>,
    @InjectRepository(ExportArtifactEntity)
    private readonly artifacts: Repository<ExportArtifactEntity>,
    private readonly dataSource: DataSource,
    private readonly projects: OperationsProjectsAccessClient,
    private readonly documents: OperationsDocumentsAccessClient,
    private readonly queue: ExportProcessingQueue,
    private readonly events: IntegrationEventsPublisher,
  ) {}

  async create(
    context: OperationsActorContext,
    projectId: string,
    documentId: string,
    versionNumber: number,
    input: CreateExportRequest,
  ): Promise<ExportRequestDetail> {
    const idempotencyKey = context.idempotencyKey;
    if (!idempotencyKey) {
      throw new BadRequestException(
        "x-idempotency-key es obligatorio para solicitar exportaciones.",
      );
    }
    await this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const existing = await this.exports.findOneBy({
      requestedByUserId: context.actor.id,
      idempotencyKey,
    });
    if (existing) {
      if (
        existing.projectId.toLowerCase() === projectId.toLowerCase() &&
        existing.documentId.toLowerCase() === documentId.toLowerCase() &&
        existing.versionNumber === versionNumber &&
        existing.format === input.format
      ) {
        return this.detail(existing);
      }
      throw new ConflictException(
        "La clave idempotente ya fue utilizada por otra exportación.",
      );
    }
    const { version } = await this.documents.requireApprovedVersion(
      projectId,
      documentId,
      versionNumber,
      context.accessToken,
      context.correlationId,
    );
    const id = randomUUID();
    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(ExportRequestEntity, {
          id,
          projectId,
          documentId,
          documentVersionId: version.id,
          versionNumber,
          format: input.format,
          status: "PENDING",
          requestedByUserId: context.actor.id,
          correlationId: context.correlationId,
          idempotencyKey,
          attemptCount: 0,
          errorCode: null,
          errorMessage: null,
          requestedAt: now,
          startedAt: null,
          completedAt: null,
          updatedAt: now,
        }),
      );
      await manager.save(
        manager.create(AuditEventEntity, {
          id: randomUUID(),
          actorUserId: context.actor.id,
          projectId,
          action: "EXPORT_REQUESTED",
          resourceType: "ExportRequest",
          resourceId: id,
          result: "SUCCEEDED",
          correlationId: context.correlationId,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent?.slice(0, 500) ?? null,
          metadataJson: JSON.stringify({
            documentId,
            documentVersionId: version.id,
            versionNumber,
            format: input.format,
          }),
          occurredAt: now,
        }),
      );
    });
    try {
      await this.queue.enqueue(id, context.correlationId);
    } catch {
      await this.exports.update(id, {
        status: "FAILED",
        errorCode: "EXPORT_QUEUE_UNAVAILABLE",
        errorMessage: "La cola de exportaciones no está disponible.",
        updatedAt: new Date(),
      });
      throw new ServiceUnavailableException(
        "La solicitud fue registrada, pero la cola de exportaciones no está disponible.",
      );
    }
    await this.events.publish({
      eventName: "export.requested",
      correlationId: context.correlationId,
      data: {
        exportRequestId: id,
        projectId,
        documentId,
        documentVersionId: version.id,
        format: input.format,
        requestedByUserId: context.actor.id,
      },
    });
    return this.detail(await this.exports.findOneByOrFail({ id }));
  }

  async list(
    context: OperationsActorContext,
    projectId: string,
    documentId: string,
  ): Promise<ExportRequestListResponse> {
    await this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const rows = await this.exports.find({
      where: { projectId, documentId },
      order: { requestedAt: "DESC" },
    });
    return {
      items: await Promise.all(rows.map((row) => this.detail(row))),
      totalItems: rows.length,
    };
  }

  async getById(
    context: OperationsActorContext,
    exportRequestId: string,
  ): Promise<ExportRequestDetail> {
    const row = await this.requireExport(exportRequestId);
    await this.projects.requireRead(
      row.projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    return this.detail(row);
  }

  private async requireExport(id: string): Promise<ExportRequestEntity> {
    const row = await this.exports.findOneBy({ id });
    if (!row) throw new NotFoundException("La exportación no existe.");
    return row;
  }

  private async detail(row: ExportRequestEntity): Promise<ExportRequestDetail> {
    const artifact = await this.artifacts.findOneBy({
      exportRequestId: row.id,
    });
    return {
      id: row.id.toLowerCase(),
      projectId: row.projectId.toLowerCase(),
      documentId: row.documentId.toLowerCase(),
      documentVersionId: row.documentVersionId.toLowerCase(),
      versionNumber: row.versionNumber,
      format: row.format,
      status: row.status,
      requestedByUserId: row.requestedByUserId.toLowerCase(),
      attemptCount: row.attemptCount,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      requestedAt: iso(row.requestedAt),
      startedAt: optionalIso(row.startedAt),
      completedAt: optionalIso(row.completedAt),
      updatedAt: iso(row.updatedAt),
      artifact: artifact ? this.artifact(artifact) : null,
    };
  }

  private artifact(row: ExportArtifactEntity): ExportArtifactDetail {
    return {
      id: row.id.toLowerCase(),
      exportRequestId: row.exportRequestId.toLowerCase(),
      fileName: row.fileName,
      mediaType: row.mediaType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      createdAt: iso(row.createdAt),
    };
  }
}
