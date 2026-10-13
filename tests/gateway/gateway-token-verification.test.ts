import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";

import { SignJWT } from "jose";

import { loadGatewayConfig } from "../../apps/gateway/src/config/gateway-config";
import {
  acceptsAccessToken,
  hasAccessCredential,
  selectAccessToken,
} from "../../apps/gateway/src/security/gateway-security";

const KEY_ID = "gateway-test-key";
const ISSUER = "levantamiento-rq-identity";
const AUDIENCE = "levantamiento-rq";

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicJwk: publicKey.export({ format: "jwk" }) };
}
const trusted = keyPair();
const stranger = keyPair();

function jwks(publicJwk: object, principal = "identity"): string {
  return Buffer.from(
    JSON.stringify({
      keys: [
        { ...publicJwk, kid: KEY_ID, alg: "EdDSA", use: "sig", principal },
      ],
    }),
  ).toString("base64");
}

const VERIFICATION = {
  issuer: ISSUER,
  audience: AUDIENCE,
  publicJwks: jwks(trusted.publicJwk),
};

async function token(
  options: {
    key?: ReturnType<typeof keyPair>["privateKey"];
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    typ?: string;
  } = {},
) {
  return new SignJWT({
    typ: options.typ ?? "access",
    email: "ana@example.test",
    name: "Ana",
    roles: ["ANALYST"],
    permissions: [],
  })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: KEY_ID })
    .setSubject("11111111-1111-4111-8111-111111111111")
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "5m")
    .sign(options.key ?? trusted.privateKey);
}

test("el Gateway acepta un token de Identity vigente", async () => {
  assert.equal(await acceptsAccessToken(await token(), VERIFICATION), true);
});

test("el Gateway rechaza antes de leer el cuerpo un token falso, ajeno, caducado o sin firma", async () => {
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
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT", kid: KEY_ID }),
  ).toString("base64url");

  const rejected: Record<string, string> = {
    "cadena cualquiera": "abc.def.ghi",
    "texto sin formato": "x",
    "firmado con otra clave": await token({ key: stranger.privateKey }),
    "otro emisor": await token({ issuer: "otro-emisor" }),
    "otra audiencia": await token({ audience: "otra-audiencia" }),
    caducado: await token({ expiresIn: "-1m" }),
    "no es de acceso": await token({ typ: "refresh" }),
    "alg none": `${header}.${forgedPayload}.`,
  };
  for (const [label, value] of Object.entries(rejected))
    assert.equal(await acceptsAccessToken(value, VERIFICATION), false, label);
});

test("un token con la firma alterada se rechaza", async () => {
  const [header, payload, signature] = (await token()).split(".");
  const tampered = `${header}.${payload}.${signature?.slice(0, -4)}AAAA`;

  assert.equal(await acceptsAccessToken(tampered, VERIFICATION), false);
});

test("sin JWKS configurado solo se exige que haya credencial (fuera de producción)", async () => {
  assert.equal(await acceptsAccessToken("cualquier-cosa", null), true);
});

test("se elige el token como los controladores: primero la cookie y después el Bearer", () => {
  assert.equal(
    selectAccessToken({
      cookieHeader: "rq_access=DE-COOKIE",
      authorization: "Bearer DE-BEARER",
    }),
    "DE-COOKIE",
  );
  assert.equal(
    selectAccessToken({ authorization: "Bearer DE-BEARER" }),
    "DE-BEARER",
  );
  assert.equal(
    selectAccessToken({ authorization: "bearer minúscula" }),
    "minúscula",
  );
  assert.equal(selectAccessToken({ cookieHeader: "rq_refresh=R" }), null);
  assert.equal(selectAccessToken({ authorization: "Basic abc" }), null);
  assert.equal(selectAccessToken({ authorization: "Bearer " }), null);
  assert.equal(selectAccessToken({}), null);
  assert.equal(hasAccessCredential({ authorization: "Bearer abc" }), true);
  assert.equal(hasAccessCredential({}), false);
});

const PRODUCTION_ENV = {
  NODE_ENV: "production",
  WEB_ORIGINS: "https://app.example.test",
  AUTH_COOKIE_SECURE: "true",
};

test("en producción el Gateway exige las claves públicas para verificar los tokens", () => {
  assert.throws(
    () => loadGatewayConfig(PRODUCTION_ENV),
    /JWT_ACCESS_PUBLIC_JWKS_BASE64 es obligatorio en producción/u,
  );
  assert.throws(
    () =>
      loadGatewayConfig({
        ...PRODUCTION_ENV,
        JWT_ACCESS_PUBLIC_JWKS_BASE64: "no-es-base64-json",
      }),
    /JWKS|base64|JSON/iu,
  );

  const config = loadGatewayConfig({
    ...PRODUCTION_ENV,
    JWT_ACCESS_PUBLIC_JWKS_BASE64: VERIFICATION.publicJwks,
  });
  assert.deepEqual(config.accessTokenVerification, VERIFICATION);
});

test("fuera de producción las claves son opcionales y el emisor y la audiencia se pueden cambiar", () => {
  assert.equal(loadGatewayConfig({}).accessTokenVerification, null);

  const config = loadGatewayConfig({
    JWT_ACCESS_PUBLIC_JWKS_BASE64: VERIFICATION.publicJwks,
    JWT_ISSUER: "otro-emisor",
    JWT_AUDIENCE: "otra-audiencia",
  });
  assert.equal(config.accessTokenVerification?.issuer, "otro-emisor");
  assert.equal(config.accessTokenVerification?.audience, "otra-audiencia");
});
