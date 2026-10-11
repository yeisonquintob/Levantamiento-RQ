import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddLocalAiKnowledgeCache1787094000000 implements MigrationInterface {
  name = "AddLocalAiKnowledgeCache1787094000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequestSources ADD
        SourceMediaType nvarchar(160) NULL,
        SourceFileExtension nvarchar(24) NULL;
    `);
    await queryRunner.query(`
      CREATE TABLE dbo.SourceLocalAnalyses (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        SourceId uniqueidentifier NOT NULL,
        SourceSha256 char(64) NOT NULL,
        Provider nvarchar(30) NOT NULL,
        Model nvarchar(120) NOT NULL,
        PromptVersion nvarchar(30) NOT NULL,
        Status nvarchar(30) NOT NULL,
        AnalysisJson nvarchar(max) NULL,
        OriginalCharacters bigint NOT NULL,
        EstimatedOriginalTokens bigint NOT NULL,
        AnalysisCharacters bigint NULL,
        EstimatedAnalysisTokens bigint NULL,
        ErrorCode nvarchar(100) NULL,
        ErrorMessage nvarchar(1000) NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_SourceLocalAnalyses PRIMARY KEY (Id),
        CONSTRAINT CK_SourceLocalAnalyses_Provider CHECK (Provider = N'OLLAMA'),
        CONSTRAINT CK_SourceLocalAnalyses_Status CHECK (Status IN (N'PROCESSING',N'COMPLETED',N'FAILED',N'CANCELLED')),
        CONSTRAINT UQ_SourceLocalAnalyses_Cache UNIQUE (SourceId, SourceSha256, Model, PromptVersion)
      );
      CREATE INDEX IX_SourceLocalAnalyses_Project ON dbo.SourceLocalAnalyses(ProjectId, Status);
    `);
    await queryRunner.query(`
      CREATE TABLE dbo.ProjectKnowledgeSnapshots (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        Model nvarchar(120) NOT NULL,
        PromptVersion nvarchar(30) NOT NULL,
        SnapshotJson nvarchar(max) NOT NULL,
        OriginalCharacters bigint NOT NULL,
        EstimatedOriginalTokens bigint NOT NULL,
        AnalysisCharacters bigint NOT NULL,
        EstimatedAnalysisTokens bigint NOT NULL,
        SnapshotCharacters bigint NOT NULL,
        EstimatedSnapshotTokens bigint NOT NULL,
        ReductionPercentage decimal(6,2) NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_ProjectKnowledgeSnapshots PRIMARY KEY (Id)
      );
      CREATE INDEX IX_ProjectKnowledgeSnapshots_Project ON dbo.ProjectKnowledgeSnapshots(ProjectId, CreatedAt DESC);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.ProjectKnowledgeSnapshots;");
    await queryRunner.query("DROP TABLE dbo.SourceLocalAnalyses;");
    await queryRunner.query("ALTER TABLE dbo.AnalysisRequestSources DROP COLUMN SourceMediaType, SourceFileExtension;");
  }
}
