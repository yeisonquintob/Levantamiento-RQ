import { requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const DOCUMENTS_AUTH_CONFIG = Symbol("DOCUMENTS_AUTH_CONFIG");

export interface DocumentsAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  projectsServiceUrl: string;
  sourcesServiceUrl: string;
  projectsTimeoutMs: number;
  sourcesTimeoutMs: number;
}

function readUrl(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  try {
    return new URL(value?.trim() || fallback).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} debe ser una URL absoluta válida.`);
  }
}

function readTimeout(value: string | undefined, name: string): number {
  const resolved = value?.trim() ? Number(value) : 8000;

  if (!Number.isInteger(resolved) || resolved < 500 || resolved > 30000) {
    throw new Error(`${name} debe estar entre 500 y 30000.`);
  }

  return resolved;
}

export function loadDocumentsAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentsAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(environment.JWT_ACCESS_PUBLIC_JWKS_BASE64),
    projectsServiceUrl: readUrl(
      environment.PROJECTS_SERVICE_URL,
      "http://127.0.0.1:3002",
      "PROJECTS_SERVICE_URL",
    ),
    sourcesServiceUrl: readUrl(
      environment.SOURCES_SERVICE_URL,
      "http://127.0.0.1:3003",
      "SOURCES_SERVICE_URL",
    ),
    projectsTimeoutMs: readTimeout(
      environment.PROJECTS_TIMEOUT_MS,
      "PROJECTS_TIMEOUT_MS",
    ),
    sourcesTimeoutMs: readTimeout(
      environment.SOURCES_TIMEOUT_MS,
      "SOURCES_TIMEOUT_MS",
    ),
  };
}
