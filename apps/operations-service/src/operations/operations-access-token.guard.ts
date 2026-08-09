import { randomUUID } from "node:crypto";

import {
  BadRequestException,
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
  OPERATIONS_AUTH_CONFIG,
  type OperationsAuthConfig,
} from "./operations-auth.config";
import type { OperationsRequest } from "./operations-request";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UnauthorizedException("Token de acceso inválido.");
  }
  return value;
}

function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new UnauthorizedException("Token de acceso inválido.");
  }
  return value;
}

function correlationId(value: string | string[] | undefined): string {
  const resolved = first(value)?.trim();
  if (!resolved) return randomUUID();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      resolved,
    )
  ) {
    throw new BadRequestException("x-correlation-id debe ser un UUID válido.");
  }
  return resolved.toLowerCase();
}

function idempotencyKey(value: string | string[] | undefined): string | null {
  const resolved = first(value)?.trim();
  if (!resolved) return null;
  if (resolved.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(resolved)) {
    throw new BadRequestException(
      "x-idempotency-key debe usar caracteres seguros y máximo 120 posiciones.",
    );
  }
  return resolved;
}

@Injectable()
export class OperationsAccessTokenGuard implements CanActivate {
  constructor(
    @Inject(OPERATIONS_AUTH_CONFIG)
    private readonly config: OperationsAuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<OperationsRequest>();
    const match = first(request.headers.authorization)?.match(
      /^Bearer\s+(.+)$/i,
    );
    if (!match?.[1])
      throw new UnauthorizedException("Token de acceso requerido.");
    try {
      const verified = await jwtVerify(
        match[1],
        new TextEncoder().encode(this.config.accessSecret),
        {
          issuer: this.config.issuer,
          audience: this.config.audience,
          algorithms: ["HS256"],
        },
      );
      if (verified.payload.typ !== "access") {
        throw new UnauthorizedException("Tipo de token inválido.");
      }
      if (verified.payload.mustChangePassword === true) {
        throw new ForbiddenException(
          "Debes cambiar la contraseña temporal antes de continuar.",
        );
      }
      request.authPrincipal = {
        id: requiredText(verified.payload.sub),
        email: requiredText(verified.payload.email),
        displayName: requiredText(verified.payload.name),
        roles: stringArray(verified.payload.roles),
        permissions: stringArray(verified.payload.permissions),
        mustChangePassword: false,
      } satisfies AuthenticatedUser;
      request.accessToken = match[1];
      request.correlationId = correlationId(
        request.headers["x-correlation-id"],
      );
      request.idempotencyKey = idempotencyKey(
        request.headers["x-idempotency-key"],
      );
      return true;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }
      throw new UnauthorizedException("Token inválido o vencido.");
    }
  }
}
