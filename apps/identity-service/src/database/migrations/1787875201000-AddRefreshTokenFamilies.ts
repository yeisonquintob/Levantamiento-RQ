import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRefreshTokenFamilies1787875201000 implements MigrationInterface {
  name = "AddRefreshTokenFamilies1787875201000";

  async up(queryRunner: QueryRunner): Promise<void> {
    // SQL Server compiles an entire query batch before executing it. Keep the
    // schema change in a separate batch so subsequent statements can resolve
    // the newly added column.
    await queryRunner.query(
      "ALTER TABLE dbo.IdentityRefreshSessions ADD FamilyId uniqueidentifier NULL",
    );
    await queryRunner.query(
      "UPDATE dbo.IdentityRefreshSessions SET FamilyId = Id WHERE FamilyId IS NULL",
    );
    await queryRunner.query(
      "ALTER TABLE dbo.IdentityRefreshSessions ALTER COLUMN FamilyId uniqueidentifier NOT NULL",
    );
    await queryRunner.query(
      "CREATE INDEX IX_IdentityRefreshSessions_FamilyId ON dbo.IdentityRefreshSessions (FamilyId)",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP INDEX IX_IdentityRefreshSessions_FamilyId ON dbo.IdentityRefreshSessions",
    );
    await queryRunner.query(
      "ALTER TABLE dbo.IdentityRefreshSessions DROP COLUMN FamilyId",
    );
  }
}
