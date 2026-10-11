import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { verifyAccessJwt } from "@levantamiento-rq/shared-http";

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
      const payload = await verifyAccessJwt(token, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        publicJwks: this.config.accessPublicJwks,
      });

      const mustChangePassword = payload.mustChangePassword === true;

      if (mustChangePassword) {
        throw new ForbiddenException(
          "Debes cambiar la contraseña temporal antes de continuar.",
        );
      }

      const principal: AuthenticatedUser = {
        id: requiredText(payload.sub),
        email: requiredText(payload.email),
        displayName: requiredText(payload.name),
        roles: requiredStringArray(payload.roles),
        permissions: requiredStringArray(payload.permissions),
        mustChangePassword,
      };

      request.authPrincipal = principal;
      request.accessToken = token;
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      throw new UnauthorizedException("Token inválido o vencido.");
    }
  }
}
