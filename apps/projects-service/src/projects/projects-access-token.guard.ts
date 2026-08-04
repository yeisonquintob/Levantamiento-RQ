import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { jwtVerify } from "jose";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  PROJECTS_AUTH_CONFIG,
  type ProjectsAuthConfig,
} from "./projects-auth.config";
import type { ProjectsRequest } from "./projects-request";

function readBearerToken(authorization: string | string[] | undefined): string {
  const header = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  const match = header?.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new UnauthorizedException("Token de acceso requerido.");
  }

  return match[1];
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UnauthorizedException("Token de acceso inválido.");
  }

  return value;
}

function requiredStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new UnauthorizedException("Token de acceso inválido.");
  }

  return value;
}

@Injectable()
export class ProjectsAccessTokenGuard implements CanActivate {
  constructor(
    @Inject(PROJECTS_AUTH_CONFIG)
    private readonly config: ProjectsAuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ProjectsRequest>();
    const token = readBearerToken(request.headers.authorization);

    try {
      const result = await jwtVerify(
        token,
        new TextEncoder().encode(this.config.accessSecret),
        {
          issuer: this.config.issuer,
          audience: this.config.audience,
          algorithms: ["HS256"],
        },
      );

      if (result.payload.typ !== "access") {
        throw new UnauthorizedException("Tipo de token inválido.");
      }

      const principal: AuthenticatedUser = {
        id: requiredText(result.payload.sub),
        email: requiredText(result.payload.email),
        displayName: requiredText(result.payload.name),
        roles: requiredStringArray(result.payload.roles),
        permissions: requiredStringArray(result.payload.permissions),
      };

      request.authPrincipal = principal;
      request.accessToken = token;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException("Token inválido o vencido.");
    }
  }
}
