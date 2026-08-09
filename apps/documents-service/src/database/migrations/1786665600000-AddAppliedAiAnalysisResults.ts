import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppliedAiAnalysisResults1786665600000 implements MigrationInterface {
  name = "AddAppliedAiAnalysisResults1786665600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.AppliedAiAnalysisResults (
        Id uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        AnalysisResultId uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        AppliedByUserId uniqueidentifier NOT NULL,
        AppliedAt datetime2(7) NOT NULL
          CONSTRAINT DF_AppliedAiAnalysisResults_AppliedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_AppliedAiAnalysisResults PRIMARY KEY (Id),
        CONSTRAINT FK_AppliedAiAnalysisResults_Document
          FOREIGN KEY (DocumentId)
          REFERENCES dbo.RequirementDocuments(Id),
        CONSTRAINT FK_AppliedAiAnalysisResults_Version
          FOREIGN KEY (DocumentVersionId)
          REFERENCES dbo.DocumentVersions(Id)
          ON DELETE CASCADE,
        CONSTRAINT UQ_AppliedAiAnalysisResults_Result UNIQUE (AnalysisResultId)
      );

      CREATE INDEX IX_AppliedAiAnalysisResults_Version
        ON dbo.AppliedAiAnalysisResults (DocumentVersionId, AppliedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dbo.AppliedAiAnalysisResults;`);
  }
}
