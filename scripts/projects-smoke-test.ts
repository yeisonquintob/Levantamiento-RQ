import { createHmac, randomUUID } from "node:crypto";

import dataSource from "../apps/projects-service/src/database/data-source";
import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

loadEnvironmentFiles({
  paths: [
    ".env",
    "apps/projects-service/.env",
    "apps/documents-service/.env",
  ],
});

function requiredSecret(value: string | undefined, name: string): string {
  const resolved = value?.trim() ?? "";

  if (resolved.length < 32) {
    throw new Error(`${name} no está configurado.`);
  }

  return resolved;
}

function encodeBase64Url(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

function sameUuid(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    normalizeUuid(left) === normalizeUuid(right)
  );
}

function matchesTemplateReference(
  value: unknown,
  template: Readonly<Record<string, unknown>>,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const reference = value as Readonly<Record<string, unknown>>;

  return (
    sameUuid(reference.id, template.id) &&
    reference.version === template.version
  );
}

function createAccessToken(): { token: string; userId: string } {
  const secret = requiredSecret(
    process.env.JWT_ACCESS_SECRET,
    "JWT_ACCESS_SECRET",
  );
  const issuer = process.env.JWT_ISSUER?.trim() || "levantamiento-rq-identity";
  const audience = process.env.JWT_AUDIENCE?.trim() || "levantamiento-rq";
  const now = Math.floor(Date.now() / 1000);
  const userId = randomUUID();

  const header = encodeBase64Url({
    alg: "HS256",
    typ: "JWT",
  });

  const payload = encodeBase64Url({
    typ: "access",
    sid: randomUUID(),
    email: "smoke-test@local.invalid",
    name: "Projects Smoke Test",
    roles: ["ADMIN"],
    permissions: ["system.admin"],
    sub: userId,
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 300,
    jti: randomUUID(),
  });

  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");

  return {
    token: `${unsignedToken}.${signature}`,
    userId,
  };
}

async function requireJson(
  url: string,
  token: string,
  options?: RequestInit,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(options?.body ? { "content-type": "application/json" } : {}),
      ...options?.headers,
    },
    signal: AbortSignal.timeout(10000),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${url} respondió ${response.status}: ${text}`);
  }

  const payload = JSON.parse(text) as unknown;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${url} no devolvió un objeto JSON.`);
  }

  return payload as Readonly<Record<string, unknown>>;
}

async function main(): Promise<void> {
  const { token } = createAccessToken();
  const createdProjectIds: string[] = [];
  let stage = "consultar plantillas publicadas";

  try {
    const templates = await requireJson(
      "http://127.0.0.1:3000/api/v1/templates?page=1&pageSize=50&status=PUBLISHED",
      token,
    );
    const templateItems = templates.items;

    if (!Array.isArray(templateItems) || templateItems.length === 0) {
      throw new Error("No existen plantillas publicadas para crear el proyecto.");
    }

    const template = templateItems[0];

    if (
      !template ||
      typeof template !== "object" ||
      Array.isArray(template) ||
      typeof template.id !== "string"
    ) {
      throw new Error("El catálogo no devolvió una plantilla válida.");
    }

    stage = "consultar el detalle directo de la plantilla";
    const directTemplate = await requireJson(
      `http://127.0.0.1:3004/api/v1/templates/${encodeURIComponent(template.id)}`,
      token,
    );

    if (
      !sameUuid(directTemplate.id, template.id) ||
      directTemplate.status !== "PUBLISHED"
    ) {
      throw new Error(
        "Documents Service no confirmó la plantilla publicada seleccionada.",
      );
    }

    stage = "crear el proyecto directamente en Projects Service";
    const directCreated = await requireJson(
      "http://127.0.0.1:3002/api/v1/projects",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: "Proyecto temporal directo",
          requestingArea: "Pruebas automáticas",
          description:
            "Registro temporal para validar Projects Service y SQL Server.",
          templateId: template.id,
        }),
      },
    );

    if (typeof directCreated.id !== "string") {
      throw new Error(
        "Projects Service no devolvió el identificador del proyecto.",
      );
    }

    createdProjectIds.push(directCreated.id);

    if (!matchesTemplateReference(directCreated.template, template)) {
      throw new Error(
        "Projects Service no conservó la plantilla y versión seleccionadas.",
      );
    }

    stage = "crear el proyecto a través del Gateway";
    const gatewayCreated = await requireJson(
      "http://127.0.0.1:3000/api/v1/projects",
      token,
      {
        method: "POST",
        body: JSON.stringify({
          title: "Proyecto temporal vía Gateway",
          requestingArea: "Pruebas automáticas",
          description:
            "Registro temporal para validar Gateway, Projects y SQL Server.",
          templateId: template.id,
        }),
      },
    );

    if (typeof gatewayCreated.id !== "string") {
      throw new Error(
        "Gateway no devolvió el identificador del proyecto creado.",
      );
    }

    createdProjectIds.push(gatewayCreated.id);

    if (!matchesTemplateReference(gatewayCreated.template, template)) {
      throw new Error(
        "Gateway no devolvió la plantilla y versión seleccionadas.",
      );
    }

    stage = "consultar el proyecto creado";
    const direct = await requireJson(
      `http://127.0.0.1:3002/api/v1/projects/${encodeURIComponent(gatewayCreated.id)}`,
      token,
    );

    if (!sameUuid(direct.id, gatewayCreated.id)) {
      throw new Error(
        "Projects Service devolvió un identificador diferente. " +
          `Esperado: ${String(gatewayCreated.id)}. ` +
          `Recibido: ${String(direct.id)}.`,
      );
    }

    stage = "listar los proyectos creados";
    const projectList = await requireJson(
      "http://127.0.0.1:3000/api/v1/projects?page=1&pageSize=50",
      token,
    );
    const projectItems = projectList.items;

    if (
      !Array.isArray(projectItems) ||
      !projectItems.some(
        (item) =>
          item &&
          typeof item === "object" &&
          !Array.isArray(item) &&
          sameUuid(item.id, gatewayCreated.id),
      )
    ) {
      throw new Error(
        "El listado del Gateway no contiene el proyecto recién creado.",
      );
    }

    const gatewaySummary = await requireJson(
      "http://127.0.0.1:3000/api/v1/projects/summary",
      token,
    );

    if (typeof gatewaySummary.total !== "number") {
      throw new Error("Gateway no devolvió los indicadores esperados.");
    }

    console.log("✓ Documents Service confirmó la plantilla publicada.");
    console.log("✓ Projects Service creó un proyecto directamente.");
    console.log("✓ Gateway creó un proyecto y conservó la versión exacta.");
    console.log("✓ RqProjectsDb respondió correctamente.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Etapa fallida: ${stage}. ${message}`);
  } finally {
    if (createdProjectIds.length > 0) {
      await dataSource.initialize();

      try {
        await dataSource.transaction(async (manager) => {
          for (const projectId of createdProjectIds) {
            await manager.query(
              "DELETE FROM dbo.ProjectParticipants WHERE ProjectId = @0",
              [projectId],
            );
            await manager.query(
              "DELETE FROM dbo.Projects WHERE Id = @0",
              [projectId],
            );
          }
        });
      } finally {
        await dataSource.destroy();
      }

      console.log(
        `✓ ${createdProjectIds.length} proyectos temporales eliminados.`,
      );
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Validación de proyectos fallida: ${message}`);
  process.exitCode = 1;
});
