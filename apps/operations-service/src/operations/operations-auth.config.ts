import { requiredPrivateJwk, requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const OPERATIONS_AUTH_CONFIG = Symbol("OPERATIONS_AUTH_CONFIG");

export interface OperationsAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  workloadPrivateJwk: string;
  workloadKeyId: string;
  projectsServiceUrl: string;
  projectsTimeoutMs: number;
  documentsServiceUrl: string;
  documentsTimeoutMs: number;
}

function url(value: string | undefined, fallback: string, name: string) {
  try {
    return new URL(value?.trim() || fallback).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} debe ser una URL absoluta válida.`);
  }
}

function timeout(value: string | undefined, name: string): number {
  const result = value?.trim() ? Number(value) : 8000;
  if (!Number.isInteger(result) || result < 500 || result > 30_000) {
    throw new Error(`${name} debe estar entre 500 y 30000.`);
  }
  return result;
}

export function loadOperationsAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): OperationsAuthConfig {
  const workloadKeyId = environment.WORKLOAD_JWT_KEY_ID?.trim() ?? "";
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(environment.JWT_ACCESS_PUBLIC_JWKS_BASE64),
    workloadKeyId,
    workloadPrivateJwk: requiredPrivateJwk(
      environment.WORKLOAD_JWT_PRIVATE_JWK_BASE64,
      workloadKeyId,
    ),
    projectsServiceUrl: url(
      environment.PROJECTS_SERVICE_URL,
      "http://127.0.0.1:3002",
      "PROJECTS_SERVICE_URL",
    ),
    projectsTimeoutMs: timeout(
      environment.PROJECTS_TIMEOUT_MS,
      "PROJECTS_TIMEOUT_MS",
    ),
    documentsServiceUrl: url(
      environment.DOCUMENTS_SERVICE_URL,
      "http://127.0.0.1:3004",
      "DOCUMENTS_SERVICE_URL",
    ),
    documentsTimeoutMs: timeout(
      environment.DOCUMENTS_TIMEOUT_MS,
      "DOCUMENTS_TIMEOUT_MS",
    ),
  };
}
