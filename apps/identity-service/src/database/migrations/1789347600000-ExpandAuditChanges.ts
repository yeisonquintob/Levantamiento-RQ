import type { MigrationInterface, QueryRunner } from "typeorm";
export class ExpandAuditChanges1789347600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE dbo.IdentitySecurityAudit ALTER COLUMN Detail nvarchar(max) NULL",
    );
  }
  async down(): Promise<void> {
    throw new Error(
      "No se reduce la auditoría porque truncaría el historial de cambios.",
    );
  }
}
