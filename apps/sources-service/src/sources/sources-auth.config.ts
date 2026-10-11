import { requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const SOURCES_AUTH_CONFIG = Symbol("SOURCES_AUTH_CONFIG");

export interface SourcesAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  projectsServiceUrl: string;
  projectsTimeoutMs: number;
}

function readUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  const resolved = value?.trim() || fallback;

  try {
    return new URL(resolved).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} debe ser una URL absoluta válida.`);
  }
}

function readInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value?.trim() ? Number(value) : fallback;

  if (!Number.isInteger(resolved) || resolved < 500 || resolved > 30000) {
    throw new Error(`${name} debe estar entre 500 y 30000.`);
  }

  return resolved;
}

export function loadSourcesAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SourcesAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(environment.JWT_ACCESS_PUBLIC_JWKS_BASE64),
    projectsServiceUrl: readUrl(
      environment.PROJECTS_SERVICE_URL,
      "http://127.0.0.1:3002",
      "PROJECTS_SERVICE_URL",
    ),
    projectsTimeoutMs: readInteger(
      environment.PROJECTS_TIMEOUT_MS,
      8000,
      "PROJECTS_TIMEOUT_MS",
    ),
  };
}
