import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type {
  ExportFormat,
  ExportStatus,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "ExportRequests" })
@Index("IX_ExportRequests_Project_Document_RequestedAt", [
  "projectId",
  "documentId",
  "requestedAt",
])
@Index("IX_ExportRequests_Status_UpdatedAt", ["status", "updatedAt"])
@Index(
  "UQ_ExportRequests_Requester_IdempotencyKey",
  ["requestedByUserId", "idempotencyKey"],
  { unique: true },
)
export class ExportRequestEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("uniqueidentifier", { name: "DocumentId" })
  documentId!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("int", { name: "VersionNumber" })
  versionNumber!: number;

  @Column("nvarchar", { name: "Format", length: 12 })
  format!: ExportFormat;

  @Column("nvarchar", { name: "Status", length: 20 })
  status!: ExportStatus;

  @Column("uniqueidentifier", { name: "RequestedByUserId" })
  requestedByUserId!: string;

  @Column("nvarchar", { name: "CorrelationId", length: 64 })
  correlationId!: string;

  @Column("nvarchar", { name: "IdempotencyKey", length: 120 })
  idempotencyKey!: string;

  @Column("int", { name: "AttemptCount" })
  attemptCount!: number;

  @Column("nvarchar", { name: "ErrorCode", length: 120, nullable: true })
  errorCode!: string | null;

  @Column("nvarchar", { name: "ErrorMessage", length: 2000, nullable: true })
  errorMessage!: string | null;

  @Column("datetime2", { name: "RequestedAt", precision: 7 })
  requestedAt!: Date;

  @Column("datetime2", { name: "StartedAt", precision: 7, nullable: true })
  startedAt!: Date | null;

  @Column("datetime2", { name: "CompletedAt", precision: 7, nullable: true })
  completedAt!: Date | null;

  @Column("datetime2", { name: "UpdatedAt", precision: 7 })
  updatedAt!: Date;
}

@Entity({ name: "ExportArtifacts" })
@Index("UQ_ExportArtifacts_Request", ["exportRequestId"], { unique: true })
export class ExportArtifactEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ExportRequestId" })
  exportRequestId!: string;

  @Column("nvarchar", { name: "StorageContainer", length: 63 })
  storageContainer!: string;

  @Column("nvarchar", { name: "StoragePath", length: 1024 })
  storagePath!: string;

  @Column("nvarchar", { name: "FileName", length: 260 })
  fileName!: string;

  @Column("nvarchar", { name: "MediaType", length: 160 })
  mediaType!: string;

  @Column("bigint", { name: "SizeBytes" })
  sizeBytes!: string;

  @Column("char", { name: "Sha256", length: 64 })
  sha256!: string;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;
}

@Entity({ name: "NotificationRequests" })
@Index("IX_NotificationRequests_Recipient_Status_CreatedAt", [
  "recipientUserId",
  "status",
  "createdAt",
])
export class NotificationRequestEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "RecipientUserId" })
  recipientUserId!: string;

  @Column("uniqueidentifier", { name: "ProjectId", nullable: true })
  projectId!: string | null;

  @Column("nvarchar", { name: "NotificationType", length: 80 })
  notificationType!: string;

  @Column("nvarchar", { name: "Channel", length: 20 })
  channel!: string;

  @Column("nvarchar", { name: "Status", length: 20 })
  status!: string;

  @Column("nvarchar", { name: "Subject", length: 240 })
  subject!: string;

  @Column("nvarchar", { name: "Body", length: 4000 })
  body!: string;

  @Column("nvarchar", { name: "ResourceType", length: 80, nullable: true })
  resourceType!: string | null;

  @Column("uniqueidentifier", { name: "ResourceId", nullable: true })
  resourceId!: string | null;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;

  @Column("datetime2", { name: "UpdatedAt", precision: 7 })
  updatedAt!: Date;
}

@Entity({ name: "NotificationDeliveries" })
@Index("IX_NotificationDeliveries_Request_Attempt", [
  "notificationRequestId",
  "attempt",
])
export class NotificationDeliveryEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "NotificationRequestId" })
  notificationRequestId!: string;

  @Column("int", { name: "Attempt" })
  attempt!: number;

  @Column("nvarchar", { name: "Status", length: 20 })
  status!: string;

  @Column("nvarchar", { name: "Provider", length: 80 })
  provider!: string;

  @Column("nvarchar", { name: "ErrorCode", length: 120, nullable: true })
  errorCode!: string | null;

  @Column("datetime2", { name: "AttemptedAt", precision: 7 })
  attemptedAt!: Date;
}

@Entity({ name: "AuditEvents" })
@Index("IX_AuditEvents_Project_OccurredAt", ["projectId", "occurredAt"])
@Index("IX_AuditEvents_Resource_OccurredAt", [
  "resourceType",
  "resourceId",
  "occurredAt",
])
export class AuditEventEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ActorUserId", nullable: true })
  actorUserId!: string | null;

  @Column("uniqueidentifier", { name: "ProjectId", nullable: true })
  projectId!: string | null;

  @Column("nvarchar", { name: "Action", length: 120 })
  action!: string;

  @Column("nvarchar", { name: "ResourceType", length: 80 })
  resourceType!: string;

  @Column("nvarchar", { name: "ResourceId", length: 120, nullable: true })
  resourceId!: string | null;

  @Column("nvarchar", { name: "Result", length: 20 })
  result!: string;

  @Column("nvarchar", { name: "CorrelationId", length: 64 })
  correlationId!: string;

  @Column("nvarchar", { name: "IpAddress", length: 64, nullable: true })
  ipAddress!: string | null;

  @Column("nvarchar", { name: "UserAgent", length: 500, nullable: true })
  userAgent!: string | null;

  @Column("nvarchar", { name: "MetadataJson", length: "MAX" })
  metadataJson!: string;

  @Column("datetime2", { name: "OccurredAt", precision: 7 })
  occurredAt!: Date;
}

@Entity({ name: "IntegrationEventInbox" })
@Index("UQ_IntegrationEventInbox_EventId", ["eventId"], { unique: true })
@Index("IX_IntegrationEventInbox_ReceivedAt", ["receivedAt"])
export class IntegrationEventInboxEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "EventId" })
  eventId!: string;

  @Column("nvarchar", { name: "EventName", length: 120 })
  eventName!: string;

  @Column("nvarchar", { name: "CorrelationId", length: 64 })
  correlationId!: string;

  @Column("datetime2", { name: "ReceivedAt", precision: 7 })
  receivedAt!: Date;

  @Column("datetime2", { name: "ProcessedAt", precision: 7, nullable: true })
  processedAt!: Date | null;

  @Column("nvarchar", { name: "Status", length: 20 })
  status!: string;

  @Column("nvarchar", { name: "ErrorMessage", length: 2000, nullable: true })
  errorMessage!: string | null;
}

export const operationEntities = [
  ExportRequestEntity,
  ExportArtifactEntity,
  NotificationRequestEntity,
  NotificationDeliveryEntity,
  AuditEventEntity,
  IntegrationEventInboxEntity,
];
