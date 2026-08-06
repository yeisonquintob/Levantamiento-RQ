import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAiAnalysisFoundation1786320000000
  implements MigrationInterface
{
  name = "CreateAiAnalysisFoundation1786320000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.AnalysisRequests (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        AnalysisType nvarchar(50) NOT NULL
          CONSTRAINT DF_AnalysisRequests_AnalysisType
          DEFAULT 'REQUIREMENT_DOCUMENT',
        Status nvarchar(24) NOT NULL
          CONSTRAINT DF_AnalysisRequests_Status DEFAULT 'PENDING',
        RequestedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AnalysisRequests_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AnalysisRequests_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CancelledAt datetime2(7) NULL,
        CONSTRAINT PK_AnalysisRequests PRIMARY KEY (Id),
        CONSTRAINT CK_AnalysisRequests_AnalysisType
          CHECK (AnalysisType IN ('REQUIREMENT_DOCUMENT')),
        CONSTRAINT CK_AnalysisRequests_Status
          CHECK (
            Status IN (
              'PENDING',
              'PROCESSING',
              'COMPLETED',
              'FAILED',
              'CANCELLED'
            )
          )
      );

      CREATE INDEX IX_AnalysisRequests_ProjectId_CreatedAt
        ON dbo.AnalysisRequests (ProjectId, CreatedAt DESC);

      CREATE INDEX IX_AnalysisRequests_DocumentVersionId_Status
        ON dbo.AnalysisRequests (DocumentVersionId, Status);

      CREATE INDEX IX_AnalysisRequests_Status_UpdatedAt
        ON dbo.AnalysisRequests (Status, UpdatedAt DESC);

      CREATE TABLE dbo.AnalysisRequestSources (
        Id uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        SourceId uniqueidentifier NOT NULL,
        SourceUpdatedAt datetime2(7) NOT NULL,
        SourceSha256 char(64) NULL,
        Position int NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AnalysisRequestSources_CreatedAt
          DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AnalysisRequestSources PRIMARY KEY (Id),
        CONSTRAINT FK_AnalysisRequestSources_Request
          FOREIGN KEY (AnalysisRequestId)
          REFERENCES dbo.AnalysisRequests(Id)
          ON DELETE CASCADE,
        CONSTRAINT CK_AnalysisRequestSources_Position
          CHECK (Position > 0),
        CONSTRAINT UQ_AnalysisRequestSources_Request_Source
          UNIQUE (AnalysisRequestId, SourceId)
      );

      CREATE INDEX IX_AnalysisRequestSources_SourceId
        ON dbo.AnalysisRequestSources (SourceId);

      CREATE TABLE dbo.AnalysisExecutions (
        Id uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        Attempt int NOT NULL,
        Status nvarchar(24) NOT NULL
          CONSTRAINT DF_AnalysisExecutions_Status DEFAULT 'PENDING',
        Provider nvarchar(40) NOT NULL
          CONSTRAINT DF_AnalysisExecutions_Provider DEFAULT 'DISABLED',
        Model nvarchar(120) NULL,
        StartedAt datetime2(7) NULL,
        FinishedAt datetime2(7) NULL,
        DurationMs bigint NULL,
        InputTokens int NULL,
        OutputTokens int NULL,
        EstimatedCost decimal(18,8) NULL,
        ProviderRequestId nvarchar(200) NULL,
        ErrorCode nvarchar(100) NULL,
        ErrorMessage nvarchar(2000) NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AnalysisExecutions_CreatedAt
          DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AnalysisExecutions PRIMARY KEY (Id),
        CONSTRAINT FK_AnalysisExecutions_Request
          FOREIGN KEY (AnalysisRequestId)
          REFERENCES dbo.AnalysisRequests(Id)
          ON DELETE CASCADE,
        CONSTRAINT CK_AnalysisExecutions_Attempt CHECK (Attempt > 0),
        CONSTRAINT CK_AnalysisExecutions_Status
          CHECK (
            Status IN (
              'PENDING',
              'PROCESSING',
              'COMPLETED',
              'FAILED',
              'CANCELLED'
            )
          ),
        CONSTRAINT CK_AnalysisExecutions_Provider
          CHECK (Provider IN ('DISABLED')),
        CONSTRAINT CK_AnalysisExecutions_Duration
          CHECK (DurationMs IS NULL OR DurationMs >= 0),
        CONSTRAINT CK_AnalysisExecutions_InputTokens
          CHECK (InputTokens IS NULL OR InputTokens >= 0),
        CONSTRAINT CK_AnalysisExecutions_OutputTokens
          CHECK (OutputTokens IS NULL OR OutputTokens >= 0),
        CONSTRAINT CK_AnalysisExecutions_EstimatedCost
          CHECK (EstimatedCost IS NULL OR EstimatedCost >= 0),
        CONSTRAINT UQ_AnalysisExecutions_Request_Attempt
          UNIQUE (AnalysisRequestId, Attempt)
      );

      CREATE INDEX IX_AnalysisExecutions_Status_CreatedAt
        ON dbo.AnalysisExecutions (Status, CreatedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.AnalysisExecutions;
      DROP TABLE dbo.AnalysisRequestSources;
      DROP TABLE dbo.AnalysisRequests;
    `);
  }
}
