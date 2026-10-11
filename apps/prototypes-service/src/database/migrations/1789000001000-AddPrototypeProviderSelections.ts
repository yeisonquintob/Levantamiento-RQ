import type { MigrationInterface, QueryRunner } from "typeorm";
export class AddPrototypeProviderSelections1789000001000 implements MigrationInterface {
  name = "AddPrototypeProviderSelections1789000001000";
  async up(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE dbo.PrototypeGenerations ADD PlannerConfigurationId uniqueidentifier NULL, ImageConfigurationId uniqueidentifier NULL");
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query("ALTER TABLE dbo.PrototypeGenerations DROP COLUMN PlannerConfigurationId, ImageConfigurationId");
  }
}
