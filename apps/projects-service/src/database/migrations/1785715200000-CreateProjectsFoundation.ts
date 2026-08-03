import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateProjectsFoundation1785715200000 implements MigrationInterface {
  name = "CreateProjectsFoundation1785715200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE SEQUENCE dbo.ProjectCodeSequence
      AS bigint
      START WITH 1
      INCREMENT BY 1
      NO CYCLE;
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.Projects (
        Id uniqueidentifier NOT NULL,
        Code nvarchar(30) NOT NULL,
        Title nvarchar(200) NOT NULL,
        RequestingArea nvarchar(160) NOT NULL,
        Description nvarchar(2000) NULL,
        Status nvarchar(32) NOT NULL
          CONSTRAINT DF_Projects_Status DEFAULT ('DRAFT'),
        OwnerUserId uniqueidentifier NOT NULL,
        CreatedByUserId uniqueidentifier NOT NULL,
        UpdatedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_Projects_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_Projects_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_Projects PRIMARY KEY (Id),
        CONSTRAINT CK_Projects_Status CHECK (
          Status IN (
            'DRAFT',
            'IN_PROGRESS',
            'VALIDATION',
            'APPROVED',
            'ARCHIVED'
          )
        )
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_Projects_Code
      ON dbo.Projects (Code);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Projects_Status_UpdatedAt
      ON dbo.Projects (Status, UpdatedAt DESC);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_Projects_OwnerUserId
      ON dbo.Projects (OwnerUserId);
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.ProjectParticipants (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        Role nvarchar(32) NOT NULL,
        AddedByUserId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_ProjectParticipants_CreatedAt
          DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ProjectParticipants PRIMARY KEY (Id),
        CONSTRAINT FK_ProjectParticipants_Project
          FOREIGN KEY (ProjectId)
          REFERENCES dbo.Projects(Id)
          ON DELETE CASCADE,
        CONSTRAINT CK_ProjectParticipants_Role CHECK (
          Role IN ('OWNER', 'EDITOR', 'REVIEWER', 'VIEWER')
        )
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_ProjectParticipants_ProjectId_UserId
      ON dbo.ProjectParticipants (ProjectId, UserId);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_ProjectParticipants_UserId
      ON dbo.ProjectParticipants (UserId);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.ProjectParticipants;");
    await queryRunner.query("DROP TABLE dbo.Projects;");
    await queryRunner.query("DROP SEQUENCE dbo.ProjectCodeSequence;");
  }
}
