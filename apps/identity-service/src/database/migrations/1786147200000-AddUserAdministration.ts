import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAdministration1786147200000
  implements MigrationInterface
{
  name = "AddUserAdministration1786147200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.IdentityUsers ADD
        MustChangePassword bit NOT NULL
          CONSTRAINT DF_IdentityUsers_MustChangePassword DEFAULT (0),
        SessionVersion int NOT NULL
          CONSTRAINT DF_IdentityUsers_SessionVersion DEFAULT (1);
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentitySecurityAudit (
        Id uniqueidentifier NOT NULL,
        EventType nvarchar(64) NOT NULL,
        ActorUserId uniqueidentifier NOT NULL,
        TargetUserId uniqueidentifier NOT NULL,
        Detail nvarchar(2000) NULL,
        CreatedAt datetime2(7) NOT NULL
          CONSTRAINT DF_IdentitySecurityAudit_CreatedAt
          DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentitySecurityAudit PRIMARY KEY (Id)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IX_IdentitySecurityAudit_TargetUserId_CreatedAt
      ON dbo.IdentitySecurityAudit (TargetUserId, CreatedAt DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE dbo.IdentitySecurityAudit;");
    await queryRunner.query(`
      ALTER TABLE dbo.IdentityUsers
        DROP CONSTRAINT DF_IdentityUsers_MustChangePassword;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.IdentityUsers
        DROP CONSTRAINT DF_IdentityUsers_SessionVersion;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.IdentityUsers
        DROP COLUMN MustChangePassword, SessionVersion;
    `);
  }
}
