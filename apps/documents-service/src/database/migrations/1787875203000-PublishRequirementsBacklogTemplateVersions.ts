import type { MigrationInterface, QueryRunner } from "typeorm";

const TEMPLATES = [
  ["RQ-SMALL", "15000000-0000-4000-8000-000000000011"],
  ["RQ-MEDIUM", "15000000-0000-4000-8000-000000000012"],
  ["RQ-LARGE", "15000000-0000-4000-8000-000000000013"],
  ["ERP-FDD", "15000000-0000-4000-8000-000000000014"],
] as const;

const REQUIREMENTS_GUIDANCE =
  "Presentar en dos grupos: requerimientos funcionales por hito o funcionalidad y requerimientos no funcionales por categoría, medida y objetivo verificable.";
const BACKLOG_GUIDANCE =
  "Organizar el backlog canónico como Epic > Feature > Historia de Usuario > Tarea, con códigos únicos, evidencia y dependencias válidas.";
const TESTS_GUIDANCE =
  "Definir pruebas vinculadas a historias de usuario reales, criterios de aceptación y tareas del esquema.";

/**
 * Publica una nueva plantilla sin alterar las versiones documentales que ya
 * referencian 1.0.0 o 1.1.0. SQL Server conserva ambas definiciones retiradas.
 */
export class PublishRequirementsBacklogTemplateVersions1787875203000
  implements MigrationInterface
{
  name = "PublishRequirementsBacklogTemplateVersions1787875203000";

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const [code, id] of TEMPLATES) {
      await queryRunner.query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.DocumentTemplates
          WHERE Code = N'${code}' AND Version = N'1.2.0'
        )
        BEGIN
          INSERT INTO dbo.DocumentTemplates (
            Id, Code, Name, Description, TemplateType, Version, Status,
            IncludesScrum, DefinitionJson, SourceTemplateId,
            CreatedByUserId, UpdatedByUserId, PublishedByUserId,
            RetiredByUserId, CreatedAt, UpdatedAt, PublishedAt, RetiredAt
          )
          SELECT
            '${id}', Code, Name, Description, TemplateType, N'1.2.0',
            N'PUBLISHED', IncludesScrum,
            JSON_MODIFY(
              JSON_MODIFY(
                JSON_MODIFY(
                  JSON_MODIFY(
                    JSON_MODIFY(
                      JSON_MODIFY(
                        JSON_MODIFY(
                          JSON_MODIFY(DefinitionJson,
                            '$.sectionOrder[6]', N'backlogStructure'),
                          '$.sections[5].title', N'Requerimientos'),
                        '$.sections[5].guidance', N'${REQUIREMENTS_GUIDANCE}'),
                      '$.sections[6].key', N'backlogStructure'),
                    '$.sections[6].title', N'Esquema'),
                  '$.sections[6].guidance', N'${BACKLOG_GUIDANCE}'),
                '$.sections[7].title', N'Pruebas'),
              '$.sections[7].guidance', N'${TESTS_GUIDANCE}'),
            Id, NULL, NULL, NULL, NULL,
            SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME(), NULL
          FROM dbo.DocumentTemplates
          WHERE Code = N'${code}' AND Version = N'1.1.0';
        END;

        UPDATE dbo.DocumentTemplates
        SET Status = N'RETIRED', UpdatedAt = SYSUTCDATETIME(),
            RetiredAt = COALESCE(RetiredAt, SYSUTCDATETIME())
        WHERE Code = N'${code}' AND Version = N'1.1.0'
          AND Status = N'PUBLISHED';
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const [code] of TEMPLATES) {
      await queryRunner.query(`
        DELETE FROM dbo.DocumentTemplates
        WHERE Code = N'${code}' AND Version = N'1.2.0';

        UPDATE dbo.DocumentTemplates
        SET Status = N'PUBLISHED', UpdatedAt = SYSUTCDATETIME(), RetiredAt = NULL
        WHERE Code = N'${code}' AND Version = N'1.1.0';
      `);
    }
  }
}
