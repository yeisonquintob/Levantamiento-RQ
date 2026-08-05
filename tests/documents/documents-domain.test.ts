import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  DOCUMENT_STATUSES,
} from "../../libs/shared/contracts/src/lib/documents.js";
import {
  parseCreateVersion,
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
    parseUpdateSection({ expectedRevision: 4, content: { general: "Definir" } }),
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

test("la persistencia pertenece solo a RqDocumentsDb", async () => {
  const migration = await readFile(
    "apps/documents-service/src/database/migrations/1786233600000-CreateRequirementDocumentsDomain.ts",
    "utf8",
  );
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
});

test("REST y Gateway publican el dominio documental completo", async () => {
  const controller = await readFile(
    "apps/documents-service/src/documents/documents.controller.ts",
    "utf8",
  );
  const gateway = await readFile(
    "apps/gateway/src/documents/documents-gateway.controller.ts",
    "utf8",
  );

  for (const routeFragment of [
    "projects/:projectId/documents",
    "documents/:documentId/versions",
    "sections/:sectionKey",
    "versions/:versionNumber/fields",
    "submit-review",
    "approve",
    "reject",
    "history",
    "template",
    "archive",
  ]) {
    assert.match(controller, new RegExp(routeFragment.replaceAll("/", "\\/")));
    assert.match(gateway, new RegExp(routeFragment.replaceAll("/", "\\/")));
  }
});
