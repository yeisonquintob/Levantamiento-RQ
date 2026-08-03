export const PROJECTS_AUTH_CONFIG = Symbol("PROJECTS_AUTH_CONFIG");

export interface ProjectsAuthConfig {
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

export function loadProjectsAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProjectsAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessSecret: requiredSecret(
      environment.JWT_ACCESS_SECRET,
      "JWT_ACCESS_SECRET",
    ),
  };
}
