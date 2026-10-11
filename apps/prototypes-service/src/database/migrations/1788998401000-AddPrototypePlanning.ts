import type { MigrationInterface, QueryRunner } from "typeorm";
export class AddPrototypePlanning1788998401000 implements MigrationInterface {
  name = "AddPrototypePlanning1788998401000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations ADD PlannerModel nvarchar(120) NULL, ApplicationName nvarchar(240) NULL, Summary nvarchar(2000) NULL;
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','PLANNING','PLANNED','FAILED'));`);
    await queryRunner.query(`ALTER TABLE dbo.PrototypeScreens DROP CONSTRAINT CK_PrototypeScreens_Status;
      ALTER TABLE dbo.PrototypeScreens ALTER COLUMN Route nvarchar(500) NULL;
      ALTER TABLE dbo.PrototypeScreens ADD ComponentsJson nvarchar(max) NOT NULL CONSTRAINT DF_PrototypeScreens_ComponentsJson DEFAULT ('[]');
      ALTER TABLE dbo.PrototypeScreens ADD CONSTRAINT CK_PrototypeScreens_Status CHECK (Status IN ('PLANNED','FAILED'));`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DELETE FROM dbo.PrototypeScreens;");
    await queryRunner.query(`ALTER TABLE dbo.PrototypeScreens DROP CONSTRAINT CK_PrototypeScreens_Status;
      ALTER TABLE dbo.PrototypeScreens DROP CONSTRAINT DF_PrototypeScreens_ComponentsJson;
      ALTER TABLE dbo.PrototypeScreens DROP COLUMN ComponentsJson;
      ALTER TABLE dbo.PrototypeScreens ALTER COLUMN Route nvarchar(500) NOT NULL;
      ALTER TABLE dbo.PrototypeScreens ADD CONSTRAINT CK_PrototypeScreens_Status CHECK (Status IN ('PENDING','GENERATED','FAILED'));`);
    await queryRunner.query(`UPDATE dbo.PrototypeGenerations SET Status = CASE WHEN Status = 'FAILED' THEN 'FAILED' ELSE 'SOURCE_READY' END;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations DROP COLUMN Summary, ApplicationName, PlannerModel;
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','FAILED'));`);
  }
}
