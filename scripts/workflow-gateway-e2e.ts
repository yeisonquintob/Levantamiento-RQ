import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PasswordHasher } from "../apps/identity-service/src/auth/password-hasher";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "../libs/shared/persistence/src/index.js";

const GATEWAY = "http://127.0.0.1:3000/api/v1";

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

function sameUuid(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function cookie(response: Response, name: string): string {
  const serialized = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));

  if (!serialized) throw new Error(`No se recibió la cookie ${name}.`);

  return serialized.split(";", 1)[0] ?? "";
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
      "x-correlation-id": randomUUID(),
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
      ...(options.idempotencyKey
        ? { "x-idempotency-key": options.idempotencyKey }
        : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30000),
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
      `${options.method ?? "GET"} ${path} respondió ${response.status}, ` +
        `esperado ${expected}: ${text}`,
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

    const rawValue = trimmed.slice(separator + 1).trim();
    result[trimmed.slice(0, separator)] =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")))
        ? rawValue.slice(1, -1)
        : rawValue;
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

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const identityUserId = randomUUID();
  const identityEmail = `workflow-e2e-${suffix}@local.invalid`;
  const identityPassword = `WfE2e!${randomUUID()}9a`;
  const documentIds: string[] = [];
  const appliedTemplateIds: string[] = [];
  const reviewIds: string[] = [];
  let projectId: string | null = null;
  let fullSessionCookie: string | null = null;
  let accessCookie: string | null = null;
  let identityUserCreated = false;
  let stage = "conectar bases temporales";

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
  const documentsDb = await database(
    "documents-service",
    "RqDocumentsDb",
    "apps/documents-service/.env",
  );
  const workflowDb = await database(
    "workflow-service",
    "RqWorkflowDb",
    "apps/documents-service/.env",
  );

  try {
    stage = "crear usuario ADMIN temporal";
    const adminRoles = (await identityDb.query(
      `SELECT TOP 1 Id FROM dbo.IdentityRoles
       WHERE Code = N'ADMIN' AND IsActive = 1`,
    )) as Array<{ Id: string }>;
    const adminRoleId = adminRoles[0]?.Id;

    if (!adminRoleId) throw new Error("No existe un rol ADMIN activo.");

    const passwordHash = await new PasswordHasher().hash(identityPassword);
    const now = new Date();

    await identityDb.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO dbo.IdentityUsers (
           Id, Email, EmailNormalized, DisplayName, PasswordHash,
           IsActive, MustChangePassword, SessionVersion, LastLoginAt,
           CreatedAt, UpdatedAt
         ) VALUES (@0, @1, @2, @3, @4, 1, 0, 1, NULL, @5, @5)`,
        [
          identityUserId,
          identityEmail,
          identityEmail.toLowerCase(),
          "Workflow E2E",
          passwordHash,
          now,
        ],
      );
      await manager.query(
        `INSERT INTO dbo.IdentityUserRoles (UserId, RoleId, CreatedAt)
         VALUES (@0, @1, @2)`,
        [identityUserId, adminRoleId, now],
      );
    });
    identityUserCreated = true;

    stage = "rechazar acceso sin sesión";
    await request(`/projects/${randomUUID()}/reviews`, null, { expected: 401 });

    stage = "iniciar sesión real por Gateway";
    const signIn = await fetch(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: identityEmail,
        password: identityPassword,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const signInText = await signIn.text();

    if (!signIn.ok) {
      throw new Error(`Inicio de sesión ${signIn.status}: ${signInText}`);
    }

    const access = cookie(signIn, "rq_access");
    const refresh = cookie(signIn, "rq_refresh");
    accessCookie = access;
    fullSessionCookie = `${access}; ${refresh}`;

    stage = "crear proyecto temporal";
    const templates = object(
      (await request("/templates?page=1&pageSize=1&status=PUBLISHED", access))
        .payload,
    );

    if (!Array.isArray(templates.items) || templates.items.length !== 1) {
      throw new Error("No existe plantilla publicada para el E2E.");
    }

    const template = object(templates.items[0]);
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Proyecto Workflow E2E ${suffix}`,
            requestingArea: "Pruebas automáticas",
            description: "Fixture temporal del Punto 19.",
            templateId: string(template.id, "template.id"),
          },
        })
      ).payload,
    );
    projectId = string(project.id, "project.id");

    const createDocument = async (label: string) => {
      const document = object(
        (
          await request(`/projects/${projectId}/documents`, access, {
            method: "POST",
            expected: 201,
            body: { title: `Documento Workflow ${label} ${suffix}` },
          })
        ).payload,
      );
      const documentId = string(document.id, `${label}.documentId`);
      documentIds.push(documentId);
      const appliedRows = (await documentsDb.query(
        "SELECT AppliedTemplateId FROM dbo.RequirementDocuments WHERE Id = @0",
        [documentId],
      )) as Array<{ AppliedTemplateId: string }>;
      const appliedTemplateId = appliedRows[0]?.AppliedTemplateId;

      if (appliedTemplateId) appliedTemplateIds.push(appliedTemplateId);

      return document;
    };

    const createReview = async (
      document: Readonly<Record<string, unknown>>,
      key: string,
      comment: string,
    ) => {
      const version = object(document.currentVersionDetail);
      const documentId = string(document.id, "document.id");
      const versionNumber = integer(version.versionNumber, "versionNumber");
      const path = `/projects/${projectId}/documents/${documentId}/versions/${versionNumber}/reviews`;
      const body = {
        expectedDocumentRevision: integer(version.revision, "version.revision"),
        comment,
      };
      const created = object(
        (
          await request(path, access, {
            method: "POST",
            expected: 201,
            idempotencyKey: key,
            body,
          })
        ).payload,
      );
      const reviewId = string(created.id, "review.id");
      reviewIds.push(reviewId);

      return { body, created, path, reviewId };
    };

    stage = "aprobar con comentario e idempotencia";
    const approvalDocument = await createDocument("Aprobación");
    const approvalDocumentId = string(
      approvalDocument.id,
      "approval.documentId",
    );
    const approvalCreateKey = `workflow-e2e-create-${suffix}`;

    await request(
      `/projects/${projectId}/documents/${approvalDocumentId}/versions/1/reviews`,
      access,
      {
        method: "POST",
        expected: 400,
        body: { expectedDocumentRevision: 1 },
      },
    );

    const approvalReview = await createReview(
      approvalDocument,
      approvalCreateKey,
      "Revisión funcional del documento.",
    );
    assert.equal(approvalReview.created.status, "IN_REVIEW");
    assert.equal(approvalReview.created.revision, 1);
    assert.equal(Array.isArray(approvalReview.created.assignments), true);

    const createReplay = object(
      (
        await request(approvalReview.path, access, {
          method: "POST",
          expected: 201,
          idempotencyKey: approvalCreateKey,
          body: approvalReview.body,
        })
      ).payload,
    );
    assert.ok(sameUuid(createReplay.id, approvalReview.reviewId));

    const commentKey = `workflow-e2e-comment-${suffix}`;
    const commentBody = {
      expectedReviewRevision: 1,
      comment: "Alcance revisado y listo para decisión.",
    };
    const commented = object(
      (
        await request(
          `/projects/${projectId}/reviews/${approvalReview.reviewId}/comments`,
          access,
          {
            method: "POST",
            idempotencyKey: commentKey,
            body: commentBody,
          },
        )
      ).payload,
    );
    assert.equal(commented.revision, 2);

    const commentReplay = object(
      (
        await request(
          `/projects/${projectId}/reviews/${approvalReview.reviewId}/comments`,
          access,
          {
            method: "POST",
            idempotencyKey: commentKey,
            body: commentBody,
          },
        )
      ).payload,
    );
    assert.equal(commentReplay.revision, 2);

    await request(
      `/projects/${projectId}/reviews/${approvalReview.reviewId}/comments`,
      access,
      {
        method: "POST",
        expected: 409,
        idempotencyKey: commentKey,
        body: { ...commentBody, comment: "Contenido distinto." },
      },
    );

    const inReviewDocument = object(
      (await request(`/documents/${approvalDocumentId}`, access)).payload,
    );
    const inReviewVersion = object(inReviewDocument.currentVersionDetail);
    assert.equal(inReviewVersion.status, "IN_REVIEW");

    const approvalKey = `workflow-e2e-approve-${suffix}`;
    const approvalBody = {
      expectedReviewRevision: 2,
      expectedDocumentRevision: integer(
        inReviewVersion.revision,
        "inReviewVersion.revision",
      ),
      comment: "Aprobación E2E confirmada.",
    };
    const approved = object(
      (
        await request(
          `/projects/${projectId}/reviews/${approvalReview.reviewId}/approve`,
          access,
          {
            method: "POST",
            idempotencyKey: approvalKey,
            body: approvalBody,
          },
        )
      ).payload,
    );
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.revision, 3);

    const approvedReplay = object(
      (
        await request(
          `/projects/${projectId}/reviews/${approvalReview.reviewId}/approve`,
          access,
          {
            method: "POST",
            idempotencyKey: approvalKey,
            body: approvalBody,
          },
        )
      ).payload,
    );
    assert.equal(approvedReplay.status, "APPROVED");

    const approvedDocument = object(
      (await request(`/documents/${approvalDocumentId}`, access)).payload,
    );
    const approvedVersion = object(approvedDocument.currentVersionDetail);
    assert.equal(approvedVersion.status, "APPROVED");

    const firstSection = Array.isArray(approvedVersion.sections)
      ? object(approvedVersion.sections[0])
      : null;

    if (!firstSection)
      throw new Error("La versión aprobada no tiene secciones.");

    await request(
      `/documents/${approvalDocumentId}/versions/1/sections/${string(firstSection.key, "section.key")}`,
      access,
      {
        method: "PATCH",
        expected: 409,
        body: {
          expectedRevision: integer(
            approvedVersion.revision,
            "approved.revision",
          ),
          content: firstSection.content,
        },
      },
    );
    await request(
      `/documents/${approvalDocumentId}/versions/1/approve`,
      access,
      { method: "POST", expected: 404, body: { expectedRevision: 1 } },
    );

    stage = "solicitar correcciones y crear versión nueva";
    const changesDocument = await createDocument("Correcciones");
    const changesDocumentId = string(changesDocument.id, "changes.documentId");
    const changesReview = await createReview(
      changesDocument,
      `workflow-e2e-changes-create-${suffix}`,
      "Validar alcance.",
    );
    const changesInReview = object(
      (await request(`/documents/${changesDocumentId}`, access)).payload,
    );
    const changesVersion = object(changesInReview.currentVersionDetail);
    const changesDecision = object(
      (
        await request(
          `/projects/${projectId}/reviews/${changesReview.reviewId}/request-changes`,
          access,
          {
            method: "POST",
            idempotencyKey: `workflow-e2e-changes-${suffix}`,
            body: {
              expectedReviewRevision: 1,
              expectedDocumentRevision: integer(
                changesVersion.revision,
                "changesVersion.revision",
              ),
              comment: "Completar los criterios de aceptación.",
            },
          },
        )
      ).payload,
    );
    assert.equal(changesDecision.status, "CHANGES_REQUESTED");
    const rejectedForChanges = object(
      (await request(`/documents/${changesDocumentId}`, access)).payload,
    );
    assert.equal(rejectedForChanges.status, "REJECTED");
    const correctedDraft = object(
      (
        await request(`/documents/${changesDocumentId}/versions`, access, {
          method: "POST",
          expected: 201,
          body: {
            expectedRevision: integer(
              rejectedForChanges.revision,
              "rejectedForChanges.revision",
            ),
            changeSummary: "Correcciones solicitadas en Workflow",
          },
        })
      ).payload,
    );
    assert.equal(correctedDraft.status, "DRAFT");
    assert.equal(correctedDraft.currentVersionNumber, 2);

    stage = "rechazar definitivamente";
    const rejectionDocument = await createDocument("Rechazo");
    const rejectionDocumentId = string(
      rejectionDocument.id,
      "rejection.documentId",
    );
    const rejectionReview = await createReview(
      rejectionDocument,
      `workflow-e2e-reject-create-${suffix}`,
      "Revisión final.",
    );
    const rejectionInReview = object(
      (await request(`/documents/${rejectionDocumentId}`, access)).payload,
    );
    const rejectionVersion = object(rejectionInReview.currentVersionDetail);
    const rejected = object(
      (
        await request(
          `/projects/${projectId}/reviews/${rejectionReview.reviewId}/reject`,
          access,
          {
            method: "POST",
            idempotencyKey: `workflow-e2e-reject-${suffix}`,
            body: {
              expectedReviewRevision: 1,
              expectedDocumentRevision: integer(
                rejectionVersion.revision,
                "rejectionVersion.revision",
              ),
              comment: "No cumple el alcance aprobado.",
            },
          },
        )
      ).payload,
    );
    assert.equal(rejected.status, "REJECTED");

    stage = "verificar listados, auditoría y persistencia";
    const listed = object(
      (await request(`/projects/${projectId}/reviews`, access)).payload,
    );
    assert.equal(listed.totalItems, 3);
    const detail = object(
      (
        await request(
          `/projects/${projectId}/reviews/${approvalReview.reviewId}`,
          access,
        )
      ).payload,
    );
    assert.equal(
      Array.isArray(detail.activities) ? detail.activities.length : 0,
      3,
    );

    const persisted = (await workflowDb.query(
      `SELECT
         r.Status,
         r.Revision,
         (SELECT COUNT(1) FROM dbo.WorkflowReviewAssignments a
          WHERE a.ReviewRequestId = r.Id) AS AssignmentCount,
         (SELECT COUNT(1) FROM dbo.WorkflowReviewActivities x
          WHERE x.ReviewRequestId = r.Id) AS ActivityCount,
         (SELECT COUNT(1) FROM dbo.WorkflowReviewActivities x
          WHERE x.ReviewRequestId = r.Id
            AND x.IdempotencyKey IS NOT NULL
            AND x.CorrelationId IS NOT NULL) AS AuditedActivityCount
       FROM dbo.WorkflowReviewRequests r WHERE r.Id = @0`,
      [approvalReview.reviewId],
    )) as Array<{
      Status: string;
      Revision: number | string;
      AssignmentCount: number | string;
      ActivityCount: number | string;
      AuditedActivityCount: number | string;
    }>;
    assert.equal(persisted[0]?.Status, "APPROVED");
    assert.equal(Number(persisted[0]?.Revision ?? 0), 3);
    assert.equal(Number(persisted[0]?.AssignmentCount ?? 0), 2);
    assert.equal(Number(persisted[0]?.ActivityCount ?? 0), 3);
    assert.equal(Number(persisted[0]?.AuditedActivityCount ?? 0), 3);

    const historyRows = (await documentsDb.query(
      `SELECT COUNT(1) AS EventCount FROM dbo.DocumentHistory
       WHERE DocumentId = @0
         AND EventType IN ('VERSION_SUBMITTED_FOR_REVIEW', 'VERSION_APPROVED')`,
      [approvalDocumentId],
    )) as Array<{ EventCount: number | string }>;
    assert.equal(Number(historyRows[0]?.EventCount ?? 0), 2);

    console.log("✓ Autenticación real y rechazo 401 confirmados.");
    console.log("✓ Solicitud, asignaciones, comentario y listado confirmados.");
    console.log(
      "✓ Idempotencia exacta y conflicto por reutilización confirmados.",
    );
    console.log(
      "✓ Aprobación, inmutabilidad y cierre del atajo directo confirmados.",
    );
    console.log("✓ Correcciones, nueva versión y rechazo final confirmados.");
    console.log(
      "✓ Auditoría correlacionada verificada en Workflow y Documents.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (fullSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: fullSessionCookie },
        signal: AbortSignal.timeout(15000),
      }).catch(() => undefined);
    }

    if (documentIds.length > 0) {
      for (const documentId of documentIds) {
        await workflowDb.query(
          "DELETE FROM dbo.WorkflowReviewRequests WHERE DocumentId = @0",
          [documentId],
        );
        await documentsDb.query(
          "DELETE FROM dbo.RequirementDocuments WHERE Id = @0",
          [documentId],
        );
      }
    }

    for (const appliedTemplateId of appliedTemplateIds) {
      await documentsDb.query(
        `DELETE FROM dbo.AppliedDocumentTemplates
         WHERE Id = @0
           AND NOT EXISTS (
             SELECT 1 FROM dbo.RequirementDocuments WHERE AppliedTemplateId = @0
           )`,
        [appliedTemplateId],
      );
    }

    if (projectId) {
      await projectsDb.query(
        `DELETE FROM dbo.ProjectParticipants WHERE ProjectId = @0;
         DELETE FROM dbo.Projects WHERE Id = @0;`,
        [projectId],
      );
    }

    if (identityUserCreated) {
      await identityDb.transaction(async (manager) => {
        await manager.query(
          "DELETE FROM dbo.IdentityRefreshSessions WHERE UserId = @0",
          [identityUserId],
        );
        await manager.query(
          `DELETE FROM dbo.IdentitySecurityAudit
           WHERE ActorUserId = @0 OR TargetUserId = @0`,
          [identityUserId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentityUserRoles WHERE UserId = @0",
          [identityUserId],
        );
        await manager.query("DELETE FROM dbo.IdentityUsers WHERE Id = @0", [
          identityUserId,
        ]);
      });
    }

    await workflowDb.destroy();
    await documentsDb.destroy();
    await projectsDb.destroy();
    await identityDb.destroy();

    if (
      accessCookie ||
      identityUserCreated ||
      reviewIds.length > 0 ||
      documentIds.length > 0 ||
      projectId
    ) {
      console.log(
        "✓ Usuario, sesión, proyecto, documentos y revisiones temporales eliminados.",
      );
    }
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  console.error(`E2E autenticado de Workflow fallido: ${message}`);
  process.exitCode = 1;
});
