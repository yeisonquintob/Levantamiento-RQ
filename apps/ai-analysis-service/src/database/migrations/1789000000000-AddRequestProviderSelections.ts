import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRequestProviderSelections1789000000000 implements MigrationInterface {
  name = "AddRequestProviderSelections1789000000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE dbo.AnalysisRequests ADD ProviderSelectionsJson nvarchar(max) NULL",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE dbo.AnalysisRequests DROP COLUMN ProviderSelectionsJson",
    );
  }
}
