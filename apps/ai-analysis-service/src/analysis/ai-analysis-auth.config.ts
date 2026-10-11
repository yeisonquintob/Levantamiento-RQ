import { requiredPrivateJwk, requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const AI_ANALYSIS_AUTH_CONFIG = Symbol("AI_ANALYSIS_AUTH_CONFIG");

export interface AiAnalysisAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  workloadPrivateJwk: string;
  workloadKeyId: string;
  projectsServiceUrl: string;
  projectsTimeoutMs: number;
  documentsServiceUrl: string;
  documentsTimeoutMs: number;
  sourcesServiceUrl: string;
  sourcesTimeoutMs: number;
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

export function loadAiAnalysisAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AiAnalysisAuthConfig {
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
    sourcesServiceUrl: readUrl(
      environment.SOURCES_SERVICE_URL,
      "http://127.0.0.1:3003",
      "SOURCES_SERVICE_URL",
    ),
    sourcesTimeoutMs: readTimeout(
      environment.SOURCES_TIMEOUT_MS,
      "SOURCES_TIMEOUT_MS",
    ),
  };
}
