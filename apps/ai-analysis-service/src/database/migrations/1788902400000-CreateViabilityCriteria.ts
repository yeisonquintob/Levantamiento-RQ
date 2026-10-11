import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateViabilityCriteria1788902400000 implements MigrationInterface {
  name = "CreateViabilityCriteria1788902400000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.ViabilityCriteria (
        Id uniqueidentifier NOT NULL,
        Level int NOT NULL,
        MinimumPercentage int NOT NULL,
        MaximumPercentage int NOT NULL,
        Name nvarchar(120) NOT NULL,
        Description nvarchar(1000) NOT NULL,
        Recommendation nvarchar(1000) NOT NULL,
        Viable bit NOT NULL,
        DisplayOrder int NOT NULL,
        Active bit NOT NULL CONSTRAINT DF_ViabilityCriteria_Active DEFAULT 1,
        CreatedAt datetime2(7) NOT NULL CONSTRAINT DF_ViabilityCriteria_CreatedAt DEFAULT SYSUTCDATETIME(),
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_ViabilityCriteria_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ViabilityCriteria PRIMARY KEY (Id),
        CONSTRAINT UQ_ViabilityCriteria_Level UNIQUE (Level),
        CONSTRAINT CK_ViabilityCriteria_Range CHECK (MinimumPercentage >= 0 AND MaximumPercentage <= 100 AND MinimumPercentage <= MaximumPercentage)
      );
      CREATE TABLE dbo.ViabilitySettings (
        SettingKey nvarchar(80) NOT NULL,
        IntegerValue int NOT NULL,
        UpdatedAt datetime2(7) NOT NULL CONSTRAINT DF_ViabilitySettings_UpdatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_ViabilitySettings PRIMARY KEY (SettingKey)
      );
      INSERT INTO dbo.ViabilitySettings (SettingKey, IntegerValue) VALUES (N'discrepancyThreshold', 25);
    `);
    const defaults = [
      [1,0,10,"Crítica","La definición es insuficiente para sustentar una decisión.","Completar evidencia y respuestas antes de continuar.",0],
      [2,11,20,"Muy baja","Existen datos aislados, pero permanecen vacíos esenciales.","Precisar objetivo, alcance y responsables.",0],
      [3,21,30,"Baja","La necesidad se reconoce parcialmente y requiere aclaraciones.","Resolver las brechas señaladas y aportar evidencia.",0],
      [4,31,40,"Limitada","Hay una base inicial sin suficiente precisión operativa.","Detallar reglas, restricciones y resultados esperados.",0],
      [5,41,50,"Intermedia","La definición permite análisis, aunque conserva riesgos relevantes.","Validar supuestos y cerrar respuestas pendientes.",0],
      [6,51,60,"Aceptable","La información es utilizable con observaciones controlables.","Atender las recomendaciones antes de aprobar.",1],
      [7,61,70,"Buena","La definición cubre la mayoría de aspectos relevantes.","Confirmar discrepancias y criterios de aceptación.",1],
      [8,71,80,"Alta","La evidencia ofrece una definición sólida y verificable.","Completar únicamente los ajustes menores identificados.",1],
      [9,81,90,"Muy alta","La definición es completa y presenta pocas brechas.","Revisar consistencia final y proceder a validación.",1],
      [10,91,100,"Óptima","La definición es integral, consistente y accionable.","Proceder con el flujo documental y su aprobación.",1],
    ] as const;
    for (const [level,min,max,name,description,recommendation,viable] of defaults) {
      await queryRunner.query(`INSERT INTO dbo.ViabilityCriteria (Id, Level, MinimumPercentage, MaximumPercentage, Name, Description, Recommendation, Viable, DisplayOrder, Active) VALUES (NEWID(), @0, @1, @2, @3, @4, @5, @6, @7, 1)`, [level,min,max,name,description,recommendation,viable,level]);
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE dbo.ViabilitySettings; DROP TABLE dbo.ViabilityCriteria;`);
  }
}
