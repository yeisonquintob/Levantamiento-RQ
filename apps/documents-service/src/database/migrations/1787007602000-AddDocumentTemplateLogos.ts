import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddDocumentTemplateLogos1787007602000 implements MigrationInterface {
  name = "AddDocumentTemplateLogos1787007602000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentTemplates ADD
        LogoFileName nvarchar(260) NULL,
        LogoMediaType nvarchar(80) NULL,
        LogoSizeBytes int NULL,
        LogoData varbinary(max) NULL,
        LogoUpdatedAt datetime2(7) NULL,
        LogoUpdatedByUserId uniqueidentifier NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentTemplates ADD CONSTRAINT CK_DocumentTemplates_Logo
      CHECK (
        (LogoData IS NULL AND LogoFileName IS NULL AND LogoMediaType IS NULL AND LogoSizeBytes IS NULL AND LogoUpdatedAt IS NULL)
        OR
        (LogoData IS NOT NULL AND LogoFileName IS NOT NULL AND LogoMediaType IN ('image/png', 'image/jpeg') AND LogoSizeBytes = DATALENGTH(LogoData) AND LogoSizeBytes BETWEEN 1 AND 524288 AND LogoUpdatedAt IS NOT NULL)
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentTemplates DROP CONSTRAINT CK_DocumentTemplates_Logo;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentTemplates DROP COLUMN
        LogoUpdatedByUserId,
        LogoUpdatedAt,
        LogoData,
        LogoSizeBytes,
        LogoMediaType,
        LogoFileName;
    `);
  }
}
