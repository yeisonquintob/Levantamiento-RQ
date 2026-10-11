import type { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandAiVersionInstruction1788048000000 implements MigrationInterface {
  name = "ExpandAiVersionInstruction1788048000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests
        ALTER COLUMN Instruction nvarchar(max) NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.AnalysisRequests
        SET Instruction = LEFT(Instruction, 2000)
        WHERE LEN(Instruction) > 2000;

      ALTER TABLE dbo.AnalysisRequests
        ALTER COLUMN Instruction nvarchar(2000) NULL;
    `);
  }
}
