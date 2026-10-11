import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { PDFDocument } from "pdf-lib";

import {
  INTEGRATION_EVENT_NAMES,
  NOTIFICATION_TYPES,
  DOCUMENT_SECTION_DEFINITIONS,
  EXPORT_FORMATS,
  EXPORT_STATUSES,
  layoutProcessFlow,
  renderProcessFlowSvg,
  type DocumentVersionDetail,
  type ProjectDetail,
  type RequirementDocumentDetail,
} from "../../libs/shared/contracts/src/index.js";
import {
  buildExportDocumentSections,
  flattenDocumentContent,
  renderDocx,
  renderMarkdown,
  renderPdf,
  sectionPresentation,
} from "../../apps/operations-service/src/operations/export-document.renderer.js";
import {
  buildExportFixture,
  buildVentasPerdidasExportFixture,
} from "./export-document.fixture.js";
import {
  parseCreateExport,
  parseVersionNumber,
} from "../../apps/operations-service/src/operations/operations-input.js";
import { parseIntegrationEvent } from "../../apps/operations-service/src/operations/integration-events.consumer.js";
import { loadOperationsAuthConfig } from "../../apps/operations-service/src/operations/operations-auth.config.js";
import { loadOperationsNotificationsConfig } from "../../apps/operations-service/src/operations/operations-notifications.config.js";
import { loadOperationsProcessingConfig } from "../../apps/operations-service/src/operations/operations-processing.config.js";
import { loadOperationsStorageConfig } from "../../apps/operations-service/src/operations/operations-storage.config.js";

const OPERATIONS_SOURCE_DIRECTORY = "apps/operations-service/src/operations";

async function readExportRendererSource(): Promise<string> {
  const files = (await readdir(OPERATIONS_SOURCE_DIRECTORY))
    .filter((file) => /^export-document\..+\.ts$/u.test(file))
    .sort();
  const sources = await Promise.all(
    files.map((file) =>
      readFile(`${OPERATIONS_SOURCE_DIRECTORY}/${file}`, "utf8"),
    ),
  );
  return sources.join("\n");
}

test("el contrato define formatos y estados de exportación", () => {
  assert.deepEqual(EXPORT_FORMATS, ["PDF", "DOCX", "MARKDOWN"]);
  assert.deepEqual(EXPORT_STATUSES, [
    "PENDING",
    "PROCESSING",
    "COMPLETED",
    "FAILED",
    "CANCELLED",
  ]);
  assert.deepEqual(parseCreateExport({ format: "PDF" }), { format: "PDF" });
  assert.deepEqual(parseCreateExport({ format: "MARKDOWN" }), {
    format: "MARKDOWN",
  });
  assert.throws(
    () => parseCreateExport({ format: "XLSX" }),
    (error: unknown) => /PDF, DOCX o MARKDOWN/i.test(String(error)),
  );
  assert.equal(parseVersionNumber("3"), 3);
  assert.throws(() => parseVersionNumber("0"), /versionNumber/i);
});

test("los contratos incluyen notificaciones y correcciones de revisión", () => {
  assert.ok(INTEGRATION_EVENT_NAMES.includes("review.changes-requested"));
  assert.deepEqual(NOTIFICATION_TYPES, [
    "REVIEW_ASSIGNED",
    "CHANGES_REQUESTED",
    "DOCUMENT_APPROVED",
    "DOCUMENT_REJECTED",
    "EXPORT_READY",
    "EXPORT_FAILED",
    "ANALYSIS_COMPLETED",
    "ANALYSIS_FAILED",
  ]);
  const event = parseIntegrationEvent({
    eventId: "00000000-0000-4000-8000-000000000001",
    eventName: "review.changes-requested",
    eventVersion: 1,
    occurredAtUtc: "2026-08-08T12:00:00.000Z",
    producer: "workflow-service",
    correlationId: "00000000-0000-4000-8000-000000000002",
    data: { projectId: "00000000-0000-4000-8000-000000000003" },
  });
  assert.equal(event.eventName, "review.changes-requested");
  assert.throws(
    () => parseIntegrationEvent({ ...event, eventVersion: 2 }),
    /versión del evento/i,
  );
});

test("Operations valida autenticación, servicios y Redis", () => {
  const publicJwks = Buffer.from(
    JSON.stringify({
      keys: [
        {
          kty: "OKP",
          crv: "Ed25519",
          x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          kid: "identity-test",
          principal: "identity",
        },
      ],
    }),
  ).toString("base64");
  const privateJwk = Buffer.from(
    JSON.stringify({
      kty: "OKP",
      crv: "Ed25519",
      x: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      d: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      kid: "operations-test",
    }),
  ).toString("base64");
  const auth = loadOperationsAuthConfig({
    JWT_ACCESS_PUBLIC_JWKS_BASE64: publicJwks,
    WORKLOAD_JWT_KEY_ID: "operations-test",
    WORKLOAD_JWT_PRIVATE_JWK_BASE64: privateJwk,
  });
  assert.equal(auth.projectsServiceUrl, "http://127.0.0.1:3002");
  assert.equal(auth.documentsServiceUrl, "http://127.0.0.1:3004");
  assert.throws(() => loadOperationsAuthConfig({}), /JSON codificado/i);
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
  const notifications = loadOperationsNotificationsConfig({});
  assert.equal(notifications.emailEnabled, false);
  assert.equal(notifications.maxAttempts, 5);
  assert.throws(
    () =>
      loadOperationsNotificationsConfig({
        OPERATIONS_EMAIL_ENABLED: "quizá",
      }),
    /true o false/i,
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

test("la cola no persiste JWT y Word admite borradores controlados", async () => {
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
  assert.match(service, /input\.format === "DOCX"/u);
  assert.match(service, /"DRAFT", "IN_REVIEW", "CHANGES_REQUESTED"/u);
  assert.match(documentsClient, /version\.status !== "APPROVED"/);
});

test("Operations y Gateway publican las rutas de exportación", async () => {
  const [controller, gateway, validation] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/export-requests.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/operations/operations-gateway.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/validation/validation-workspace.tsx",
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
  // Cada tarjeta de Validación abre sus exportaciones; el documento es el de la fila.
  assert.match(validation, /openExports\(document, "MARKDOWN"\)/);
  assert.match(
    validation,
    /exportRequests\.filter\(\(item\) => item\.format === exportFormat\)/,
  );
  assert.match(validation, /DevOps · TXT/);
  assert.match(validation, /Presentación/);
  assert.match(validation, /downloadProjectPresentation/);
  assert.match(validation, /buildReadableBacklogTxtExport/);
  assert.match(validation, /text\/plain;charset=utf-8/);
});

test("Operations y Gateway publican notificaciones y auditoría", async () => {
  const [controller, gateway, consumer] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/notifications-audit.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/operations/operations-gateway.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/integration-events.consumer.ts",
      "utf8",
    ),
  ]);
  for (const fragment of [
    '"notifications"',
    '"notifications/:notificationId/read"',
    '"projects/:projectId/audit-events"',
  ]) {
    assert.match(controller, new RegExp(fragment));
    assert.match(gateway, new RegExp(fragment));
  }
  assert.match(consumer, /noAck: false/);
  assert.match(consumer, /waitForConfirms/);
  assert.match(consumer, /retryQueueName/);
});

test("la bandeja permite limpiar notificaciones propias y audita la operación", async () => {
  const [service, controller, gateway, web] = await Promise.all([
    readFile(
      "apps/operations-service/src/operations/notifications-audit.service.ts",
      "utf8",
    ),
    readFile(
      "apps/operations-service/src/operations/notifications-audit.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/gateway/src/operations/operations-gateway.controller.ts",
      "utf8",
    ),
    readFile(
      "apps/web/src/app/workspace/notifications/notifications-workspace.tsx",
      "utf8",
    ),
  ]);
  assert.match(service, /recipientUserId: context\.actor\.id/);
  assert.match(service, /NOTIFICATIONS_CLEARED/);
  assert.match(controller, /@Delete\("notifications"\)/);
  assert.match(gateway, /@Delete\("notifications"\)/);
  assert.match(web, /Limpiar notificaciones/);
  assert.match(web, /method: "DELETE"/);
});

test("la purga de Operations elimina artefactos y avisos pero conserva la auditoría", async () => {
  const service = await readFile(
    "apps/operations-service/src/operations/export-requests.service.ts",
    "utf8",
  );
  const purge = service.slice(
    service.indexOf("async purgeProject"),
    service.indexOf("async list"),
  );
  assert.match(purge, /projects\.requireOwner/);
  assert.match(purge, /storage\.deleteIfExists/);
  assert.match(purge, /NotificationRequestEntity/);
  assert.doesNotMatch(purge, /delete\(AuditEventEntity/);
});

test("los generadores producen PDF, DOCX y Markdown reales con las 14 secciones", async () => {
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
    templateLogo: {
      fileName: "marca.png",
      mediaType: "image/png" as const,
      sizeBytes: 68,
      updatedAt: "2026-08-08T13:30:00.000Z",
      dataBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    },
  };
  const [pdf, docx, markdown] = await Promise.all([
    renderPdf(input),
    renderDocx(input),
    renderMarkdown(input),
  ]);
  assert.equal(pdf.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(docx.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.ok(pdf.buffer.length > 1_000);
  assert.ok(docx.buffer.length > 5_000);
  assert.equal(markdown.extension, "md");
  assert.equal(markdown.mediaType, "text/markdown; charset=utf-8");
  assert.match(
    markdown.buffer.toString("utf8"),
    /# Levantamiento de exportaciones/,
  );
  const markdownText = markdown.buffer.toString("utf8");
  assert.match(markdownText, /## 1\. Objetivos/);
  assert.match(markdownText, /### 5\.1\. Flujo AS-IS/);
  assert.match(markdownText, /### 5\.2\. Flujo TO-BE/);
  assert.match(markdownText, /### 5\.3\. Modelo entidad-relación/);
  assert.doesNotMatch(markdownText, /^## 5\.1\. Flujo AS-IS$/m);
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
  assert.ok(loadedPdf.getPageCount() >= 2);
});

test("SMALL, MEDIUM y LARGE producen profundidades y artefactos distintos sin API", async () => {
  const small = buildExportFixture("SMALL_REQUIREMENT");
  const medium = buildExportFixture("MEDIUM_REQUIREMENT");
  const large = buildExportFixture("LARGE_REQUIREMENT");
  const milestoneRows = (input: typeof small): number => {
    const section = input.version.sections.find(
      (item) => item.key === "milestones",
    );
    if (!section) throw new Error("Fixture sin hitos.");
    const table = sectionPresentation(section).tables.find(
      (item) => item.title === "Historias de Usuario",
    );
    return table?.rows.length ?? 0;
  };
  assert.equal(milestoneRows(small), 1);
  assert.equal(milestoneRows(medium), 3);
  assert.equal(milestoneRows(large), 6);
  const artifacts = await Promise.all(
    [small, medium, large].flatMap((input) => [
      renderPdf(input),
      renderDocx(input),
    ]),
  );
  assert.equal(artifacts.filter((item) => item.extension === "pdf").length, 3);
  assert.equal(artifacts.filter((item) => item.extension === "docx").length, 3);
  for (const artifact of artifacts) assert.ok(artifact.buffer.length > 5_000);
});

test("Scrum agrega 15 secciones y presenta cada sprint como un bloque resumido", () => {
  const scrum = buildExportFixture("LARGE_REQUIREMENT", true);
  const noScrum = buildExportFixture("ERP_FDD", false);
  assert.equal(scrum.version.sections.length, 15);
  assert.equal(scrum.version.sections.at(-1)?.key, "scrumPlan");
  assert.equal(noScrum.version.sections.length, 14);
  const presentation = sectionPresentation(scrum.version.sections.at(-1)!);
  assert.match(presentation.lines[0]?.text ?? "", /15 días calendario/i);
  assert.equal(presentation.tables.length, 0);
  assert.match(JSON.stringify(presentation.lines), /Sprint 1/u);
  assert.match(JSON.stringify(presentation.lines), /Objetivo:.*incremento/u);
  assert.match(JSON.stringify(presentation.lines), /Entregable:/u);
  assert.match(JSON.stringify(presentation.lines), /Criterio de cierre:/u);
});

test("la exportación conserva el calendario laboral colombiano del Scrum", () => {
  const scrum = buildExportFixture("LARGE_REQUIREMENT", true);
  const section = scrum.version.sections.at(-1)!;
  const content = section.content as Record<string, unknown>;
  const presentation = sectionPresentation({
    ...section,
    content: {
      ...content,
      calendarMode: "COLOMBIA_BUSINESS_DAYS",
      confirmedStartDate: "2026-09-01",
    },
  });

  assert.match(presentation.lines[0]?.text ?? "", /15 días hábiles/i);
  assert.match(presentation.lines[0]?.text ?? "", /2026-09-01/);
  assert.equal(presentation.tables.length, 0);
});

test("el prototipo conserva la especificación en Markdown y una descripción en Word y PDF", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT", true);
  const version = {
    ...input.version,
    sections: input.version.sections.map((section) =>
      section.key === "solutionProposal"
        ? {
            ...section,
            content: {
              objective:
                "Validar una experiencia operativa antes de su implementación.",
              description:
                "El prototipo permite recorrer el flujo principal y comprobar sus reglas funcionales.",
              prototypeMarkdown:
                "# Especificaciones del prototipo\n\n## Navegación y rutas\n\n- `/inicio`: resumen operativo.\n\n## Pantallas\n\n- Inicio con estados y acciones.",
            },
          }
        : section,
    ),
  } satisfies DocumentVersionDetail;
  const prototypeInput = { ...input, version };
  const solution = buildExportDocumentSections(prototypeInput).find(
    (section) => section.number === 4,
  );
  assert.match(JSON.stringify(solution?.lines), /Descripción del prototipo/u);
  assert.match(JSON.stringify(solution?.lines), /recorrer el flujo principal/u);
  assert.doesNotMatch(JSON.stringify(solution?.lines), /`\/inicio`/u);

  const [markdown, pdf, docx] = await Promise.all([
    renderMarkdown(prototypeInput),
    renderPdf(prototypeInput),
    renderDocx(prototypeInput),
  ]);
  const markdownText = markdown.buffer.toString("utf8");
  assert.match(markdownText, /## Anexo · Especificaciones del prototipo/u);
  assert.match(markdownText, /### Navegación y rutas/u);
  assert.match(markdownText, /`\/inicio`/u);
  assert.equal(pdf.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(docx.buffer.subarray(0, 2).toString("ascii"), "PK");
});

test("el modelo común presenta Feature, HU, CA, campos y pruebas como tablas", () => {
  const input = buildExportFixture("LARGE_REQUIREMENT");
  const milestone = input.version.sections.find(
    (item) => item.key === "milestones",
  )!;
  const tests = input.version.sections.find((item) => item.key === "tests")!;
  const milestonePresentation = sectionPresentation(milestone);
  const testPresentation = sectionPresentation(tests);
  assert.deepEqual(
    milestonePresentation.tables.map((table) => table.title),
    [
      "Mapa de Features",
      "Historias de Usuario",
      "Criterios de aceptación",
      "Datos y campos",
    ],
  );
  assert.deepEqual(testPresentation.tables[0]?.headers, [
    "Prueba",
    "Trazabilidad",
    "Precondición",
    "Acción",
    "Resultado esperado",
  ]);
  assert.match(
    milestonePresentation.tables[1]?.rows[0]?.[2] ?? "",
    /COMO: .*QUIERO: .*PARA: /s,
  );
  assert.deepEqual(milestonePresentation.tables[2]?.headers, [
    "HU",
    "CA",
    "DADO",
    "CUANDO",
    "ENTONCES",
  ]);
});

test("el punto 7 presenta Epic, Feature, HU y Tarea como un árbol jerárquico", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT");
  const backlog = input.version.sections.find(
    (item) => item.key === "backlogStructure",
  )!;
  const treeBacklog = {
    ...backlog,
    content: {
      epics: [
        {
          code: "EP-001",
          title: "Gestión de solicitudes",
          description: "Organiza el ciclo completo de las solicitudes.",
          features: [
            {
              code: "FE-001",
              title: "Registro",
              description: "Permite registrar información verificable.",
              userStories: [
                {
                  code: "HU-001",
                  title: "Registrar solicitud",
                  description:
                    "Capturar una solicitud y conservar su trazabilidad.",
                  tasks: [
                    {
                      code: "T-001",
                      title: "Definir validaciones",
                      type: "ANALYSIS",
                      dependencyCodes: [],
                    },
                    {
                      code: "T-002",
                      title: "Implementar formulario",
                      type: "DEVELOPMENT",
                      dependencyCodes: ["T-001"],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  } satisfies typeof backlog;
  const presentation = sectionPresentation(treeBacklog);

  assert.equal(presentation.tables.length, 0);
  assert.deepEqual(
    presentation.lines.slice(1).map((line) => line.level),
    [0, 1, 1, 2, 2, 3, 3, 3],
  );
  assert.deepEqual(
    presentation.lines.slice(1).map((line) => line.bullet),
    [true, false, true, false, true, false, true, true],
  );
  assert.match(presentation.lines[1]?.text ?? "", /EPIC · EP-001 · Gestión/u);
  assert.match(presentation.lines[2]?.text ?? "", /Organiza el ciclo/u);
  assert.match(
    presentation.lines[3]?.text ?? "",
    /FEATURE · FE-001 · Registro/u,
  );
  assert.match(presentation.lines[5]?.text ?? "", /HU · HU-001 · Registrar/u);
  assert.match(
    presentation.lines[7]?.text ?? "",
    /TAREA · T-001 · Definir validaciones \(Tipo: Análisis · Sin dependencias\)/u,
  );
  assert.match(
    presentation.lines[8]?.text ?? "",
    /TAREA · T-002 · Implementar formulario \(Tipo: Desarrollo · Depende de: T-001\)/u,
  );

  const treeInput = {
    ...input,
    version: {
      ...input.version,
      sections: input.version.sections.map((section) =>
        section.key === "backlogStructure" ? treeBacklog : section,
      ),
    },
  };
  const scheme = buildExportDocumentSections(treeInput).find(
    (section) => section.number === 7,
  );
  assert.equal(scheme?.tables.length, 0);
  assert.deepEqual(
    scheme?.lines.slice(1).map((line) => line.level),
    [0, 1, 1, 2, 2, 3, 3, 3],
  );

  const [markdown, pdf, docx] = await Promise.all([
    renderMarkdown(treeInput),
    renderPdf(treeInput),
    renderDocx(treeInput),
  ]);
  const markdownText = markdown.buffer.toString("utf8");
  assert.match(
    markdownText,
    /- \*\*EPIC · EP-001 · Gestión de solicitudes\*\*/u,
  );
  assert.match(markdownText, /  - \*\*FEATURE · FE-001 · Registro\*\*/u);
  assert.match(
    markdownText,
    /    - \*\*HU · HU-001 · Registrar solicitud\*\*/u,
  );
  assert.match(markdownText, /      - TAREA · T-001 · Definir validaciones/u);
  assert.match(markdownText, /Descripción: Capturar una solicitud/u);
  assert.doesNotMatch(markdownText, /\| Epic \| Feature \| HU \| Tarea \|/u);
  assert.equal(pdf.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(docx.buffer.subarray(0, 2).toString("ascii"), "PK");
});

test("el punto 6 exporta bloques por hito con historias completas y conserva 6.2", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT");
  const milestone = input.version.sections.find(
    (item) => item.key === "milestones",
  )!;
  const modernMilestone = {
    ...milestone,
    content: {
      functionalRequirements: [
        {
          code: "HU-F-001",
          title: "Registrar solicitud",
          description: "Permite iniciar el proceso desde el portal.",
          milestone: "H-001",
          functionality: "Gestión de solicitudes",
          milestoneDescription:
            "Centraliza la radicación y el seguimiento de solicitudes.",
          assignmentStatus: "ASSIGNED",
          role: "Solicitante",
          want: "registrar una solicitud",
          benefit: "iniciar su gestión",
          context: "Portal de autoservicio",
          premises: ["El usuario se encuentra autenticado"],
          impactedSystems: ["Portal", "ERP"],
          fields: [
            {
              name: "Número de solicitud",
              dataType: "Texto",
              required: true,
              validation: "Único",
            },
          ],
          acceptanceCriteria: [
            {
              code: "CA-F-001",
              given: "una solicitud completa",
              when: "el usuario confirma el registro",
              then: "el sistema genera el número de solicitud",
            },
          ],
        },
      ],
      nonFunctionalRequirements: [
        {
          code: "RNF-001",
          title: "Disponibilidad",
          category: "Disponibilidad",
          description: "El portal debe permanecer disponible.",
          measure: "Porcentaje mensual",
          target: "99.5 %",
        },
      ],
    },
  } satisfies typeof milestone;
  const presentation = sectionPresentation(modernMilestone);

  assert.deepEqual(
    presentation.tables.map((table) => table.title),
    [
      "6.1.1 Hito H-001 · Gestión de solicitudes",
      "6.1.1.1 HU-F-001 · Registrar solicitud",
      "6.2 Requerimientos no funcionales",
    ],
  );
  assert.match(
    JSON.stringify(presentation.tables[0]),
    /Centraliza la radicación.*1 HU/s,
  );
  const story = JSON.stringify(presentation.tables[1]);
  assert.match(story, /Descripción funcional.*Historia de usuario/s);
  assert.match(story, /COMO: Solicitante.*QUIERO: registrar.*PARA: iniciar/s);
  assert.match(story, /Contexto.*Premisas.*Sistemas impactados/s);
  assert.match(story, /Número de solicitud.*Criterios de aceptación/s);
  assert.match(story, /DADO: una solicitud completa.*ENTONCES:/s);

  const modernInput = {
    ...input,
    version: {
      ...input.version,
      sections: input.version.sections.map((section) => {
        if (section.key === "milestones") return modernMilestone;
        if (section.key !== "backlogStructure") return section;
        return {
          ...section,
          content: {
            epics: [
              {
                code: "EP-001",
                title: "Gestión de solicitudes",
                description: "Centraliza la gestión de solicitudes.",
                features: [],
              },
              {
                code: "EP-002",
                title: "Administración",
                description: "Agrupa la administración de catálogos.",
                features: [],
              },
            ],
          },
        };
      }),
    },
  };
  const point6 = buildExportDocumentSections(modernInput).filter(
    (section) => section.number === 6,
  );
  assert.deepEqual(
    point6.map((section) => section.headingNumber ?? "6"),
    ["6", "6.1", "6.2"],
  );
  assert.match(point6[1]?.tables[0]?.title ?? "", /Hito H-001/u);
  assert.match(point6[1]?.tables[1]?.title ?? "", /HU-F-001/u);
  assert.match(point6[1]?.tables[2]?.title ?? "", /Hito H-002/u);
  assert.match(JSON.stringify(point6[1]?.tables[2]), /0 HU/u);
  assert.equal(
    point6[2]?.tables[0]?.title,
    "Matriz de requerimientos no funcionales",
  );

  const markdown = (await renderMarkdown(modernInput)).buffer.toString("utf8");
  assert.match(markdown, /### 6\.1\. Requerimientos funcionales/u);
  assert.match(markdown, /### 6\.2\. Requerimientos no funcionales/u);
  assert.ok(
    markdown.indexOf("Hito H-001") < markdown.indexOf("HU-F-001") &&
      markdown.indexOf("HU-F-001") <
        markdown.indexOf("6.2. Requerimientos no funcionales"),
  );
});

test("Mermaid histórico se transforma y nunca se imprime crudo", () => {
  const base = buildExportFixture("MEDIUM_REQUIREMENT");
  const section = base.version.sections.find(
    (item) => item.key === "processFlow",
  )!;
  const presentation = sectionPresentation({
    ...section,
    content: "flowchart TD\nA[Inicio] --> B{Validar}\nB -->|Sí| C[Fin]",
  });
  assert.equal(presentation.flowSteps.length, 2);
  assert.doesNotMatch(
    presentation.lines.map((line) => line.text).join("\n"),
    /flowchart|-->/i,
  );
});

test("la exportación separa AS-IS, TO-BE y modelo entidad-relación en el punto 5", async () => {
  const base = buildExportFixture("MEDIUM_REQUIREMENT");
  const input = {
    ...base,
    version: {
      ...base.version,
      sections: base.version.sections.map((section) =>
        section.key === "processFlow"
          ? {
              ...section,
              content: {
                processFlows: {
                  asIs: {
                    title: "Proceso actual",
                    objective: "Describir la operación actual.",
                    lanes: [
                      { id: "actor", name: "Solicitante", kind: "ACTOR" },
                    ],
                    nodes: [
                      {
                        id: "start",
                        kind: "START",
                        label: "Inicio",
                        laneId: "actor",
                      },
                      {
                        id: "end",
                        kind: "END",
                        label: "Fin",
                        laneId: "actor",
                      },
                    ],
                    edges: [{ from: "start", to: "end", label: null }],
                    problems: ["Validación manual."],
                    improvements: [],
                    expectedResults: [],
                    sourceIds: [],
                  },
                  toBe: {
                    title: "Proceso futuro",
                    objective: "Representar la operación propuesta.",
                    lanes: [
                      { id: "system", name: "Plataforma", kind: "SYSTEM" },
                    ],
                    nodes: [
                      {
                        id: "start",
                        kind: "START",
                        label: "Inicio",
                        laneId: "system",
                      },
                      {
                        id: "end",
                        kind: "END",
                        label: "Fin",
                        laneId: "system",
                      },
                    ],
                    edges: [{ from: "start", to: "end", label: null }],
                    problems: [],
                    improvements: ["Validación controlada."],
                    expectedResults: ["Registro trazable."],
                    sourceIds: [],
                  },
                },
                entityRelationship: {
                  title: "Modelo de solicitud",
                  entities: [
                    {
                      id: "request",
                      name: "Solicitud",
                      description: "Registro de la solicitud.",
                      attributes: [
                        {
                          name: "id",
                          dataType: "UUID",
                          primaryKey: true,
                          foreignKey: false,
                          required: true,
                        },
                      ],
                    },
                  ],
                  relationships: [],
                  sourceIds: [],
                },
              },
            }
          : section,
      ),
    },
  };
  const diagramSections = buildExportDocumentSections(input).filter(
    (section) => section.number === 5,
  );
  assert.deepEqual(
    diagramSections.map((section) => section.headingNumber ?? "5"),
    ["5", "5.1", "5.2", "5.3"],
  );
  assert.equal(diagramSections[1]?.flowDiagram?.title, "Proceso actual");
  assert.equal(diagramSections[2]?.flowDiagram?.title, "Proceso futuro");
  assert.equal(
    diagramSections[1]?.flowDiagram?.lanes?.[0]?.name,
    "Solicitante",
  );
  assert.equal(diagramSections[1]?.flowDiagram?.nodes[0]?.laneId, "actor");
  assert.equal(
    diagramSections[3]?.entityRelationshipDiagram?.entities[0]?.name,
    "Solicitud",
  );
  const entityExport = JSON.stringify(diagramSections[3]?.tables);
  assert.match(entityExport, /Solicitud/);
  assert.match(entityExport, /Clave \/ regla/);

  const rendered = await renderPdf(input);
  const pdf = await PDFDocument.load(rendered.buffer);
  const pageSizes = pdf.getPages().map((page) => ({
    width: page.getWidth(),
    height: page.getHeight(),
  }));
  assert.ok(pageSizes.some((page) => page.width > page.height));
  assert.ok(pageSizes.some((page) => page.height > page.width));

  const renderer = await readExportRendererSource();
  assert.match(renderer, /HeadingLevel\.HEADING_2/);
  assert.match(renderer, /NAVI_DOCUMENT_COLORS\.operation/);
  assert.match(renderer, /NAVI_DOCUMENT_COLORS\.institutional/);
  assert.match(renderer, /section\.headingNumber \? "subsection" : "section"/);
});

test("DOCX inserta los flujos como imagen horizontal por carriles sin cambiar su contrato", async () => {
  const input = buildExportFixture("MEDIUM_REQUIREMENT");
  const section = input.version.sections.find(
    (item) => item.key === "processFlow",
  )!;
  const diagram = sectionPresentation(section).flowDiagram;
  assert.ok(diagram);

  const layout = await layoutProcessFlow(diagram);
  const svg = renderProcessFlowSvg(layout, { title: diagram.title });
  assert.equal(layout.nodes.length, diagram.nodes.length);
  assert.equal(layout.edges.length, diagram.edges.length);
  assert.equal(layout.engine, "elk");
  assert.match(svg, /rq-process-flow__edges/);
  assert.match(svg, /rq-process-flow__nodes/);

  const [pdf, docx, renderer] = await Promise.all([
    renderPdf(input),
    renderDocx(input),
    readExportRendererSource(),
  ]);
  assert.equal(pdf.buffer.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(docx.buffer.subarray(0, 2).toString("ascii"), "PK");
  assert.equal(
    renderer.match(/exportFlowLayout\(section\.flowDiagram\)/gu)?.length,
    1,
  );
  assert.match(renderer, /renderSwimlaneFlowSvg\(section\.flowDiagram\)/);
  assert.match(renderer, /fitDiagramDimensions/);
  assert.match(renderer, /maximumWidth \/ Math\.max\(sourceWidth, 1\)/);
  assert.match(renderer, /type: "svg"/);
});

test("las secciones controladas muestran reglas útiles y no el marcador técnico", () => {
  const input = buildExportFixture("SMALL_REQUIREMENT");
  const section = input.version.sections.find(
    (item) => item.key === "writingRules",
  )!;
  const presentation = sectionPresentation(section);
  assert.match(presentation.lines[0]?.text ?? "", /redacción clara/i);
  assert.doesNotMatch(
    presentation.lines[0]?.text ?? "",
    /Template Controlled: Sí/i,
  );
  const exported = JSON.stringify(buildExportDocumentSections(input));
  assert.doesNotMatch(
    exported,
    /Reglas de redacción|Formato visual recomendado|Instrucción para automatización/,
  );
});

test("la salida corporativa excluye trazabilidad técnica y UUID de negocio", () => {
  const input = buildExportFixture("MEDIUM_REQUIREMENT");
  const exported = buildExportDocumentSections(input);
  const text = JSON.stringify(exported);
  assert.match(text, /Features/);
  assert.match(text, /Historias de Usuario/);
  assert.match(text, /Criterios de aceptación/);
  assert.doesNotMatch(text, /Trazabilidad documental/);
  assert.doesNotMatch(text, /10000000-0000-4000-8000-000000000001/);
});

test("los entregables omiten marcadores pendientes y mensajes operativos de IA", () => {
  const input = buildExportFixture("MEDIUM_REQUIREMENT");
  const base = input.version.sections.find((item) => item.key === "header")!;
  const presentation = sectionPresentation({
    ...base,
    content: {
      title: "Documento para validación con el usuario",
      preparedBy: "Yeison Quinto",
      reviewedBy: "[PENDIENTE POR DEFINIR]",
      note: "Generado con IA · requiere revisión humana",
    },
    templateControlled: false,
  });
  const exported = JSON.stringify(presentation);
  assert.match(exported, /Documento para validación con el usuario/u);
  assert.doesNotMatch(
    exported,
    /Yeison Quinto|PENDIENTE POR DEFINIR|Pendiente|IA|revisión humana/iu,
  );
  assert.doesNotMatch(exported, /Revisado por:\s*"/iu);
});

test("Ventas perdidas conserva hechos, estructura corporativa y Scrum sin ruido técnico", async () => {
  const input = buildVentasPerdidasExportFixture();
  const sections = buildExportDocumentSections(input);
  const exported = JSON.stringify(sections);

  assert.deepEqual(
    sections.map((section) => section.title),
    [
      "Objetivo",
      "Contexto y problema",
      "Alcance",
      "Solución propuesta del profesional de soluciones",
      "Diagramas",
      "Flujo AS-IS",
      "Flujo TO-BE",
      "Modelo entidad-relación",
      "Requerimientos",
      "Requerimientos funcionales",
      "Requerimientos no funcionales",
      "Esquema",
      "Pruebas",
      "Datos, campos e integraciones",
      "Supuestos y dependencias",
      "Aprobación",
      "Control de cambios",
      "Plan Scrum",
    ],
  );
  for (const fact of [
    "ventas perdidas",
    "D365",
    "texto",
    "carga masiva",
    "voz",
    "Android",
    "iOS",
    "Web",
    "COMO:",
    "QUIERO:",
    "PARA:",
    "DADO",
    "CUANDO",
    "ENTONCES",
  ]) {
    assert.match(exported, new RegExp(fact, "i"));
  }
  assert.doesNotMatch(exported, /[0-9a-f]{8}-[0-9a-f-]{27,}/i);
  assert.doesNotMatch(exported, /Template Controlled|flowchart|-->/i);

  const pdf = await renderPdf(input);
  const loaded = await PDFDocument.load(pdf.buffer);
  assert.ok(loaded.getPageCount() >= 3);
  const maximumExpectedPages = Math.max(12, sections.length + 6);
  assert.ok(loaded.getPageCount() <= maximumExpectedPages);
});

test("PDF y DOCX se derivan del mismo orden funcional y exportar no ejecuta IA", async () => {
  const input = buildExportFixture("LARGE_REQUIREMENT");
  const sectionTitles = input.version.sections.map((section) => section.title);
  assert.equal(sectionTitles.length, 15);
  for (const section of input.version.sections) {
    const presentation = sectionPresentation(section);
    assert.ok(
      presentation.lines.length > 0 ||
        presentation.flowSteps.length > 0 ||
        presentation.tables.length > 0,
    );
  }
  const processing = await readFile(
    "apps/operations-service/src/operations/export-processing.service.ts",
    "utf8",
  );
  const renderer = await readExportRendererSource();
  assert.doesNotMatch(
    processing + renderer,
    /OpenAiResponsesProvider|analysis-requests|provider\.generate/,
  );
});
