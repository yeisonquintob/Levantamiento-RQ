import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowRequestedChangesDocumentStatus1787007600000 implements MigrationInterface {
  name = "AllowRequestedChangesDocumentStatus1787007600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentVersions
        DROP CONSTRAINT CK_DocumentVersions_Status;
      ALTER TABLE dbo.RequirementDocuments
        DROP CONSTRAINT CK_RequirementDocuments_Status;

      ALTER TABLE dbo.RequirementDocuments
        ADD CONSTRAINT CK_RequirementDocuments_Status
        CHECK (Status IN (
          'DRAFT',
          'IN_REVIEW',
          'CHANGES_REQUESTED',
          'APPROVED',
          'REJECTED',
          'ARCHIVED'
        ));
      ALTER TABLE dbo.DocumentVersions
        ADD CONSTRAINT CK_DocumentVersions_Status
        CHECK (Status IN (
          'DRAFT',
          'IN_REVIEW',
          'CHANGES_REQUESTED',
          'APPROVED',
          'REJECTED',
          'ARCHIVED'
        ));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE dbo.DocumentVersions
      SET Status = 'DRAFT'
      WHERE Status = 'CHANGES_REQUESTED';
      UPDATE dbo.RequirementDocuments
      SET Status = 'DRAFT'
      WHERE Status = 'CHANGES_REQUESTED';

      ALTER TABLE dbo.DocumentVersions
        DROP CONSTRAINT CK_DocumentVersions_Status;
      ALTER TABLE dbo.RequirementDocuments
        DROP CONSTRAINT CK_RequirementDocuments_Status;

      ALTER TABLE dbo.RequirementDocuments
        ADD CONSTRAINT CK_RequirementDocuments_Status
        CHECK (Status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED'));
      ALTER TABLE dbo.DocumentVersions
        ADD CONSTRAINT CK_DocumentVersions_Status
        CHECK (Status IN ('DRAFT','IN_REVIEW','APPROVED','REJECTED','ARCHIVED'));
    `);
  }
}
