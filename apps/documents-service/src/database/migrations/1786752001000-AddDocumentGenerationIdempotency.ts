import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentGenerationIdempotency1786752001000 implements MigrationInterface {
  name = "AddDocumentGenerationIdempotency1786752001000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.RequirementDocuments
        ADD CreationIdempotencyKey nvarchar(120) NULL;
      ALTER TABLE dbo.DocumentVersions
        ADD IdempotencyKey nvarchar(120) NULL;
    `);
    await queryRunner.query(`
      UPDATE dbo.RequirementDocuments
      SET CreationIdempotencyKey = CONVERT(nvarchar(36), Id)
      WHERE CreationIdempotencyKey IS NULL;
      UPDATE dbo.DocumentVersions
      SET IdempotencyKey = CONVERT(nvarchar(36), Id)
      WHERE IdempotencyKey IS NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.RequirementDocuments
        ALTER COLUMN CreationIdempotencyKey nvarchar(120) NOT NULL;
      ALTER TABLE dbo.DocumentVersions
        ALTER COLUMN IdempotencyKey nvarchar(120) NOT NULL;
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_RequirementDocuments_Project_CreationKey
        ON dbo.RequirementDocuments (ProjectId, CreationIdempotencyKey);
      CREATE UNIQUE INDEX UQ_DocumentVersions_Document_IdempotencyKey
        ON dbo.DocumentVersions (DocumentId, IdempotencyKey);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX UQ_DocumentVersions_Document_IdempotencyKey
        ON dbo.DocumentVersions;
      DROP INDEX UQ_RequirementDocuments_Project_CreationKey
        ON dbo.RequirementDocuments;
      ALTER TABLE dbo.DocumentVersions DROP COLUMN IdempotencyKey;
      ALTER TABLE dbo.RequirementDocuments DROP COLUMN CreationIdempotencyKey;
    `);
  }
}
