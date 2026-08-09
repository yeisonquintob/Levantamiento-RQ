import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateOperationsFoundation1786752000000 implements MigrationInterface {
  name = "CreateOperationsFoundation1786752000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.ExportRequests (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        VersionNumber int NOT NULL,
        Format nvarchar(12) NOT NULL,
        Status nvarchar(20) NOT NULL,
        RequestedByUserId uniqueidentifier NOT NULL,
        CorrelationId nvarchar(64) NOT NULL,
        IdempotencyKey nvarchar(120) NOT NULL,
        AttemptCount int NOT NULL CONSTRAINT DF_ExportRequests_AttemptCount DEFAULT 0,
        ErrorCode nvarchar(120) NULL,
        ErrorMessage nvarchar(2000) NULL,
        RequestedAt datetime2(7) NOT NULL,
        StartedAt datetime2(7) NULL,
        CompletedAt datetime2(7) NULL,
        UpdatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_ExportRequests PRIMARY KEY (Id),
        CONSTRAINT CK_ExportRequests_Format CHECK (Format IN ('PDF', 'DOCX')),
        CONSTRAINT CK_ExportRequests_Status CHECK (Status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
        CONSTRAINT CK_ExportRequests_VersionNumber CHECK (VersionNumber >= 1),
        CONSTRAINT CK_ExportRequests_AttemptCount CHECK (AttemptCount >= 0)
      );
      CREATE INDEX IX_ExportRequests_Project_Document_RequestedAt
        ON dbo.ExportRequests (ProjectId, DocumentId, RequestedAt DESC);
      CREATE INDEX IX_ExportRequests_Status_UpdatedAt
        ON dbo.ExportRequests (Status, UpdatedAt);
      CREATE UNIQUE INDEX UQ_ExportRequests_Requester_IdempotencyKey
        ON dbo.ExportRequests (RequestedByUserId, IdempotencyKey);

      CREATE TABLE dbo.ExportArtifacts (
        Id uniqueidentifier NOT NULL,
        ExportRequestId uniqueidentifier NOT NULL,
        StorageContainer nvarchar(63) NOT NULL,
        StoragePath nvarchar(1024) NOT NULL,
        FileName nvarchar(260) NOT NULL,
        MediaType nvarchar(160) NOT NULL,
        SizeBytes bigint NOT NULL,
        Sha256 char(64) NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_ExportArtifacts PRIMARY KEY (Id),
        CONSTRAINT FK_ExportArtifacts_Request FOREIGN KEY (ExportRequestId)
          REFERENCES dbo.ExportRequests(Id) ON DELETE CASCADE,
        CONSTRAINT CK_ExportArtifacts_Size CHECK (SizeBytes >= 0),
        CONSTRAINT CK_ExportArtifacts_Sha256 CHECK (LEN(Sha256) = 64)
      );
      CREATE UNIQUE INDEX UQ_ExportArtifacts_Request
        ON dbo.ExportArtifacts (ExportRequestId);

      CREATE TABLE dbo.NotificationRequests (
        Id uniqueidentifier NOT NULL,
        RecipientUserId uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NULL,
        NotificationType nvarchar(80) NOT NULL,
        Channel nvarchar(20) NOT NULL,
        Status nvarchar(20) NOT NULL,
        Subject nvarchar(240) NOT NULL,
        Body nvarchar(4000) NOT NULL,
        ResourceType nvarchar(80) NULL,
        ResourceId uniqueidentifier NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_NotificationRequests PRIMARY KEY (Id),
        CONSTRAINT CK_NotificationRequests_Channel CHECK (Channel IN ('IN_APP', 'EMAIL')),
        CONSTRAINT CK_NotificationRequests_Status CHECK (Status IN ('PENDING', 'DELIVERED', 'FAILED', 'READ'))
      );
      CREATE INDEX IX_NotificationRequests_Recipient_Status_CreatedAt
        ON dbo.NotificationRequests (RecipientUserId, Status, CreatedAt DESC);

      CREATE TABLE dbo.NotificationDeliveries (
        Id uniqueidentifier NOT NULL,
        NotificationRequestId uniqueidentifier NOT NULL,
        Attempt int NOT NULL,
        Status nvarchar(20) NOT NULL,
        Provider nvarchar(80) NOT NULL,
        ErrorCode nvarchar(120) NULL,
        AttemptedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_NotificationDeliveries PRIMARY KEY (Id),
        CONSTRAINT FK_NotificationDeliveries_Request FOREIGN KEY (NotificationRequestId)
          REFERENCES dbo.NotificationRequests(Id) ON DELETE CASCADE,
        CONSTRAINT CK_NotificationDeliveries_Attempt CHECK (Attempt >= 1)
      );
      CREATE UNIQUE INDEX IX_NotificationDeliveries_Request_Attempt
        ON dbo.NotificationDeliveries (NotificationRequestId, Attempt);

      CREATE TABLE dbo.AuditEvents (
        Id uniqueidentifier NOT NULL,
        ActorUserId uniqueidentifier NULL,
        ProjectId uniqueidentifier NULL,
        Action nvarchar(120) NOT NULL,
        ResourceType nvarchar(80) NOT NULL,
        ResourceId nvarchar(120) NULL,
        Result nvarchar(20) NOT NULL,
        CorrelationId nvarchar(64) NOT NULL,
        IpAddress nvarchar(64) NULL,
        UserAgent nvarchar(500) NULL,
        MetadataJson nvarchar(max) NOT NULL,
        OccurredAt datetime2(7) NOT NULL,
        CONSTRAINT PK_AuditEvents PRIMARY KEY (Id),
        CONSTRAINT CK_AuditEvents_Result CHECK (Result IN ('SUCCEEDED', 'FAILED', 'DENIED')),
        CONSTRAINT CK_AuditEvents_MetadataJson CHECK (ISJSON(MetadataJson) = 1)
      );
      CREATE INDEX IX_AuditEvents_Project_OccurredAt
        ON dbo.AuditEvents (ProjectId, OccurredAt DESC);
      CREATE INDEX IX_AuditEvents_Resource_OccurredAt
        ON dbo.AuditEvents (ResourceType, ResourceId, OccurredAt DESC);

      CREATE TABLE dbo.IntegrationEventInbox (
        Id uniqueidentifier NOT NULL,
        EventId uniqueidentifier NOT NULL,
        EventName nvarchar(120) NOT NULL,
        CorrelationId nvarchar(64) NOT NULL,
        ReceivedAt datetime2(7) NOT NULL,
        ProcessedAt datetime2(7) NULL,
        Status nvarchar(20) NOT NULL,
        ErrorMessage nvarchar(2000) NULL,
        CONSTRAINT PK_IntegrationEventInbox PRIMARY KEY (Id),
        CONSTRAINT CK_IntegrationEventInbox_Status CHECK (Status IN ('RECEIVED', 'PROCESSED', 'FAILED'))
      );
      CREATE UNIQUE INDEX UQ_IntegrationEventInbox_EventId
        ON dbo.IntegrationEventInbox (EventId);
      CREATE INDEX IX_IntegrationEventInbox_ReceivedAt
        ON dbo.IntegrationEventInbox (ReceivedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.IntegrationEventInbox;
      DROP TABLE dbo.AuditEvents;
      DROP TABLE dbo.NotificationDeliveries;
      DROP TABLE dbo.NotificationRequests;
      DROP TABLE dbo.ExportArtifacts;
      DROP TABLE dbo.ExportRequests;
    `);
  }
}
