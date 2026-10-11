import type { MigrationInterface, QueryRunner } from "typeorm";

// PASO_5_CHECKPOINTS_PERSISTENTES_V1
export class CreateLocalDraftBlockCheckpoints1789441200000 implements MigrationInterface {
  name = "CreateLocalDraftBlockCheckpoints1789441200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.LocalDraftBlockCheckpoints (
        Id uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        BlockKey nvarchar(160) NOT NULL,
        BlockNumber int NOT NULL,
        BlockTotal int NOT NULL,
        BlockLabel nvarchar(300) NOT NULL,
        Status nvarchar(24) NOT NULL
          CONSTRAINT DF_LocalDraftBlockCheckpoints_Status DEFAULT 'PENDING',
        SchemaVersion nvarchar(30) NOT NULL
          CONSTRAINT DF_LocalDraftBlockCheckpoints_SchemaVersion DEFAULT '4.1.0',
        StageValuesJson nvarchar(max) NULL,
        CompletedAt datetime2(7) NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_LocalDraftBlockCheckpoints_CreatedAt
          DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_LocalDraftBlockCheckpoints_UpdatedAt
          DEFAULT SYSUTCDATETIME(),

        CONSTRAINT PK_LocalDraftBlockCheckpoints PRIMARY KEY (Id),

        CONSTRAINT FK_LocalDraftBlockCheckpoints_AnalysisRequest
          FOREIGN KEY (AnalysisRequestId)
          REFERENCES dbo.AnalysisRequests(Id)
          ON DELETE CASCADE,

        CONSTRAINT UQ_LocalDraftBlockCheckpoints_Request_BlockKey
          UNIQUE (AnalysisRequestId, BlockKey),

        CONSTRAINT CK_LocalDraftBlockCheckpoints_Number
          CHECK (
            BlockNumber >= 1
            AND BlockTotal >= 1
            AND BlockNumber <= BlockTotal
          ),

        CONSTRAINT CK_LocalDraftBlockCheckpoints_Status
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

      CREATE INDEX IX_LocalDraftBlockCheckpoints_Request_BlockNumber
        ON dbo.LocalDraftBlockCheckpoints (
          AnalysisRequestId,
          BlockNumber
        );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.LocalDraftBlockCheckpoints;
    `);
  }
}
