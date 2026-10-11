import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { verifyAccessJwt } from "@levantamiento-rq/shared-http";
import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";
import {
  PROTOTYPES_AUTH_CONFIG,
  type PrototypesAuthConfig,
} from "./prototypes-auth.config";
import type { PrototypesRequest } from "./prototypes-request";

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new UnauthorizedException("Token de acceso inválido.");
  return value;
}
function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
    throw new UnauthorizedException("Token de acceso inválido.");
  return value;
}
@Injectable()
export class PrototypesAccessTokenGuard implements CanActivate {
  constructor(
    @Inject(PROTOTYPES_AUTH_CONFIG)
    private readonly config: PrototypesAuthConfig,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PrototypesRequest>();
    const header = Array.isArray(request.headers.authorization)
      ? request.headers.authorization[0]
      : request.headers.authorization;
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException("Token de acceso requerido.");
    try {
      const payload = await verifyAccessJwt(token, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        publicJwks: this.config.accessPublicJwks,
      });
      if (payload.mustChangePassword === true)
        throw new ForbiddenException(
          "Debes cambiar la contraseña temporal antes de continuar.",
        );
      request.authPrincipal = {
        id: text(payload.sub),
        email: text(payload.email),
        displayName: text(payload.name),
        roles: strings(payload.roles),
        permissions: strings(payload.permissions),
        mustChangePassword: false,
      } satisfies AuthenticatedUser;
      request.accessToken = token;
      const correlation = request.headers["x-correlation-id"];
      request.correlationId =
        (Array.isArray(correlation) ? correlation[0] : correlation)?.trim() ||
        randomUUID();
      return true;
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      )
        throw error;
      throw new UnauthorizedException("Token inválido o vencido.");
    }
  }
}
