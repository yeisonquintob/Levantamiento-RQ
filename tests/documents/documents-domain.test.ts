import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_SCRUM_SECTION_DEFINITION,
  DOCUMENT_SECTION_DEFINITIONS,
  DOCUMENT_STATUSES,
  getDocumentSectionDefinitions,
} from "../../libs/shared/contracts/src/lib/documents.js";
import {
  parseCreateVersion,
  parseApplyAiDraft,
  parseReplaceFields,
  parseSectionKey,
  parseUpdateSection,
  validateDocumentSectionContent,
} from "../../apps/documents-service/src/documents/documents-input.js";

test("el contrato conserva exactamente los catorce puntos canónicos", () => {
  assert.equal(DOCUMENT_SECTION_DEFINITIONS.length, 14);
  assert.deepEqual(
    DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
    [
      "header",
      "objectives",
      "problemDescription",
      "scope",
      "solutionProposal",
      "processFlow",
      "milestones",
      "backlogStructure",
      "tests",
      "assumptionsDependenciesPending",
      "approvalsAndChangeControl",
      "writingRules",
      "visualFormat",
      "automationInstruction",
    ],
  );
  assert.deepEqual(DOCUMENT_STATUSES, [
    "DRAFT",
    "IN_REVIEW",
    "CHANGES_REQUESTED",
    "APPROVED",
    "REJECTED",
    "ARCHIVED",
  ]);
  const scrumSections = getDocumentSectionDefinitions(true);
  assert.equal(scrumSections.length, 15);
  assert.equal(
    scrumSections.at(-1)?.key,
    DOCUMENT_SCRUM_SECTION_DEFINITION.key,
  );
  assert.throws(() => parseSectionKey("customSection"), /canónica/i);
});

test("las ediciones exigen revisión optimista y JSON serializable", () => {
  assert.deepEqual(
    parseUpdateSection({
      expectedRevision: 4,
      content: { general: "Definir" },
    }),
    { expectedRevision: 4, content: { general: "Definir" } },
  );
  assert.throws(
    () => parseUpdateSection({ expectedRevision: 0, content: {} }),
    /expectedRevision/i,
  );
  assert.deepEqual(
    parseCreateVersion({
      expectedRevision: 3,
      changeSummary: "Ajustes posteriores a la aprobación",
    }),
    {
      expectedRevision: 3,
      changeSummary: "Ajustes posteriores a la aprobación",
    },
  );
});

test("aprobaciones exige tres roles y un único cambio aprobado", () => {
  const approvals = ["Elaboración", "Revisión", "Aprobación"].map(
    (responsibility) => ({ responsibility }),
  );
  assert.doesNotThrow(() =>
    validateDocumentSectionContent("approvalsAndChangeControl", {
      approvals,
      changeControl: [],
    }),
  );
  assert.throws(
    () =>
      validateDocumentSectionContent("approvalsAndChangeControl", {
        approvals: approvals.slice(0, 2),
        changeControl: [],
      }),
    /elaboración, revisión y aprobación/i,
  );
  assert.throws(
    () =>
      validateDocumentSectionContent("approvalsAndChangeControl", {
        approvals,
        changeControl: [{ version: "1.1.0" }, { version: "1.2.0" }],
      }),
    /changeControl/i,
  );
});

test("la edición manual del esquema rechaza duplicados, huérfanos y ciclos", () => {
  const backlog = {
    epics: [
      {
        code: "EP-001",
        features: [
          {
            code: "FE-001",
            userStories: [
              {
                code: "HU-001",
                featureCode: "FE-001",
                acceptanceCriteria: [{ code: "CA-001" }],
                tasks: [
                  {
                    code: "T-001",
                    origin: "EVIDENCE",
                    dependencyCodes: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  assert.doesNotThrow(() =>
    validateDocumentSectionContent("backlogStructure", backlog),
  );
  assert.throws(
    () =>
      validateDocumentSectionContent("backlogStructure", {
        ...backlog,
        epics: [...backlog.epics, backlog.epics[0]],
      }),
    /duplicado/i,
  );
  assert.throws(
    () =>
      validateDocumentSectionContent("backlogStructure", {
        epics: [
          {
            ...backlog.epics[0],
            features: [
              {
                ...backlog.epics[0].features[0],
                userStories: [
                  {
                    ...backlog.epics[0].features[0].userStories[0],
                    tasks: [
                      {
                        code: "T-001",
                        origin: "EVIDENCE",
                        dependencyCodes: ["T-999"],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    /inexistente/i,
  );
});

test("el punto 7 sincroniza su estructura con el punto 6 en la misma transacción", async () => {
  const service = await readFile(
    new URL(
      "../../apps/documents-service/src/documents/documents.service.ts",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(service, /PUNTO_7_REQUIREMENTS_SYNCHRONIZATION/);

  assert.match(service, /synchronizeBacklogStructureWithRequirements/);

  assert.match(service, /PUNTO_7_SYNC_IN_TRANSACTION/);

  assert.match(service, /sectionKey ===\s*"backlogStructure"/);

  assert.match(service, /key:\s*"milestones"/);

  assert.match(service, /featureCode:/);

  assert.match(service, /epicCode:/);
});

test("campos, requisitos, criterios y referencias SourceId se validan", () => {
  const parsed = parseReplaceFields({
    expectedRevision: 2,
    fields: [
      {
        sectionKey: "scope",
        key: "includedScope",
        label: "Incluye",
        valueType: "LIST",
        value: ["Proceso de compras"],
        order: 1,
      },
    ],
    requirements: [
      {
        clientId: "requirement-1",
        sectionKey: "milestones",
        code: "RF-001",
        title: "Registrar solicitud",
        description: "El sistema deberá registrar una solicitud.",
        requirementType: "FUNCTIONAL",
        status: "DEFINED",
        order: 1,
        acceptanceCriteria: [
          { description: "La solicitud conserva su código.", order: 1 },
        ],
      },
    ],
    evidence: [
      {
        sourceId: "11111111-1111-4111-8111-111111111111",
        sectionKey: "milestones",
        requirementClientId: "requirement-1",
      },
    ],
  });

  assert.equal(parsed.fields.length, 1);
  assert.equal(parsed.requirements[0]?.acceptanceCriteria.length, 1);
  assert.equal(parsed.evidence[0]?.requirementClientId, "requirement-1");
  assert.throws(
    () =>
      parseReplaceFields({
        expectedRevision: 1,
        fields: [],
        requirements: [],
        evidence: [
          {
            sourceId: "11111111-1111-4111-8111-111111111111",
            requirementClientId: "missing",
          },
        ],
      }),
    /inexistente/i,
  );
});

test("la aplicación IA valida revisión, claves únicas y trazabilidad", () => {
  const sections = DOCUMENT_SECTION_DEFINITIONS.slice(0, 11).map((section) => ({
    key: section.key,
    content:
      section.key === "backlogStructure"
        ? { epics: [] }
        : `Contenido de ${section.key}`,
  }));
  const parsed = parseApplyAiDraft({
    expectedRevision: 7,
    analysisRequestId: "11111111-1111-4111-8111-111111111111",
    analysisResultId: "22222222-2222-4222-8222-222222222222",
    sections,
    requirements: [
      {
        clientId: "ai-requirement-1",
        sectionKey: "milestones",
        code: "RF-001",
        title: "Registrar solicitud",
        description: "El sistema deberá registrar la solicitud.",
        requirementType: "FUNCTIONAL",
        status: "PROPOSED",
        order: 1,
        acceptanceCriteria: [
          { description: "La solicitud obtiene un código.", order: 1 },
        ],
      },
    ],
    evidence: [
      {
        sourceId: "33333333-3333-4333-8333-333333333333",
        sectionKey: "milestones",
        requirementClientId: "ai-requirement-1",
      },
    ],
  });

  assert.equal(parsed.sections.length, 11);
  assert.equal(parsed.requirements[0]?.status, "PROPOSED");
  assert.equal(parsed.evidence[0]?.requirementClientId, "ai-requirement-1");
  assert.throws(
    () =>
      parseApplyAiDraft({
        ...parsed,
        sections: [...sections, sections[0]],
      }),
    /duplicada/i,
  );

  const scrumParsed = parseApplyAiDraft({
    ...parsed,
    sections: [
      ...sections,
      {
        key: DOCUMENT_SCRUM_SECTION_DEFINITION.key,
        content: "Sprint 1: Día 1 al Día 15.",
      },
    ],
  });
  assert.equal(scrumParsed.sections.length, 12);
  assert.equal(scrumParsed.sections.at(-1)?.key, "scrumPlan");

  const historicalParsed = parseApplyAiDraft({
    ...parsed,
    sections: [
      ...sections
        .filter((section) => section.key !== "solutionProposal")
        .slice(0, 6),
      { key: "nonFunctionalRequirements", content: { security: [] } },
      ...sections
        .filter((section) => section.key !== "solutionProposal")
        .slice(7),
    ],
  });
  assert.equal(historicalParsed.sections.length, 10);
  assert.equal(historicalParsed.sections[6]?.key, "nonFunctionalRequirements");

  const historicalWithSolution = parseApplyAiDraft({
    ...parsed,
    sections: [
      ...sections.slice(0, 7),
      { key: "nonFunctionalRequirements", content: { security: [] } },
      ...sections.slice(8),
    ],
  });
  assert.equal(historicalWithSolution.sections.length, 11);
  assert.equal(historicalWithSolution.sections[4]?.key, "solutionProposal");
  assert.equal(
    historicalWithSolution.sections[7]?.key,
    "nonFunctionalRequirements",
  );
});

test("la persistencia pertenece solo a RqDocumentsDb", async () => {
  const [migration, aiApplicationMigration] = await Promise.all([
    readFile(
      "apps/documents-service/src/database/migrations/1786233600000-CreateRequirementDocumentsDomain.ts",
      "utf8",
    ),
    readFile(
      "apps/documents-service/src/database/migrations/1786665600000-AddAppliedAiAnalysisResults.ts",
      "utf8",
    ),
  ]);
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );

  for (const table of [
    "AppliedDocumentTemplates",
    "RequirementDocuments",
    "DocumentVersions",
    "DocumentSections",
    "DocumentFields",
    "DocumentRequirements",
    "AcceptanceCriteria",
    "DocumentEvidence",
    "DocumentHistory",
  ]) {
    assert.match(migration, new RegExp(`dbo\\.${table}`));
  }
  assert.doesNotMatch(migration, /RqProjectsDb|RqSourcesDb/);
  assert.match(aiApplicationMigration, /AppliedAiAnalysisResults/);
  assert.match(
    aiApplicationMigration,
    /UQ_AppliedAiAnalysisResults_Result UNIQUE \(AnalysisResultId\)/,
  );
  assert.match(aiApplicationMigration, /DocumentVersionId/);
  assert.doesNotMatch(aiApplicationMigration, /RqAiDb/);
  assert.match(service, /DocumentsProjectsAccessClient/);
  assert.match(service, /DocumentsSourcesAccessClient/);
  assert.doesNotMatch(service, /ProjectEntity|SourceEntity/);
});

test("aprobación, bloqueo, historial y concurrencia están protegidos", async () => {
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );

  assert.match(service, /Revision = :expectedRevision/);
  assert.match(service, /La revisión enviada está desactualizada/);
  assert.match(service, /La versión aprobada es inmutable/);
  assert.match(service, /VERSION_APPROVED/);
  assert.match(service, /VERSION_CREATED/);
  assert.match(service, /DOCUMENT_ARCHIVED/);
  assert.match(service, /assertDocumentSections/);
  assert.match(service, /templateControlled/);
  assert.match(service, /AI_DRAFT_APPLIED/);
  assert.match(service, /analysisResultId/);
});

test("la aplicación de documentos grandes respeta el límite de parámetros de SQL Server", async () => {
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );
  const applyAiDraft = service.slice(
    service.indexOf("async applyAiDraft"),
    service.indexOf("async submitReview"),
  );
  assert.match(service, /SQL_SERVER_WRITE_BATCH_SIZE = 100/);
  assert.match(service, /SQL_SERVER_IN_BATCH_SIZE = 500/);
  assert.match(applyAiDraft, /deleteAcceptanceCriteriaInBatches/);
  assert.ok(
    (applyAiDraft.match(/chunk: SQL_SERVER_WRITE_BATCH_SIZE/g) ?? []).length >=
      3,
  );
});

test("la persistencia acepta los valores JSON escalares del contrato", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1786838400000-AllowJsonScalarDocumentValues.ts",
    "utf8",
  );

  assert.match(migration, /CK_DocumentSections_ContentJson/);
  assert.match(migration, /CK_DocumentFields_ValueJson/);
  assert.match(migration, /ISJSON\(CONCAT\(N'\[', ContentJson, N'\]'\)\) = 1/);
  assert.match(migration, /ISJSON\(CONCAT\(N'\[', ValueJson, N'\]'\)\) = 1/);
  assert.match(migration, /LEN\(LTRIM\(RTRIM\(ContentJson\)\)\) > 0/);
});

test("la persistencia amplía Plan Scrum a la sección opcional número 15", async () => {
  const scrumMigration = await readFile(
    "apps/documents-service/src/database/migrations/1786924800000-AllowScrumPlanDocumentSection.ts",
    "utf8",
  );
  const solutionMigration = await readFile(
    "apps/documents-service/src/database/migrations/1788470400000-AddSolutionProposalSection.ts",
    "utf8",
  );
  const databaseVerifier = await readFile(
    "scripts/documents-verify-database.ts",
    "utf8",
  );

  assert.match(scrumMigration, /CK_DocumentSections_Order/);
  assert.match(solutionMigration, /OrderIndex BETWEEN 1 AND 15/);
  assert.match(solutionMigration, /OrderIndex BETWEEN 1 AND 14/);
  assert.match(solutionMigration, /solutionProposal/);
  assert.match(databaseVerifier, /AllowScrumPlanDocumentSection1786924800000/);
  assert.match(databaseVerifier, /CK_DocumentSections_Order/);
});

test("correcciones solicitadas es un estado editable distinto del rechazo", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1787007600000-AllowRequestedChangesDocumentStatus.ts",
    "utf8",
  );
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );
  const verifier = await readFile(
    "scripts/documents-verify-database.ts",
    "utf8",
  );

  assert.match(migration, /CHANGES_REQUESTED/);
  assert.match(service, /VERSION_CHANGES_REQUESTED/);
  assert.match(service, /"DRAFT", "CHANGES_REQUESTED"/);
  assert.match(service, /"IN_REVIEW"[\s\S]*"REJECTED"/);
  assert.match(verifier, /AllowRequestedChangesDocumentStatus1787007600000/);
});

test("REST publica Documents y Gateway delega las decisiones a Workflow", async () => {
  const controller = await readFile(
    "apps/documents-service/src/documents/documents.controller.ts",
    "utf8",
  );
  const gateway = await readFile(
    "apps/gateway/src/documents/documents-gateway.controller.ts",
    "utf8",
  );
  const workflowGateway = await readFile(
    "apps/gateway/src/workflow/workflow-gateway.controller.ts",
    "utf8",
  );

  for (const routeFragment of [
    "projects/:projectId/documents",
    "documents/:documentId/versions",
    "sections/:sectionKey",
    "versions/:versionNumber/fields",
    "history",
    "template",
    "archive",
  ]) {
    assert.match(controller, new RegExp(routeFragment.replaceAll("/", "\\/")));
    assert.match(gateway, new RegExp(routeFragment.replaceAll("/", "\\/")));
  }

  assert.match(controller, /apply-ai-draft/);
  assert.doesNotMatch(
    gateway,
    /apply-ai-draft/,
    "La aplicación IA es una ruta interna entre servicios.",
  );

  for (const internalTransition of [
    "submit-review",
    "request-changes",
    "approve",
    "reject",
  ]) {
    assert.match(controller, new RegExp(internalTransition));
    assert.doesNotMatch(gateway, new RegExp(internalTransition));
  }

  for (const workflowAction of [
    "reviews/:reviewId/request-changes",
    "reviews/:reviewId/approve",
    "reviews/:reviewId/reject",
  ]) {
    assert.match(
      workflowGateway,
      new RegExp(workflowAction.replaceAll("/", "\\/")),
    );
  }
});

test("la purga documental elimina resultados IA y plantillas aplicadas huérfanas", async () => {
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );
  const purge = service.slice(
    service.indexOf("async purgeProject"),
    service.indexOf("async getById"),
  );
  assert.match(purge, /AppliedAiAnalysisResultEntity/);
  assert.match(purge, /RequirementDocumentEntity/);
  assert.match(purge, /AppliedDocumentTemplateEntity/);
  assert.match(purge, /access\.role !== "ADMIN"/);
});

test("solo los borradores exponen eliminación segura en Documents y Gateway", async () => {
  const service = await readFile(
    "apps/documents-service/src/documents/documents.service.ts",
    "utf8",
  );
  const controller = await readFile(
    "apps/documents-service/src/documents/documents.controller.ts",
    "utf8",
  );
  const gateway = await readFile(
    "apps/gateway/src/documents/documents-gateway.controller.ts",
    "utf8",
  );
  const workspace = await readFile(
    "apps/web/src/app/workspace/documents/documents-workspace.tsx",
    "utf8",
  );
  assert.match(service, /version\.status !== "DRAFT"/);
  assert.match(service, /DOCUMENT_DRAFT_DELETED/);
  assert.match(
    controller,
    /@Delete\("documents\/:documentId\/versions\/:versionNumber"\)/,
  );
  assert.match(
    gateway,
    /@Delete\("documents\/:documentId\/versions\/:versionNumber"\)/,
  );
  assert.match(workspace, /Eliminar borrador/);
  assert.match(workspace, /version\.status === "DRAFT"/);
});

test("el backend 4.1 valida HU-P sin heredar criterios funcionales", async () => {
  assert.doesNotThrow(() =>
    validateDocumentSectionContent("backlogStructure", {
      epics: [
        {
          code: "EP-001",
          sourceNumber: "3",
          features: [
            {
              code: "FE-001",
              sourceNumber: "3.1",
              userStories: [
                {
                  code: "HU-P-001",
                  title: "Configurar módulo",
                  description: "Planificación de implementación.",
                  sourceNumber: "3.1.1",
                  functionalRequirementCodes: ["HU-F-001"],
                  sourceIds: [],
                  tasks: [
                    {
                      code: "T-001",
                      title: "Validar configuración",
                      description: "Validar configuración.",
                      sourceNumber: "3.1.1.1",
                      origin: "EVIDENCE",
                      dependencyCodes: [],
                      sourceIds: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
  );

  const service = await readFile(
    new URL(
      "../../apps/documents-service/src/documents/documents.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(service, /POINT_6_7_INDEPENDENT_BACKEND/);
  assert.match(service, /isIndependentPlanningBacklog/);
  assert.match(service, /return requirementsContent/);
  assert.match(service, /return backlogContent/);
});
