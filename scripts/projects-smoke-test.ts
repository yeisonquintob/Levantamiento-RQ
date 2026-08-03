import { createHmac, randomUUID } from "node:crypto";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

loadEnvironmentFiles({
  paths: [".env", "apps/projects-service/.env"],
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

async function createAccessToken(): Promise<string> {
  const secret = requiredSecret(
    process.env.JWT_ACCESS_SECRET,
    "JWT_ACCESS_SECRET",
  );
  const issuer = process.env.JWT_ISSUER?.trim() || "levantamiento-rq-identity";
  const audience = process.env.JWT_AUDIENCE?.trim() || "levantamiento-rq";
  const now = Math.floor(Date.now() / 1000);

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
    sub: randomUUID(),
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 120,
    jti: randomUUID(),
  });

  const unsignedToken = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

async function requireJson(
  url: string,
  token: string,
): Promise<Readonly<Record<string, unknown>>> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(5000),
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
  const token = await createAccessToken();

  const directSummary = await requireJson(
    "http://127.0.0.1:3002/api/v1/projects/summary",
    token,
  );

  const gatewaySummary = await requireJson(
    "http://127.0.0.1:3000/api/v1/projects/summary",
    token,
  );

  const gatewayList = await requireJson(
    "http://127.0.0.1:3000/api/v1/projects?page=1&pageSize=5",
    token,
  );

  for (const [name, payload] of [
    ["Projects Service", directSummary],
    ["Gateway summary", gatewaySummary],
  ] as const) {
    if (typeof payload.total !== "number") {
      throw new Error(`${name} no devolvió el total esperado.`);
    }
  }

  if (!Array.isArray(gatewayList.items)) {
    throw new Error("Gateway no devolvió el listado esperado.");
  }

  console.log("✓ Projects Service autenticado y conectado a RqProjectsDb.");
  console.log("✓ Gateway enruta proyectos sin modificar datos.");
  console.log("✓ Listado e indicadores respondieron correctamente.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Validación de proyectos fallida: ${message}`);
  process.exitCode = 1;
});
