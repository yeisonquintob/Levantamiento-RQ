import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSourceFilesAndExtraction1785888000000
  implements MigrationInterface
{
  name = "AddSourceFilesAndExtraction1785888000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      DROP CONSTRAINT CK_Sources_ProcessingStatus;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      ADD CONSTRAINT CK_Sources_ProcessingStatus CHECK (
        ProcessingStatus IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')
      );
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources ADD
        ProcessingMessage nvarchar(2000) NULL,
        ProcessedAt datetime2(7) NULL,
        FileExtension nvarchar(24) NULL,
        PageCount int NULL,
        SheetCount int NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Sources_ProjectId_ProcessingStatus
      ON dbo.Sources (ProjectId, ProcessingStatus);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UX_Sources_ProjectId_Sha256_ActiveFile
      ON dbo.Sources (ProjectId, Sha256)
      WHERE SourceType = 'FILE'
        AND Status = 'ACTIVE'
        AND Sha256 IS NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX UX_Sources_ProjectId_Sha256_ActiveFile
      ON dbo.Sources;
    `);

    await queryRunner.query(`
      DROP INDEX IX_Sources_ProjectId_ProcessingStatus
      ON dbo.Sources;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources DROP COLUMN
        ProcessingMessage,
        ProcessedAt,
        FileExtension,
        PageCount,
        SheetCount;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      DROP CONSTRAINT CK_Sources_ProcessingStatus;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      ADD CONSTRAINT CK_Sources_ProcessingStatus CHECK (
        ProcessingStatus IN ('PENDING', 'READY', 'FAILED')
      );
    `);
  }
}
