import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowMarkdownExports1787007603000 implements MigrationInterface {
  name = "AllowMarkdownExports1787007603000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.ExportRequests DROP CONSTRAINT CK_ExportRequests_Format;
      ALTER TABLE dbo.ExportRequests ADD CONSTRAINT CK_ExportRequests_Format
        CHECK (Format IN ('PDF', 'DOCX', 'MARKDOWN'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.ExportRequests DROP CONSTRAINT CK_ExportRequests_Format;
      ALTER TABLE dbo.ExportRequests ADD CONSTRAINT CK_ExportRequests_Format
        CHECK (Format IN ('PDF', 'DOCX'));
    `);
  }
}
