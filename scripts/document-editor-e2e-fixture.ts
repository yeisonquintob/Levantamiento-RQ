import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import documentsDataSource from "../apps/documents-service/src/database/data-source";
import {
  createSqlServerDataSource,
  loadSqlServerDatabaseConfig,
} from "../libs/shared/persistence/src/index.js";

const GATEWAY = "http://127.0.0.1:3000/api/v1";
const DOCUMENT_TITLE_PREFIX = "Documento editor E2E";
const PROJECT_TITLE_PREFIX = "Proyecto editor E2E";

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} no está configurado.`);
  return value;
}

function asObject(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La API no devolvió un objeto JSON válido.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${name} no es texto.`);
  return value;
}

function responseCookie(response: Response, name: string): string {
  const serialized = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`));
  if (!serialized) throw new Error(`No se recibió la cookie ${name}.`);
  return serialized.split(";", 1)[0] ?? "";
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

async function projectDatabase() {
  const environment = await parseEnvironment("apps/projects-service/.env");
  const config = loadSqlServerDatabaseConfig(
    { serviceName: "projects-service", defaultDatabaseName: "RqProjectsDb" },
    environment,
  );
  return createSqlServerDataSource(config, { entities: [], migrations: [] });
}

async function cleanup(): Promise<void> {
  await documentsDataSource.initialize();
  try {
    const appliedTemplates = (await documentsDataSource.query(
      `SELECT AppliedTemplateId
       FROM dbo.RequirementDocuments
       WHERE Title LIKE @0`,
      [`${DOCUMENT_TITLE_PREFIX}%`],
    )) as Array<{ AppliedTemplateId: string }>;
    await documentsDataSource.query(
      "DELETE FROM dbo.RequirementDocuments WHERE Title LIKE @0",
      [`${DOCUMENT_TITLE_PREFIX}%`],
    );
    for (const row of appliedTemplates) {
      await documentsDataSource.query(
        `DELETE FROM dbo.AppliedDocumentTemplates
         WHERE Id = @0
           AND NOT EXISTS (
             SELECT 1 FROM dbo.RequirementDocuments WHERE AppliedTemplateId = @0
           )`,
        [row.AppliedTemplateId],
      );
    }
  } finally {
    await documentsDataSource.destroy();
  }

  const projects = await projectDatabase();
  await projects.initialize();
  try {
    await projects.transaction(async (manager) => {
      await manager.query(
        `DELETE FROM dbo.ProjectParticipants
         WHERE ProjectId IN (
           SELECT Id FROM dbo.Projects WHERE Title LIKE @0
         )`,
        [`${PROJECT_TITLE_PREFIX}%`],
      );
      await manager.query("DELETE FROM dbo.Projects WHERE Title LIKE @0", [
        `${PROJECT_TITLE_PREFIX}%`,
      ]);
    });
  } finally {
    await projects.destroy();
  }
}

async function prepare(runLabel: string): Promise<void> {
  const email = requiredEnvironment("DOCUMENT_EDITOR_E2E_EMAIL");
  const password = requiredEnvironment("DOCUMENT_EDITOR_E2E_PASSWORD");
  const signIn = await fetch(`${GATEWAY}/auth/sign-in`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(20000),
  });
  const signInBody = await signIn.text();
  if (!signIn.ok) {
    throw new Error(`El inicio de sesión respondió ${signIn.status}: ${signInBody}`);
  }

  const access = responseCookie(signIn, "rq_access");
  const refresh = responseCookie(signIn, "rq_refresh");
  try {
    const templatesResponse = await fetch(
      `${GATEWAY}/templates?page=1&pageSize=1&status=PUBLISHED`,
      {
        headers: { accept: "application/json", cookie: access },
        signal: AbortSignal.timeout(20000),
      },
    );
    const templatesBody = await templatesResponse.text();
    if (!templatesResponse.ok) {
      throw new Error(
        `La consulta de plantillas respondió ${templatesResponse.status}: ${templatesBody}`,
      );
    }
    const templates = asObject(JSON.parse(templatesBody) as unknown);
    if (!Array.isArray(templates.items) || templates.items.length !== 1) {
      throw new Error("No existe una plantilla publicada para el E2E.");
    }
    const template = asObject(templates.items[0]);
    const projectTitle = `${PROJECT_TITLE_PREFIX} ${runLabel}`;
    const projectResponse = await fetch(`${GATEWAY}/projects`, {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: access,
        "content-type": "application/json",
        "x-correlation-id": randomUUID(),
      },
      body: JSON.stringify({
        title: projectTitle,
        requestingArea: "Pruebas E2E",
        description: "Proyecto temporal para validar el editor del punto 17.",
        templateId: asString(template.id, "template.id"),
      }),
      signal: AbortSignal.timeout(20000),
    });
    const projectBody = await projectResponse.text();
    if (projectResponse.status !== 201) {
      throw new Error(
        `La creación del proyecto respondió ${projectResponse.status}: ${projectBody}`,
      );
    }
    console.log(`✓ Proyecto temporal preparado: ${projectTitle}`);
  } finally {
    await fetch(`${GATEWAY}/auth/sign-out`, {
      method: "POST",
      headers: { cookie: `${access}; ${refresh}` },
      signal: AbortSignal.timeout(15000),
    }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (action !== "prepare" && action !== "cleanup") {
    throw new Error("Uso: document-editor-e2e-fixture.ts <prepare|cleanup> [corrida]");
  }
  await cleanup();
  if (action === "prepare") await prepare(process.argv[3]?.trim() || "1");
  else console.log("✓ Fixtures temporales del editor eliminados.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fixture E2E del editor fallida: ${message}`);
  process.exitCode = 1;
});
