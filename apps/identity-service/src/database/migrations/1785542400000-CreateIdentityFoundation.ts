import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateIdentityFoundation1785542400000
  implements MigrationInterface
{
  name = "CreateIdentityFoundation1785542400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.IdentityUsers (
        Id uniqueidentifier NOT NULL,
        Email nvarchar(320) NOT NULL,
        EmailNormalized nvarchar(320) NOT NULL,
        DisplayName nvarchar(200) NOT NULL,
        PasswordHash nvarchar(500) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_IdentityUsers_IsActive DEFAULT (1),
        LastLoginAt datetime2(7) NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityUsers_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityUsers_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentityUsers PRIMARY KEY (Id)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_IdentityUsers_EmailNormalized
      ON dbo.IdentityUsers (EmailNormalized);
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentityRoles (
        Id uniqueidentifier NOT NULL,
        Code nvarchar(100) NOT NULL,
        Name nvarchar(160) NOT NULL,
        IsActive bit NOT NULL CONSTRAINT DF_IdentityRoles_IsActive DEFAULT (1),
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityRoles_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityRoles_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentityRoles PRIMARY KEY (Id)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_IdentityRoles_Code
      ON dbo.IdentityRoles (Code);
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentityPermissions (
        Id uniqueidentifier NOT NULL,
        Code nvarchar(160) NOT NULL,
        Name nvarchar(200) NOT NULL,
        Description nvarchar(500) NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityPermissions_CreatedAt DEFAULT (SYSUTCDATETIME()),
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityPermissions_UpdatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentityPermissions PRIMARY KEY (Id)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_IdentityPermissions_Code
      ON dbo.IdentityPermissions (Code);
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentityUserRoles (
        UserId uniqueidentifier NOT NULL,
        RoleId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityUserRoles_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentityUserRoles PRIMARY KEY (UserId, RoleId),
        CONSTRAINT FK_IdentityUserRoles_User
          FOREIGN KEY (UserId) REFERENCES dbo.IdentityUsers(Id) ON DELETE CASCADE,
        CONSTRAINT FK_IdentityUserRoles_Role
          FOREIGN KEY (RoleId) REFERENCES dbo.IdentityRoles(Id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentityRolePermissions (
        RoleId uniqueidentifier NOT NULL,
        PermissionId uniqueidentifier NOT NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityRolePermissions_CreatedAt DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_IdentityRolePermissions PRIMARY KEY (RoleId, PermissionId),
        CONSTRAINT FK_IdentityRolePermissions_Role
          FOREIGN KEY (RoleId) REFERENCES dbo.IdentityRoles(Id) ON DELETE CASCADE,
        CONSTRAINT FK_IdentityRolePermissions_Permission
          FOREIGN KEY (PermissionId) REFERENCES dbo.IdentityPermissions(Id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE TABLE dbo.IdentityRefreshSessions (
        Id uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        TokenHash char(64) NOT NULL,
        ExpiresAt datetime2(7) NOT NULL,
        RevokedAt datetime2(7) NULL,
        ReplacedBySessionId uniqueidentifier NULL,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_IdentityRefreshSessions_CreatedAt DEFAULT (SYSUTCDATETIME()),
        LastUsedAt datetime2(7) NULL,
        UserAgent nvarchar(512) NULL,
        IpAddress nvarchar(64) NULL,
        CONSTRAINT PK_IdentityRefreshSessions PRIMARY KEY (Id),
        CONSTRAINT FK_IdentityRefreshSessions_User
          FOREIGN KEY (UserId) REFERENCES dbo.IdentityUsers(Id) ON DELETE CASCADE
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX UQ_IdentityRefreshSessions_TokenHash
      ON dbo.IdentityRefreshSessions (TokenHash);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_IdentityRefreshSessions_UserId
      ON dbo.IdentityRefreshSessions (UserId);
    `);

    await queryRunner.query(`
      CREATE INDEX IX_IdentityRefreshSessions_ExpiresAt
      ON dbo.IdentityRefreshSessions (ExpiresAt);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE dbo.IdentityRefreshSessions;",
    );
    await queryRunner.query(
      "DROP TABLE dbo.IdentityRolePermissions;",
    );
    await queryRunner.query("DROP TABLE dbo.IdentityUserRoles;");
    await queryRunner.query(
      "DROP TABLE dbo.IdentityPermissions;",
    );
    await queryRunner.query("DROP TABLE dbo.IdentityRoles;");
    await queryRunner.query("DROP TABLE dbo.IdentityUsers;");
  }
}
