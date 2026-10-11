import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  loadGatewayConfig,
  parseWebOrigins,
} from "../../apps/gateway/src/config/gateway-config";
import {
  ACCESS_COOKIE,
  hasCookie,
  readCookie,
} from "../../apps/gateway/src/auth/cookies";
import {
  InMemorySlidingWindowLimiter,
  isBrowserMutationAllowed,
} from "../../apps/gateway/src/security/gateway-security";

test("el límite de inicio de sesión bloquea intentos y expira la ventana", () => {
  let now = 1_000;
  const limiter = new InMemorySlidingWindowLimiter(2, 60_000, () => now);

  assert.equal(limiter.consume("127.0.0.1").allowed, true);
  assert.equal(limiter.consume("127.0.0.1").allowed, true);
  const rejected = limiter.consume("127.0.0.1");
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 60);

  now += 60_001;
  assert.equal(limiter.consume("127.0.0.1").allowed, true);
});

test("login y refresh no comparten la misma clave de rate limit", async () => {
  const guard = await readFile(
    "apps/gateway/src/security/auth-rate-limit.guard.ts",
    "utf8",
  );

  assert.match(guard, /AUTH_RATE_LIMIT_CREDENTIAL_SCOPE/);

  assert.match(guard, /REFRESH_COOKIE/);

  assert.match(guard, /kind === "signin"/);

  assert.match(guard, /"refresh"/);

  assert.match(guard, /createHash\("sha256"\)[\s\S]*update\(refreshToken\)/);

  assert.doesNotMatch(guard, /`\$\{request\.ip \?\? "unknown"\}\|\$\{email\}`/);
});

test("las mutaciones de navegador exigen un origen incluido en la allowlist", () => {
  const webOrigins = [
    "http://127.0.0.1:4200",
    "http://localhost:4200",
    "http://10.20.30.40:4200",
  ];

  assert.equal(
    isBrowserMutationAllowed({
      method: "GET",
      origin: "https://evil.test",
      webOrigins,
    }),
    true,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "POST",
      origin: "http://127.0.0.1:4200",
      webOrigins,
    }),
    true,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "POST",
      origin: "http://10.20.30.40:4200",
      webOrigins,
    }),
    true,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "POST",
      origin: "https://evil.test",
      webOrigins,
    }),
    false,
  );
  assert.equal(
    isBrowserMutationAllowed({
      method: "PATCH",
      secFetchSite: "cross-site",
      webOrigins,
    }),
    false,
  );
  assert.equal(
    isBrowserMutationAllowed({ method: "POST", webOrigins }),
    true,
    "clientes internos sin cabeceras de navegador siguen habilitados",
  );
  assert.equal(
    isBrowserMutationAllowed({
      hasSessionCookie: true,
      method: "POST",
      webOrigins,
    }),
    false,
    "una mutación autenticada por cookie falla cerrada sin señales de origen",
  );
});

test("las cookies malformadas fallan cerradas sin provocar una excepción", () => {
  const header = `${ACCESS_COOKIE}=%E0%A4%A; another=value`;
  assert.equal(hasCookie(header, ACCESS_COOKIE), true);
  assert.equal(readCookie(header, ACCESS_COOKIE), null);
  assert.equal(
    readCookie("rq_access=valid%20token", ACCESS_COOKIE),
    "valid token",
  );
});

test("producción activa Secure por defecto y rechaza su desactivación", () => {
  const environment = {
    NODE_ENV: "production",
    WEB_ORIGINS: "https://app.example.com",
  };

  assert.equal(loadGatewayConfig(environment).cookieSecure, true);
  assert.throws(
    () =>
      loadGatewayConfig({
        ...environment,
        AUTH_COOKIE_SECURE: "false",
      }),
    /AUTH_COOKIE_SECURE debe ser true/u,
  );
});

test("WEB_ORIGINS normaliza, elimina duplicados y rechaza valores inseguros", () => {
  assert.deepEqual(
    parseWebOrigins(
      "http://127.0.0.1:4200, http://localhost:4200, http://127.0.0.1:4200",
    ),
    ["http://127.0.0.1:4200", "http://localhost:4200"],
  );
  assert.throws(() => parseWebOrigins("*"), /no admite/u);
  assert.throws(() => parseWebOrigins("null"), /no admite/u);
  assert.throws(() => parseWebOrigins("not-a-url"), /origen inválido/u);
});

test("CORS permite PUT para actualizar recursos administrativos", async () => {
  const gatewayMain = await readFile("apps/gateway/src/main.ts", "utf8");

  assert.match(
    gatewayMain,
    /methods:\s*\[[^\]]*"PUT"[^\]]*\]/u,
    "la actualización del logo de plantilla requiere preflight PUT autorizado",
  );
});

test("la PWA excluye navegación, API, Workspace y credenciales de la caché", async () => {
  const worker = await readFile("apps/web/public/sw.js", "utf8");
  const manifest = await readFile("apps/web/src/app/manifest.ts", "utf8");

  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /url\.pathname\.startsWith\("\/workspace"\)/);
  assert.match(worker, /request\.headers\.has\("authorization"\)/);
  const publicShell = worker.match(/const PUBLIC_SHELL = \[([\s\S]*?)\];/)?.[1];
  assert.ok(publicShell);
  assert.doesNotMatch(publicShell, /api|workspace|document/i);
  assert.match(manifest, /display: "standalone"/);
  assert.match(manifest, /icon-512\.png/);
});
