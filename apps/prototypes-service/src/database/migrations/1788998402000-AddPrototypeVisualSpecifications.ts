import type { MigrationInterface, QueryRunner } from "typeorm";
export class AddPrototypeVisualSpecifications1788998402000 implements MigrationInterface {
  name = "AddPrototypeVisualSpecifications1788998402000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations ADD TotalVisualSpecifications int NOT NULL CONSTRAINT DF_PrototypeGenerations_TotalVisualSpecifications DEFAULT (0);
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','PLANNING','PLANNED','VISUAL_SPEC_BUILDING','VISUAL_SPEC_READY','FAILED'));`);
    await queryRunner.query(`CREATE TABLE dbo.PrototypeVisualSpecifications (
      Id uniqueidentifier NOT NULL CONSTRAINT DF_PrototypeVisualSpecifications_Id DEFAULT (NEWSEQUENTIALID()),
      GenerationId uniqueidentifier NOT NULL, ScreenId uniqueidentifier NOT NULL, Device nvarchar(16) NOT NULL,
      TemplateCode nvarchar(40) NOT NULL, DesignSystemCode nvarchar(40) NOT NULL, SpecificationJson nvarchar(max) NOT NULL,
      CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeVisualSpecifications_CreatedAt DEFAULT (SYSUTCDATETIME()),
      UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeVisualSpecifications_UpdatedAt DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT PK_PrototypeVisualSpecifications PRIMARY KEY (Id),
      CONSTRAINT FK_PrototypeVisualSpecifications_Generation FOREIGN KEY (GenerationId) REFERENCES dbo.PrototypeGenerations(Id) ON DELETE CASCADE,
      CONSTRAINT FK_PrototypeVisualSpecifications_Screen FOREIGN KEY (ScreenId) REFERENCES dbo.PrototypeScreens(Id),
      CONSTRAINT CK_PrototypeVisualSpecifications_Device CHECK (Device IN ('WEB','MOBILE')),
      CONSTRAINT CK_PrototypeVisualSpecifications_Template CHECK (TemplateCode IN ('WEB_TEMPLATE_V1','MOBILE_TEMPLATE_V1')),
      CONSTRAINT CK_PrototypeVisualSpecifications_DesignSystem CHECK (DesignSystemCode = 'CORPORATE_DEFAULT_V1'),
      CONSTRAINT UX_PrototypeVisualSpecifications_ScreenId_Device UNIQUE (ScreenId, Device));`);
    await queryRunner.query(
      "CREATE INDEX IX_PrototypeVisualSpecifications_GenerationId_Device ON dbo.PrototypeVisualSpecifications (GenerationId, Device);",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.PrototypeVisualSpecifications;");
    await queryRunner.query(`UPDATE dbo.PrototypeGenerations SET Status = CASE WHEN Status = 'FAILED' THEN 'FAILED' WHEN Status IN ('VISUAL_SPEC_BUILDING','VISUAL_SPEC_READY') THEN 'PLANNED' ELSE Status END;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT DF_PrototypeGenerations_TotalVisualSpecifications;
      ALTER TABLE dbo.PrototypeGenerations DROP COLUMN TotalVisualSpecifications;
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','PLANNING','PLANNED','FAILED'));`);
  }
}
