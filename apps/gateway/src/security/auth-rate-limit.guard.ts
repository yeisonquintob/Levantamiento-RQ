import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";
import { InMemorySlidingWindowLimiter } from "./gateway-security";

interface RequestLike {
  ip?: string;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly limiter: InMemorySlidingWindowLimiter;

  constructor(
    @Inject(GATEWAY_CONFIG)
    config: GatewayConfig,
  ) {
    this.limiter = new InMemorySlidingWindowLimiter(
      config.authSignInRateLimit,
      config.authSignInRateWindowSeconds * 1000,
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestLike>();
    const decision = this.limiter.consume(request.ip ?? "unknown");

    if (!decision.allowed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message:
            "Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde.",
          retryAfterSeconds: decision.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
