import { createHmac, randomUUID } from "node:crypto";

import { loadEnvironmentFiles } from "../libs/shared/config/src/index.js";

loadEnvironmentFiles({
  paths: [".env", "apps/sources-service/.env"],
});

function requiredSecret(value: string | undefined, name: string): string {
  const resolved = value?.trim() ?? "";

  if (resolved.length < 32) {
    throw new Error(`${name} no está configurado.`);
  }

  return resolved;
}

function requiredProjectId(value: string | undefined): string {
  const resolved = value?.trim() ?? "";

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      resolved,
    )
  ) {
    throw new Error(
      "SOURCES_SMOKE_PROJECT_ID debe contener un proyecto accesible.",
    );
  }

  return resolved;
}

function encodeBase64Url(value: Readonly<Record<string, unknown>>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function createAccessToken(): string {
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
    email: "sources-smoke-test@local.invalid",
    name: "Sources Smoke Test",
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
  options?: RequestInit,
): Promise<Readonly<Record<string, unknown>>> {
  const isFormData = options?.body instanceof FormData;
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(options?.body && !isFormData
        ? { "content-type": "application/json" }
        : {}),
    },
    signal: AbortSignal.timeout(8000),
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
  const token = createAccessToken();
  const projectId = requiredProjectId(process.env.SOURCES_SMOKE_PROJECT_ID);
  const directBase =
    `http://127.0.0.1:3003/api/v1/projects/${projectId}/sources`;
  const gatewayBase =
    `http://127.0.0.1:3000/api/v1/projects/${projectId}/sources`;

  const created = await requireJson(directBase, token, {
    method: "POST",
    body: JSON.stringify({
      sourceType: "NOTE",
      title: "Validación automática de Sources Service",
      content: "Fuente temporal creada por la prueba controlada.",
    }),
  });

  if (typeof created.id !== "string") {
    throw new Error("Sources Service no devolvió el identificador esperado.");
  }

  const fileName = `sources-smoke-${randomUUID()}.txt`;
  const fileContent = Buffer.from(
    `Carga multipart temporal ${randomUUID()}`,
    "utf8",
  );
  const form = new FormData();
  form.append(
    "metadata",
    JSON.stringify([
      {
        fileName,
        classification: "EVIDENCE",
        description: "Validación automática de carga mediante Gateway.",
      },
    ]),
  );
  form.append(
    "files",
    new Blob([fileContent], { type: "text/plain" }),
    fileName,
  );

  const upload = await requireJson(`${gatewayBase}/files`, token, {
    method: "POST",
    body: form,
  });
  const accepted = Array.isArray(upload.accepted) ? upload.accepted : [];
  const uploadedSource = accepted[0];

  if (
    upload.acceptedFiles !== 1 ||
    upload.rejectedFiles !== 0 ||
    !uploadedSource ||
    typeof uploadedSource !== "object" ||
    !("id" in uploadedSource) ||
    typeof uploadedSource.id !== "string"
  ) {
    throw new Error(
      `Gateway no almacenó el archivo esperado: ${JSON.stringify(upload)}`,
    );
  }

  const list = await requireJson(`${gatewayBase}?page=1&pageSize=5`, token);
  const summary = await requireJson(`${gatewayBase}/summary`, token);

  if (
    !Array.isArray(list.items) ||
    !list.items.some(
      (item) =>
        item &&
        typeof item === "object" &&
        "id" in item &&
        item.id === uploadedSource.id,
    ) ||
    typeof summary.total !== "number"
  ) {
    throw new Error("Gateway no devolvió la estructura de fuentes esperada.");
  }

  await requireJson(`${directBase}/${created.id}`, token, {
    method: "DELETE",
  });
  await requireJson(`${directBase}/${uploadedSource.id}`, token, {
    method: "DELETE",
  });

  console.log("✓ Sources Service autenticado y conectado a RqSourcesDb.");
  console.log("✓ Acceso al proyecto validado mediante Projects Service.");
  console.log("✓ Gateway carga archivos multipart sin modificar datos.");
  console.log("✓ Fuentes temporales creadas, consultadas y archivadas.");
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Validación de Sources Service fallida: ${message}`);
  process.exitCode = 1;
});
