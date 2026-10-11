import type { MigrationInterface, QueryRunner } from "typeorm";

const TEMPLATE_IDS: Readonly<Record<string, string>> = {
  "RQ-SMALL": "16000000-0000-4000-8000-000000000011",
  "RQ-MEDIUM": "16000000-0000-4000-8000-000000000012",
  "RQ-LARGE": "16000000-0000-4000-8000-000000000013",
  "ERP-FDD": "16000000-0000-4000-8000-000000000014",
};

function sqlText(value: string): string {
  return value.replaceAll("'", "''");
}

type TemplateRow = {
  Code: string;
  DefinitionJson: string;
};

function upgradedDefinition(raw: string): string {
  const definition = JSON.parse(raw) as {
    sectionOrder: string[];
    sections: Array<{
      key: string;
      order: number;
      title: string;
      required: boolean;
      guidance: string;
    }>;
    aiPrompt?: { templateInstruction?: string };
  };
  if (!definition.sections.some((section) => section.key === "solutionProposal")) {
    const processIndex = definition.sections.findIndex(
      (section) => section.key === "processFlow",
    );
    definition.sections.splice(processIndex < 0 ? 4 : processIndex, 0, {
      key: "solutionProposal",
      order: 0,
      title: "Solución propuesta del profesional de soluciones",
      required: true,
      guidance:
        "Proponer una solución breve con objetivo, componentes involucrados y correspondencia explícita entre estado actual, evaluación y resultado TO-BE.",
    });
  }
  definition.sections = definition.sections.map((section, index) => ({
    ...section,
    order: index + 1,
    guidance:
      section.key === "header"
        ? "Identificar título, código, versión, área solicitante y estado; los responsables se registran exclusivamente en Aprobaciones."
        : section.key === "approvalsAndChangeControl"
          ? "Concentrar elaboración, revisión y aprobación por responsable y momento; registrar un único control de cambio solo cuando la versión sea aprobada."
          : section.guidance,
  }));
  definition.sectionOrder = definition.sections.map((section) => section.key);
  if (definition.aiPrompt) {
    definition.aiPrompt.templateInstruction =
      "Conserva las secciones configuradas. Genera una solución propuesta compacta y coherente con AS-IS y TO-BE. No incluyas responsables en el encabezado; concéntralos en Aprobaciones y no registres la generación del borrador como control de cambios.";
  }
  return JSON.stringify(definition);
}

export class AddSolutionProposalSection1788470400000
  implements MigrationInterface
{
  name = "AddSolutionProposalSection1788470400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_Order;
    `);

    const rows = (await queryRunner.query(`
      SELECT Code, DefinitionJson
      FROM dbo.DocumentTemplates
      WHERE Version = N'1.2.0';
    `)) as TemplateRow[];

    for (const row of rows) {
      const id = TEMPLATE_IDS[row.Code];
      if (!id) continue;
      const definition = sqlText(upgradedDefinition(row.DefinitionJson));
      await queryRunner.query(`
        IF NOT EXISTS (
          SELECT 1 FROM dbo.DocumentTemplates
          WHERE Code = N'${sqlText(row.Code)}' AND Version = N'1.3.0'
        )
        BEGIN
          INSERT INTO dbo.DocumentTemplates (
            Id, Code, Name, Description, TemplateType, Version, Status,
            IncludesScrum, DefinitionJson, SourceTemplateId,
            CreatedByUserId, UpdatedByUserId, PublishedByUserId,
            RetiredByUserId, CreatedAt, UpdatedAt, PublishedAt, RetiredAt
          )
          SELECT
            '${id}', Code, Name, Description, TemplateType, N'1.3.0',
            N'PUBLISHED', IncludesScrum, N'${definition}', Id,
            NULL, NULL, NULL, NULL, SYSUTCDATETIME(), SYSUTCDATETIME(),
            SYSUTCDATETIME(), NULL
          FROM dbo.DocumentTemplates
          WHERE Code = N'${sqlText(row.Code)}' AND Version = N'1.2.0';
        END;

        UPDATE dbo.DocumentTemplates
        SET Status = N'RETIRED', UpdatedAt = SYSUTCDATETIME(),
            RetiredAt = COALESCE(RetiredAt, SYSUTCDATETIME())
        WHERE Code = N'${sqlText(row.Code)}' AND Version = N'1.2.0'
          AND Status = N'PUBLISHED';
      `);
    }

    await queryRunner.query(`
      UPDATE dbo.DocumentSections
      SET OrderIndex = -OrderIndex
      WHERE OrderIndex >= 5
        AND DocumentVersionId IN (
          SELECT DISTINCT DocumentVersionId
          FROM dbo.DocumentSections
          WHERE SectionKey = N'processFlow'
            AND DocumentVersionId NOT IN (
              SELECT DocumentVersionId FROM dbo.DocumentSections
              WHERE SectionKey = N'solutionProposal'
            )
        );

      UPDATE dbo.DocumentSections
      SET OrderIndex = -OrderIndex + 1
      WHERE OrderIndex <= -5;

      INSERT INTO dbo.DocumentSections (
        Id, DocumentVersionId, SectionKey, Title, OrderIndex,
        ContentJson, TemplateControlled
      )
      SELECT NEWID(), versions.Id, N'solutionProposal',
        N'Solución propuesta del profesional de soluciones', 5,
        N'{"objective":"[PENDIENTE POR DEFINIR]","description":"[PENDIENTE POR DEFINIR]","involvedElements":["[PENDIENTE POR DEFINIR]"],"flowAlignment":{"currentState":"[PENDIENTE POR DEFINIR]","evaluation":"[PENDIENTE POR DEFINIR]","expectedResult":"[PENDIENTE POR DEFINIR]"}}',
        0
      FROM dbo.DocumentVersions versions
      WHERE EXISTS (
        SELECT 1 FROM dbo.DocumentSections flow
        WHERE flow.DocumentVersionId = versions.Id
          AND flow.SectionKey = N'processFlow'
      )
      AND NOT EXISTS (
        SELECT 1 FROM dbo.DocumentSections proposal
        WHERE proposal.DocumentVersionId = versions.Id
          AND proposal.SectionKey = N'solutionProposal'
      );

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_Order
        CHECK (OrderIndex BETWEEN 1 AND 15);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dbo.DocumentSections
        DROP CONSTRAINT CK_DocumentSections_Order;

      DELETE FROM dbo.DocumentSections WHERE SectionKey = N'solutionProposal';

      UPDATE dbo.DocumentSections
      SET OrderIndex = -OrderIndex
      WHERE OrderIndex >= 6;

      UPDATE dbo.DocumentSections
      SET OrderIndex = -OrderIndex - 1
      WHERE OrderIndex <= -6;

      ALTER TABLE dbo.DocumentSections
        ADD CONSTRAINT CK_DocumentSections_Order
        CHECK (OrderIndex BETWEEN 1 AND 14);

      DELETE FROM dbo.DocumentTemplates WHERE Version = N'1.3.0';

      UPDATE dbo.DocumentTemplates
      SET Status = N'PUBLISHED', UpdatedAt = SYSUTCDATETIME(), RetiredAt = NULL
      WHERE Version = N'1.2.0'
        AND Code IN (N'RQ-SMALL', N'RQ-MEDIUM', N'RQ-LARGE', N'ERP-FDD');
    `);
  }
}
