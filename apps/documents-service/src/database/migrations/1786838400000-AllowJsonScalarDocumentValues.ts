import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowJsonScalarDocumentValues1786838400000 implements MigrationInterface {
  name = "AllowJsonScalarDocumentValues1786838400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_ContentJson;

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_ContentJson CHECK (
          LEN(LTRIM(RTRIM(ContentJson))) > 0
          AND ISJSON(CONCAT(N'[', ContentJson, N']')) = 1
        );

      ALTER TABLE dbo.DocumentFields
        DROP CONSTRAINT CK_DocumentFields_ValueJson;

      ALTER TABLE dbo.DocumentFields
        ADD CONSTRAINT CK_DocumentFields_ValueJson CHECK (
          LEN(LTRIM(RTRIM(ValueJson))) > 0
          AND ISJSON(CONCAT(N'[', ValueJson, N']')) = 1
        );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_ContentJson;

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_ContentJson
        CHECK (ISJSON(ContentJson) = 1);

      ALTER TABLE dbo.DocumentFields
        DROP CONSTRAINT CK_DocumentFields_ValueJson;

      ALTER TABLE dbo.DocumentFields
        ADD CONSTRAINT CK_DocumentFields_ValueJson
        CHECK (ISJSON(ValueJson) = 1);
    `);
  }
}
