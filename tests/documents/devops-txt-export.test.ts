import assert from "node:assert/strict";
import test from "node:test";

import type { RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";

import { buildReadableBacklogTxtExport } from "../../apps/web/src/app/workspace/validation/devops-txt-export";

function documentWithBacklog(content: unknown): RequirementDocumentDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectId: "22222222-2222-4222-8222-222222222222",
    title: "Automatización SOAT",
    status: "DRAFT",
    revision: 1,
    currentVersionNumber: 6,
    currentVersion: "1.0.5",
    template: {
      id: "33333333-3333-4333-8333-333333333333",
      sourceTemplateId: "44444444-4444-4444-8444-444444444444",
      code: "RQ-LARGE",
      name: "Requerimiento grande",
      version: "1.2.0",
      templateType: "LARGE_REQUIREMENT",
      appliedAt: "2026-09-01T00:00:00.000Z",
    },
    createdByUserId: "55555555-5555-4555-8555-555555555555",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    archivedAt: null,
    currentVersionDetail: {
      id: "66666666-6666-4666-8666-666666666666",
      versionNumber: 6,
      version: "1.0.5",
      status: "DRAFT",
      revision: 1,
      changeSummary: "Esquema generado",
      createdByUserId: "55555555-5555-4555-8555-555555555555",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      approvedByUserId: null,
      approvedAt: null,
      sections: [
        {
          id: "77777777-7777-4777-8777-777777777777",
          key: "backlogStructure",
          title: "Esquema",
          order: 7,
          content: content as never,
          templateControlled: false,
        },
      ],
      fields: [],
      requirements: [],
      evidence: [],
    },
  };
}

test("exporta Punto 7 como TXT legible con toda la jerarquía", () => {
  const exported = buildReadableBacklogTxtExport(
    documentWithBacklog({
      structureStatus: "AI_SUGGESTED",
      epics: [
        {
          code: "EP-001",
          sourceNumber: "1",
          title: "Gestión SOAT",
          description: "Gestionar el proceso SOAT.",
          features: [
            {
              code: "FE-001",
              sourceNumber: "1.1",
              title: "Registro digital",
              description: "Digitalizar solicitudes.",
              userStories: [
                {
                  code: "HU-P-001",
                  sourceNumber: "1.1.1",
                  title: "Registrar solicitud",
                  description: "Permitir el registro de solicitudes.",
                  tasks: [
                    {
                      code: "T-001",
                      sourceNumber: "1.1.1.1",
                      title: "Diseñar formulario",
                      description: "Diseñar campos y validaciones.",
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

  assert.ok(exported);
  assert.equal(exported.itemCount, 4);
  assert.equal(
    exported.fileName,
    "automatizacion-soat-v1.0.5-esquema.txt",
  );
  assert.match(exported.content, /^\uFEFFESQUEMA DEL PROYECTO/u);
  assert.match(exported.content, /Resumen: 1 épica\(s\).*1 tarea\(s\)/u);
  assert.match(exported.content, /ÉPICA 1 · EP-001 · Gestión SOAT/u);
  assert.match(
    exported.content,
    /  FEATURE 1\.1 · FE-001 · Registro digital/u,
  );
  assert.match(
    exported.content,
    /    HISTORIA DE USUARIO 1\.1\.1 · HU-P-001 · Registrar solicitud/u,
  );
  assert.match(
    exported.content,
    /      TAREA 1\.1\.1\.1 · T-001 · Diseñar formulario/u,
  );
  assert.doesNotMatch(exported.content, /Ruta jerárquica|Código padre/u);
});

test("no genera TXT cuando el Punto 7 todavía no contiene Epic", () => {
  assert.equal(
    buildReadableBacklogTxtExport(
      documentWithBacklog({
        structureStatus: "AI_SUGGESTED",
        epics: [],
      }),
    ),
    null,
  );
});
