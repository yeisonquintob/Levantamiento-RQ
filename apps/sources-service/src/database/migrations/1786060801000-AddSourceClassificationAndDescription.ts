import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSourceClassificationAndDescription1786060801000 implements MigrationInterface {
  name = "AddSourceClassificationAndDescription1786060801000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.Sources ADD
        Description nvarchar(2000) NULL,
        Classification nvarchar(40) NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      ADD CONSTRAINT CK_Sources_Classification CHECK (
        Classification IS NULL OR
        Classification IN (
          'REQUIREMENT',
          'MEETING',
          'CURRENT_PROCESS',
          'BUSINESS_RULE',
          'EVIDENCE',
          'MANUAL',
          'INTEGRATION',
          'DATA',
          'OTHER'
        )
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Sources_ProjectId_Classification
      ON dbo.Sources (ProjectId, Classification);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IX_Sources_ProjectId_Classification ON dbo.Sources;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources
      DROP CONSTRAINT CK_Sources_Classification;
    `);

    await queryRunner.query(`
      ALTER TABLE dbo.Sources DROP COLUMN
        Description,
        Classification;
    `);
  }
}
