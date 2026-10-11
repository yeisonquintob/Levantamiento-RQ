import type { MigrationInterface, QueryRunner } from "typeorm";

export class AllowScrumPlanDocumentSection1786924800000
  implements MigrationInterface
{
  name = "AllowScrumPlanDocumentSection1786924800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_Order;

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_Order
        CHECK (OrderIndex BETWEEN 1 AND 14);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_Order;

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_Order
        CHECK (OrderIndex BETWEEN 1 AND 13);
    `);
  }
}
