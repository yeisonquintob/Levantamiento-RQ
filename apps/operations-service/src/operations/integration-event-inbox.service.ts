import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type {
  IntegrationEventEnvelope,
  NotificationType,
  ProjectDetail,
} from "@levantamiento-rq/shared-contracts";

import {
  AuditEventEntity,
  IntegrationEventInboxEntity,
  NotificationDeliveryEntity,
  NotificationRequestEntity,
} from "./operation.entities";
import { OperationsProjectsAccessClient } from "./projects-access.client";
import {
  OPERATIONS_SERVICE_ACTOR,
  OperationsServiceToken,
} from "./operations-service-token.service";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONSUMED_EVENTS = [
  "review.requested",
  "review.changes-requested",
  "document.approved",
  "document.rejected",
  "analysis.failed",
  "export.completed",
  "export.failed",
] as const;

export type ConsumedEventName = (typeof CONSUMED_EVENTS)[number];

interface NotificationDefinition {
  recipients: readonly string[];
  type: NotificationType;
  subject: string;
  body: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string | null;
  auditAction: string;
  auditResult: "SUCCEEDED" | "FAILED";
  auditMetadata: Readonly<Record<string, unknown>>;
  auditAlreadyRecorded?: boolean;
}

export class PermanentIntegrationEventError extends Error {}

function requiredId(data: Readonly<Record<string, unknown>>, key: string) {
  const value = data[key];
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new PermanentIntegrationEventError(
      `El evento no contiene ${key} válido.`,
    );
  }
  return value.toLowerCase();
}

function requiredText(
  data: Readonly<Record<string, unknown>>,
  key: string,
  maximum = 260,
) {
  const value = data[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new PermanentIntegrationEventError(
      `El evento no contiene ${key} válido.`,
    );
  }
  return value.trim();
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

@Injectable()
export class IntegrationEventInboxService {
  constructor(
    @InjectRepository(IntegrationEventInboxEntity)
    private readonly inbox: Repository<IntegrationEventInboxEntity>,
    private readonly dataSource: DataSource,
    private readonly projects: OperationsProjectsAccessClient,
    private readonly serviceToken: OperationsServiceToken,
  ) {}

  accepts(eventName: string): eventName is ConsumedEventName {
    return (CONSUMED_EVENTS as readonly string[]).includes(eventName);
  }

  async process(
    event: IntegrationEventEnvelope,
  ): Promise<"PROCESSED" | "DUPLICATE"> {
    if (!this.accepts(event.eventName)) return "PROCESSED";
    this.requireTrustedProducer(event);
    const existing = await this.inbox.findOneBy({ eventId: event.eventId });
    if (existing?.status === "PROCESSED") return "DUPLICATE";

    const projectId = requiredId(event.data, "projectId");
    const project = await this.project(projectId, event.correlationId);
    const definition = this.definition(event, project);
    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const lock = (await manager.query(
        `DECLARE @result int;
         EXEC @result = sys.sp_getapplock
           @Resource = @0,
           @LockMode = N'Exclusive',
           @LockOwner = N'Transaction',
           @LockTimeout = 10000;
         SELECT @result AS Result;`,
        [`operations.integration-event.${event.eventId}`],
      )) as Array<{ Result: number }>;
      if ((lock[0]?.Result ?? -999) < 0) {
        throw new Error(
          "No se pudo obtener el bloqueo idempotente del evento.",
        );
      }
      let row = await manager.findOneBy(IntegrationEventInboxEntity, {
        eventId: event.eventId,
      });
      if (row?.status === "PROCESSED") return;
      if (!row) {
        row = manager.create(IntegrationEventInboxEntity, {
          id: randomUUID(),
          eventId: event.eventId,
          eventName: event.eventName,
          correlationId: event.correlationId,
          receivedAt: now,
          processedAt: null,
          status: "RECEIVED",
          errorMessage: null,
        });
        await manager.save(row);
      } else {
        row.status = "RECEIVED";
        row.errorMessage = null;
        await manager.save(row);
      }

      for (const recipientUserId of definition.recipients) {
        const notification = manager.create(NotificationRequestEntity, {
          id: randomUUID(),
          recipientUserId,
          projectId,
          notificationType: definition.type,
          channel: "IN_APP",
          status: "DELIVERED",
          subject: definition.subject,
          body: definition.body,
          resourceType: definition.resourceType,
          resourceId: definition.resourceId,
          createdAt: now,
          updatedAt: now,
        });
        await manager.save(notification);
        await manager.save(
          manager.create(NotificationDeliveryEntity, {
            id: randomUUID(),
            notificationRequestId: notification.id,
            attempt: 1,
            status: "DELIVERED",
            provider: "IN_APP",
            errorCode: null,
            attemptedAt: now,
          }),
        );
      }

      if (!definition.auditAlreadyRecorded) {
        await manager.save(
          manager.create(AuditEventEntity, {
            id: randomUUID(),
            actorUserId: definition.actorUserId,
            projectId,
            action: definition.auditAction,
            resourceType: definition.resourceType,
            resourceId: definition.resourceId,
            result: definition.auditResult,
            correlationId: event.correlationId,
            ipAddress: null,
            userAgent: `${event.producer}/integration-event`,
            metadataJson: JSON.stringify(definition.auditMetadata),
            occurredAt: new Date(event.occurredAtUtc),
          }),
        );
      }

      row.status = "PROCESSED";
      row.processedAt = now;
      row.errorMessage = null;
      await manager.save(row);
    });
    return "PROCESSED";
  }

  async markFailed(event: IntegrationEventEnvelope, error: unknown) {
    const safeMessage =
      error instanceof PermanentIntegrationEventError
        ? error.message.slice(0, 2_000)
        : "El evento no pudo procesarse y se reintentará.";
    const existing = await this.inbox.findOneBy({ eventId: event.eventId });
    if (existing?.status === "PROCESSED") return;
    const now = new Date();
    await this.inbox.save({
      id: existing?.id ?? randomUUID(),
      eventId: event.eventId,
      eventName: event.eventName,
      correlationId: event.correlationId,
      receivedAt: existing?.receivedAt ?? now,
      processedAt: null,
      status: "FAILED",
      errorMessage: safeMessage,
    });
  }

  private async project(
    projectId: string,
    correlationId: string,
  ): Promise<ProjectDetail> {
    const token = await this.serviceToken.issue();
    return this.projects.requireRead(
      projectId,
      token,
      OPERATIONS_SERVICE_ACTOR,
      correlationId,
    );
  }

  private definition(
    event: IntegrationEventEnvelope,
    project: ProjectDetail,
  ): NotificationDefinition {
    const data = event.data;
    const projectLabel = `${project.code} · ${project.title}`;
    if (event.eventName === "review.requested") {
      const requestedBy = requiredId(data, "requestedByUserId");
      const recipients = unique(
        project.participants
          .filter((item) => item.role === "REVIEWER" || item.role === "OWNER")
          .map((item) => item.userId)
          .filter((item) => item !== requestedBy),
      );
      return {
        recipients,
        type: "REVIEW_ASSIGNED",
        subject: "Revisión documental asignada",
        body: `${projectLabel}: hay una versión pendiente de revisión.`,
        resourceType: "WorkflowReview",
        resourceId: requiredId(data, "reviewId"),
        actorUserId: requestedBy,
        auditAction: "REVIEW_REQUESTED",
        auditResult: "SUCCEEDED",
        auditMetadata: {
          documentId: requiredId(data, "documentId"),
          documentVersionId: requiredId(data, "documentVersionId"),
          versionNumber: data.versionNumber,
          assignedRecipients: recipients.length,
        },
      };
    }

    if (event.eventName === "review.changes-requested") {
      const actor = requiredId(data, "decidedByUserId");
      return {
        recipients: unique([requiredId(data, "requestedByUserId")]).filter(
          (item) => item !== actor,
        ),
        type: "CHANGES_REQUESTED",
        subject: "Correcciones solicitadas",
        body: `${projectLabel}: la versión revisada requiere correcciones.`,
        resourceType: "WorkflowReview",
        resourceId: requiredId(data, "reviewId"),
        actorUserId: actor,
        auditAction: "DOCUMENT_CHANGES_REQUESTED",
        auditResult: "SUCCEEDED",
        auditMetadata: this.documentMetadata(data),
      };
    }

    if (
      event.eventName === "document.approved" ||
      event.eventName === "document.rejected"
    ) {
      const approved = event.eventName === "document.approved";
      const actor = requiredId(data, "decidedByUserId");
      return {
        recipients: unique([requiredId(data, "requestedByUserId")]).filter(
          (item) => item !== actor,
        ),
        type: approved ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
        subject: approved ? "Documento aprobado" : "Documento rechazado",
        body: approved
          ? `${projectLabel}: la versión quedó aprobada y bloqueada.`
          : `${projectLabel}: la versión fue rechazada.`,
        resourceType: "RequirementDocument",
        resourceId: requiredId(data, "documentId"),
        actorUserId: actor,
        auditAction: approved ? "DOCUMENT_APPROVED" : "DOCUMENT_REJECTED",
        auditResult: "SUCCEEDED",
        auditMetadata: this.documentMetadata(data),
      };
    }

    if (event.eventName === "analysis.failed") {
      return {
        recipients: [requiredId(data, "requestedByUserId")],
        type: "ANALYSIS_FAILED",
        subject: "El análisis no pudo completarse",
        body: `${projectLabel}: revisa el estado del análisis antes de reintentarlo.`,
        resourceType: "AnalysisRequest",
        resourceId: requiredId(data, "analysisRequestId"),
        actorUserId: OPERATIONS_SERVICE_ACTOR.id,
        auditAction: "ANALYSIS_FAILED",
        auditResult: "FAILED",
        auditMetadata: {
          executionId: requiredId(data, "executionId"),
          errorCode: requiredText(data, "errorCode", 120),
        },
      };
    }

    const completed = event.eventName === "export.completed";
    return {
      recipients: [requiredId(data, "requestedByUserId")],
      type: completed ? "EXPORT_READY" : "EXPORT_FAILED",
      subject: completed ? "Exportación lista" : "La exportación falló",
      body: completed
        ? `${projectLabel}: el archivo solicitado está listo para descargar.`
        : `${projectLabel}: no fue posible generar el archivo solicitado.`,
      resourceType: "ExportRequest",
      resourceId: requiredId(data, "exportRequestId"),
      actorUserId: OPERATIONS_SERVICE_ACTOR.id,
      auditAction: completed ? "EXPORT_COMPLETED" : "EXPORT_FAILED",
      auditResult: completed ? "SUCCEEDED" : "FAILED",
      auditMetadata: {
        documentId: requiredId(data, "documentId"),
        format: requiredText(data, "format", 12),
        ...(completed
          ? {
              fileName: requiredText(data, "fileName"),
              sizeBytes: data.sizeBytes,
            }
          : { errorCode: requiredText(data, "errorCode", 120) }),
      },
      auditAlreadyRecorded: true,
    };
  }

  private documentMetadata(data: Readonly<Record<string, unknown>>) {
    return {
      reviewId: requiredId(data, "reviewId"),
      documentId: requiredId(data, "documentId"),
      documentVersionId: requiredId(data, "documentVersionId"),
      versionNumber: data.versionNumber,
    };
  }

  private requireTrustedProducer(event: IntegrationEventEnvelope): void {
    const expected = event.eventName.startsWith("review.")
      ? "workflow-service"
      : event.eventName.startsWith("document.")
        ? "workflow-service"
        : event.eventName.startsWith("analysis.")
          ? "ai-analysis-service"
          : "operations-service";
    if (event.producer !== expected) {
      throw new PermanentIntegrationEventError(
        `El productor ${event.producer} no está autorizado para ${event.eventName}.`,
      );
    }
  }
}
