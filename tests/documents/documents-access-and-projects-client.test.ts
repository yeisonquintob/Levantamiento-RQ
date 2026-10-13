import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { SignJWT } from "jose";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { DocumentsProjectsAccessClient } from "../../apps/documents-service/src/documents/projects-access.client";
import {
  type DocumentsAuthConfig,
  loadDocumentsAuthConfig,
} from "../../apps/documents-service/src/templates/documents-auth.config";
import { DocumentsAccessTokenGuard } from "../../apps/documents-service/src/templates/documents-access-token.guard";

const KEY_ID = "documents-test-key";
const ISSUER = "levantamiento-rq-identity";
const AUDIENCE = "levantamiento-rq";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicJwk: publicKey.export({ format: "jwk" }) };
}
const trusted = keyPair();
const stranger = keyPair();

function jwks(publicJwk: object, kid = KEY_ID, principal = "identity"): string {
  return Buffer.from(
    JSON.stringify({
      keys: [{ ...publicJwk, kid, alg: "EdDSA", use: "sig", principal }],
    }),
  ).toString("base64");
}

const CONFIG: DocumentsAuthConfig = {
  issuer: ISSUER,
  audience: AUDIENCE,
  accessPublicJwks: jwks(trusted.publicJwk),
  projectsServiceUrl: "http://projects.test",
  sourcesServiceUrl: "http://sources.test",
  projectsTimeoutMs: 1_000,
  sourcesTimeoutMs: 1_000,
};

interface TokenOptions {
  key?: ReturnType<typeof keyPair>["privateKey"];
  kid?: string;
  issuer?: string;
  audience?: string;
  expiresIn?: string;
  typ?: string;
  claims?: Record<string, unknown>;
}

async function token(options: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    typ: options.typ ?? "access",
    email: "ana@example.test",
    name: "Ana Analista",
    roles: ["ANALYST"],
    permissions: ["documents.read"],
    ...options.claims,
  })
    .setProtectedHeader({
      alg: "EdDSA",
      typ: "JWT",
      kid: options.kid ?? KEY_ID,
    })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.key ?? trusted.privateKey);
}

function context(headers: Record<string, string | undefined>) {
  const request: Record<string, unknown> = { headers };
  return {
    request,
    host: { switchToHttp: () => ({ getRequest: () => request }) } as never,
  };
}

function httpStatus(expected: number) {
  return (error: unknown) =>
    typeof (error as { getStatus?: () => number }).getStatus === "function" &&
    (error as { getStatus: () => number }).getStatus() === expected;
}

const guard = new DocumentsAccessTokenGuard(CONFIG);

async function rejects(
  headers: Record<string, string | undefined>,
  status = 401,
) {
  await assert.rejects(
    guard.canActivate(context(headers).host),
    httpStatus(status),
  );
}

test("un token válido autentica y deja al usuario, el token y la correlación en la petición", async () => {
  const jwt = await token();
  const { request, host } = context({
    authorization: `Bearer ${jwt}`,
    "x-correlation-id": " corr-1 ",
  });

  assert.equal(await guard.canActivate(host), true);

  assert.deepEqual(request.authPrincipal, {
    id: "11111111-1111-4111-8111-111111111111",
    email: "ana@example.test",
    displayName: "Ana Analista",
    roles: ["ANALYST"],
    permissions: ["documents.read"],
    mustChangePassword: false,
  });
  assert.equal(request.accessToken, jwt);
  assert.equal(request.correlationId, "corr-1");
});

test("sin correlación en la petición se genera una nueva", async () => {
  const { request, host } = context({
    authorization: `Bearer ${await token()}`,
  });
  await guard.canActivate(host);
  assert.match(String(request.correlationId), /^[0-9a-f-]{36}$/u);
});

test("sin encabezado Authorization, o con otro esquema, se rechaza con 401", async () => {
  await rejects({});
  await rejects({ authorization: "Basic abc" });
  await rejects({ authorization: "Bearer" });
  await rejects({ authorization: `Token ${await token()}` });
});

test("un token manipulado, de otra clave, de otro emisor o de otra audiencia se rechaza con 401", async () => {
  const valid = await token();
  const [header, payload, signature] = valid.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({
      sub: "x",
      email: "a@b.c",
      name: "Admin",
      roles: ["ADMIN"],
      permissions: ["system.admin"],
      typ: "access",
      iss: ISSUER,
      aud: AUDIENCE,
      exp: 4_102_444_800,
    }),
  ).toString("base64url");

  await rejects({
    authorization: `Bearer ${header}.${forgedPayload}.${signature}`,
  });
  await rejects({
    authorization: `Bearer ${header}.${payload}.${signature?.slice(0, -4)}AAAA`,
  });
  await rejects({
    authorization: `Bearer ${await token({ key: stranger.privateKey })}`,
  });
  await rejects({
    authorization: `Bearer ${await token({ issuer: "otro-emisor" })}`,
  });
  await rejects({
    authorization: `Bearer ${await token({ audience: "otra-audiencia" })}`,
  });
  await rejects({ authorization: "Bearer basura" });
});

test("un token caducado se rechaza con 401", async () => {
  await rejects({
    authorization: `Bearer ${await token({ expiresIn: "-1m" })}`,
  });
});

test("un JWT sin firma (alg none) o con otro algoritmo no se acepta", async () => {
  const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT", kid: KEY_ID })).toString("base64url")}.${Buffer.from(
    JSON.stringify({
      sub: "x",
      email: "a@b.c",
      name: "Admin",
      roles: ["ADMIN"],
      permissions: ["system.admin"],
      typ: "access",
      iss: ISSUER,
      aud: AUDIENCE,
      exp: 4_102_444_800,
    }),
  ).toString("base64url")}.`;
  await rejects({ authorization: `Bearer ${none}` });

  const hs256 = await new SignJWT({
    typ: "access",
    email: "a@b.c",
    name: "A",
    roles: [],
    permissions: [],
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: KEY_ID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject("x")
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode("secreto-compartido-de-prueba-0123456789"));
  await rejects({ authorization: `Bearer ${hs256}` });
});

test("un token que no es de acceso, o con una clave no autorizada, se rechaza", async () => {
  await rejects({ authorization: `Bearer ${await token({ typ: "refresh" })}` });
  await rejects({
    authorization: `Bearer ${await token({ kid: "kid-desconocido" })}`,
  });
});

test("Identity no puede emitir tokens de workload y un principal ajeno no se admite", async () => {
  await rejects({
    authorization: `Bearer ${await token({ claims: { service: "ai-analysis-service" } })}`,
  });

  const foreign = new DocumentsAccessTokenGuard({
    ...CONFIG,
    accessPublicJwks: jwks(trusted.publicJwk, KEY_ID, "servicio-inexistente"),
  });
  await assert.rejects(
    foreign.canActivate(
      context({ authorization: `Bearer ${await token()}` }).host,
    ),
    httpStatus(401),
  );
});

test("quien debe cambiar la contraseña temporal recibe 403, no acceso", async () => {
  await rejects(
    {
      authorization: `Bearer ${await token({ claims: { mustChangePassword: true } })}`,
    },
    403,
  );
});

test("un token firmado pero con datos de usuario incompletos se rechaza con 401", async () => {
  for (const claims of [
    { email: "" },
    { name: 7 },
    { roles: "ADMIN" },
    { roles: [1] },
    { permissions: [{}] },
  ])
    await rejects({ authorization: `Bearer ${await token({ claims })}` });
});

test("la configuración de autenticación valida el JWKS, las URL y los tiempos de espera", () => {
  const env = { JWT_ACCESS_PUBLIC_JWKS_BASE64: jwks(trusted.publicJwk) };

  const config = loadDocumentsAuthConfig(env);
  assert.equal(config.issuer, ISSUER);
  assert.equal(config.audience, AUDIENCE);
  assert.equal(config.projectsServiceUrl, "http://127.0.0.1:3002");
  assert.equal(config.projectsTimeoutMs, 8000);

  const custom = loadDocumentsAuthConfig({
    ...env,
    JWT_ISSUER: "emisor",
    PROJECTS_SERVICE_URL: "http://projects.interno:3002/",
    SOURCES_TIMEOUT_MS: "1500",
  });
  assert.equal(custom.issuer, "emisor");
  assert.equal(custom.projectsServiceUrl, "http://projects.interno:3002");
  assert.equal(custom.sourcesTimeoutMs, 1500);

  assert.throws(() => loadDocumentsAuthConfig({}), /JWKS|base64|JSON|clave/iu);
  assert.throws(
    () =>
      loadDocumentsAuthConfig({ ...env, PROJECTS_SERVICE_URL: "no-es-url" }),
    /PROJECTS_SERVICE_URL/u,
  );
  assert.throws(
    () => loadDocumentsAuthConfig({ ...env, PROJECTS_TIMEOUT_MS: "10" }),
    /PROJECTS_TIMEOUT_MS/u,
  );
  assert.throws(
    () => loadDocumentsAuthConfig({ ...env, SOURCES_TIMEOUT_MS: "99999" }),
    /SOURCES_TIMEOUT_MS/u,
  );
  assert.throws(
    () => loadDocumentsAuthConfig({ ...env, SOURCES_TIMEOUT_MS: "abc" }),
    /SOURCES_TIMEOUT_MS/u,
  );
});

// ---------------------------------------------------------------- acceso al proyecto

const client = new DocumentsProjectsAccessClient(CONFIG);

function actorWith(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: "u-1",
    email: "ana@example.test",
    displayName: "Ana",
    roles: ["ANALYST"],
    permissions: [],
    mustChangePassword: false,
    ...overrides,
  } as AuthenticatedUser;
}

const project = {
  id: "p-1",
  title: "Portal",
  participants: [
    { userId: "u-1", role: "EDITOR" },
    { userId: "u-2", role: "REVIEWER" },
    { userId: "u-3", role: "OWNER" },
    { userId: "u-4", role: "VIEWER" },
  ],
};

function stubFetch(
  respond: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("el acceso se resuelve por el rol del participante en el proyecto", async () => {
  const stub = stubFetch(() => json(project));
  try {
    const expected: Record<string, [string, boolean, boolean]> = {
      "u-1": ["EDITOR", true, false],
      "u-2": ["REVIEWER", false, true],
      "u-3": ["OWNER", true, true],
      "u-4": ["VIEWER", false, false],
    };
    for (const [id, [role, canEdit, canReview]] of Object.entries(expected)) {
      const access = await client.requireRead(
        "p-1",
        "jwt",
        actorWith({ id }),
        "corr",
      );
      assert.equal(access.role, role, id);
      assert.equal(access.canEdit, canEdit, `${id} edita`);
      assert.equal(access.canReview, canReview, `${id} revisa`);
    }
    // Se pasa el token del usuario y la correlación al servicio de proyectos.
    const headers = stub.calls[0]?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer jwt");
    assert.equal(headers["x-correlation-id"], "corr");
    assert.equal(
      stub.calls[0]?.url,
      "http://projects.test/api/v1/projects/p-1",
    );
  } finally {
    stub.restore();
  }
});

test("un administrador accede a cualquier proyecto con todos los permisos", async () => {
  const stub = stubFetch(() => json(project));
  try {
    for (const actor of [
      actorWith({ id: "ajeno", roles: ["admin"] }),
      actorWith({ id: "ajeno", permissions: ["system.admin"] }),
    ]) {
      const access = await client.requireRead("p-1", "jwt", actor, "corr");
      assert.equal(access.role, "ADMIN");
      assert.equal(access.canEdit && access.canReview, true);
    }
  } finally {
    stub.restore();
  }
});

test("un servicio con lectura global lee, pero no edita ni revisa", async () => {
  const stub = stubFetch(() => json(project));
  try {
    const access = await client.requireRead(
      "p-1",
      "jwt",
      actorWith({ id: "ajeno", permissions: ["projects.read.all"] }),
      "corr",
    );
    assert.equal(access.role, "SERVICE");
    assert.equal(access.canEdit, false);
    assert.equal(access.canReview, false);
  } finally {
    stub.restore();
  }
});

test("quien no participa en el proyecto recibe 403", async () => {
  const stub = stubFetch(() => json(project));
  try {
    await assert.rejects(
      client.requireRead("p-1", "jwt", actorWith({ id: "ajeno" }), "corr"),
      httpStatus(403),
    );
  } finally {
    stub.restore();
  }
});

test("si el servicio de proyectos responde un error, se propaga con su estado y su mensaje", async () => {
  for (const [status, body] of [
    [404, { message: "no existe" }],
    [401, { message: "sin sesión" }],
  ] as const) {
    const stub = stubFetch(() => json(body, status));
    try {
      await assert.rejects(
        client.requireRead("p-1", "jwt", actorWith(), "corr"),
        (error: unknown) =>
          httpStatus(status)(error) &&
          JSON.stringify(
            (error as { getResponse: () => unknown }).getResponse(),
          ).includes(body.message),
      );
    } finally {
      stub.restore();
    }
  }
});

test("una respuesta de error que no es JSON se devuelve como mensaje y una vacía usa el texto por defecto", async () => {
  let stub = stubFetch(() => new Response("Bad Gateway", { status: 502 }));
  try {
    await assert.rejects(
      client.requireRead("p-1", "jwt", actorWith(), "corr"),
      (error: unknown) =>
        httpStatus(502)(error) &&
        JSON.stringify(
          (error as { getResponse: () => unknown }).getResponse(),
        ).includes("Bad Gateway"),
    );
  } finally {
    stub.restore();
  }
  stub = stubFetch(() => new Response("", { status: 500 }));
  try {
    await assert.rejects(
      client.requireRead("p-1", "jwt", actorWith(), "corr"),
      (error: unknown) =>
        httpStatus(500)(error) &&
        JSON.stringify(
          (error as { getResponse: () => unknown }).getResponse(),
        ).includes("No fue posible validar el proyecto"),
    );
  } finally {
    stub.restore();
  }
});

test("si el servicio de proyectos no responde, se informa 503 y no un error interno", async () => {
  const stub = stubFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    await assert.rejects(
      client.requireRead("p-1", "jwt", actorWith(), "corr"),
      httpStatus(503),
    );
  } finally {
    stub.restore();
  }
});

test("el identificador del proyecto se codifica en la URL", async () => {
  const stub = stubFetch(() => json(project));
  try {
    await client.requireRead(
      "../admin?x=1",
      "jwt",
      actorWith({ permissions: ["system.admin"] }),
      "c",
    );
    assert.equal(
      stub.calls[0]?.url,
      "http://projects.test/api/v1/projects/..%2Fadmin%3Fx%3D1",
    );
  } finally {
    stub.restore();
  }
});

test("al marcar el documento como generado se avisa a proyectos, y si falla se pide reintentar", async () => {
  let stub = stubFetch(() => json({}, 200));
  try {
    await client.documentGenerated("p-1", "d-1", "jwt");
    assert.equal(stub.calls[0]?.init.method, "POST");
    assert.equal(
      stub.calls[0]?.url,
      "http://projects.test/api/v1/projects/p-1/documents/d-1/generated",
    );
  } finally {
    stub.restore();
  }
  stub = stubFetch(() => json({}, 500));
  try {
    await assert.rejects(
      client.documentGenerated("p-1", "d-1", "jwt"),
      httpStatus(503),
    );
  } finally {
    stub.restore();
  }
});
