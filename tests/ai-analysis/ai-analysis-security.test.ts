import assert from "node:assert/strict";
import test from "node:test";

import { SignJWT } from "jose";

import {
  AI_ANALYSIS_PROJECT_ACTIONS,
  type AuthenticatedUser,
} from "../../libs/shared/contracts/src/index.js";
import {
  loadAiAnalysisAuthConfig,
  type AiAnalysisAuthConfig,
} from "../../apps/ai-analysis-service/src/analysis/ai-analysis-auth.config.js";
import { AiAnalysisAccessTokenGuard } from "../../apps/ai-analysis-service/src/analysis/ai-analysis-access-token.guard.js";
import type { AiAnalysisRequest } from "../../apps/ai-analysis-service/src/analysis/ai-analysis-request.js";
import { AiAnalysisProjectsAccessClient } from "../../apps/ai-analysis-service/src/analysis/projects-access.client.js";

const SECRET = "ai-analysis-test-secret-with-32-characters";
const CONFIG: AiAnalysisAuthConfig = {
  issuer: "levantamiento-rq-identity",
  audience: "levantamiento-rq",
  accessSecret: SECRET,
  projectsServiceUrl: "http://127.0.0.1:3002",
  projectsTimeoutMs: 8000,
};

function matchesHttpException(
  error: unknown,
  expectedStatus: number,
  expectedMessage: string,
): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    getStatus?: () => number;
    message?: unknown;
  };

  return (
    typeof candidate.getStatus === "function" &&
    candidate.getStatus() === expectedStatus &&
    candidate.message === expectedMessage
  );
}

function actor(
  id: string,
  roles: readonly string[] = ["ANALYST"],
  permissions: readonly string[] = [],
): AuthenticatedUser {
  return {
    id,
    email: `${id}@local.invalid`,
    displayName: id,
    roles,
    permissions,
    mustChangePassword: false,
  };
}

function executionContext(request: AiAnalysisRequest) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}

async function accessToken(
  user: AuthenticatedUser,
  mustChangePassword = false,
): Promise<string> {
  return new SignJWT({
    typ: "access",
    email: user.email,
    name: user.displayName,
    roles: user.roles,
    permissions: user.permissions,
    mustChangePassword,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(CONFIG.issuer)
    .setAudience(CONFIG.audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(SECRET));
}

function projectPayload(
  participants: readonly Readonly<Record<string, string>>[],
): Readonly<Record<string, unknown>> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "RQ-2026-000001",
    title: "Proyecto de validación",
    participants,
  };
}

test("el contrato define lectura, creación y cancelación", () => {
  assert.deepEqual(AI_ANALYSIS_PROJECT_ACTIONS, [
    "READ",
    "CREATE",
    "CANCEL",
  ]);
});

test("la configuración exige secreto seguro, URL y timeout válidos", () => {
  assert.throws(
    () => loadAiAnalysisAuthConfig({ JWT_ACCESS_SECRET: "corto" }),
    /mínimo 32/i,
  );
  assert.throws(
    () =>
      loadAiAnalysisAuthConfig({
        JWT_ACCESS_SECRET: SECRET,
        PROJECTS_SERVICE_URL: "no-es-url",
      }),
    /URL absoluta/i,
  );
  assert.throws(
    () =>
      loadAiAnalysisAuthConfig({
        JWT_ACCESS_SECRET: SECRET,
        PROJECTS_TIMEOUT_MS: "10",
      }),
    /500 y 30000/i,
  );

  assert.equal(
    loadAiAnalysisAuthConfig({
      JWT_ACCESS_SECRET: SECRET,
    }).projectsServiceUrl,
    "http://127.0.0.1:3002",
  );
});

test("el guard valida JWT, principal y correlación", async () => {
  const user = actor("22222222-2222-4222-8222-222222222222");
  const token = await accessToken(user);
  const request: AiAnalysisRequest = {
    headers: {
      authorization: `Bearer ${token}`,
      "x-correlation-id": "correlation-test",
    },
  };
  const guard = new AiAnalysisAccessTokenGuard(CONFIG);

  assert.equal(
    await guard.canActivate(executionContext(request)),
    true,
  );
  assert.equal(request.authPrincipal?.id, user.id);
  assert.equal(request.accessToken, token);
  assert.equal(request.correlationId, "correlation-test");
});

test("el guard rechaza ausencia de token y contraseña temporal", async () => {
  const guard = new AiAnalysisAccessTokenGuard(CONFIG);

  await assert.rejects(
    guard.canActivate(executionContext({ headers: {} })),
    (error: unknown) =>
      matchesHttpException(
        error,
        401,
        "Token de acceso requerido.",
      ),
  );

  const user = actor("33333333-3333-4333-8333-333333333333");
  const token = await accessToken(user, true);

  await assert.rejects(
    guard.canActivate(
      executionContext({
        headers: { authorization: `Bearer ${token}` },
      }),
    ),
    (error: unknown) =>
      matchesHttpException(
        error,
        403,
        "Debes cambiar la contraseña temporal antes de continuar.",
      ),
  );
});

test("la matriz permite leer a participantes y administrar a owner/editor", async () => {
  const originalFetch = globalThis.fetch;
  const owner = actor("44444444-4444-4444-8444-444444444444");
  const viewer = actor("55555555-5555-4555-8555-555555555555");
  let receivedCorrelation = "";

  globalThis.fetch = async (_input, init) => {
    const headers = init?.headers as Record<string, string>;
    receivedCorrelation = headers["x-correlation-id"] ?? "";

    return new Response(
      JSON.stringify(
        projectPayload([
          { userId: owner.id, role: "OWNER" },
          { userId: viewer.id, role: "VIEWER" },
        ]),
      ),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const client = new AiAnalysisProjectsAccessClient(CONFIG);
    const ownerAccess = await client.requireCreate(
      "11111111-1111-4111-8111-111111111111",
      "token",
      owner,
      "correlation-owner",
    );

    assert.equal(ownerAccess.canCreate, true);
    assert.equal(ownerAccess.canCancel, true);
    assert.equal(receivedCorrelation, "correlation-owner");

    const viewerAccess = await client.requireRead(
      "11111111-1111-4111-8111-111111111111",
      "token",
      viewer,
      "correlation-viewer",
    );

    assert.equal(viewerAccess.canRead, true);
    assert.equal(viewerAccess.canCreate, false);

    await assert.rejects(
      client.requireCancel(
        "11111111-1111-4111-8111-111111111111",
        "token",
        viewer,
        "correlation-viewer",
      ),
      /Solo ADMIN, OWNER o EDITOR/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("system.admin conserva acceso aun sin participación", async () => {
  const originalFetch = globalThis.fetch;
  const administrator = actor(
    "66666666-6666-4666-8666-666666666666",
    ["ADMIN"],
    ["system.admin"],
  );

  globalThis.fetch = async () =>
    new Response(JSON.stringify(projectPayload([])), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  try {
    const client = new AiAnalysisProjectsAccessClient(CONFIG);
    const access = await client.requireCancel(
      "11111111-1111-4111-8111-111111111111",
      "token",
      administrator,
      "correlation-admin",
    );

    assert.equal(access.role, "ADMIN");
    assert.equal(access.canCreate, true);
    assert.equal(access.canCancel, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
