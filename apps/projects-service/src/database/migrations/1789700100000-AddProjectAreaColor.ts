import type { MigrationInterface, QueryRunner } from "typeorm";

// Color del icono de cada área. Los colores iniciales dependen del icono sugerido.
export class AddProjectAreaColor1789700100000 implements MigrationInterface {
  name = "AddProjectAreaColor1789700100000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE dbo.ProjectAreas ADD Color NVARCHAR(20) NULL`,
    );
    await queryRunner.query(`
      UPDATE dbo.ProjectAreas SET Color = CASE Icon
        WHEN 'wallet' THEN 'green'
        WHEN 'calculator' THEN 'blue'
        WHEN 'chart' THEN 'teal'
        WHEN 'laptop' THEN 'blue'
        WHEN 'truck' THEN 'orange'
        WHEN 'gear' THEN 'slate'
        WHEN 'users' THEN 'purple'
        WHEN 'scale' THEN 'brown'
        WHEN 'cart' THEN 'orange'
        WHEN 'wrench' THEN 'brown'
        WHEN 'calendar' THEN 'purple'
        WHEN 'megaphone' THEN 'red'
        WHEN 'shield' THEN 'teal'
        WHEN 'headset' THEN 'blue'
        WHEN 'box' THEN 'brown'
        ELSE 'slate'
      END
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dbo.ProjectAreas DROP COLUMN Color`);
  }
}
