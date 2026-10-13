import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PUBLIC_GATEWAY_ROUTES,
  corsHeadersForAllowedOrigin,
  hasAccessCredential,
  requiresAccessCredential,
} from "../../apps/gateway/src/security/gateway-security";
import { SourcesGatewayController } from "../../apps/gateway/src/sources/sources-gateway.controller";

const prefix = "v1";

/** El error es una excepción HTTP de Nest con ese código (se compara el estado: hay copias de @nestjs/common). */
function httpStatus(expected: number) {
  return (error: unknown) =>
    typeof (error as { getStatus?: () => number }).getStatus === "function" &&
    (error as { getStatus: () => number }).getStatus() === expected;
}

function requires(method: string, url: string): boolean {
  return requiresAccessCredential({
    method,
    url,
    globalPrefix: `api/${prefix}`,
  });
}

test("solo la salud y el acceso son públicos; el resto de la API exige credencial", () => {
  for (const route of PUBLIC_GATEWAY_ROUTES)
    assert.equal(requires("POST", `/api/v1/${route}`), false, route);

  for (const url of [
    "/api/v1/projects",
    "/api/v1/projects/abc/sources/files",
    "/api/v1/users",
    "/api/v1/admin/ai-providers",
    "/api/v1/auth/me",
    "/api/v1/auth/change-password",
    "/api/v1/prototypes/generations/limits",
  ])
    assert.equal(requires("POST", url), true, url);
});

test("el prefijo y la consulta no permiten esquivar la comprobación", () => {
  // Una ruta pública con consulta sigue siendo pública; una privada con una pública en la consulta, no.
  assert.equal(requires("GET", "/api/v1/health?x=1"), false);
  assert.equal(requires("GET", "/api/v1/projects?next=/api/v1/health"), true);
  assert.equal(requires("GET", "/api/v1/health/"), false);
  // Rutas con sufijos o variantes de las públicas NO son públicas.
  assert.equal(requires("GET", "/api/v1/health/detail"), true);
  assert.equal(requires("POST", "/api/v1/auth/sign-in/extra"), true);
  assert.equal(requires("POST", "/api/v1/auth/sign-ins"), true);
  assert.equal(requires("GET", "/api/v1/auth/microsoft"), true);
  // Fuera del prefijo de la API (documentación en desarrollo, raíz) no se exige aquí.
  assert.equal(requires("GET", "/api/docs"), false);
  assert.equal(requires("GET", "/"), false);
});

test("la verificación previa de CORS (OPTIONS) no exige credencial", () => {
  assert.equal(requires("OPTIONS", "/api/v1/projects"), false);
  assert.equal(requires("options", "/api/v1/users"), false);
});

test("se reconoce la cookie de sesión o el encabezado Bearer, y nada más", () => {
  assert.equal(hasAccessCredential({ cookieHeader: "rq_access=abc" }), true);
  assert.equal(
    hasAccessCredential({ cookieHeader: "otra=1; rq_access=abc; mas=2" }),
    true,
  );
  assert.equal(hasAccessCredential({ authorization: "Bearer abc.def" }), true);
  assert.equal(hasAccessCredential({ authorization: "bearer abc" }), true);

  assert.equal(hasAccessCredential({}), false);
  assert.equal(hasAccessCredential({ cookieHeader: "rq_access=" }), false);
  // La cookie de renovación no sirve para llamar a rutas protegidas.
  assert.equal(hasAccessCredential({ cookieHeader: "rq_refresh=abc" }), false);
  assert.equal(hasAccessCredential({ authorization: "Bearer " }), false);
  assert.equal(hasAccessCredential({ authorization: "Basic abc" }), false);
});

function uploadRequest(options: { cookie?: string; failWith?: unknown }) {
  const state = { partsRead: 0 };
  const request = {
    headers: options.cookie ? { cookie: options.cookie } : {},
    isMultipart: () => true,
    parts: async function* () {
      state.partsRead += 1;
      if (options.failWith) throw options.failWith;
      yield {
        type: "file" as const,
        filename: "a.txt",
        mimetype: "text/plain",
        toBuffer: async () => Buffer.from("hola"),
      };
      yield {
        type: "field" as const,
        fieldname: "metadata",
        value: JSON.stringify({ files: [] }),
      };
    },
  };
  return { request, state };
}

test("la subida de fuentes exige la sesión antes de leer ningún archivo", async () => {
  const controller = new SourcesGatewayController({
    summary: async () => ({}),
  } as never);
  const { request, state } = uploadRequest({});

  await assert.rejects(
    controller.uploadFiles(request as never, "proyecto"),
    httpStatus(401),
  );
  assert.equal(state.partsRead, 0, "no se leyó ningún archivo sin sesión");
});

test("la subida de fuentes devuelve 413 cuando se superan los límites de tamaño", async () => {
  const controller = new SourcesGatewayController({
    summary: async () => ({}),
  } as never);

  for (const code of [
    "FST_REQ_FILE_TOO_LARGE",
    "FST_FILES_LIMIT",
    "FST_PARTS_LIMIT",
  ]) {
    const { request } = uploadRequest({
      cookie: "rq_access=token",
      failWith: Object.assign(new Error("límite"), { code }),
    });
    await assert.rejects(
      controller.uploadFiles(request as never, "proyecto"),
      httpStatus(413),
      code,
    );
  }
});

test("un error inesperado al leer la subida no se disfraza de 413", async () => {
  const controller = new SourcesGatewayController({
    summary: async () => ({}),
  } as never);
  const { request } = uploadRequest({
    cookie: "rq_access=token",
    failWith: new Error("disco lleno"),
  });

  await assert.rejects(
    controller.uploadFiles(request as never, "proyecto"),
    /disco lleno/u,
  );
});

test("con sesión, los archivos se entregan al servicio de fuentes con el token", async () => {
  const received: unknown[] = [];
  const controller = new SourcesGatewayController({
    summary: async () => ({}),
    uploadFiles: async (...args: unknown[]) => {
      received.push(args);
      return { ok: true };
    },
  } as never);
  const { request } = uploadRequest({ cookie: "rq_access=token-123" });

  const result = await controller.uploadFiles(request as never, "proyecto-1");

  assert.deepEqual(result, { ok: true });
  const [token, projectId, files] = received[0] as [
    string,
    string,
    { fileName: string; buffer: Buffer }[],
  ];
  assert.equal(token, "token-123");
  assert.equal(projectId, "proyecto-1");
  assert.equal(files[0]?.fileName, "a.txt");
  assert.equal(files[0]?.buffer.toString(), "hola");
});

test("un token que el servicio rechaza no llega a cargar archivos en el Gateway", async () => {
  const controller = new SourcesGatewayController({
    summary: async () => {
      throw Object.assign(new Error("token inválido"), {
        getStatus: () => 401,
      });
    },
  } as never);
  const { request, state } = uploadRequest({ cookie: "rq_access=basura" });

  await assert.rejects(
    controller.uploadFiles(request as never, "proyecto"),
    httpStatus(401),
  );
  assert.equal(state.partsRead, 0, "no se leyó ningún archivo");
});

test("el rechazo temprano lleva CORS solo para los orígenes de la web (si no, el navegador no lee el 401)", () => {
  const webOrigins = ["http://127.0.0.1:4200", "http://localhost:4200"];

  assert.deepEqual(
    corsHeadersForAllowedOrigin("http://127.0.0.1:4200", webOrigins),
    {
      "access-control-allow-origin": "http://127.0.0.1:4200",
      "access-control-allow-credentials": "true",
      vary: "Origin",
    },
  );
  assert.deepEqual(
    corsHeadersForAllowedOrigin("https://malo.example", webOrigins),
    {},
  );
  assert.deepEqual(corsHeadersForAllowedOrigin(undefined, webOrigins), {});
  assert.deepEqual(corsHeadersForAllowedOrigin("null", webOrigins), {});
});
