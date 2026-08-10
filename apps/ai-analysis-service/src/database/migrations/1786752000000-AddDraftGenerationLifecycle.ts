import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddDraftGenerationLifecycle1786752000000 implements MigrationInterface {
  name = "AddDraftGenerationLifecycle1786752000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests
        ADD Purpose nvarchar(24) NOT NULL
              CONSTRAINT DF_AnalysisRequests_Purpose DEFAULT 'INITIAL_DRAFT',
            Instruction nvarchar(2000) NULL,
            IdempotencyKey nvarchar(120) NULL,
            GeneratedVersionNumber int NULL,
            GeneratedVersion nvarchar(32) NULL,
            ErrorCode nvarchar(100) NULL,
            ErrorMessage nvarchar(2000) NULL;
    `);
    await queryRunner.query(`
      UPDATE dbo.AnalysisRequests
      SET IdempotencyKey = CONVERT(nvarchar(36), Id),
          GeneratedVersionNumber = 1,
          GeneratedVersion = N'1.0.0'
      WHERE IdempotencyKey IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests ALTER COLUMN IdempotencyKey nvarchar(120) NOT NULL;
      ALTER TABLE dbo.AnalysisRequests ALTER COLUMN GeneratedVersionNumber int NOT NULL;
      ALTER TABLE dbo.AnalysisRequests ALTER COLUMN GeneratedVersion nvarchar(32) NOT NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests
        ADD CONSTRAINT CK_AnalysisRequests_Purpose
              CHECK (Purpose IN ('INITIAL_DRAFT', 'AI_VERSION')),
            CONSTRAINT CK_AnalysisRequests_GeneratedVersionNumber
              CHECK (GeneratedVersionNumber > 0);
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_AnalysisRequests_Project_IdempotencyKey
        ON dbo.AnalysisRequests (ProjectId, IdempotencyKey);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX UQ_AnalysisRequests_Project_IdempotencyKey
        ON dbo.AnalysisRequests;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests
        DROP CONSTRAINT CK_AnalysisRequests_Purpose,
             CK_AnalysisRequests_GeneratedVersionNumber,
             DF_AnalysisRequests_Purpose;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests
        DROP COLUMN Purpose, Instruction, IdempotencyKey,
                    GeneratedVersionNumber, GeneratedVersion,
                    ErrorCode, ErrorMessage;
    `);
  }
}
