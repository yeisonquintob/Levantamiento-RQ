import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddLocalAiFallbackAudit1787180400000 implements MigrationInterface {
  name = "AddLocalAiFallbackAudit1787180400000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.LocalAiAuditEvents (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        AnalysisRequestId uniqueidentifier NOT NULL,
        Action nvarchar(80) NOT NULL,
        ReasonCode nvarchar(100) NOT NULL,
        CorrelationId uniqueidentifier NULL,
        CreatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_LocalAiAuditEvents PRIMARY KEY (Id),
        CONSTRAINT CK_LocalAiAuditEvents_Action CHECK (Action = N'RAW_SOURCE_FALLBACK')
      );
      CREATE INDEX IX_LocalAiAuditEvents_Project_CreatedAt ON dbo.LocalAiAuditEvents(ProjectId, CreatedAt DESC);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.LocalAiAuditEvents;");
  }
}
