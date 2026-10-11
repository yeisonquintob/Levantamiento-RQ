import type { MigrationInterface, QueryRunner } from "typeorm";

// Situación del proyecto (activo, pausado o eliminado), independiente de su etapa. «Eliminado»
// ya no borra datos: solo cambia la situación y se puede revertir.
export class AddProjectActivityState1789614000000 implements MigrationInterface {
  name = "AddProjectActivityState1789614000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.Projects ADD ActivityState NVARCHAR(10) NOT NULL
        CONSTRAINT DF_Projects_ActivityState DEFAULT 'ACTIVE'
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.Projects ADD CONSTRAINT CK_Projects_ActivityState
        CHECK (ActivityState IN ('ACTIVE', 'PAUSED', 'DELETED'))
    `);
    await queryRunner.query(`
      CREATE INDEX IX_Projects_ActivityState_CreatedAt
        ON dbo.Projects (ActivityState, CreatedAt)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IX_Projects_ActivityState_CreatedAt ON dbo.Projects`,
    );
    await queryRunner.query(
      `ALTER TABLE dbo.Projects DROP CONSTRAINT CK_Projects_ActivityState`,
    );
    await queryRunner.query(
      `ALTER TABLE dbo.Projects DROP CONSTRAINT DF_Projects_ActivityState`,
    );
    await queryRunner.query(
      `ALTER TABLE dbo.Projects DROP COLUMN ActivityState`,
    );
  }
}
