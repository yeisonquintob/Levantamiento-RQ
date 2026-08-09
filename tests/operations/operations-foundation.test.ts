import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import {
  DOCUMENT_SECTION_DEFINITIONS,
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  type DocumentVersionDetail,
  type ProjectDetail,
  type RequirementDocumentDetail,
} from "../../libs/shared/contracts/src/index.js";
import {
  flattenDocumentContent,
  renderDocx,
  renderPdf,
} from "../../apps/operations-service/src/operations/export-document.renderer.js";
import {
  parseCreateExport,
  parseVersionNumber,
} from "../../apps/operations-service/src/operations/operations-input.js";
import { loadOperationsAuthConfig } from "../../apps/operations-service/src/operations/operations-auth.config.js";
import { loadOperationsProcessingConfig } from "../../apps/operations-service/src/operations/operations-processing.config.js";
import { loadOperationsStorageConfig } from "../../apps/operations-service/src/operations/operations-storage.config.js";

test("el contrato define formatos y estados de exportación", () => {
  assert.deepEqual(EXPORT_FORMATS, ["PDF", "DOCX"]);
  assert.deepEqual(EXPORT_STATUSES, [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);
  assert.deepEqual(parseCreateExport({ format: "PDF" }), { format: "PDF" });
  assert.throws(() => parseCreateExport({ format: "XLSX" }), /PDF o DOCX/i);
  assert.equal(parseVersionNumber("3"), 3);
  assert.throws(() => parseVersionNumber("0"), /versionNumber/i);
});

test("Operations valida autenticación, servicios y Redis", () => {
  const auth = loadOperationsAuthConfig({
    JWT_ACCESS_SECRET: "operations-test-secret-with-32-characters",
  });
  assert.equal(auth.projectsServiceUrl, "http://127.0.0.1:3002");
  assert.equal(auth.documentsServiceUrl, "http://127.0.0.1:3004");
  assert.throws(() => loadOperationsAuthConfig({}), /32 caracteres/i);
  const processing = loadOperationsProcessingConfig({
    REDIS_PASSWORD: "local-test-password",
  });
  assert.equal(processing.queueName, "rq-exports-v1");
  assert.equal(processing.attempts, 3);
  assert.throws(() => loadOperationsProcessingConfig({}), /REDIS_PASSWORD/);
  const storage = loadOperationsStorageConfig({
    AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
  });
  assert.equal(storage.containerName, "rq-exports");
  assert.throws(
    () =>
      loadOperationsStorageConfig({
        AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true",
        OPERATIONS_STORAGE_CONTAINER: "Contenedor Inválido",
      }),
    /contenedor Blob/i,
  );
});

test("RqOperationsDb conserva propiedad y referencias externas sin FK", async () => {
  const migration = await readFile(
    "apps/operations-service/src/database/migrations/1786752000000-CreateOperationsFoundation.ts",
    "utf8",
  );
  for (const table of [
    "ExportRequests",
    "ExportArtifacts",
    "NotificationRequests",
    "NotificationDeliveries",
    "AuditEvents",
    "IntegrationEventInbox",
  ]) {
    assert.match(migration, new RegExp(`dbo\\.${table}`));
  }
  assert.match(migration, /UQ_ExportRequests_Requester_IdempotencyKey/);
  assert.match(migration, /UQ_IntegrationEventInbox_EventId/);
  assert.doesNotMatch(migration, /RqDocumentsDb|RqProjectsDb|RqIdentityDb/);
});

test("la cola no persiste JWT y el servicio exige aprobación e idempotencia", async () => {
  const [queue, service, documentsClient] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/export-processing.queue.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/export-requests.service.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/documents-access.client.ts",
      "utf8",
    ),
  ]);
  assert.doesNotMatch(queue, /accessToken|authorization|Bearer/);
  assert.match(queue, /jobId: exportRequestId/);
  assert.match(service, /x-idempotency-key es obligatorio/);
  assert.match(service, /EXPORT_REQUESTED/);
  assert.match(documentsClient, /version\.status !== "APPROVED"/);
});

test("Operations y Gateway publican las rutas de exportación", async () => {
  const [controller, gateway] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/export-requests.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/operations/operations-gateway.controller.ts",
      "utf8",
    ),
  ]);
  for (const fragment of [
    "projects/:projectId/documents/:documentId/versions/:versionNumber/exports",
    "projects/:projectId/documents/:documentId/exports",
    "exports/:exportRequestId",
    "exports/:exportRequestId/download",
  ]) {
    assert.match(controller, new RegExp(fragment.replaceAll("/", "\\/")));
    assert.match(gateway, new RegExp(fragment.replaceAll("/", "\\/")));
  }
});

test("los generadores producen PDF y DOCX reales con las 13 secciones", async () => {
  const version: DocumentVersionDetail = {
    id: "00000000-0000-4000-8000-000000000104",
    versionNumber: 2,
    version: "1.1.0",
    status: "APPROVED",
    revision: 7,
    changeSummary: "Versión aprobada para exportación",
    createdByUserId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T13:00:00.000Z",
    approvedByUserId: "00000000-0000-4000-8000-000000000002",
    approvedAt: "2026-08-08T13:00:00.000Z",
    sections: DOCUMENT_SECTION_DEFINITIONS.map((section, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      key: section.key,
      title: section.title,
      order: index + 1,
      content: {
        description: `Contenido verificable de ${section.title}.`,
        acceptanceCriteria: ["El resultado queda trazado y aprobado."],
      },
      templateControlled: index >= 10,
    })),
    fields: [],
    requirements: [
      {
        id: "00000000-0000-4000-8000-000000000201",
        sectionKey: "milestones",
        code: "RF-001",
        title: "Exportar el documento aprobado",
        description: "Generar un artefacto trazable sin alterar la versión.",
        requirementType: "FUNCTIONAL",
        status: "APPROVED",
        order: 1,
        acceptanceCriteria: [
          {
            id: "00000000-0000-4000-8000-000000000202",
            description: "El archivo corresponde a la versión exacta.",
            order: 1,
          },
        ],
      },
    ],
    evidence: [
      {
        id: "00000000-0000-4000-8000-000000000203",
        sourceId: "00000000-0000-4000-8000-000000000204",
        sectionKey: "milestones",
        requirementId: "00000000-0000-4000-8000-000000000201",
        excerpt: "Evidencia de aceptación.",
        note: null,
      },
    ],
  };
  const project: ProjectDetail = {
    id: "00000000-0000-4000-8000-000000000101",
    code: "RQ-2026-000001",
    title: "Exportación documental",
    requestingArea: "Planificación",
    description: "Proyecto de prueba",
    status: "VALIDATION",
    template: null,
    ownerUserId: "00000000-0000-4000-8000-000000000001",
    participantCount: 0,
    participants: [],
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T13:00:00.000Z",
  };
  const document: RequirementDocumentDetail = {
    id: "00000000-0000-4000-8000-000000000102",
    projectId: project.id,
    title: "Levantamiento de exportaciones",
    status: "APPROVED",
    revision: 7,
    currentVersionNumber: 2,
    currentVersion: "1.1.0",
    template: {
      id: "00000000-0000-4000-8000-000000000103",
      sourceTemplateId: "00000000-0000-4000-8000-000000000105",
      code: "RQ-MEDIUM",
      name: "Requerimiento mediano",
      version: "1.0.0",
      templateType: "MEDIUM_REQUIREMENT",
      appliedAt: "2026-08-08T10:00:00.000Z",
    },
    createdByUserId: project.ownerUserId,
    createdAt: "2026-08-08T10:00:00.000Z",
    updatedAt: "2026-08-08T13:00:00.000Z",
    archivedAt: null,
    currentVersionDetail: version,
  };
  const input = {
    project,
    document,
    version,
    generatedAt: new Date("2026-08-08T14:00:00.000Z"),
  };
  const [pdf, docx] = await Promise.all([renderPdf(input), renderDocx(input)]);
  assert.equal(pdf.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(docx.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(pdf.buffer.length > 1_000);
  assert.ok(docx.buffer.length > 5_000);
  assert.equal(
    flattenDocumentContent({ enabled: true })[0]?.text,
    "Enabled: Sí",
  );

  const longVersion: DocumentVersionDetail = {
    ...version,
    sections: version.sections.map((section, index) =>
      index === 0
        ? {
            ...section,
            content: {
              description: "Contenido extenso verificable. ".repeat(1_000),
            },
          }
        : section,
    ),
  };
  const longPdf = await renderPdf({ ...input, version: longVersion });
  const loadedPdf = await PDFDocument.load(longPdf.buffer);
  assert.ok(loadedPdf.getPageCount() > 4);
});
