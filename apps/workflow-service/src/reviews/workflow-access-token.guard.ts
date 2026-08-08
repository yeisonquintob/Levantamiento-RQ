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
  WORKFLOW_AUTH_CONFIG,
  type WorkflowAuthConfig,
} from "./workflow-auth.config";
import type { WorkflowRequest } from "./workflow-request";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readBearerToken(value: string | string[] | undefined): string {
  const match = first(value)?.match(/^Bearer\s+(.+)$/i);

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

function readIdempotencyKey(
  value: string | string[] | undefined,
): string | null {
  const resolved = first(value)?.trim();

  if (!resolved) return null;
  if (resolved.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(resolved)) {
    throw new BadRequestException(
      "x-idempotency-key debe usar caracteres seguros y máximo 120 posiciones.",
    );
  }

  return resolved;
}

function readCorrelationId(value: string | string[] | undefined): string {
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

@Injectable()
export class WorkflowAccessTokenGuard implements CanActivate {
  constructor(
    @Inject(WORKFLOW_AUTH_CONFIG)
    private readonly config: WorkflowAuthConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkflowRequest>();
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
      request.correlationId = readCorrelationId(
        request.headers["x-correlation-id"],
      );
      request.idempotencyKey = readIdempotencyKey(
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
