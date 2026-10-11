import type { MigrationInterface, QueryRunner } from "typeorm";

export class DefaultHistoricalAnalysisToCloud1788470402000 implements MigrationInterface {
  name = "DefaultHistoricalAnalysisToCloud1788470402000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.AnalysisRequests SET UseLocalAi = 0, UseCloudAi = 1;
      ALTER TABLE dbo.AnalysisRequests DROP CONSTRAINT DF_AnalysisRequests_UseLocalAi;
      ALTER TABLE dbo.AnalysisRequests ADD CONSTRAINT DF_AnalysisRequests_UseLocalAi DEFAULT 0 FOR UseLocalAi;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.AnalysisRequests DROP CONSTRAINT DF_AnalysisRequests_UseLocalAi;
      ALTER TABLE dbo.AnalysisRequests ADD CONSTRAINT DF_AnalysisRequests_UseLocalAi DEFAULT 1 FOR UseLocalAi;
    `);
  }
}
