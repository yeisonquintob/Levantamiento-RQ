import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequest } from "./auth-request";

const REQUIRED_PERMISSIONS = "rq:required-permissions";

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<readonly string[]>(
        REQUIRED_PERMISSIONS,
        [context.getHandler(), context.getClass()],
      ) ?? [];

    if (required.length === 0) {
      return true;
    }

    const request =
      context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = new Set(request.authPrincipal?.permissions ?? []);
    const allowed = required.every((permission) =>
      granted.has(permission),
    );

    if (!allowed) {
      throw new ForbiddenException(
        "La cuenta no tiene los permisos requeridos.",
      );
    }

    return true;
  }
}
