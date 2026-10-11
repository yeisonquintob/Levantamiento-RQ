import type { MigrationInterface, QueryRunner } from "typeorm";
export class CreateProjectAudit1789347600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE dbo.ProjectAuditEvents (
      Id uniqueidentifier NOT NULL PRIMARY KEY, ProjectId uniqueidentifier NOT NULL,
      ActorUserId uniqueidentifier NOT NULL, ActorName nvarchar(200) NULL,
      ProjectLabel nvarchar(260) NOT NULL, Action nvarchar(80) NOT NULL,
      MetadataJson nvarchar(max) NOT NULL, OccurredAt datetime2(7) NOT NULL,
      CONSTRAINT CK_ProjectAudit_Metadata CHECK (ISJSON(MetadataJson)=1));
      CREATE INDEX IX_ProjectAudit_Project_Date ON dbo.ProjectAuditEvents(ProjectId, OccurredAt DESC);
      CREATE INDEX IX_ProjectAudit_Date ON dbo.ProjectAuditEvents(OccurredAt DESC, Id DESC);
      INSERT INTO dbo.ProjectAuditEvents(Id,ProjectId,ActorUserId,ActorName,ProjectLabel,Action,MetadataJson,OccurredAt)
      SELECT NEWID(),Id,CreatedByUserId,NULL,CONCAT(Code,' · ',Title),'PROJECT_CREATED',
        N'{"historical":true,"changes":[]}',CreatedAt FROM dbo.Projects;`);
  }
  async down(): Promise<void> {
    throw new Error("No se elimina el historial de auditoría automáticamente.");
  }
}
