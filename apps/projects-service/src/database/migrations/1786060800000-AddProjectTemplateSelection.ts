import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddProjectTemplateSelection1786060800000
  implements MigrationInterface
{
  name = "AddProjectTemplateSelection1786060800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.Projects ADD
        TemplateId uniqueidentifier NULL,
        TemplateCode nvarchar(40) NULL,
        TemplateName nvarchar(200) NULL,
        TemplateVersion nvarchar(32) NULL,
        TemplateType nvarchar(40) NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Projects
      ADD CONSTRAINT CK_Projects_TemplateSnapshot CHECK (
        (
          TemplateId IS NULL AND
          TemplateCode IS NULL AND
          TemplateName IS NULL AND
          TemplateVersion IS NULL AND
          TemplateType IS NULL
        )
        OR
        (
          TemplateId IS NOT NULL AND
          TemplateCode IS NOT NULL AND
          TemplateName IS NOT NULL AND
          TemplateVersion IS NOT NULL AND
          TemplateType IN (
            'SMALL_REQUIREMENT',
            'MEDIUM_REQUIREMENT',
            'LARGE_REQUIREMENT',
            'ERP_FDD'
          )
        )
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Projects_TemplateId
      ON dbo.Projects (TemplateId);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IX_Projects_TemplateId ON dbo.Projects;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Projects
      DROP CONSTRAINT CK_Projects_TemplateSnapshot;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Projects DROP COLUMN
        TemplateId,
        TemplateCode,
        TemplateName,
        TemplateVersion,
        TemplateType;
    `);
  }
}
