import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  DOCUMENT_STATUSES,
} from "../../libs/shared/contracts/src/lib/documents.js";
import {
  parseCreateVersion,
  parseApplyAiDraft,
  parseReplaceFields,
  parseSectionKey,
  parseUpdateSection,
} from "../../apps/documents-service/src/documents/documents-input.js";

test("el contrato conserva exactamente los trece puntos canónicos", () => {
  assert.equal(DOCUMENT_SECTION_DEFINITIONS.length, 13);
  assert.deepEqual(
    DOCUMENT_SECTION_DEFINITIONS.map((section) => section.key),
    [
      "header",
      "objectives",
      "problemDescription",
      "scope",
      "processFlow",
      "milestones",
      "nonFunctionalRequirements",
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
    "APPROVED",
    "REJECTED",
    "ARCHIVED",
  ]);
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

test("la aplicación IA exige revisión, diez secciones canónicas y trazabilidad", () => {
  const sections = DOCUMENT_SECTION_DEFINITIONS.slice(0, 10).map((section) => ({
    key: section.key,
    content: `Contenido de ${section.key}`,
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

  assert.equal(parsed.sections.length, 10);
  assert.equal(parsed.requirements[0]?.status, "PROPOSED");
  assert.equal(parsed.evidence[0]?.requirementClientId, "ai-requirement-1");
  assert.throws(
    () => parseApplyAiDraft({ ...parsed, sections: sections.slice(0, 9) }),
    /exactamente|diez/i,
  );
  assert.throws(
    () => parseApplyAiDraft({ ...parsed, sections: [...sections].reverse() }),
    /orden canónico/i,
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
  assert.match(service, /assertThirteenSections/);
  assert.match(service, /templateControlled/);
  assert.match(service, /AI_DRAFT_APPLIED/);
  assert.match(service, /analysisResultId/);
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

  for (const internalTransition of ["submit-review", "approve", "reject"]) {
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
