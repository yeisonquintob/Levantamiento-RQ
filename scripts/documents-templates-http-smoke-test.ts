import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

interface DocumentTemplateListItem {
  id: string;
  code: string;
}

interface DocumentTemplateListResponse {
  items: DocumentTemplateListItem[];
  totalItems: number;
}

interface DocumentTemplateMetrics {
  total: number;
}

interface DocumentTemplateDetail {
  definition: {
    sections: unknown[];
    sectionOrder: unknown[];
  };
}

function loadEnvironmentFiles(paths: readonly string[]): void {
  const fileValues: Record<string, string> = {};

  for (const configuredPath of paths) {
    const absolutePath = resolve(process.cwd(), configuredPath);

    if (!existsSync(absolutePath)) {
      continue;
    }

    Object.assign(
      fileValues,
      parseEnv(readFileSync(absolutePath, "utf8")),
    );
  }

  for (const [key, value] of Object.entries(fileValues)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadEnvironmentFiles([
  ".env",
  "apps/documents-service/.env",
]);

function requiredSecret(value: string | undefined): string {
  const resolved = value?.trim() ?? "";

  if (resolved.length < 32) {
    throw new Error(
      "JWT_ACCESS_SECRET debe tener mínimo 32 caracteres para la prueba HTTP.",
    );
  }

  return resolved;
}

async function readJson<T>(
  baseUrl: string,
  path: string,
  token: string,
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} en ${path}: ${text || "sin respuesta"}`,
    );
  }

  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const baseUrl =
    process.env.DOCUMENTS_SMOKE_BASE_URL?.trim() ||
    "http://127.0.0.1:3000";
  const issuer =
    process.env.JWT_ISSUER?.trim() || "levantamiento-rq-identity";
  const audience =
    process.env.JWT_AUDIENCE?.trim() || "levantamiento-rq";
  const secret = requiredSecret(process.env.JWT_ACCESS_SECRET);

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const payload = {
    sub: "14000000-0000-4000-8000-000000000099",
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 300,
    typ: "access",
    email: "smoke.templates@local.test",
    name: "Templates Smoke Test",
    roles: ["ADMIN"],
    permissions: ["documents.templates.manage"],
  };
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
  const unsignedToken = `${encode(header)}.${encode(payload)}`;
  const signature = createHmac("sha256", secret)
    .update(unsignedToken)
    .digest("base64url");
  const token = `${unsignedToken}.${signature}`;

  const list = await readJson<DocumentTemplateListResponse>(
    baseUrl,
    "/api/v1/templates?page=1&pageSize=50",
    token,
  );
  const filtered = await readJson<DocumentTemplateListResponse>(
    baseUrl,
    "/api/v1/templates?page=1&pageSize=50&search=RQ",
    token,
  );
  const metrics = await readJson<DocumentTemplateMetrics>(
    baseUrl,
    "/api/v1/templates/summary",
    token,
  );

  assert.ok(list.items.length >= 4);
  assert.ok(filtered.items.some((item) => item.code.startsWith("RQ-")));
  assert.equal(metrics.total, list.totalItems);

  const first = list.items[0];
  assert.ok(first);

  const detail = await readJson<DocumentTemplateDetail>(
    baseUrl,
    `/api/v1/templates/${encodeURIComponent(first.id)}`,
    token,
  );

  assert.ok(detail.definition.sections.length >= 1);
  assert.equal(
    detail.definition.sectionOrder.length,
    detail.definition.sections.length,
  );

  console.log(`Catálogo HTTP verificado: ${baseUrl}`);
  console.log(`Plantillas consultadas: ${list.totalItems}`);
  console.log("Listado, filtros, indicadores y detalle correctos.");
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
});
