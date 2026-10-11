import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSourceSecurityQuarantine1787875200000 implements MigrationInterface {
  name = "AddSourceSecurityQuarantine1787875200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.Sources ADD
        SecurityStatus nvarchar(24) NOT NULL
          CONSTRAINT DF_Sources_SecurityStatus DEFAULT ('CLEAN'),
        SecurityScanner nvarchar(100) NULL,
        SecurityScannedAt datetime2(7) NULL;
    `);
    await queryRunner.query(`
      ALTER TABLE dbo.Sources ADD CONSTRAINT CK_Sources_SecurityStatus
        CHECK (SecurityStatus IN ('UPLOADED','QUARANTINED','SCANNING','CLEAN','INFECTED'));
    `);
    await queryRunner.query(`
      CREATE INDEX IX_Sources_SecurityStatus ON dbo.Sources (SecurityStatus);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IX_Sources_SecurityStatus ON dbo.Sources;
      ALTER TABLE dbo.Sources DROP CONSTRAINT CK_Sources_SecurityStatus;
      ALTER TABLE dbo.Sources DROP CONSTRAINT DF_Sources_SecurityStatus;
      ALTER TABLE dbo.Sources DROP COLUMN SecurityScannedAt, SecurityScanner, SecurityStatus;
    `);
  }
}
