import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { PasswordHasher } from "../apps/identity-service/src/auth/password-hasher";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "../libs/shared/persistence/src/index.js";
import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

loadEnvironmentFiles({
  paths: [
    ".env",
    "apps/identity-service/.env",
    "apps/projects-service/.env",
    "apps/sources-service/.env",
    "apps/documents-service/.env",
    "apps/ai-analysis-service/.env",
    "apps/gateway/.env",
  ],
});

const GATEWAY = "http://127.0.0.1:3000/api/v1";

function object(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "La API no devolvió un objeto JSON válido.",
    );
  }

  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} no es texto.`);
  }

  return value;
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

  if (!serialized) {
    throw new Error(`No se recibió la cookie ${name}.`);
  }

  return serialized.split(";", 1)[0] ?? "";
}

async function request(
  path: string,
  sessionCookie: string | null,
  options: {
    method?: string;
    body?: unknown;
    expected?: number;
    correlationId?: string;
  } = {},
): Promise<{
  response: Response;
  payload: unknown;
}> {
  const correlationId =
    options.correlationId ?? randomUUID();
  const response = await fetch(`${GATEWAY}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      "x-correlation-id": correlationId,
      ...(sessionCookie
        ? { cookie: sessionCookie }
        : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
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
      `${options.method ?? "GET"} ${path} respondió `
      + `${response.status}, esperado ${expected}: ${text}`,
    );
  }

  return { response, payload };
}

async function parseEnvironment(
  path: string,
): Promise<NodeJS.ProcessEnv> {
  const content = await readFile(path, "utf8");
  const result: NodeJS.ProcessEnv = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const rawValue = trimmed.slice(separator + 1).trim();
    const unquoted =
      rawValue.length >= 2 &&
      (
        (
          rawValue.startsWith('"') &&
          rawValue.endsWith('"')
        ) ||
        (
          rawValue.startsWith("'") &&
          rawValue.endsWith("'")
        )
      )
        ? rawValue.slice(1, -1)
        : rawValue;

    result[trimmed.slice(0, separator)] = unquoted;
  }

  return result;
}

async function database(
  serviceName: string,
  databaseName: string,
  environmentPath: string,
) {
  const environment = await parseEnvironment(environmentPath);
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
  const identityEmail =
    `ai-gateway-e2e-${suffix}@local.invalid`;
  const identityPassword =
    `AiE2e!${randomUUID()}9a`;

  let accessCookie: string | null = null;
  let fullSessionCookie: string | null = null;
  let identityUserCreated = false;
  let projectId: string | null = null;
  let sourceId: string | null = null;
  let documentId: string | null = null;
  let documentVersionId: string | null = null;
  let appliedTemplateId: string | null = null;
  let analysisRequestId: string | null = null;
  let stage = "crear usuario temporal de identidad";

  const identityDb = await database(
    "identity-service",
    "RqIdentityDb",
    "apps/identity-service/.env",
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

  try {
    const adminRoleRows = (
      await identityDb.query(
        `SELECT TOP 1 Id
         FROM dbo.IdentityRoles
         WHERE Code = N'ADMIN'
           AND IsActive = 1`,
      )
    ) as Array<{ Id: string }>;
    const adminRoleId = adminRoleRows[0]?.Id;

    if (!adminRoleId) {
      throw new Error(
        "No existe un rol ADMIN activo en RqIdentityDb.",
      );
    }

    const passwordHash =
      await new PasswordHasher().hash(identityPassword);
    const now = new Date();

    await identityDb.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO dbo.IdentityUsers (
           Id,
           Email,
           EmailNormalized,
           DisplayName,
           PasswordHash,
           IsActive,
           MustChangePassword,
           SessionVersion,
           LastLoginAt,
           CreatedAt,
           UpdatedAt
         )
         VALUES (
           @0, @1, @2, @3, @4,
           1, 0, 1, NULL, @5, @5
         )`,
        [
          identityUserId,
          identityEmail,
          identityEmail.toLowerCase(),
          "AI Gateway E2E",
          passwordHash,
          now,
        ],
      );

      await manager.query(
        `INSERT INTO dbo.IdentityUserRoles (
           UserId,
           RoleId,
           CreatedAt
         )
         VALUES (@0, @1, @2)`,
        [identityUserId, adminRoleId, now],
      );
    });

    identityUserCreated = true;

    stage = "validar rechazo sin sesión";
    await request(
      `/projects/${randomUUID()}/analysis-requests`,
      null,
      { expected: 401 },
    );

    stage = "iniciar sesión mediante el Gateway";
    const signInResponse = await fetch(
      `${GATEWAY}/auth/sign-in`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: identityEmail,
          password: identityPassword,
        }),
        signal: AbortSignal.timeout(30000),
      },
    );
    const signInText = await signInResponse.text();

    if (!signInResponse.ok) {
      throw new Error(
        `El inicio de sesión respondió `
        + `${signInResponse.status}: ${signInText}`,
      );
    }

    const access = cookie(signInResponse, "rq_access");
    const refresh = cookie(signInResponse, "rq_refresh");
    accessCookie = access;
    fullSessionCookie = `${access}; ${refresh}`;

    stage = "seleccionar plantilla publicada";
    const templates = object(
      (
        await request(
          "/templates?page=1&pageSize=1&status=PUBLISHED",
          access,
        )
      ).payload,
    );
    const templateItems = templates.items;

    if (
      !Array.isArray(templateItems) ||
      templateItems.length !== 1
    ) {
      throw new Error(
        "No existe una plantilla publicada para el E2E.",
      );
    }

    const template = object(templateItems[0]);

    stage = "crear proyecto temporal";
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Proyecto AI Gateway E2E ${suffix}`,
            requestingArea: "Pruebas automáticas",
            description:
              "Proyecto temporal del Paso 18.1E.",
            templateId: string(
              template.id,
              "template.id",
            ),
          },
        })
      ).payload,
    );
    projectId = string(project.id, "project.id");

    stage = "crear fuente READY";
    const source = object(
      (
        await request(
          `/projects/${projectId}/sources`,
          access,
          {
            method: "POST",
            expected: 201,
            body: {
              sourceType: "NOTE",
              title: `Fuente AI Gateway E2E ${suffix}`,
              content:
                "El sistema deberá generar una propuesta "
                + "trazable y revisable por una persona.",
            },
          },
        )
      ).payload,
    );
    sourceId = string(source.id, "source.id");

    if (
      source.processingStatus !== "READY" ||
      source.status !== "ACTIVE"
    ) {
      throw new Error(
        "La fuente textual no quedó ACTIVE y READY.",
      );
    }

    stage = "crear documento y versión actual";
    const document = object(
      (
        await request(
          `/projects/${projectId}/documents`,
          access,
          {
            method: "POST",
            expected: 201,
            body: {
              title:
                `Levantamiento AI Gateway E2E ${suffix}`,
            },
          },
        )
      ).payload,
    );
    documentId = string(document.id, "document.id");
    const version = object(
      document.currentVersionDetail,
    );
    documentVersionId = string(
      version.id,
      "document.currentVersionDetail.id",
    );

    const appliedRows = (
      await documentsDb.query(
        "SELECT AppliedTemplateId "
        + "FROM dbo.RequirementDocuments WHERE Id = @0",
        [documentId],
      )
    ) as Array<{ AppliedTemplateId: string }>;

    appliedTemplateId =
      appliedRows[0]?.AppliedTemplateId ?? null;

    stage = "crear solicitud mediante Gateway";
    const correlationId = randomUUID();
    const created = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests`,
          access,
          {
            method: "POST",
            expected: 201,
            correlationId,
            body: {
              analysisType: "REQUIREMENT_DOCUMENT",
              documentId,
              documentVersionId,
              sourceIds: [sourceId],
            },
          },
        )
      ).payload,
    );
    analysisRequestId = string(
      created.id,
      "analysisRequest.id",
    );

    assert.equal(created.status, "PENDING");
    assert.equal(created.sourceCount, 1);
    assert.equal(created.executionCount, 0);

    const createdSources = created.sources;

    if (
      !Array.isArray(createdSources) ||
      createdSources.length !== 1
    ) {
      throw new Error(
        "La solicitud no devolvió un snapshot de fuente.",
      );
    }

    const snapshot = object(createdSources[0]);

    if (!sameUuid(snapshot.sourceId, sourceId)) {
      throw new Error(
        "El snapshot no corresponde a la fuente creada.",
      );
    }

    if (typeof snapshot.sourceUpdatedAt !== "string") {
      throw new Error(
        "El snapshot no conservó SourceUpdatedAt.",
      );
    }

    stage = "listar solicitud por Gateway";
    const listed = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests`
          + "?status=PENDING&page=1&pageSize=10",
          access,
        )
      ).payload,
    );

    if (
      !Array.isArray(listed.items) ||
      !listed.items.some(
        (item) =>
          item &&
          typeof item === "object" &&
          sameUuid(
            (
              item as Readonly<
                Record<string, unknown>
              >
            ).id,
            analysisRequestId,
          ),
      )
    ) {
      throw new Error(
        "La solicitud no apareció en el listado.",
      );
    }

    stage = "consultar detalle por Gateway";
    const detail = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests/`
          + analysisRequestId,
          access,
        )
      ).payload,
    );

    if (
      !sameUuid(detail.documentId, documentId) ||
      !sameUuid(
        detail.documentVersionId,
        documentVersionId,
      )
    ) {
      throw new Error(
        "El detalle no conserva documento y versión.",
      );
    }

    stage = "cancelar solicitud por Gateway";
    const cancelled = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests/`
          + `${analysisRequestId}/cancel`,
          access,
          { method: "POST" },
        )
      ).payload,
    );

    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(
      typeof cancelled.cancelledAt,
      "string",
    );

    const idempotent = object(
      (
        await request(
          `/projects/${projectId}/analysis-requests/`
          + `${analysisRequestId}/cancel`,
          access,
          { method: "POST" },
        )
      ).payload,
    );

    assert.equal(idempotent.status, "CANCELLED");

    const rows = (
      await aiDb.query(
        `SELECT
           ar.Status,
           (SELECT COUNT(1)
            FROM dbo.AnalysisRequestSources ars
            WHERE ars.AnalysisRequestId = ar.Id)
             AS SourceCount,
           (SELECT COUNT(1)
            FROM dbo.AnalysisExecutions ae
            WHERE ae.AnalysisRequestId = ar.Id)
             AS ExecutionCount
         FROM dbo.AnalysisRequests ar
         WHERE ar.Id = @0`,
        [analysisRequestId],
      )
    ) as Array<{
      Status: string;
      SourceCount: number | string;
      ExecutionCount: number | string;
    }>;

    assert.equal(rows[0]?.Status, "CANCELLED");
    assert.equal(Number(rows[0]?.SourceCount ?? 0), 1);
    assert.equal(
      Number(rows[0]?.ExecutionCount ?? 0),
      0,
    );

    console.log(
      "✓ Usuario ADMIN temporal creado sin credenciales manuales.",
    );
    console.log(
      "✓ Sesión real iniciada mediante Gateway.",
    );
    console.log(
      "✓ Proyecto, fuente READY y documento creados.",
    );
    console.log(
      "✓ Solicitud PENDING creada mediante cookie HttpOnly.",
    );
    console.log(
      "✓ Listado, detalle y cancelación verificados.",
    );
    console.log(
      "✓ Snapshot persistido y cero ejecuciones confirmadas.",
    );
    console.log(
      "✓ Solicitud sin sesión rechazada con HTTP 401.",
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (fullSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: fullSessionCookie },
        signal: AbortSignal.timeout(15000),
      }).catch(() => undefined);
    }

    if (analysisRequestId) {
      await aiDb.query(
        "DELETE FROM dbo.AnalysisExecutions "
        + "WHERE AnalysisRequestId = @0; "
        + "DELETE FROM dbo.AnalysisRequestSources "
        + "WHERE AnalysisRequestId = @0; "
        + "DELETE FROM dbo.AnalysisRequests "
        + "WHERE Id = @0;",
        [analysisRequestId],
      );
    }

    if (documentId) {
      await documentsDb.query(
        "DELETE FROM dbo.RequirementDocuments "
        + "WHERE Id = @0",
        [documentId],
      );
    }

    if (appliedTemplateId) {
      await documentsDb.query(
        "DELETE FROM dbo.AppliedDocumentTemplates "
        + "WHERE Id = @0",
        [appliedTemplateId],
      );
    }

    if (sourceId) {
      const sourcesDb = await database(
        "sources-service",
        "RqSourcesDb",
        "apps/sources-service/.env",
      );

      try {
        await sourcesDb.query(
          "DELETE FROM dbo.Sources WHERE Id = @0",
          [sourceId],
        );
      } finally {
        await sourcesDb.destroy();
      }
    }

    if (projectId) {
      const projectsDb = await database(
        "projects-service",
        "RqProjectsDb",
        "apps/projects-service/.env",
      );

      try {
        await projectsDb.query(
          "DELETE FROM dbo.ProjectParticipants "
          + "WHERE ProjectId = @0; "
          + "DELETE FROM dbo.Projects WHERE Id = @0;",
          [projectId],
        );
      } finally {
        await projectsDb.destroy();
      }
    }

    if (identityUserCreated) {
      await identityDb.transaction(async (manager) => {
        await manager.query(
          "DELETE FROM dbo.IdentityRefreshSessions "
          + "WHERE UserId = @0",
          [identityUserId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentitySecurityAudit "
          + "WHERE ActorUserId = @0 "
          + "OR TargetUserId = @0",
          [identityUserId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentityUserRoles "
          + "WHERE UserId = @0",
          [identityUserId],
        );
        await manager.query(
          "DELETE FROM dbo.IdentityUsers "
          + "WHERE Id = @0",
          [identityUserId],
        );
      });
    }

    await aiDb.destroy();
    await documentsDb.destroy();
    await identityDb.destroy();

    if (
      accessCookie ||
      identityUserCreated ||
      analysisRequestId ||
      documentId ||
      sourceId ||
      projectId
    ) {
      console.log(
        "✓ Usuario, sesión y registros temporales eliminados.",
      );
    }
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.stack ?? error.message
      : String(error);

  console.error(
    `E2E autenticado de AI Analysis fallido: ${message}`,
  );
  process.exitCode = 1;
});
