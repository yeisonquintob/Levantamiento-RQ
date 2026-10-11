import { requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const WORKFLOW_AUTH_CONFIG = Symbol("WORKFLOW_AUTH_CONFIG");

export interface WorkflowAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  projectsServiceUrl: string;
  projectsTimeoutMs: number;
  documentsServiceUrl: string;
  documentsTimeoutMs: number;
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

function readTimeout(value: string | undefined, name: string): number {
  const resolved = value?.trim() ? Number(value) : 8000;

  if (!Number.isInteger(resolved) || resolved < 500 || resolved > 30000) {
    throw new Error(`${name} debe estar entre 500 y 30000.`);
  }

  return resolved;
}

export function loadWorkflowAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkflowAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(environment.JWT_ACCESS_PUBLIC_JWKS_BASE64),
    projectsServiceUrl: readUrl(
      environment.PROJECTS_SERVICE_URL,
      "http://127.0.0.1:3002",
      "PROJECTS_SERVICE_URL",
    ),
    projectsTimeoutMs: readTimeout(
      environment.PROJECTS_TIMEOUT_MS,
      "PROJECTS_TIMEOUT_MS",
    ),
    documentsServiceUrl: readUrl(
      environment.DOCUMENTS_SERVICE_URL,
      "http://127.0.0.1:3004",
      "DOCUMENTS_SERVICE_URL",
    ),
    documentsTimeoutMs: readTimeout(
      environment.DOCUMENTS_TIMEOUT_MS,
      "DOCUMENTS_TIMEOUT_MS",
    ),
  };
}
