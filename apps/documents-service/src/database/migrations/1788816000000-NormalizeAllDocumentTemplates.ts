import type { MigrationInterface, QueryRunner } from "typeorm";

const CANONICAL_SECTIONS = [
  ["header", "Encabezado del documento"],
  ["objectives", "Objetivos del proyecto"],
  ["problemDescription", "Descripción del problema"],
  ["scope", "Alcance"],
  ["solutionProposal", "Solución propuesta del profesional de soluciones"],
  ["processFlow", "Diagrama de flujo"],
  ["milestones", "Requerimientos"],
  ["backlogStructure", "Esquema"],
  ["tests", "Pruebas"],
  ["assumptionsDependenciesPending", "Supuestos, dependencias y pendientes"],
  ["approvalsAndChangeControl", "Aprobaciones y control de cambios"],
  ["writingRules", "Plantilla aplicada"],
  ["visualFormat", "Prototipo"],
  ["automationInstruction", "KPIs"],
] as const;

const SCRUM_SECTION = ["scrumPlan", "Plan de trabajo"] as const;

interface TemplateRow {
  Id: string;
  IncludesScrum: boolean | number;
  DefinitionJson: string;
}

type TemplateSection = Record<string, unknown> & { key?: unknown };

function sqlText(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeDefinition(raw: string, includesScrum: boolean): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const existingSections = Array.isArray(parsed.sections)
    ? (parsed.sections.filter(
        (section): section is TemplateSection =>
          Boolean(section) &&
          typeof section === "object" &&
          !Array.isArray(section),
      ) as TemplateSection[])
    : [];
  const byKey = new Map(
    existingSections
      .filter((section) => typeof section.key === "string")
      .map((section) => [String(section.key), section]),
  );
  const definitions = includesScrum
    ? [...CANONICAL_SECTIONS, SCRUM_SECTION]
    : CANONICAL_SECTIONS;
  const sections = definitions.map(([key, title], index) => {
    const existing = byKey.get(key) ?? {};
    return {
      ...existing,
      key,
      order: index + 1,
      title,
      required:
        typeof existing.required === "boolean" ? existing.required : true,
      guidance:
        typeof existing.guidance === "string"
          ? existing.guidance
          : key === "solutionProposal"
            ? "Proponer una solución breve con objetivo, componentes involucrados y correspondencia explícita entre estado actual, evaluación y resultado TO-BE."
            : "Completar esta sección con información verificable de las fuentes seleccionadas.",
    };
  });
  return JSON.stringify({
    ...parsed,
    sectionOrder: sections.map((section) => section.key),
    sections,
  });
}

export class NormalizeAllDocumentTemplates1788816000000 implements MigrationInterface {
  name = "NormalizeAllDocumentTemplates1788816000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      IF OBJECT_ID(N'dbo.DocumentTemplateDefinitionBackups1788816000000', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.DocumentTemplateDefinitionBackups1788816000000 (
          TemplateId uniqueidentifier NOT NULL PRIMARY KEY,
          DefinitionJson nvarchar(max) NOT NULL,
          UpdatedAt datetime2(7) NOT NULL
        );
      END;

      INSERT INTO dbo.DocumentTemplateDefinitionBackups1788816000000 (
        TemplateId, DefinitionJson, UpdatedAt
      )
      SELECT Id, DefinitionJson, UpdatedAt
      FROM dbo.DocumentTemplates source
      WHERE NOT EXISTS (
        SELECT 1
        FROM dbo.DocumentTemplateDefinitionBackups1788816000000 stored
        WHERE stored.TemplateId = source.Id
      );
    `);

    const rows = (await queryRunner.query(`
      SELECT Id, IncludesScrum, DefinitionJson
      FROM dbo.DocumentTemplates;
    `)) as TemplateRow[];

    for (const row of rows) {
      const normalized = sqlText(
        normalizeDefinition(row.DefinitionJson, Boolean(row.IncludesScrum)),
      );
      await queryRunner.query(`
        UPDATE dbo.DocumentTemplates
        SET DefinitionJson = N'${normalized}', UpdatedAt = SYSUTCDATETIME()
        WHERE Id = '${row.Id}';
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      IF OBJECT_ID(N'dbo.DocumentTemplateDefinitionBackups1788816000000', N'U') IS NOT NULL
      BEGIN
        UPDATE templates
        SET templates.DefinitionJson = stored.DefinitionJson,
            templates.UpdatedAt = stored.UpdatedAt
        FROM dbo.DocumentTemplates templates
        INNER JOIN dbo.DocumentTemplateDefinitionBackups1788816000000 stored
          ON stored.TemplateId = templates.Id;

        DROP TABLE dbo.DocumentTemplateDefinitionBackups1788816000000;
      END;
    `);
  }
}
