import { loadSqlServerDatabaseConfig } from "@levantamiento-rq/shared-persistence";
import { SESSION_INACTIVITY_TIMEOUT_SECONDS } from "@levantamiento-rq/shared-contracts";
import { requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const AUTH_CONFIG = Symbol("AUTH_CONFIG");

export interface AuthConfig {
  enabled: boolean;
  issuer: string;
  audience: string;
  accessPrivateJwk: string;
  accessPublicJwks: string;
  accessKeyId: string;
  refreshSecret: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  inactivityTtlSeconds: number;
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error("AUTH_ENABLED debe ser true o false.");
}

function readInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const resolved = value?.trim() ? Number(value) : fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} debe estar entre ${minimum} y ${maximum}.`);
  }
  return resolved;
}

function readSecret(value: string | undefined, name: string): string {
  const resolved = value?.trim() ?? "";
  if (resolved.length < 32) {
    throw new Error(`${name} debe tener mínimo 32 caracteres.`);
  }
  return resolved;
}

export function loadAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const enabled = readBoolean(environment.AUTH_ENABLED, false);

  if (!enabled) {
    return {
      enabled: false,
      issuer: "levantamiento-rq-identity",
      audience: "levantamiento-rq",
      accessPrivateJwk: "",
      accessPublicJwks: "",
      accessKeyId: "",
      refreshSecret: "",
      accessTtlSeconds: 900,
      refreshTtlSeconds: 604800,
      inactivityTtlSeconds: SESSION_INACTIVITY_TIMEOUT_SECONDS,
    };
  }

  const database = loadSqlServerDatabaseConfig(
    {
      serviceName: "identity-service",
      defaultDatabaseName: "RqIdentityDb",
    },
    environment,
  );

  if (!database.enabled) {
    throw new Error(
      "AUTH_ENABLED=true requiere DATABASE_ENABLED=true en identity-service.",
    );
  }

  const accessPrivateJwk = environment.JWT_ACCESS_PRIVATE_JWK_BASE64?.trim() ?? "";
  let privateJwk: Readonly<Record<string, unknown>>;
  try {
    privateJwk = JSON.parse(Buffer.from(accessPrivateJwk, "base64").toString("utf8")) as Readonly<Record<string, unknown>>;
  } catch {
    throw new Error("JWT_ACCESS_PRIVATE_JWK_BASE64 debe contener un JWK Ed25519 codificado en base64.");
  }
  const accessKeyId = environment.JWT_ACCESS_KEY_ID?.trim() ?? "";
  if (
    privateJwk.kty !== "OKP" ||
    privateJwk.crv !== "Ed25519" ||
    typeof privateJwk.d !== "string" ||
    privateJwk.kid !== accessKeyId ||
    !accessKeyId
  ) {
    throw new Error("La clave privada de acceso debe ser Ed25519 y su kid debe coincidir con JWT_ACCESS_KEY_ID.");
  }
  const accessPublicJwks = requiredPublicJwks(
    environment.JWT_ACCESS_PUBLIC_JWKS_BASE64,
  );
  const refreshSecret = readSecret(
    environment.JWT_REFRESH_SECRET,
    "JWT_REFRESH_SECRET",
  );

  return {
    enabled: true,
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPrivateJwk,
    accessPublicJwks,
    accessKeyId,
    refreshSecret,
    accessTtlSeconds: readInteger(
      environment.JWT_ACCESS_TTL_SECONDS,
      900,
      60,
      3600,
      "JWT_ACCESS_TTL_SECONDS",
    ),
    refreshTtlSeconds: readInteger(
      environment.JWT_REFRESH_TTL_SECONDS,
      604800,
      3600,
      2592000,
      "JWT_REFRESH_TTL_SECONDS",
    ),
    inactivityTtlSeconds: SESSION_INACTIVITY_TIMEOUT_SECONDS,
  };
}
