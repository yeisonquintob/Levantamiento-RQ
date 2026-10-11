import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiSecurityAudit1787875202000 implements MigrationInterface {
  name = "AddAiSecurityAudit1787875202000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.AiSecurityAudit (
        Id uniqueidentifier NOT NULL CONSTRAINT PK_AiSecurityAudit PRIMARY KEY DEFAULT NEWSEQUENTIALID(),
        EventType nvarchar(64) NOT NULL,
        ActorUserId uniqueidentifier NULL,
        ProjectId uniqueidentifier NULL,
        ExecutionId uniqueidentifier NULL,
        Code nvarchar(80) NOT NULL,
        DetailJson nvarchar(2000) NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_AiSecurityAudit_CreatedAt DEFAULT SYSUTCDATETIME()
      );
      CREATE INDEX IX_AiSecurityAudit_Project_CreatedAt ON dbo.AiSecurityAudit(ProjectId, CreatedAt DESC);
    `);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.AiSecurityAudit;");
  }
}
