import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { BlobServiceClient } from "@azure/storage-blob";

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
  if (typeof value !== "string" || !value)
    throw new Error(`${name} no es texto.`);
  return value;
}

function integer(value: unknown, name: string): number {
  const resolved = Number(value);
  if (!Number.isInteger(resolved)) throw new Error(`${name} no es entero.`);
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

async function waitForExport(
  sessionCookie: string,
  id: string,
): Promise<Readonly<Record<string, unknown>>> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const detail = object(
      (await request(`/exports/${id}`, sessionCookie)).payload,
    );
    if (detail.status === "COMPLETED") return detail;
    if (detail.status === "FAILED") {
      throw new Error(string(detail.errorMessage, "export.errorMessage"));
    }
    await delay(300);
  }
  throw new Error("La exportación no terminó dentro del tiempo límite.");
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const identityUserId = randomUUID();
  const email = `operations-e2e-${suffix}@local.invalid`;
  const password = `OpE2e!${randomUUID()}9a`;
  const exportIds: string[] = [];
  const blobPaths: string[] = [];
  let projectId: string | null = null;
  let documentId: string | null = null;
  let appliedTemplateId: string | null = null;
  let reviewId: string | null = null;
  let fullSessionCookie: string | null = null;
  let identityCreated = false;
  let stage = "conectar bases";

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
  const operationsDb = await database(
    "operations-service",
    "RqOperationsDb",
    "apps/documents-service/.env",
  );

  try {
    stage = "crear usuario temporal";
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
        [
          identityUserId,
          email,
          email.toLowerCase(),
          "Operations E2E",
          hash,
          now,
        ],
      );
      await manager.query(
        "INSERT INTO dbo.IdentityUserRoles (UserId, RoleId, CreatedAt) VALUES (@0, @1, @2)",
        [identityUserId, roleId, now],
      );
    });
    identityCreated = true;

    stage = "autenticar por Gateway";
    const signIn = await fetch(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

    stage = "crear y aprobar documento temporal";
    const templates = object(
      (await request("/templates?page=1&pageSize=1&status=PUBLISHED", access))
        .payload,
    );
    if (!Array.isArray(templates.items) || templates.items.length !== 1) {
      throw new Error("No existe una plantilla publicada.");
    }
    const template = object(templates.items[0]);
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Proyecto Operations E2E ${suffix}`,
            requestingArea: "Pruebas automáticas",
            description: "Fixture temporal de exportación PDF y DOCX.",
            templateId: string(template.id, "template.id"),
          },
        })
      ).payload,
    );
    projectId = string(project.id, "project.id");
    const document = object(
      (
        await request(`/projects/${projectId}/documents`, access, {
          method: "POST",
          expected: 201,
          body: { title: `Documento Operations E2E ${suffix}` },
        })
      ).payload,
    );
    documentId = string(document.id, "document.id");
    const applied = (await documentsDb.query(
      "SELECT AppliedTemplateId FROM dbo.RequirementDocuments WHERE Id = @0",
      [documentId],
    )) as Array<{ AppliedTemplateId: string }>;
    appliedTemplateId = applied[0]?.AppliedTemplateId ?? null;
    const version = object(document.currentVersionDetail);
    const review = object(
      (
        await request(
          `/projects/${projectId}/documents/${documentId}/versions/1/reviews`,
          access,
          {
            method: "POST",
            expected: 201,
            idempotencyKey: `operations-e2e-review-${suffix}`,
            body: {
              expectedDocumentRevision: integer(
                version.revision,
                "version.revision",
              ),
              comment: "Documento temporal listo para exportación.",
            },
          },
        )
      ).payload,
    );
    reviewId = string(review.id, "review.id");
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
            idempotencyKey: `operations-e2e-approve-${suffix}`,
            body: {
              expectedReviewRevision: integer(
                review.revision,
                "review.revision",
              ),
              expectedDocumentRevision: integer(
                inReviewVersion.revision,
                "inReviewVersion.revision",
              ),
              comment: "Aprobación temporal para validar entregables.",
            },
          },
        )
      ).payload,
    );
    assert.equal(approved.status, "APPROVED");

    stage = "generar, consultar y descargar PDF y DOCX";
    await request(`/exports/${randomUUID()}/download`, null, { expected: 401 });
    for (const format of ["PDF", "DOCX"] as const) {
      const path = `/projects/${projectId}/documents/${documentId}/versions/1/exports`;
      const body = { format };
      const key = `operations-e2e-${format.toLowerCase()}-${suffix}`;
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
      const exportId = string(created.id, "export.id");
      exportIds.push(exportId);
      const replay = object(
        (
          await request(path, access, {
            method: "POST",
            expected: 201,
            idempotencyKey: key,
            body,
          })
        ).payload,
      );
      assert.equal(string(replay.id, "replay.id"), exportId);
      const completed = await waitForExport(access, exportId);
      assert.equal(completed.status, "COMPLETED");
      const artifact = object(completed.artifact);

      const download = await fetch(`${GATEWAY}/exports/${exportId}/download`, {
        headers: { cookie: access, "x-correlation-id": randomUUID() },
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
      if (format === "PDF") {
        assert.equal(buffer.subarray(0, 5).toString("ascii"), "%PDF-");
      } else {
        assert.equal(buffer.subarray(0, 2).toString("ascii"), "PK");
      }
    }

    const history = object(
      (
        await request(
          `/projects/${projectId}/documents/${documentId}/exports`,
          access,
        )
      ).payload,
    );
    assert.equal(history.totalItems, 2);
    console.log(
      "✓ Autenticación, aprobación y autorización por proyecto confirmadas.",
    );
    console.log("✓ PDF y DOCX generados, listados y descargados por Gateway.");
    console.log(
      "✓ Idempotencia, integridad SHA-256 y rechazo 401 confirmados.",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (fullSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: fullSessionCookie },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
    }

    if (exportIds.length > 0) {
      const paths = (await operationsDb.query(
        "SELECT StoragePath FROM dbo.ExportArtifacts WHERE ExportRequestId IN (SELECT value FROM OPENJSON(@0))",
        [JSON.stringify(exportIds)],
      )) as Array<{ StoragePath: string }>;
      blobPaths.push(...paths.map((row) => row.StoragePath));
      await operationsDb.query(
        "DELETE FROM dbo.AuditEvents WHERE ResourceId IN (SELECT value FROM OPENJSON(@0))",
        [JSON.stringify(exportIds)],
      );
      await operationsDb.query(
        "DELETE FROM dbo.ExportRequests WHERE Id IN (SELECT value FROM OPENJSON(@0))",
        [JSON.stringify(exportIds)],
      );
    }
    const connection = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
    if (connection && blobPaths.length > 0) {
      const container =
        BlobServiceClient.fromConnectionString(connection).getContainerClient(
          "rq-exports",
        );
      await Promise.all(
        blobPaths.map((path) => container.getBlobClient(path).deleteIfExists()),
      );
    }
    if (reviewId) {
      await workflowDb.query(
        "DELETE FROM dbo.WorkflowReviewRequests WHERE Id = @0",
        [reviewId],
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
          [identityUserId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentitySecurityAudit WHERE ActorUserId = @0 OR TargetUserId = @0",
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
    await operationsDb.destroy();
    await workflowDb.destroy();
    await documentsDb.destroy();
    await projectsDb.destroy();
    await identityDb.destroy();
    console.log("✓ Fixtures temporales y artefactos eliminados.");
  }
}

void main().catch((error: unknown) => {
  console.error(
    `E2E de exportaciones fallido: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
