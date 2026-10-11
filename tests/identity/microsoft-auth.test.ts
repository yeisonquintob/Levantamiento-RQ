import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { exportJWK, generateKeyPair } from "jose";

import type { AuthConfig } from "../../apps/identity-service/src/auth/auth-config";
import { AuthService } from "../../apps/identity-service/src/auth/auth-service";
import type {
  IdentityStore,
  IdentityUserRecord,
} from "../../apps/identity-service/src/auth/identity-store";
import {
  loadMicrosoftAuthConfig,
  type MicrosoftAuthConfig,
} from "../../apps/identity-service/src/auth/microsoft-auth-config";
import { MicrosoftAuthService } from "../../apps/identity-service/src/auth/microsoft-auth.service";
import { PasswordHasher } from "../../apps/identity-service/src/auth/password-hasher";
import { TokenService } from "../../apps/identity-service/src/auth/token-service";

const TENANT = "11111111-2222-4333-8444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const validEnvironment: NodeJS.ProcessEnv = {
  AUTH_ENABLED: "true",
  MICROSOFT_AUTH_ENABLED: "true",
  MICROSOFT_TENANT_ID: TENANT,
  MICROSOFT_CLIENT_ID: CLIENT,
  MICROSOFT_CLIENT_SECRET: "secreto-de-prueba",
  MICROSOFT_REDIRECT_URI: "http://localhost:3000/api/v1/auth/microsoft/callback",
  JWT_REFRESH_SECRET: "r".repeat(40),
};

function enabledConfig(
  overrides: Partial<MicrosoftAuthConfig> = {},
): MicrosoftAuthConfig {
  return { ...loadMicrosoftAuthConfig(validEnvironment), ...overrides };
}

const unusedAuthService = {} as AuthService;

test("el acceso con Microsoft permanece apagado salvo configuración explícita", () => {
  assert.equal(loadMicrosoftAuthConfig({}).enabled, false);
  assert.equal(
    loadMicrosoftAuthConfig({ ...validEnvironment, MICROSOFT_AUTH_ENABLED: "false" })
      .enabled,
    false,
  );
  assert.equal(
    loadMicrosoftAuthConfig({ ...validEnvironment, AUTH_ENABLED: "false" }).enabled,
    false,
  );
  assert.equal(enabledConfig().enabled, true);
});

test("la configuración exige un tenant concreto y una redirección segura", () => {
  for (const tenant of ["common", "organizations", ""]) {
    assert.throws(
      () => loadMicrosoftAuthConfig({ ...validEnvironment, MICROSOFT_TENANT_ID: tenant }),
      /MICROSOFT_TENANT_ID/,
    );
  }
  assert.throws(
    () => loadMicrosoftAuthConfig({ ...validEnvironment, MICROSOFT_CLIENT_SECRET: "" }),
    /MICROSOFT_CLIENT_SECRET/,
  );
  assert.throws(
    () =>
      loadMicrosoftAuthConfig({
        ...validEnvironment,
        MICROSOFT_REDIRECT_URI: "http://localhost:3000/cb?next=https://evil.example",
      }),
    /MICROSOFT_REDIRECT_URI/,
  );
  assert.throws(
    () =>
      loadMicrosoftAuthConfig({
        ...validEnvironment,
        NODE_ENV: "production",
        MICROSOFT_REDIRECT_URI: "http://gateway.example/api/v1/auth/microsoft/callback",
      }),
    /HTTPS/,
  );
});

test("authorize construye una solicitud OIDC con PKCE S256, state y nonce únicos", () => {
  const service = new MicrosoftAuthService(enabledConfig(), unusedAuthService);
  const first = service.authorize("http://localhost:4200");
  const second = service.authorize("http://localhost:4200");
  const url = new URL(first.authorizationUrl);

  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, `/${TENANT}/oauth2/v2.0/authorize`);
  assert.equal(url.searchParams.get("client_id"), CLIENT);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "openid profile email");
  assert.equal(
    url.searchParams.get("redirect_uri"),
    validEnvironment.MICROSOFT_REDIRECT_URI,
  );
  assert.ok((url.searchParams.get("state") ?? "").length >= 40);
  assert.ok((url.searchParams.get("nonce") ?? "").length >= 40);
  assert.ok((url.searchParams.get("code_challenge") ?? "").length >= 40);
  assert.notEqual(
    url.searchParams.get("state"),
    new URL(second.authorizationUrl).searchParams.get("state"),
  );
  assert.equal(first.authorizationUrl.includes("client_secret"), false);
  assert.equal(first.transaction.includes(CLIENT), false);
});

test("complete rechaza transacciones alteradas, vencidas o con state distinto", async () => {
  const service = new MicrosoftAuthService(enabledConfig(), unusedAuthService);
  const { authorizationUrl, transaction } = service.authorize("http://localhost:4200");
  const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
  const context = { userAgent: "test", ipAddress: "127.0.0.1" };

  const [body, signature] = transaction.split(".");
  const tampered = `${body?.slice(0, -2)}AA.${signature}`;
  await assert.rejects(
    () => service.complete({ code: "c", state, transaction: tampered }, context),
    /no es válida/,
  );
  await assert.rejects(
    () => service.complete({ code: "c", state: "otro-state", transaction }, context),
    /no es válida/,
  );
  await assert.rejects(
    () => service.complete({ code: "c", state, transaction: "sin-firma" }, context),
    /no es válida/,
  );

  const expired = new MicrosoftAuthService(
    enabledConfig({ transactionTtlSeconds: -5 }),
    unusedAuthService,
  );
  const old = expired.authorize("http://localhost:4200");
  await assert.rejects(
    () =>
      expired.complete(
        {
          code: "c",
          state: new URL(old.authorizationUrl).searchParams.get("state") ?? "",
          transaction: old.transaction,
        },
        context,
      ),
    /expiró/,
  );
});

test("una transacción firmada con otro secreto no es aceptada", async () => {
  const issuer = new MicrosoftAuthService(
    enabledConfig({ transactionSecret: "x".repeat(40) }),
    unusedAuthService,
  );
  const verifier = new MicrosoftAuthService(enabledConfig(), unusedAuthService);
  const { authorizationUrl, transaction } = issuer.authorize("http://localhost:4200");

  await assert.rejects(
    () =>
      verifier.complete(
        {
          code: "c",
          state: new URL(authorizationUrl).searchParams.get("state") ?? "",
          transaction,
        },
        {},
      ),
    /no es válida/,
  );
});

test("con el acceso apagado ni autoriza ni completa", async () => {
  const service = new MicrosoftAuthService(
    loadMicrosoftAuthConfig({}),
    unusedAuthService,
  );

  assert.throws(() => service.authorize("http://localhost:4200"), /no está configurado/);
  await assert.rejects(
    () => service.complete({ code: "c", state: "s", transaction: "t" }, {}),
    /no está configurado/,
  );
});

async function authServiceWith(users: IdentityUserRecord[]) {
  const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
    crv: "Ed25519",
    extractable: true,
  });
  const kid = "identity-microsoft-test";
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value), "utf8").toString("base64");
  const config: AuthConfig = {
    enabled: true,
    issuer: "levantamiento-rq-test",
    audience: "levantamiento-rq-test",
    accessPrivateJwk: encode({
      ...(await exportJWK(privateKey)),
      kid,
      alg: "EdDSA",
      use: "sig",
    }),
    accessPublicJwks: encode({
      keys: [
        {
          ...(await exportJWK(publicKey)),
          kid,
          alg: "EdDSA",
          use: "sig",
          principal: "identity",
        },
      ],
    }),
    accessKeyId: kid,
    refreshSecret: "b".repeat(64),
    accessTtlSeconds: 300,
    refreshTtlSeconds: 3600,
    inactivityTtlSeconds: 1800,
  };
  const events: string[] = [];
  const store = {
    findUserByEmailNormalized: (email: string) =>
      Promise.resolve(users.find((user) => user.emailNormalized === email) ?? null),
    createRefreshSession: () => Promise.resolve(),
    updateLastLogin: () => Promise.resolve(),
    recordSecurityEvent: (type: string) => {
      events.push(type);
      return Promise.resolve();
    },
  } as unknown as IdentityStore;

  return {
    events,
    auth: new AuthService(config, store, new PasswordHasher(), new TokenService(config)),
  };
}

function userRecord(isActive: boolean): IdentityUserRecord {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    email: "Persona@Empresa.com",
    emailNormalized: "persona@empresa.com",
    displayName: "Persona Prueba",
    passwordHash: "no-se-usa",
    isActive,
    mustChangePassword: false,
    sessionVersion: 1,
    roles: ["ANALYST"],
    permissions: ["requirements.read"],
  };
}

test("la identidad de Microsoft solo abre sesión para cuentas locales activas", async () => {
  const active = await authServiceWith([userRecord(true)]);
  const session = await active.auth.signInWithExternalIdentity(
    "PERSONA@empresa.com",
    "MICROSOFT",
  );
  assert.equal(session.user.email, "Persona@Empresa.com");
  assert.ok(session.accessToken.length > 20);
  assert.deepEqual(active.events, ["LOGIN_SUCCEEDED"]);

  const inactive = await authServiceWith([userRecord(false)]);
  await assert.rejects(
    () => inactive.auth.signInWithExternalIdentity("persona@empresa.com", "MICROSOFT"),
    /no tiene acceso activo/,
  );
  assert.deepEqual(inactive.events, ["LOGIN_FAILED"]);

  const unknown = await authServiceWith([]);
  await assert.rejects(
    () => unknown.auth.signInWithExternalIdentity("otra@empresa.com", "MICROSOFT"),
    /no tiene acceso activo/,
  );
  assert.deepEqual(unknown.events, ["LOGIN_FAILED"]);
});

test("el Gateway redirige con cookie de transacción acotada y sin exponer tokens en la URL", async () => {
  const controller = await readFile(
    "apps/gateway/src/auth/auth-gateway.controller.ts",
    "utf8",
  );

  assert.match(controller, /@Get\("microsoft\/start"\)/);
  assert.match(controller, /@Get\("microsoft\/callback"\)/);
  assert.match(controller, /MICROSOFT_TRANSACTION_COOKIE/);
  assert.match(controller, /path: MICROSOFT_TRANSACTION_PATH/);
  assert.match(controller, /this\.config\.webOrigins\.includes\(normalized\)/);
  assert.doesNotMatch(controller, /redirect\([^)]*accessToken/);
});

test("el diseño del acceso ofrece Microsoft, mostrar contraseña y usa solo colores de Apariencia", async () => {
  const [form, styles] = await Promise.all([
    readFile("apps/web/src/app/sign-in/sign-in-form.tsx", "utf8"),
    readFile("apps/web/src/app/auth.css", "utf8"),
  ]);

  assert.match(form, /Ingresar con Microsoft/);
  assert.match(form, /api\/v1\/auth\/microsoft\/start\?origin=/);
  assert.match(form, /aria-pressed=\{visible\}/);
  assert.match(form, /Mostrar contraseña/);
  assert.match(form, /Levantamiento <em>RQ<\/em>/);

  const start = styles.indexOf(".rq-auth-experience {");
  const end = styles.indexOf(".rq-analysis-workspace {");
  assert.ok(start > 0 && end > start);
  const block = styles.slice(start, end);
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(block, /\brgba?\(/);
  assert.match(block, /var\(--rq-color-institutional\)/);
  assert.match(block, /var\(--rq-action-operation\)/);
});
