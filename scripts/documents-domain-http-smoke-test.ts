import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import dataSource from "../apps/documents-service/src/database/data-source";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "../libs/shared/persistence/src/index.js";

const GATEWAY = "http://127.0.0.1:3000/api/v1";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurado.`);
  return value;
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La API no devolvió un objeto JSON válido.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function number(value: unknown, name: string): number {
  if (typeof value !== "number") throw new Error(`${name} no es numérico.`);
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} no es texto.`);
  return value;
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
  sessionCookie: string,
  options: { method?: string; body?: unknown; expected?: number } = {},
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(`${GATEWAY}${path}`, {
    method: options.method ?? "GET",
    headers: {
      accept: "application/json",
      cookie: sessionCookie,
      "x-correlation-id": randomUUID(),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
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
    const rawValue = trimmed.slice(separator + 1).trim();
    const unquoted =
      rawValue.length >= 2 &&
      ((rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'")))
        ? rawValue.slice(1, -1)
        : rawValue;
    result[trimmed.slice(0, separator)] = unquoted;
  }
  return result;
}

async function cleanupExternalDatabase(
  serviceName: string,
  databaseName: string,
  environmentPath: string,
  statements: readonly { sql: string; parameters: readonly string[] }[],
): Promise<void> {
  const environment = await parseEnvironment(environmentPath);
  const config = loadSqlServerDatabaseConfig(
    { serviceName, defaultDatabaseName: databaseName },
    environment,
  );
  const cleanup = createSqlServerDataSource(config, { entities: [], migrations: [] });
  await cleanup.initialize();
  try {
    await cleanup.transaction(async (manager) => {
      for (const statement of statements) {
        await manager.query(statement.sql, [...statement.parameters]);
      }
    });
  } finally {
    await cleanup.destroy();
  }
}

async function main(): Promise<void> {
  const email = requiredEnvironment("DOCUMENTS_SMOKE_ADMIN_EMAIL");
  const password = requiredEnvironment("DOCUMENTS_SMOKE_ADMIN_PASSWORD");
  const suffix = randomUUID().slice(0, 8);
  let sessionCookie: string | null = null;
  let fullSessionCookie: string | null = null;
  let projectId: string | null = null;
  let sourceId: string | null = null;
  let documentId: string | null = null;
  let appliedTemplateId: string | null = null;
  let stage = "iniciar sesión";

  await dataSource.initialize();

  try {
    await cleanupExternalDatabase(
      "sources-service",
      "RqSourcesDb",
      "apps/sources-service/.env",
      [
        {
          sql: "DELETE FROM dbo.Sources WHERE Title LIKE N'Evidencia documental %'",
          parameters: [],
        },
      ],
    );
    await cleanupExternalDatabase(
      "projects-service",
      "RqProjectsDb",
      "apps/projects-service/.env",
      [
        {
          sql: `DELETE FROM dbo.ProjectParticipants
                WHERE ProjectId IN (
                  SELECT Id FROM dbo.Projects
                  WHERE Title LIKE N'Proyecto documental smoke %'
                )`,
          parameters: [],
        },
        {
          sql: "DELETE FROM dbo.Projects WHERE Title LIKE N'Proyecto documental smoke %'",
          parameters: [],
        },
      ],
    );

    const signInResponse = await fetch(`${GATEWAY}/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20000),
    });
    const signInText = await signInResponse.text();
    if (!signInResponse.ok) {
      throw new Error(`El inicio de sesión respondió ${signInResponse.status}: ${signInText}`);
    }
    const access = cookie(signInResponse, "rq_access");
    const refresh = cookie(signInResponse, "rq_refresh");
    sessionCookie = access;
    fullSessionCookie = `${access}; ${refresh}`;

    stage = "seleccionar una plantilla publicada";
    const templates = object(
      (await request("/templates?page=1&pageSize=1&status=PUBLISHED", access)).payload,
    );
    const templateItems = templates.items;
    if (!Array.isArray(templateItems) || templateItems.length !== 1) {
      throw new Error("No existe una plantilla publicada para el smoke.");
    }
    const template = object(templateItems[0]);

    stage = "crear el proyecto temporal";
    const project = object(
      (
        await request("/projects", access, {
          method: "POST",
          expected: 201,
          body: {
            title: `Proyecto documental smoke ${suffix}`,
            requestingArea: "Pruebas automáticas",
            description: "Proyecto temporal del punto 16.",
            templateId: string(template.id, "template.id"),
          },
        })
      ).payload,
    );
    projectId = string(project.id, "project.id");

    stage = "crear una fuente de evidencia temporal";
    const source = object(
      (
        await request(`/projects/${projectId}/sources`, access, {
          method: "POST",
          expected: 201,
          body: {
            sourceType: "NOTE",
            title: `Evidencia documental ${suffix}`,
            content: "El sistema deberá conservar el código de la solicitud.",
          },
        })
      ).payload,
    );
    sourceId = string(source.id, "source.id");

    stage = "crear el documento";
    let detail = object(
      (
        await request(`/projects/${projectId}/documents`, access, {
          method: "POST",
          expected: 201,
          body: { title: `Levantamiento smoke ${suffix}` },
        })
      ).payload,
    );
    documentId = string(detail.id, "document.id");
    const templateRows = (await dataSource.query(
      "SELECT AppliedTemplateId FROM dbo.RequirementDocuments WHERE Id = @0",
      [documentId],
    )) as Array<{ AppliedTemplateId: string }>;
    appliedTemplateId = templateRows[0]?.AppliedTemplateId ?? null;
    let version = object(detail.currentVersionDetail);
    const sections = version.sections;
    if (!Array.isArray(sections) || sections.length !== 13) {
      throw new Error("La versión inicial no contiene exactamente 13 secciones.");
    }

    stage = "actualizar una sección y rechazar una revisión obsoleta";
    let response = await request(
      `/documents/${documentId}/versions/1/sections/objectives`,
      access,
      {
        method: "PATCH",
        body: {
          expectedRevision: number(version.revision, "version.revision"),
          content: {
            general: "Optimizar el registro verificable de solicitudes.",
            specific: ["Conservar la trazabilidad de cada solicitud."],
          },
        },
      },
    );
    version = object(response.payload);
    await request(
      `/documents/${documentId}/versions/1/sections/scope`,
      access,
      {
        method: "PATCH",
        expected: 409,
        body: {
          expectedRevision: 1,
          content: { included: ["Registro"], excluded: ["ERP"], involvedSystems: ["Portal"] },
        },
      },
    );

    stage = "guardar campos, requisito, criterio y SourceId";
    response = await request(`/documents/${documentId}/versions/1/fields`, access, {
      method: "PATCH",
      body: {
        expectedRevision: number(version.revision, "version.revision"),
        fields: [
          {
            sectionKey: "scope",
            key: "includedScope",
            label: "Incluye",
            valueType: "LIST",
            value: ["Registro de solicitudes"],
            order: 1,
          },
        ],
        requirements: [
          {
            clientId: "rf-1",
            sectionKey: "milestones",
            code: "RF-001",
            title: "Registrar solicitud",
            description: "El sistema deberá registrar una solicitud.",
            requirementType: "FUNCTIONAL",
            status: "DEFINED",
            order: 1,
            acceptanceCriteria: [
              { description: "La solicitud conserva un código único.", order: 1 },
            ],
          },
        ],
        evidence: [
          {
            sourceId,
            sectionKey: "milestones",
            requirementClientId: "rf-1",
            excerpt: "El sistema deberá conservar el código.",
          },
        ],
      },
    });
    version = object(response.payload);
    if (
      !Array.isArray(version.requirements) ||
      version.requirements.length !== 1 ||
      !Array.isArray(version.evidence) ||
      version.evidence.length !== 1
    ) {
      throw new Error("El contenido estructurado no fue persistido.");
    }

    stage = "consultar listado, plantilla e historial";
    const list = object((await request(`/projects/${projectId}/documents`, access)).payload);
    if (!Array.isArray(list.items) || list.items.length !== 1) {
      throw new Error("El documento no aparece en el listado del proyecto.");
    }
    await request(`/documents/${documentId}/template`, access);
    const historyBeforeApproval = (
      await request(`/documents/${documentId}/history`, access)
    ).payload;
    if (!Array.isArray(historyBeforeApproval) || historyBeforeApproval.length < 3) {
      throw new Error("El historial no contiene las ediciones realizadas.");
    }

    stage = "enviar, aprobar y bloquear la versión";
    response = await request(
      `/documents/${documentId}/versions/1/submit-review`,
      access,
      {
        method: "POST",
        body: { expectedRevision: number(version.revision, "version.revision") },
      },
    );
    version = object(response.payload);
    response = await request(`/documents/${documentId}/versions/1/approve`, access, {
      method: "POST",
      body: {
        expectedRevision: number(version.revision, "version.revision"),
        comment: "Aprobación automática del smoke.",
      },
    });
    version = object(response.payload);
    if (version.status !== "APPROVED") throw new Error("La versión no quedó aprobada.");
    await request(
      `/documents/${documentId}/versions/1/sections/objectives`,
      access,
      {
        method: "PATCH",
        expected: 409,
        body: {
          expectedRevision: number(version.revision, "version.revision"),
          content: { general: "No debe guardarse", specific: ["No debe guardarse"] },
        },
      },
    );

    stage = "crear una versión posterior al aprobado";
    detail = object((await request(`/documents/${documentId}`, access)).payload);
    detail = object(
      (
        await request(`/documents/${documentId}/versions`, access, {
          method: "POST",
          expected: 201,
          body: {
            expectedRevision: number(detail.revision, "document.revision"),
            changeSummary: "Nueva versión posterior a la aprobación.",
          },
        })
      ).payload,
    );
    version = object(detail.currentVersionDetail);
    if (
      version.versionNumber !== 2 ||
      version.status !== "DRAFT" ||
      !Array.isArray(version.sections) ||
      version.sections.length !== 13
    ) {
      throw new Error("La nueva versión no clonó correctamente las 13 secciones.");
    }

    console.log("✓ Documento creado con exactamente 13 secciones canónicas.");
    console.log("✓ Sección, campos, requisito, criterio, evidencia e historial verificados.");
    console.log("✓ Revisión obsoleta rechazada y versión aprobada inmutable.");
    console.log("✓ Nueva versión borrador creada desde la versión aprobada.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (documentId) {
      await dataSource.query("DELETE FROM dbo.RequirementDocuments WHERE Id = @0", [
        documentId,
      ]);
    }
    if (appliedTemplateId) {
      await dataSource.query("DELETE FROM dbo.AppliedDocumentTemplates WHERE Id = @0", [
        appliedTemplateId,
      ]);
    }
    await dataSource.destroy();

    if (sourceId) {
      await cleanupExternalDatabase(
        "sources-service",
        "RqSourcesDb",
        "apps/sources-service/.env",
        [{ sql: "DELETE FROM dbo.Sources WHERE Id = @0", parameters: [sourceId] }],
      );
    }
    if (projectId) {
      await cleanupExternalDatabase(
        "projects-service",
        "RqProjectsDb",
        "apps/projects-service/.env",
        [
          {
            sql: "DELETE FROM dbo.ProjectParticipants WHERE ProjectId = @0",
            parameters: [projectId],
          },
          { sql: "DELETE FROM dbo.Projects WHERE Id = @0", parameters: [projectId] },
        ],
      );
    }
    if (fullSessionCookie) {
      await fetch(`${GATEWAY}/auth/sign-out`, {
        method: "POST",
        headers: { cookie: fullSessionCookie },
        signal: AbortSignal.timeout(15000),
      }).catch(() => undefined);
    }
    if (sessionCookie && (documentId || projectId || sourceId)) {
      console.log("✓ Registros temporales y sesión del smoke eliminados.");
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Smoke HTTP del dominio documental fallido: ${message}`);
  process.exitCode = 1;
});
