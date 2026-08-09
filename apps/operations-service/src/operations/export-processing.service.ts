import { createHash, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";

import { OperationsDocumentsAccessClient } from "./documents-access.client";
import { ExportArtifactStorage } from "./export-artifact-storage.service";
import { renderDocx, renderPdf } from "./export-document.renderer";
import {
  AuditEventEntity,
  ExportArtifactEntity,
  ExportRequestEntity,
} from "./operation.entities";
import {
  OPERATIONS_SERVICE_ACTOR,
  OperationsServiceToken,
} from "./operations-service-token.service";
import { OperationsProjectsAccessClient } from "./projects-access.client";

function safeFilePart(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "documento"
  );
}

@Injectable()
export class ExportProcessingService {
  constructor(
    @InjectRepository(ExportRequestEntity)
    private readonly exports: Repository<ExportRequestEntity>,
    @InjectRepository(ExportArtifactEntity)
    private readonly artifacts: Repository<ExportArtifactEntity>,
    private readonly dataSource: DataSource,
    private readonly projects: OperationsProjectsAccessClient,
    private readonly documents: OperationsDocumentsAccessClient,
    private readonly serviceToken: OperationsServiceToken,
    private readonly storage: ExportArtifactStorage,
    private readonly events: IntegrationEventsPublisher,
  ) {}

  async process(
    exportRequestId: string,
    attemptNumber: number,
    finalAttempt: boolean,
    jobCorrelationId: string,
  ): Promise<void> {
    const request = await this.exports.findOneBy({ id: exportRequestId });
    if (!request) throw new Error("La solicitud de exportación no existe.");
    if (request.status === "CANCELLED") return;

    const existingArtifact = await this.artifacts.findOneBy({
      exportRequestId: request.id,
    });
    if (
      request.status === "COMPLETED" &&
      existingArtifact &&
      (await this.storage.exists(existingArtifact.storagePath))
    ) {
      return;
    }

    const correlationId = request.correlationId || jobCorrelationId;
    const startedAt = request.startedAt ?? new Date();
    await this.exports.update(request.id, {
      status: "PROCESSING",
      attemptCount: Math.max(request.attemptCount, attemptNumber),
      errorCode: null,
      errorMessage: null,
      startedAt,
      updatedAt: new Date(),
    });

    try {
      const accessToken = await this.serviceToken.issue();
      const [{ document, version }, project] = await Promise.all([
        this.documents.requireApprovedVersion(
          request.projectId,
          request.documentId,
          request.versionNumber,
          accessToken,
          correlationId,
        ),
        this.projects.requireRead(
          request.projectId,
          accessToken,
          OPERATIONS_SERVICE_ACTOR,
          correlationId,
        ),
      ]);
      if (
        version.id.toLowerCase() !== request.documentVersionId.toLowerCase()
      ) {
        throw new Error("La versión aprobada no coincide con la solicitud.");
      }

      const generatedAt = new Date();
      const rendered =
        request.format === "PDF"
          ? await renderPdf({ project, document, version, generatedAt })
          : await renderDocx({ project, document, version, generatedAt });
      const fileName = `${safeFilePart(project.code)}-${safeFilePart(document.title)}-v${safeFilePart(version.version)}.${rendered.extension}`;
      const blobPath = [
        "projects",
        request.projectId.toLowerCase(),
        "documents",
        request.documentId.toLowerCase(),
        "versions",
        String(request.versionNumber),
        `${request.id.toLowerCase()}.${rendered.extension}`,
      ].join("/");
      const sha256 = createHash("sha256").update(rendered.buffer).digest("hex");
      await this.storage.upload(
        blobPath,
        rendered.buffer,
        rendered.mediaType,
        fileName,
        sha256,
      );

      await this.dataSource.transaction(async (manager) => {
        const artifactRepository = manager.getRepository(ExportArtifactEntity);
        const previous = await artifactRepository.findOneBy({
          exportRequestId: request.id,
        });
        await artifactRepository.save(
          artifactRepository.create({
            id: previous?.id ?? randomUUID(),
            exportRequestId: request.id,
            storageContainer: this.storage.containerName,
            storagePath: blobPath,
            fileName,
            mediaType: rendered.mediaType,
            sizeBytes: String(rendered.buffer.length),
            sha256,
            createdAt: generatedAt,
          }),
        );
        await manager.update(ExportRequestEntity, request.id, {
          status: "COMPLETED",
          attemptCount: Math.max(request.attemptCount, attemptNumber),
          errorCode: null,
          errorMessage: null,
          completedAt: generatedAt,
          updatedAt: generatedAt,
        });
        await manager.save(
          manager.create(AuditEventEntity, {
            id: randomUUID(),
            actorUserId: OPERATIONS_SERVICE_ACTOR.id,
            projectId: request.projectId,
            action: "EXPORT_COMPLETED",
            resourceType: "ExportRequest",
            resourceId: request.id,
            result: "SUCCEEDED",
            correlationId,
            ipAddress: null,
            userAgent: "operations-service/worker",
            metadataJson: JSON.stringify({
              documentId: request.documentId,
              documentVersionId: request.documentVersionId,
              versionNumber: request.versionNumber,
              format: request.format,
              sizeBytes: rendered.buffer.length,
              sha256,
            }),
            occurredAt: generatedAt,
          }),
        );
      });
      await this.events.publish({
        eventName: "export.completed",
        correlationId,
        data: {
          exportRequestId: request.id,
          projectId: request.projectId,
          documentId: request.documentId,
          documentVersionId: request.documentVersionId,
          format: request.format,
          fileName,
          sizeBytes: rendered.buffer.length,
        },
      });
    } catch {
      const now = new Date();
      const status = finalAttempt ? "FAILED" : "PENDING";
      const errorMessage = finalAttempt
        ? "No fue posible generar el archivo tras agotar los reintentos."
        : "La generación no terminó y se reintentará automáticamente.";
      await this.exports.update(request.id, {
        status,
        attemptCount: Math.max(request.attemptCount, attemptNumber),
        errorCode: "EXPORT_GENERATION_FAILED",
        errorMessage,
        updatedAt: now,
      });
      if (finalAttempt) {
        await this.dataSource.getRepository(AuditEventEntity).save({
          id: randomUUID(),
          actorUserId: OPERATIONS_SERVICE_ACTOR.id,
          projectId: request.projectId,
          action: "EXPORT_FAILED",
          resourceType: "ExportRequest",
          resourceId: request.id,
          result: "FAILED",
          correlationId,
          ipAddress: null,
          userAgent: "operations-service/worker",
          metadataJson: JSON.stringify({
            documentId: request.documentId,
            documentVersionId: request.documentVersionId,
            versionNumber: request.versionNumber,
            format: request.format,
            errorCode: "EXPORT_GENERATION_FAILED",
          }),
          occurredAt: now,
        });
        await this.events.publish({
          eventName: "export.failed",
          correlationId,
          data: {
            exportRequestId: request.id,
            projectId: request.projectId,
            documentId: request.documentId,
            format: request.format,
            errorCode: "EXPORT_GENERATION_FAILED",
          },
        });
      }
      throw new Error(errorMessage);
    }
  }
}
