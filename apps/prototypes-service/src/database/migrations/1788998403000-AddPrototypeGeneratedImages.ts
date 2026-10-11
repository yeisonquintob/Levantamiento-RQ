import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddPrototypeGeneratedImages1788998403000 implements MigrationInterface {
  name = "AddPrototypeGeneratedImages1788998403000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations ADD TotalImages int NOT NULL CONSTRAINT DF_PrototypeGenerations_TotalImages DEFAULT (0);
      ALTER TABLE dbo.PrototypeGenerations ADD CompletedImages int NOT NULL CONSTRAINT DF_PrototypeGenerations_CompletedImages DEFAULT (0);
      ALTER TABLE dbo.PrototypeGenerations ADD FailedImages int NOT NULL CONSTRAINT DF_PrototypeGenerations_FailedImages DEFAULT (0);
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','PLANNING','PLANNED','VISUAL_SPEC_BUILDING','VISUAL_SPEC_READY','IMAGE_GENERATING','COMPLETED','PARTIALLY_COMPLETED','FAILED'));`);
    await queryRunner.query(`CREATE TABLE dbo.PrototypeGeneratedImages (
      Id uniqueidentifier NOT NULL CONSTRAINT DF_PrototypeGeneratedImages_Id DEFAULT (NEWSEQUENTIALID()),
      GenerationId uniqueidentifier NOT NULL, VisualSpecificationId uniqueidentifier NOT NULL, ScreenId uniqueidentifier NOT NULL,
      Device nvarchar(16) NOT NULL, Provider nvarchar(40) NOT NULL, Model nvarchar(120) NULL,
      Status nvarchar(16) NOT NULL, MediaType nvarchar(80) NULL, StorageKey nvarchar(700) NULL,
      Width int NULL, Height int NULL, ErrorCode nvarchar(80) NULL, ErrorMessage nvarchar(1000) NULL,
      CorrelationId uniqueidentifier NULL, StartedAt datetime2(7) NULL, CompletedAt datetime2(7) NULL,
      CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeGeneratedImages_CreatedAt DEFAULT (SYSUTCDATETIME()),
      UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeGeneratedImages_UpdatedAt DEFAULT (SYSUTCDATETIME()),
      CONSTRAINT PK_PrototypeGeneratedImages PRIMARY KEY (Id),
      CONSTRAINT FK_PrototypeGeneratedImages_Generation FOREIGN KEY (GenerationId) REFERENCES dbo.PrototypeGenerations(Id) ON DELETE CASCADE,
      CONSTRAINT FK_PrototypeGeneratedImages_VisualSpecification FOREIGN KEY (VisualSpecificationId) REFERENCES dbo.PrototypeVisualSpecifications(Id),
      CONSTRAINT FK_PrototypeGeneratedImages_Screen FOREIGN KEY (ScreenId) REFERENCES dbo.PrototypeScreens(Id),
      CONSTRAINT CK_PrototypeGeneratedImages_Device CHECK (Device IN ('WEB','MOBILE')),
      CONSTRAINT CK_PrototypeGeneratedImages_Provider CHECK (Provider IN ('OPENAI_IMAGES','OTHER')),
      CONSTRAINT CK_PrototypeGeneratedImages_Status CHECK (Status IN ('PENDING','GENERATING','COMPLETED','FAILED')),
      CONSTRAINT UX_PrototypeGeneratedImages_VisualSpecificationId UNIQUE (VisualSpecificationId));`);
    await queryRunner.query(
      "CREATE INDEX IX_PrototypeGeneratedImages_GenerationId_Status ON dbo.PrototypeGeneratedImages (GenerationId, Status);",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.PrototypeGeneratedImages;");
    await queryRunner.query(`UPDATE dbo.PrototypeGenerations SET Status = CASE WHEN Status IN ('IMAGE_GENERATING','COMPLETED','PARTIALLY_COMPLETED') THEN 'VISUAL_SPEC_READY' ELSE Status END;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT CK_PrototypeGenerations_Status;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT DF_PrototypeGenerations_TotalImages;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT DF_PrototypeGenerations_CompletedImages;
      ALTER TABLE dbo.PrototypeGenerations DROP CONSTRAINT DF_PrototypeGenerations_FailedImages;
      ALTER TABLE dbo.PrototypeGenerations DROP COLUMN TotalImages, CompletedImages, FailedImages;
      ALTER TABLE dbo.PrototypeGenerations ADD CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','PLANNING','PLANNED','VISUAL_SPEC_BUILDING','VISUAL_SPEC_READY','FAILED'));`);
  }
}
