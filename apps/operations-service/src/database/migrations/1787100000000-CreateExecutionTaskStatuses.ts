import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateExecutionTaskStatuses1787100000000
  implements MigrationInterface
{
  name = "CreateExecutionTaskStatuses1787100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.ExecutionTaskStatuses (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        TaskCode nvarchar(120) NOT NULL,
        State nvarchar(20) NOT NULL,
        Source nvarchar(20) NOT NULL,
        Note nvarchar(1000) NULL,
        CompletedAt datetime2(7) NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_ExecutionTaskStatuses PRIMARY KEY (Id),
        CONSTRAINT CK_ExecutionTaskStatuses_State CHECK (State IN ('PENDING', 'IN_PROGRESS', 'DONE')),
        CONSTRAINT CK_ExecutionTaskStatuses_Source CHECK (Source IN ('MANUAL', 'AZURE_CSV')),
        CONSTRAINT CK_ExecutionTaskStatuses_TaskCode CHECK (LEN(TaskCode) >= 1)
      );
      CREATE UNIQUE INDEX UQ_ExecutionTaskStatuses_Project_Task
        ON dbo.ExecutionTaskStatuses (ProjectId, TaskCode);
      CREATE INDEX IX_ExecutionTaskStatuses_Project_State
        ON dbo.ExecutionTaskStatuses (ProjectId, State);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dbo.ExecutionTaskStatuses;`);
  }
}
