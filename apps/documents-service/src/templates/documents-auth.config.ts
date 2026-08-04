export const DOCUMENTS_AUTH_CONFIG = Symbol("DOCUMENTS_AUTH_CONFIG");

export interface DocumentsAuthConfig {
  issuer: string;
  audience: string;
  accessSecret: string;
}

function requiredSecret(value: string | undefined, name: string): string {
  const resolved = value?.trim() ?? "";

  if (resolved.length < 32) {
    throw new Error(`${name} debe tener mínimo 32 caracteres.`);
  }

  return resolved;
}

export function loadDocumentsAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): DocumentsAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessSecret: requiredSecret(
      environment.JWT_ACCESS_SECRET,
      "JWT_ACCESS_SECRET",
    ),
  };
}
