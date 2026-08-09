import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import amqp from "amqplib";

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

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${name} no es texto.`);
  }
  return value;
}

function sessionCookie(response: Response, name: string): string {
  const value = response.headers
    .getSetCookie()
    .find((item) => item.startsWith(`${name}=`));
  if (!value) throw new Error(`No se recibió la cookie ${name}.`);
  return value.split(";", 1)[0] ?? "";
}

async function request(
  path: string,
  cookie: string | null,
  options: { method?: string; body?: unknown; expected?: number } = {},
) {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      "x-correlation-id": randomUUID(),
      ...(cookie ? { cookie } : {}),
      ...(options.body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await response.text();
  const payload = raw ? (JSON.parse(raw) as unknown) : null;
  const expected = options.expected ?? 200;
  if (response.status !== expected) {
    throw new Error(
      `${options.method ?? "GET"} ${path} respondió ${response.status}, esperado ${expected}: ${raw}`,
    );
  }
  return { response, payload };
}

async function environment(path: string): Promise<NodeJS.ProcessEnv> {
  const content = await readFile(path, "utf8");
  const result: NodeJS.ProcessEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const current = line.trim();
    if (!current || current.startsWith("#")) continue;
    const separator = current.indexOf("=");
    if (separator < 1) continue;
    const raw = current.slice(separator + 1).trim();
    result[current.slice(0, separator)] =
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
  const variables = await environment(environmentPath);
  variables.DATABASE_ENABLED = "true";
  variables.DB_NAME = databaseName;
  const config = loadSqlServerDatabaseConfig(
    { serviceName, defaultDatabaseName: databaseName },
    variables,
  );
  const source = createSqlServerDataSource(config, {
    entities: [],
    migrations: [],
  });
  await source.initialize();
  return source;
}

function rabbitUrl(): string {
  const user = process.env.RABBITMQ_DEFAULT_USER?.trim();
  const password = process.env.RABBITMQ_DEFAULT_PASS?.trim();
  const port = process.env.RQ_RABBITMQ_AMQP_PORT?.trim() || "5673";
  if (!user || !password) {
    throw new Error("Falta la configuración local de RabbitMQ.");
  }
  return `amqp://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}`;
}

async function waitForNotification(cookie: string, resourceId: string) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const payload = object(
      (await request("/notifications?state=UNREAD&page=1&pageSize=20", cookie))
        .payload,
    );
    const items = Array.isArray(payload.items) ? payload.items : [];
    const found = items
      .map((item) => object(item))
      .find((item) => item.resourceId === resourceId);
    if (found) return { found, payload };
    await delay(200);
  }
  throw new Error("La notificación no fue entregada dentro del tiempo límite.");
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const userId = randomUUID();
  const eventId = randomUUID();
  const analysisRequestId = randomUUID();
  const executionId = randomUUID();
  const email = `notifications-e2e-${suffix}@local.invalid`;
  const password = `NoE2e!${randomUUID()}9a`;
  let projectId: string | null = null;
  let fullCookie: string | null = null;
  let userCreated = false;
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
  const operationsDb = await database(
    "operations-service",
    "RqOperationsDb",
    "apps/documents-service/.env",
  );
  const connection = await amqp.connect(rabbitUrl());
  const channel = await connection.createConfirmChannel();

  try {
    stage = "crear usuario temporal";
    const roles = (await identityDb.query(
      "SELECT TOP 1 Id FROM dbo.IdentityRoles WHERE Code = N'ADMIN' AND IsActive = 1",
    )) as Array<{ Id: string }>;
    const roleId = roles[0]?.Id;
    if (!roleId) throw new Error("No existe un rol ADMIN activo.");
    const now = new Date();
    const hash = await new PasswordHasher().hash(password);
    await identityDb.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO dbo.IdentityUsers (
          Id, Email, EmailNormalized, DisplayName, PasswordHash,
          IsActive, MustChangePassword, SessionVersion, LastLoginAt,
          CreatedAt, UpdatedAt
        ) VALUES (@0, @1, @2, @3, @4, 1, 0, 1, NULL, @5, @5)`,
        [userId, email, email, "Notifications E2E", hash, now],
      );
      await manager.query(
        "INSERT INTO dbo.IdentityUserRoles (UserId, RoleId, CreatedAt) VALUES (@0, @1, @2)",
        [userId, roleId, now],
      );
    });
    userCreated = true;

    stage = "autenticar y crear proyecto";
    const signIn = await fetch(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!signIn.ok) {
      throw new Error(`Inicio de sesión rechazado con ${signIn.status}.`);
    }
    const access = sessionCookie(signIn, "rq_access");
    const refresh = sessionCookie(signIn, "rq_refresh");
    fullCookie = `${access}; ${refresh}`;
    const templates = object(
      (await request("/templates?page=1&pageSize=1&status=PUBLISHED", access))
        .payload,
    );
    if (!Array.isArray(templates.items) || templates.items.length === 0) {
      throw new Error("No existe una plantilla publicada.");
    }
    const template = object(templates.items[0]);
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Notificaciones E2E ${suffix}`,
            requestingArea: "Pruebas automáticas",
            templateId: text(template.id, "template.id"),
          },
        })
      ).payload,
    );
    projectId = text(project.id, "project.id");

    stage = "publicar evento duplicado";
    const envelope = {
      eventId,
      eventName: "analysis.failed",
      eventVersion: 1,
      occurredAtUtc: new Date().toISOString(),
      producer: "ai-analysis-service",
      correlationId: randomUUID(),
      data: {
        projectId,
        analysisRequestId,
        executionId,
        requestedByUserId: userId,
        errorCode: "E2E_EXPECTED_FAILURE",
      },
    };
    const content = Buffer.from(JSON.stringify(envelope));
    for (let index = 0; index < 3; index += 1) {
      channel.publish("rq.integration.v1", "analysis.failed", content, {
        persistent: true,
        contentType: "application/json",
        messageId: eventId,
        correlationId: envelope.correlationId,
      });
    }
    await channel.waitForConfirms();

    stage = "consultar y leer notificación";
    const { found, payload } = await waitForNotification(
      access,
      analysisRequestId,
    );
    assert.equal(found.notificationType, "ANALYSIS_FAILED");
    assert.equal(found.status, "DELIVERED");
    assert.equal(payload.unreadItems, 1);
    const notificationId = text(found.id, "notification.id");
    const audit = object(
      (
        await request(
          `/projects/${projectId}/audit-events?action=ANALYSIS_FAILED&page=1&pageSize=20`,
          access,
        )
      ).payload,
    );
    assert.equal(audit.totalItems, 1);
    const marked = object(
      (
        await request(`/notifications/${notificationId}/read`, access, {
          method: "POST",
        })
      ).payload,
    );
    assert.equal(marked.status, "READ");
    const replay = object(
      (
        await request(`/notifications/${notificationId}/read`, access, {
          method: "POST",
        })
      ).payload,
    );
    assert.equal(replay.status, "READ");
    const unread = object(
      (await request("/notifications?state=UNREAD", access)).payload,
    );
    assert.equal(unread.unreadItems, 0);
    await request("/notifications", null, { expected: 401 });

    stage = "renderizar vistas del Workspace";
    for (const [path, expectedText] of [
      ["/workspace/notifications", "Bandeja personal"],
      ["/workspace/audit", "Trazabilidad operacional"],
    ] as const) {
      const page = await fetch(`http://127.0.0.1:4200${path}`, {
        headers: { cookie: access },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      });
      const html = await page.text();
      assert.equal(page.status, 200);
      assert.match(html, new RegExp(expectedText));
    }

    const counts = (await operationsDb.query(
      `SELECT
        (SELECT COUNT(*) FROM dbo.IntegrationEventInbox WHERE EventId = @0 AND Status = N'PROCESSED') InboxCount,
        (SELECT COUNT(*) FROM dbo.NotificationRequests WHERE ProjectId = @1 AND ResourceId = @2) NotificationCount,
        (SELECT COUNT(*) FROM dbo.AuditEvents WHERE ProjectId = @1 AND Action = N'ANALYSIS_FAILED') AuditCount`,
      [eventId, projectId, analysisRequestId],
    )) as Array<{
      InboxCount: number;
      NotificationCount: number;
      AuditCount: number;
    }>;
    assert.deepEqual(counts[0], {
      InboxCount: 1,
      NotificationCount: 1,
      AuditCount: 1,
    });
    console.log(
      "✓ RabbitMQ entregó el evento y el inbox lo procesó una sola vez.",
    );
    console.log(
      "✓ Notificación propia, auditoría y marcado idempotente validados.",
    );
    console.log(
      "✓ Duplicados concurrentes y acceso sin sesión fueron rechazados.",
    );
    console.log("✓ Bandeja y auditoría se renderizaron con sesión real.");
  } catch (error) {
    throw new Error(
      `Etapa fallida: ${stage}. ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (fullCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: fullCookie },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => undefined);
    }
    await operationsDb.query(
      `DELETE FROM dbo.NotificationDeliveries
       WHERE NotificationRequestId IN (SELECT Id FROM dbo.NotificationRequests WHERE ProjectId = @0);
       DELETE FROM dbo.NotificationRequests WHERE ProjectId = @0;
       DELETE FROM dbo.AuditEvents WHERE ProjectId = @0;
       DELETE FROM dbo.IntegrationEventInbox WHERE EventId = @1;`,
      [projectId ?? randomUUID(), eventId],
    );
    if (projectId) {
      await projectsDb.query(
        `DELETE FROM dbo.ProjectParticipants WHERE ProjectId = @0;
         DELETE FROM dbo.Projects WHERE Id = @0;`,
        [projectId],
      );
    }
    if (userCreated) {
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
    await channel.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
    await operationsDb.destroy();
    await projectsDb.destroy();
    await identityDb.destroy();
    console.log("✓ Fixtures temporales eliminados.");
  }
}

void main().catch((error: unknown) => {
  console.error(
    `E2E de notificaciones fallido: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  );
  process.exitCode = 1;
});
