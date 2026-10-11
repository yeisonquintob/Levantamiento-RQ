import {
  requiredPrivateJwk,
  requiredPublicJwks,
} from "@levantamiento-rq/shared-http";
export const PROTOTYPES_AUTH_CONFIG = Symbol("PROTOTYPES_AUTH_CONFIG");
export interface PrototypesAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
  workloadPrivateJwk: string;
  workloadKeyId: string;
  aiAnalysisServiceUrl: string;
  aiAnalysisTimeoutMs: number;
}
export function loadPrototypesAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PrototypesAuthConfig {
  const workloadKeyId = environment.WORKLOAD_JWT_KEY_ID?.trim() ?? "";
  const aiAnalysisServiceUrl =
    environment.AI_ANALYSIS_SERVICE_URL?.trim() || "http://127.0.0.1:3005";
  try {
    new URL(aiAnalysisServiceUrl);
  } catch {
    throw new Error("AI_ANALYSIS_SERVICE_URL debe ser una URL válida.");
  }
  const timeout = environment.AI_ANALYSIS_TIMEOUT_MS?.trim()
    ? Number(environment.AI_ANALYSIS_TIMEOUT_MS)
    : 600000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 600000)
    throw new Error("AI_ANALYSIS_TIMEOUT_MS no es válido.");
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(
      environment.JWT_ACCESS_PUBLIC_JWKS_BASE64,
    ),
    workloadKeyId,
    workloadPrivateJwk: requiredPrivateJwk(
      environment.WORKLOAD_JWT_PRIVATE_JWK_BASE64,
      workloadKeyId,
    ),
    aiAnalysisServiceUrl: aiAnalysisServiceUrl.replace(/\/$/, ""),
    aiAnalysisTimeoutMs: timeout,
  };
}
