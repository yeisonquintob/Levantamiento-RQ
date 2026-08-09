import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { jwtVerify } from "jose";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  SOURCES_AUTH_CONFIG,
  type SourcesAuthConfig,
} from "./sources-auth.config";
import type { SourcesRequest } from "./sources-request";

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
export class SourcesAccessTokenGuard implements CanActivate {
  constructor(
    @Inject(SOURCES_AUTH_CONFIG)
    private readonly config: SourcesAuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SourcesRequest>();
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

      const mustChangePassword = result.payload.mustChangePassword === true;

      if (mustChangePassword) {
        throw new ForbiddenException(
          "Debes cambiar la contraseña temporal antes de continuar.",
        );
      }

      request.authPrincipal = {
        id: requiredText(result.payload.sub),
        email: requiredText(result.payload.email),
        displayName: requiredText(result.payload.name),
        roles: requiredStringArray(result.payload.roles),
        permissions: requiredStringArray(result.payload.permissions),
        mustChangePassword,
      } satisfies AuthenticatedUser;

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
