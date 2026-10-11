import type { MigrationInterface, QueryRunner } from "typeorm";

// Catálogo de áreas solicitantes. Se siembra con las áreas que ya usan los proyectos para que el
// filtro «Área» funcione desde el primer momento.
export class CreateProjectAreas1789700000000 implements MigrationInterface {
  name = "CreateProjectAreas1789700000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.ProjectAreas (
        Id UNIQUEIDENTIFIER NOT NULL
          CONSTRAINT PK_ProjectAreas PRIMARY KEY
          CONSTRAINT DF_ProjectAreas_Id DEFAULT NEWID(),
        Name NVARCHAR(160) NOT NULL,
        Icon NVARCHAR(30) NULL,
        CreatedByUserId UNIQUEIDENTIFIER NULL,
        CreatedAt DATETIME2 NOT NULL
          CONSTRAINT DF_ProjectAreas_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT UQ_ProjectAreas_Name UNIQUE (Name)
      )
    `);
    await queryRunner.query(`
      INSERT INTO dbo.ProjectAreas (Name)
      SELECT DISTINCT LTRIM(RTRIM(RequestingArea))
      FROM dbo.Projects
      WHERE RequestingArea IS NOT NULL AND LTRIM(RTRIM(RequestingArea)) <> ''
    `);
    // Icono sugerido por el nombre del área; se puede cambiar en Parámetros → Área.
    await queryRunner.query(`
      UPDATE dbo.ProjectAreas SET Icon = CASE
        WHEN Name LIKE N'%cartera%' THEN 'wallet'
        WHEN Name LIKE N'%contab%' THEN 'calculator'
        WHEN Name LIKE N'%financ%' THEN 'chart'
        WHEN Name = N'TI' OR Name LIKE N'%tecnolog%' OR Name LIKE N'%sistemas%' THEN 'laptop'
        WHEN Name LIKE N'%log_stica%' OR Name LIKE N'%transporte%' THEN 'truck'
        WHEN Name LIKE N'%operac%' THEN 'gear'
        WHEN Name LIKE N'%human%' OR Name LIKE N'%talento%' THEN 'users'
        WHEN Name LIKE N'%jur_dic%' OR Name LIKE N'%legal%' OR Name LIKE N'%licitac%' THEN 'scale'
        WHEN Name LIKE N'%compras%' OR Name LIKE N'%comercial%' THEN 'cart'
        WHEN Name LIKE N'%servicio%' OR Name LIKE N'%mantenim%' THEN 'wrench'
        WHEN Name LIKE N'%planific%' THEN 'calendar'
        WHEN Name LIKE N'%mercad%' OR Name LIKE N'%producto%' THEN 'megaphone'
        WHEN Name LIKE N'%segur%' THEN 'shield'
        WHEN Name LIKE N'%cliente%' THEN 'headset'
        ELSE NULL
      END
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dbo.ProjectAreas`);
  }
}
