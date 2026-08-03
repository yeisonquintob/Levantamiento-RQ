import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSourcesFoundation1785801600000
  implements MigrationInterface
{
  name = "CreateSourcesFoundation1785801600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.Sources (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        SourceType nvarchar(32) NOT NULL,
        Title nvarchar(240) NOT NULL,
        Content nvarchar(max) NULL,
        ExtractedText nvarchar(max) NULL,
        ProcessingStatus nvarchar(32) NOT NULL
          CONSTRAINT DF_Sources_ProcessingStatus DEFAULT ('PENDING'),
        Status nvarchar(32) NOT NULL
          CONSTRAINT DF_Sources_Status DEFAULT ('ACTIVE'),
        OriginalFileName nvarchar(260) NULL,
        MediaType nvarchar(160) NULL,
        FileSizeBytes bigint NULL,
        Sha256 char(64) NULL,
        StorageContainer nvarchar(120) NULL,
        StoragePath nvarchar(700) NULL,
        CreatedByUserId uniqueidentifier NOT NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_Sources_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_Sources_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_Sources PRIMARY KEY (Id),
        CONSTRAINT CK_Sources_SourceType CHECK (
          SourceType IN ('FILE', 'NOTE', 'CONVERSATION', 'TRANSCRIPT')
        ),
        CONSTRAINT CK_Sources_ProcessingStatus CHECK (
          ProcessingStatus IN ('PENDING', 'READY', 'FAILED')
        ),
        CONSTRAINT CK_Sources_Status CHECK (
          Status IN ('ACTIVE', 'ARCHIVED')
        )
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Sources_ProjectId_Status_UpdatedAt
      ON dbo.Sources (ProjectId, Status, UpdatedAt DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Sources_ProjectId_SourceType
      ON dbo.Sources (ProjectId, SourceType);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Sources_Sha256
      ON dbo.Sources (Sha256)
      WHERE Sha256 IS NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.Sources;");
  }
}
