import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiAnalysisEngineSelection1788470401000 implements MigrationInterface {
  name = "AddAiAnalysisEngineSelection1788470401000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests ADD
        UseLocalAi bit NOT NULL CONSTRAINT DF_AnalysisRequests_UseLocalAi DEFAULT 1,
        UseCloudAi bit NOT NULL CONSTRAINT DF_AnalysisRequests_UseCloudAi DEFAULT 1;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests ADD CONSTRAINT CK_AnalysisRequests_AiEngine
        CHECK (UseLocalAi = 1 OR UseCloudAi = 1);
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisExecutions DROP CONSTRAINT CK_AnalysisExecutions_Provider;
      ALTER TABLE dbo.AnalysisExecutions ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED', 'OPENAI', 'OLLAMA', 'FAKE'));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.AnalysisExecutions SET Provider = 'DISABLED' WHERE Provider = 'OLLAMA';
      ALTER TABLE dbo.AnalysisExecutions DROP CONSTRAINT CK_AnalysisExecutions_Provider;
      ALTER TABLE dbo.AnalysisExecutions ADD CONSTRAINT CK_AnalysisExecutions_Provider
        CHECK (Provider IN ('DISABLED', 'OPENAI', 'FAKE'));
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests DROP CONSTRAINT CK_AnalysisRequests_AiEngine;
      ALTER TABLE dbo.AnalysisRequests DROP CONSTRAINT DF_AnalysisRequests_UseLocalAi;
      ALTER TABLE dbo.AnalysisRequests DROP CONSTRAINT DF_AnalysisRequests_UseCloudAi;
      ALTER TABLE dbo.AnalysisRequests DROP COLUMN UseLocalAi, UseCloudAi;
    `);
  }
}
