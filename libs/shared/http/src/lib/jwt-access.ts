import { createLocalJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface JwtAccessVerificationConfig {
  issuer: string;
  audience: string;
  publicJwks: string;
}

const keySets = new Map<string, ReturnType<typeof createLocalJWKSet>>();

const WORKLOAD_POLICIES = {
  "ai-analysis-service": {
    subject: "00000000-0000-4000-8000-000000000005",
    permissions: [
      "documents.ai.apply",
      "documents.read.all",
      "projects.read.all",
      "sources.internal-image.read",
    ],
  },
  "operations-service": {
    subject: "00000000-0000-4000-8000-000000000008",
    permissions: [
      "documents.approved.read",
      "projects.read.all",
      "templates.published.read",
    ],
  },
  "prototypes-service": {
    subject: "00000000-0000-4000-8000-000000000009",
    permissions: ["ai.prototype-plan.execute"],
  },
} as const;

function decodeBase64Json(value: string, name: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw new Error(`${name} debe contener JSON codificado en base64.`);
  }
}

export function requiredPublicJwks(
  value: string | undefined,
  name = "JWT_ACCESS_PUBLIC_JWKS_BASE64",
): string {
  const encoded = value?.trim() ?? "";
  const parsed = decodeBase64Json(encoded, name) as {
    keys?: readonly Record<string, unknown>[];
  };
  if (!Array.isArray(parsed.keys) || parsed.keys.length < 1) {
    throw new Error(`${name} debe contener al menos una clave pública.`);
  }
  for (const key of parsed.keys) {
    if (
      key.kty !== "OKP" ||
      key.crv !== "Ed25519" ||
      typeof key.x !== "string" ||
      typeof key.kid !== "string" ||
      !key.kid.trim() ||
      (key.principal !== "identity" &&
        !(
          typeof key.principal === "string" &&
          key.principal in WORKLOAD_POLICIES
        )) ||
      "d" in key
    ) {
      throw new Error(`${name} solo admite claves públicas Ed25519 con kid.`);
    }
  }
  return encoded;
}

export function requiredPrivateJwk(
  value: string | undefined,
  keyId: string,
  name = "WORKLOAD_JWT_PRIVATE_JWK_BASE64",
): string {
  const encoded = value?.trim() ?? "";
  const key = decodeBase64Json(encoded, name) as Readonly<Record<string, unknown>>;
  if (
    key.kty !== "OKP" ||
    key.crv !== "Ed25519" ||
    typeof key.x !== "string" ||
    typeof key.d !== "string" ||
    key.kid !== keyId ||
    !keyId
  ) {
    throw new Error(`${name} debe ser una clave privada Ed25519 cuyo kid coincida.`);
  }
  return encoded;
}

function localKeySet(encoded: string) {
  const existing = keySets.get(encoded);
  if (existing) return existing;
  const jwks = decodeBase64Json(encoded, "JWT_ACCESS_PUBLIC_JWKS_BASE64") as {
    keys: Parameters<typeof createLocalJWKSet>[0]["keys"];
  };
  const created = createLocalJWKSet(jwks);
  keySets.set(encoded, created);
  return created;
}

export async function verifyAccessJwt(
  token: string,
  config: JwtAccessVerificationConfig,
): Promise<JWTPayload> {
  const result = await jwtVerify(token, localKeySet(config.publicJwks), {
    issuer: config.issuer,
    audience: config.audience,
    algorithms: ["EdDSA"],
    typ: "JWT",
  });
  if (!result.protectedHeader.kid?.trim()) {
    throw new Error("El token no contiene kid.");
  }
  if (result.payload.typ !== "access") {
    throw new Error("Tipo de token inválido.");
  }
  const jwks = decodeBase64Json(config.publicJwks, "JWT_ACCESS_PUBLIC_JWKS_BASE64") as {
    keys: readonly Record<string, unknown>[];
  };
  const signingKey = jwks.keys.find(
    (key) => key.kid === result.protectedHeader.kid,
  );
  if (!signingKey) {
    throw new Error("La clave de firma no está autorizada.");
  }
  const principal = signingKey.principal;
  if (principal === "identity") {
    if (result.payload.service !== undefined) {
      throw new Error("Identity no emite tokens de workload.");
    }
  } else if (typeof principal === "string" && principal in WORKLOAD_POLICIES) {
    const policy = WORKLOAD_POLICIES[principal as keyof typeof WORKLOAD_POLICIES];
    const roles = Array.isArray(result.payload.roles)
      ? [...result.payload.roles].sort()
      : [];
    const permissions = Array.isArray(result.payload.permissions)
      ? [...result.payload.permissions].sort()
      : [];
    if (
      result.payload.service !== principal ||
      result.payload.sub !== policy.subject ||
      JSON.stringify(roles) !== JSON.stringify(["SERVICE"]) ||
      JSON.stringify(permissions) !==
        JSON.stringify([...policy.permissions].sort())
    ) {
      throw new Error("Los privilegios del workload no coinciden con su identidad de firma.");
    }
  } else {
    throw new Error("Principal de firma no permitido.");
  }
  return result.payload;
}
