import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { BlobServiceClient } from "@azure/storage-blob";
import { Queue, type Job } from "bullmq";

import { PasswordHasher } from "../apps/identity-service/src/auth/password-hasher";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "../libs/shared/persistence/src/index.js";

const GATEWAY = "http://127.0.0.1:3000/api/v1";
const WEB = "http://127.0.0.1:4200";
const CORRELATION_ID = randomUUID();

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La API no devolvió un objeto JSON válido.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} no es texto.`);
  }
  return value;
}

function integer(value: unknown, name: string): number {
  const resolved = Number(value);
  if (!Number.isInteger(resolved)) {
    throw new Error(`${name} no es entero.`);
  }
  return resolved;
}

function items(value: unknown, name: string): readonly unknown[] {
  const resolved = object(value).items;
  if (!Array.isArray(resolved)) {
    throw new Error(`${name}.items no es una lista.`);
  }
  return resolved;
}

function cookie(response: Response, name: string): string {
  const value = response.headers
    .getSetCookie()
    .find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`No se recibió la cookie ${name}.`);
  return value.split(";", 1)[0] ?? "";
}

async function request(
  path: string,
  sessionCookie: string | null,
  options: {
    method?: string;
    body?: unknown;
    expected?: number;
    idempotencyKey?: string;
  } = {},
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      "x-correlation-id": CORRELATION_ID,
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      payload = text;
    }
  }
  const expected = options.expected ?? 200;
  if (response.status !== expected) {
    throw new Error(
      `${options.method ?? "GET"} ${path} respondió ${response.status}, esperado ${expected}: ${text}`,
    );
  }
  return { response, payload };
}

async function parseEnvironment(path: string): Promise<NodeJS.ProcessEnv> {
  const content = await readFile(path, "utf8");
  const result: NodeJS.ProcessEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const raw = trimmed.slice(separator + 1).trim();
    result[trimmed.slice(0, separator)] =
      raw.length >= 2 &&
      ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'")))
        ? raw.slice(1, -1)
        : raw;
  }
  return result;
}

async function database(
  serviceName: string,
  databaseName: string,
  environmentPath: string,
) {
  const environment = await parseEnvironment(environmentPath);
  environment.DATABASE_ENABLED = "true";
  environment.DB_NAME = databaseName;
  const config = loadSqlServerDatabaseConfig(
    { serviceName, defaultDatabaseName: databaseName },
    environment,
  );
  const dataSource = createSqlServerDataSource(config, {
    entities: [],
    migrations: [],
  });
  await dataSource.initialize();
  return dataSource;
}

async function uploadFile(
  projectId: string,
  sessionCookie: string,
  fileName: string,
  content: Buffer,
) {
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify([
      {
        fileName,
        classification: "REQUIREMENT",
        description: "Fuente temporal de la aceptación V1.",
      },
    ]),
  );
  form.append(
    "files",
    new Blob([new Uint8Array(content)], { type: "text/plain" }),
    fileName,
  );
  const response = await fetch(
    `${GATEWAY}/projects/${projectId}/sources/files`,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: sessionCookie,
        "x-correlation-id": CORRELATION_ID,
      },
      body: form,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const text = await response.text();
  if (response.status !== 201) {
    throw new Error(`La carga respondió ${response.status}: ${text}`);
  }
  return object(JSON.parse(text) as unknown);
}

async function waitForSource(
  projectId: string,
  sourceId: string,
  sessionCookie: string,
) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = object(
      (
        await request(
          `/projects/${projectId}/sources/${sourceId}`,
          sessionCookie,
        )
      ).payload,
    );
    if (detail.processingStatus === "READY") return detail;
    if (detail.processingStatus === "FAILED") {
      throw new Error(
        typeof detail.processingMessage === "string"
          ? detail.processingMessage
          : "La extracción de la fuente falló.",
      );
    }
    await delay(300);
  }
  throw new Error("La fuente no terminó de procesarse.");
}

async function waitForAnalysis(
  projectId: string,
  analysisRequestId: string,
  sessionCookie: string,
) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const detail = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests/${analysisRequestId}`,
          sessionCookie,
        )
      ).payload,
    );
    if (detail.status === "COMPLETED") return detail;
    if (detail.status === "FAILED") {
      const executions = Array.isArray(detail.executions)
        ? detail.executions.map(object)
        : [];
      const latest = executions.at(-1);
      throw new Error(
        typeof latest?.errorMessage === "string"
          ? latest.errorMessage
          : "El análisis terminó con error.",
      );
    }
    await delay(400);
  }
  throw new Error("El análisis no terminó dentro del tiempo límite.");
}

async function waitForExport(sessionCookie: string, exportId: string) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const detail = object(
      (await request(`/exports/${exportId}`, sessionCookie)).payload,
    );
    if (detail.status === "COMPLETED") return detail;
    if (detail.status === "FAILED") {
      throw new Error(string(detail.errorMessage, "export.errorMessage"));
    }
    await delay(300);
  }
  throw new Error("La exportación no terminó dentro del tiempo límite.");
}

async function waitForOperationalEvidence(
  projectId: string,
  sessionCookie: string,
) {
  const deadline = Date.now() + 45_000;
  const requiredActions = new Set([
    "REVIEW_REQUESTED",
    "DOCUMENT_APPROVED",
    "EXPORT_COMPLETED",
  ]);
  while (Date.now() < deadline) {
    const auditPayload = (
      await request(
        `/projects/${projectId}/audit-events?page=1&pageSize=100`,
        sessionCookie,
      )
    ).payload;
    const auditItems = items(auditPayload, "audit").map(object);
    const actions = new Set(auditItems.map((item) => item.action));
    const notificationsPayload = (
      await request(
        "/notifications?state=ALL&page=1&pageSize=100",
        sessionCookie,
      )
    ).payload;
    const notifications = items(notificationsPayload, "notifications").map(
      object,
    );
    const exportReady = notifications.filter(
      (item) => item.notificationType === "EXPORT_READY",
    );
    if (
      [...requiredActions].every((action) => actions.has(action)) &&
      exportReady.length >= 2
    ) {
      return { auditItems, notifications };
    }
    await delay(400);
  }
  throw new Error(
    "No llegaron a tiempo la auditoría y las notificaciones esperadas.",
  );
}

async function removeQueueJobs(
  queueName: string,
  matches: (job: Job) => boolean,
): Promise<void> {
  const password = process.env.REDIS_PASSWORD?.trim();
  const queue = new Queue(queueName, {
    connection: {
      host: "127.0.0.1",
      port: Number(process.env.REDIS_PORT ?? 6381),
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
    },
  });
  try {
    const jobs = await queue.getJobs(
      ["completed", "failed", "delayed", "waiting", "paused"],
      0,
      999,
    );
    await Promise.all(
      jobs.filter(matches).map((job) => job.remove().catch(() => undefined)),
    );
  } finally {
    await queue.close();
  }
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const email = `v1-e2e-${suffix}@local.invalid`;
  const password = `V1E2e!${randomUUID()}9a`;
  const fileName = `v1-aceptacion-${suffix}.txt`;
  const fileContent = Buffer.from(
    "El sistema deberá conservar la trazabilidad de cada requerimiento, permitir revisión humana y exportar la versión aprobada en PDF y DOCX.",
    "utf8",
  );
  const exportIds: string[] = [];
  const exportBlobPaths: string[] = [];
  let projectId: string | null = null;
  let sourceId: string | null = null;
  let sourceContainer: string | null = null;
  let sourceBlobPath: string | null = null;
  let documentId: string | null = null;
  let appliedTemplateId: string | null = null;
  let analysisRequestId: string | null = null;
  let reviewId: string | null = null;
  let fullSessionCookie: string | null = null;
  let identityCreated = false;
  let stage = "conectar las bases de dominio";

  const identityDb = await database(
    "identity-service",
    "RqIdentityDb",
    "apps/identity-service/.env",
  );
  const projectsDb = await database(
    "projects-service",
    "RqProjectsDb",
    "apps/projects-service/.env",
  );
  const sourcesDb = await database(
    "sources-service",
    "RqSourcesDb",
    "apps/sources-service/.env",
  );
  const documentsDb = await database(
    "documents-service",
    "RqDocumentsDb",
    "apps/documents-service/.env",
  );
  const aiDb = await database(
    "ai-analysis-service",
    "RqAiDb",
    "apps/ai-analysis-service/.env",
  );
  const workflowDb = await database(
    "workflow-service",
    "RqWorkflowDb",
    "apps/documents-service/.env",
  );
  const operationsDb = await database(
    "operations-service",
    "RqOperationsDb",
    "apps/documents-service/.env",
  );

  try {
    stage = "crear un administrador temporal";
    const roles = (await identityDb.query(
      "SELECT TOP 1 Id FROM dbo.IdentityRoles WHERE Code = N'ADMIN' AND IsActive = 1",
    )) as Array<{ Id: string }>;
    const roleId = roles[0]?.Id;
    if (!roleId) throw new Error("No existe un rol ADMIN activo.");
    const hash = await new PasswordHasher().hash(password);
    const now = new Date();
    await identityDb.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO dbo.IdentityUsers (
           Id, Email, EmailNormalized, DisplayName, PasswordHash,
           IsActive, MustChangePassword, SessionVersion, LastLoginAt,
           CreatedAt, UpdatedAt
         ) VALUES (@0, @1, @2, @3, @4, 1, 0, 1, NULL, @5, @5)`,
        [userId, email, email.toLowerCase(), "Aceptación V1", hash, now],
      );
      await manager.query(
        "INSERT INTO dbo.IdentityUserRoles (UserId, RoleId, CreatedAt) VALUES (@0, @1, @2)",
        [userId, roleId, now],
      );
    });
    identityCreated = true;

    stage = "validar autenticación y autorización";
    await request(`/projects/${randomUUID()}/sources`, null, { expected: 401 });
    const signIn = await fetch(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-correlation-id": CORRELATION_ID,
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30_000),
    });
    const signInText = await signIn.text();
    if (!signIn.ok) {
      throw new Error(`Inicio de sesión ${signIn.status}: ${signInText}`);
    }
    const access = cookie(signIn, "rq_access");
    const refresh = cookie(signIn, "rq_refresh");
    fullSessionCookie = `${access}; ${refresh}`;

    stage = "crear proyecto desde una plantilla publicada";
    const templateItems = items(
      (await request("/templates?page=1&pageSize=1&status=PUBLISHED", access))
        .payload,
      "templates",
    );
    if (templateItems.length !== 1) {
      throw new Error("No existe una plantilla publicada.");
    }
    const template = object(templateItems[0]);
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Aceptación integral V1 ${suffix}`,
            requestingArea: "Arquitectura y calidad",
            description: "Fixture integral y temporal de aceptación V1.",
            templateId: string(template.id, "template.id"),
          },
        })
      ).payload,
    );
    projectId = string(project.id, "project.id");

    stage = "cargar, procesar y descargar una fuente física";
    const uploaded = await uploadFile(projectId, access, fileName, fileContent);
    assert.equal(uploaded.acceptedFiles, 1);
    assert.equal(uploaded.rejectedFiles, 0);
    if (!Array.isArray(uploaded.accepted) || uploaded.accepted.length !== 1) {
      throw new Error("La API no aceptó exactamente un archivo.");
    }
    const source = object(uploaded.accepted[0]);
    sourceId = string(source.id, "source.id");
    sourceContainer = string(
      source.storageContainer,
      "source.storageContainer",
    );
    sourceBlobPath = string(source.storagePath, "source.storagePath");
    const processing = object(
      (
        await request(`/projects/${projectId}/sources/process`, access, {
          method: "POST",
          expected: 201,
          body: { sourceIds: [sourceId] },
        })
      ).payload,
    );
    assert.equal(processing.enqueued, 1);
    const readySource = await waitForSource(projectId, sourceId, access);
    assert.equal(readySource.status, "ACTIVE");
    assert.match(
      string(readySource.extractedText, "source.extractedText"),
      /trazabilidad/i,
    );
    const sourceDownload = await fetch(
      `${GATEWAY}/projects/${projectId}/sources/${sourceId}/download`,
      {
        headers: { cookie: access, "x-correlation-id": CORRELATION_ID },
        signal: AbortSignal.timeout(30_000),
      },
    );
    assert.equal(sourceDownload.status, 200);
    assert.deepEqual(
      Buffer.from(await sourceDownload.arrayBuffer()),
      fileContent,
    );

    stage = "crear documento y ejecutar el proveedor Fake AI";
    const document = object(
      (
        await request(`/projects/${projectId}/documents`, access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Documento de aceptación V1 ${suffix}`,
            changeSummary: "Borrador inicial generado desde el E2E",
            idempotencyKey: `v1-document-${suffix}`,
          },
        })
      ).payload,
    );
    documentId = string(document.id, "document.id");
    const repeatedDocument = object(
      (
        await request(`/projects/${projectId}/documents`, access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Documento de aceptación V1 ${suffix}`,
            changeSummary: "Borrador inicial generado desde el E2E",
            idempotencyKey: `v1-document-${suffix}`,
          },
        })
      ).payload,
    );
    assert.equal(repeatedDocument.id, documentId);
    const initialVersion = object(document.currentVersionDetail);
    const documentVersionId = string(initialVersion.id, "document.version.id");
    const appliedRows = (await documentsDb.query(
      "SELECT AppliedTemplateId FROM dbo.RequirementDocuments WHERE Id = @0",
      [documentId],
    )) as Array<{ AppliedTemplateId: string }>;
    appliedTemplateId = appliedRows[0]?.AppliedTemplateId ?? null;
    const analysis = object(
      (
        await request(`/projects/${projectId}/analysis-requests`, access, {
          method: "POST",
          expected: 201,
          body: {
            analysisType: "REQUIREMENT_DOCUMENT",
            documentId,
            documentVersionId,
            sourceIds: [sourceId],
            purpose: "INITIAL_DRAFT",
            idempotencyKey: `v1-initial-draft-${suffix}`,
          },
        })
      ).payload,
    );
    analysisRequestId = string(analysis.id, "analysis.id");
    const repeatedAnalysis = object(
      (
        await request(`/projects/${projectId}/analysis-requests`, access, {
          method: "POST",
          expected: 201,
          body: {
            analysisType: "REQUIREMENT_DOCUMENT",
            documentId,
            documentVersionId,
            sourceIds: [sourceId],
            purpose: "INITIAL_DRAFT",
            idempotencyKey: `v1-initial-draft-${suffix}`,
          },
        })
      ).payload,
    );
    assert.equal(repeatedAnalysis.id, analysisRequestId);
    const completedAnalysis = await waitForAnalysis(
      projectId,
      analysisRequestId,
      access,
    );
    const executions = Array.isArray(completedAnalysis.executions)
      ? completedAnalysis.executions.map(object)
      : [];
    assert.equal(executions.length, 1);
    assert.equal(executions.at(-1)?.provider, "FAKE");
    const generatedResult = object(completedAnalysis.result);
    assert.equal(generatedResult.status, "ACCEPTED");
    const draft = object(generatedResult.draft);
    assert.equal(Array.isArray(draft.sections) ? draft.sections.length : 0, 13);
    assert.ok(
      Array.isArray(draft.requirements) && draft.requirements.length > 0,
    );

    stage = "validar aplicación automática sujeta a revisión humana";
    const withAi = object(
      (await request(`/documents/${documentId}`, access)).payload,
    );
    const withAiVersion = object(withAi.currentVersionDetail);
    assert.ok(
      Array.isArray(withAiVersion.requirements) &&
        withAiVersion.requirements.length > 0,
    );
    assert.ok(
      Array.isArray(withAiVersion.evidence) &&
        withAiVersion.evidence.length > 0,
    );

    stage = "comentar, revisar y aprobar el documento";
    const review = object(
      (
        await request(
          `/projects/${projectId}/documents/${documentId}/versions/1/reviews`,
          access,
          {
            method: "POST",
            expected: 201,
            idempotencyKey: `v1-review-${suffix}`,
            body: {
              expectedDocumentRevision: integer(
                withAiVersion.revision,
                "withAiVersion.revision",
              ),
              comment: "Versión con trazabilidad lista para revisión.",
            },
          },
        )
      ).payload,
    );
    reviewId = string(review.id, "review.id");
    const commented = object(
      (
        await request(
          `/projects/${projectId}/reviews/${reviewId}/comments`,
          access,
          {
            method: "POST",
            idempotencyKey: `v1-comment-${suffix}`,
            body: {
              expectedReviewRevision: integer(
                review.revision,
                "review.revision",
              ),
              comment: "Se verificaron fuente, requisitos y evidencias.",
            },
          },
        )
      ).payload,
    );
    const inReview = object(
      (await request(`/documents/${documentId}`, access)).payload,
    );
    const inReviewVersion = object(inReview.currentVersionDetail);
    const approved = object(
      (
        await request(
          `/projects/${projectId}/reviews/${reviewId}/approve`,
          access,
          {
            method: "POST",
            idempotencyKey: `v1-approve-${suffix}`,
            body: {
              expectedReviewRevision: integer(
                commented.revision,
                "commented.revision",
              ),
              expectedDocumentRevision: integer(
                inReviewVersion.revision,
                "inReviewVersion.revision",
              ),
              comment: "Aceptación técnica V1 aprobada.",
            },
          },
        )
      ).payload,
    );
    assert.equal(approved.status, "APPROVED");

    stage = "generar y validar PDF y DOCX";
    await request(`/exports/${randomUUID()}/download`, null, { expected: 401 });
    for (const format of ["PDF", "DOCX"] as const) {
      const created = object(
        (
          await request(
            `/projects/${projectId}/documents/${documentId}/versions/1/exports`,
            access,
            {
              method: "POST",
              expected: 201,
              idempotencyKey: `v1-export-${format.toLowerCase()}-${suffix}`,
              body: { format },
            },
          )
        ).payload,
      );
      const exportId = string(created.id, "export.id");
      exportIds.push(exportId);
      const completed = await waitForExport(access, exportId);
      const artifact = object(completed.artifact);
      const download = await fetch(`${GATEWAY}/exports/${exportId}/download`, {
        headers: { cookie: access, "x-correlation-id": CORRELATION_ID },
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(download.status, 200);
      assert.match(
        download.headers.get("content-disposition") ?? "",
        /attachment/i,
      );
      const buffer = Buffer.from(await download.arrayBuffer());
      assert.equal(
        String(buffer.length),
        string(artifact.sizeBytes, "sizeBytes"),
      );
      assert.equal(
        createHash("sha256").update(buffer).digest("hex"),
        string(artifact.sha256, "sha256"),
      );
      assert.equal(
        buffer.subarray(0, format === "PDF" ? 5 : 2).toString("ascii"),
        format === "PDF" ? "%PDF-" : "PK",
      );
    }

    stage = "verificar historial, auditoría, notificaciones y frontend";
    const historyPayload = (
      await request(`/documents/${documentId}/history`, access)
    ).payload;
    if (!Array.isArray(historyPayload)) {
      throw new Error("El historial documental no es una lista.");
    }
    const historyEvents = new Set(
      historyPayload.map(object).map((entry) => entry.eventType),
    );
    for (const expected of [
      "DOCUMENT_CREATED",
      "AI_DRAFT_APPLIED",
      "VERSION_SUBMITTED_FOR_REVIEW",
      "VERSION_APPROVED",
    ]) {
      assert.ok(historyEvents.has(expected), `Falta el evento ${expected}.`);
    }
    const operational = await waitForOperationalEvidence(projectId, access);
    const notification = operational.notifications.find(
      (item) => item.notificationType === "EXPORT_READY",
    );
    if (!notification)
      throw new Error("No existe una notificación de exportación.");
    const marked = object(
      (
        await request(
          `/notifications/${string(notification.id, "notification.id")}/read`,
          access,
          {
            method: "POST",
          },
        )
      ).payload,
    );
    assert.equal(marked.status, "READ");

    for (const route of [
      "/workspace",
      "/workspace/sources",
      "/workspace/documents",
      "/workspace/validation",
      "/workspace/settings/audit",
      "/workspace/notifications",
      "/workspace/settings",
    ]) {
      const page = await fetch(`${WEB}${route}`, {
        headers: { cookie: access },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      assert.equal(page.status, 200, `${route} no respondió HTTP 200.`);
    }
    const legacyAudit = await fetch(`${WEB}/workspace/audit`, {
      headers: { cookie: access },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    assert.equal(legacyAudit.status, 308);
    assert.match(
      legacyAudit.headers.get("location") ?? "",
      /\/workspace\/settings\/audit/,
    );

    const inboxRows = (await operationsDb.query(
      "SELECT COUNT(1) AS Total FROM dbo.IntegrationEventInbox WHERE CorrelationId = @0 AND Status = N'PROCESSED'",
      [CORRELATION_ID],
    )) as Array<{ Total: number | string }>;
    assert.ok(Number(inboxRows[0]?.Total ?? 0) >= 4);

    console.log("✓ Login, plantilla y proyecto validados.");
    console.log(
      "✓ Archivo, Azurite, BullMQ, extracción READY y descarga validados.",
    );
    console.log(
      "✓ Fake AI, 13 secciones, revisión humana y trazabilidad validadas.",
    );
    console.log("✓ Comentario, aprobación, bloqueo e historial validados.");
    console.log("✓ PDF/DOCX, SHA-256, auditoría y notificaciones validados.");
    console.log(
      "✓ Rutas funcionales principales del frontend respondieron HTTP 200.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (fullSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: {
          cookie: fullSessionCookie,
          "x-correlation-id": CORRELATION_ID,
        },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
    }

    if (exportIds.length > 0) {
      const paths = (await operationsDb.query(
        "SELECT StoragePath FROM dbo.ExportArtifacts WHERE ExportRequestId IN (SELECT value FROM OPENJSON(@0))",
        [JSON.stringify(exportIds)],
      )) as Array<{ StoragePath: string }>;
      exportBlobPaths.push(...paths.map((row) => row.StoragePath));
    }
    await operationsDb.query(
      `DELETE FROM dbo.NotificationRequests
       WHERE ProjectId = @0 OR RecipientUserId = @1;
       DELETE FROM dbo.AuditEvents
       WHERE ProjectId = @0 OR ActorUserId = @1 OR CorrelationId = @2;
       DELETE FROM dbo.IntegrationEventInbox WHERE CorrelationId = @2;`,
      [projectId, userId, CORRELATION_ID],
    );
    if (exportIds.length > 0) {
      await operationsDb.query(
        "DELETE FROM dbo.ExportRequests WHERE Id IN (SELECT value FROM OPENJSON(@0))",
        [JSON.stringify(exportIds)],
      );
    }
    if (reviewId) {
      await workflowDb.query(
        "DELETE FROM dbo.WorkflowReviewRequests WHERE Id = @0",
        [reviewId],
      );
    }
    if (analysisRequestId) {
      await aiDb.query(
        `DELETE FROM dbo.AnalysisResults WHERE AnalysisRequestId = @0;
         DELETE FROM dbo.AnalysisExecutions WHERE AnalysisRequestId = @0;
         DELETE FROM dbo.AnalysisRequestSources WHERE AnalysisRequestId = @0;
         DELETE FROM dbo.AnalysisRequests WHERE Id = @0;`,
        [analysisRequestId],
      );
    }
    if (documentId) {
      await documentsDb.query(
        "DELETE FROM dbo.RequirementDocuments WHERE Id = @0",
        [documentId],
      );
    }
    if (appliedTemplateId) {
      await documentsDb.query(
        `DELETE FROM dbo.AppliedDocumentTemplates
         WHERE Id = @0 AND NOT EXISTS (
           SELECT 1 FROM dbo.RequirementDocuments WHERE AppliedTemplateId = @0
         )`,
        [appliedTemplateId],
      );
    }
    if (sourceId) {
      await sourcesDb.query("DELETE FROM dbo.Sources WHERE Id = @0", [
        sourceId,
      ]);
    }
    if (projectId) {
      await projectsDb.query(
        `DELETE FROM dbo.ProjectParticipants WHERE ProjectId = @0;
         DELETE FROM dbo.Projects WHERE Id = @0;`,
        [projectId],
      );
    }
    if (identityCreated) {
      await identityDb.transaction(async (manager) => {
        await manager.query(
          "DELETE FROM dbo.IdentityRefreshSessions WHERE UserId = @0",
          [userId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentitySecurityAudit WHERE ActorUserId = @0 OR TargetUserId = @0",
          [userId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentityUserRoles WHERE UserId = @0",
          [userId],
        );
        await manager.query("DELETE FROM dbo.IdentityUsers WHERE Id = @0", [
          userId,
        ]);
      });
    }

    const storage = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
    if (storage) {
      const blobService = BlobServiceClient.fromConnectionString(storage);
      if (sourceContainer && sourceBlobPath) {
        await blobService
          .getContainerClient(sourceContainer)
          .getBlobClient(sourceBlobPath)
          .deleteIfExists();
      }
      await Promise.all(
        exportBlobPaths.map((path) =>
          blobService
            .getContainerClient("rq-exports")
            .getBlobClient(path)
            .deleteIfExists(),
        ),
      );
    }

    if (sourceId) {
      await removeQueueJobs(
        process.env.SOURCES_PROCESSING_QUEUE?.trim() || "source-processing",
        (job) => object(job.data).sourceId === sourceId,
      );
    }
    if (analysisRequestId) {
      await removeQueueJobs(
        process.env.AI_PROCESSING_QUEUE?.trim() || "ai-analysis-processing",
        (job) => object(job.data).analysisRequestId === analysisRequestId,
      );
    }
    if (exportIds.length > 0) {
      const exportSet = new Set(exportIds);
      await removeQueueJobs(
        process.env.OPERATIONS_EXPORT_QUEUE?.trim() || "rq-exports-v1",
        (job) =>
          exportSet.has(
            string(object(job.data).exportRequestId, "job.exportRequestId"),
          ),
      );
    }

    await operationsDb.destroy();
    await workflowDb.destroy();
    await aiDb.destroy();
    await documentsDb.destroy();
    await sourcesDb.destroy();
    await projectsDb.destroy();
    await identityDb.destroy();
    console.log("✓ Fixtures, blobs y trabajos temporales eliminados.");
  }
}

void main().catch((error: unknown) => {
  console.error(
    `E2E V1 integral fallido: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
