import type { MigrationInterface, QueryRunner } from "typeorm";
export class CreatePrototypeGenerations1788998400000 implements MigrationInterface {
  name = "CreatePrototypeGenerations1788998400000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE dbo.PrototypeGenerations (
      Id uniqueidentifier NOT NULL CONSTRAINT DF_PrototypeGenerations_Id DEFAULT (NEWSEQUENTIALID()), ProjectId uniqueidentifier NULL,
      SourceFileName nvarchar(260) NOT NULL, SourceMarkdown nvarchar(max) NOT NULL, SourceSha256 char(64) NOT NULL, SourceSizeBytes bigint NOT NULL,
      TargetDevice nvarchar(16) NOT NULL, Status nvarchar(24) NOT NULL CONSTRAINT DF_PrototypeGenerations_Status DEFAULT ('SOURCE_READY'),
      PlannerProvider nvarchar(80) NULL, ImageProvider nvarchar(80) NULL, TotalScreens int NOT NULL CONSTRAINT DF_PrototypeGenerations_TotalScreens DEFAULT (0),
      GeneratedScreens int NOT NULL CONSTRAINT DF_PrototypeGenerations_GeneratedScreens DEFAULT (0), ErrorCode nvarchar(80) NULL, ErrorMessage nvarchar(2000) NULL,
      RequestedByUserId uniqueidentifier NOT NULL, CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeGenerations_CreatedAt DEFAULT (SYSUTCDATETIME()),
      UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_PrototypeGenerations_UpdatedAt DEFAULT (SYSUTCDATETIME()), CONSTRAINT PK_PrototypeGenerations PRIMARY KEY (Id),
      CONSTRAINT CK_PrototypeGenerations_TargetDevice CHECK (TargetDevice IN ('RESPONSIVE','WEB','MOBILE')),
      CONSTRAINT CK_PrototypeGenerations_Status CHECK (Status IN ('SOURCE_READY','FAILED')), CONSTRAINT CK_PrototypeGenerations_Counts CHECK (TotalScreens >= 0 AND GeneratedScreens >= 0 AND GeneratedScreens <= TotalScreens));`);
    await queryRunner.query(
      "CREATE INDEX IX_PrototypeGenerations_SourceSha256 ON dbo.PrototypeGenerations (SourceSha256);",
    );
    await queryRunner.query(
      "CREATE INDEX IX_PrototypeGenerations_ProjectId_CreatedAt ON dbo.PrototypeGenerations (ProjectId, CreatedAt DESC) WHERE ProjectId IS NOT NULL;",
    );
    await queryRunner.query(`CREATE TABLE dbo.PrototypeScreens (
      Id uniqueidentifier NOT NULL CONSTRAINT DF_PrototypeScreens_Id DEFAULT (NEWSEQUENTIALID()), GenerationId uniqueidentifier NOT NULL, ScreenOrder int NOT NULL,
      Code nvarchar(100) NOT NULL, Name nvarchar(200) NOT NULL, Objective nvarchar(2000) NOT NULL, Origin nvarchar(16) NOT NULL, Route nvarchar(500) NOT NULL,
      Device nvarchar(16) NOT NULL, Status nvarchar(24) NOT NULL, ImageStorageKey nvarchar(700) NULL, CONSTRAINT PK_PrototypeScreens PRIMARY KEY (Id),
      CONSTRAINT FK_PrototypeScreens_Generation FOREIGN KEY (GenerationId) REFERENCES dbo.PrototypeGenerations(Id) ON DELETE CASCADE,
      CONSTRAINT CK_PrototypeScreens_Origin CHECK (Origin IN ('EXPLICIT','DERIVED')), CONSTRAINT CK_PrototypeScreens_Device CHECK (Device IN ('RESPONSIVE','WEB','MOBILE')),
      CONSTRAINT CK_PrototypeScreens_Status CHECK (Status IN ('PENDING','GENERATED','FAILED')), CONSTRAINT UX_PrototypeScreens_GenerationId_Order UNIQUE (GenerationId, ScreenOrder));`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.PrototypeScreens;");
    await queryRunner.query("DROP TABLE dbo.PrototypeGenerations;");
  }
}
