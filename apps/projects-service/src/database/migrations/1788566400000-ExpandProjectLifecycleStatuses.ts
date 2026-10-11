import type { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandProjectLifecycleStatuses1788566400000 implements MigrationInterface {
  name = "ExpandProjectLifecycleStatuses1788566400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE dbo.Projects DROP CONSTRAINT CK_Projects_Status`,
    );
    await queryRunner.query(
      `UPDATE dbo.Projects SET Status = 'DISCUSSION' WHERE Status = 'IN_PROGRESS'`,
    );
    await queryRunner.query(`
      ALTER TABLE dbo.Projects ADD CONSTRAINT CK_Projects_Status CHECK (
        Status IN ('DRAFT', 'DISCUSSION', 'SOURCES', 'DOCUMENT_GENERATED',
          'VALIDATION', 'APPROVED', 'EXECUTION', 'COMPLETED', 'ARCHIVED')
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE dbo.Projects DROP CONSTRAINT CK_Projects_Status`,
    );
    await queryRunner.query(`
      UPDATE dbo.Projects SET Status = CASE
        WHEN Status IN ('DISCUSSION', 'SOURCES', 'DOCUMENT_GENERATED', 'EXECUTION') THEN 'IN_PROGRESS'
        WHEN Status = 'COMPLETED' THEN 'APPROVED'
        ELSE Status
      END
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.Projects ADD CONSTRAINT CK_Projects_Status
      CHECK (Status IN ('DRAFT', 'IN_PROGRESS', 'VALIDATION', 'APPROVED', 'ARCHIVED'))
    `);
  }
}
