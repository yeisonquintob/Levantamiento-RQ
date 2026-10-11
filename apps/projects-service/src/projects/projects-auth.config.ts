import { requiredPublicJwks } from "@levantamiento-rq/shared-http";

export const PROJECTS_AUTH_CONFIG = Symbol("PROJECTS_AUTH_CONFIG");

export interface ProjectsAuthConfig {
  issuer: string;
  audience: string;
  accessPublicJwks: string;
}

export function loadProjectsAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ProjectsAuthConfig {
  return {
    issuer: environment.JWT_ISSUER?.trim() || "levantamiento-rq-identity",
    audience: environment.JWT_AUDIENCE?.trim() || "levantamiento-rq",
    accessPublicJwks: requiredPublicJwks(
      environment.JWT_ACCESS_PUBLIC_JWKS_BASE64,
    ),
  };
}
