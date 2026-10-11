import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type OnModuleDestroy,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import Redis from "ioredis";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";
import {
  readCookie,
  REFRESH_COOKIE,
} from "../auth/cookies";

interface RequestLike {
  ip?: string;
  headers?: Readonly<
    Record<
      string,
      string | string[] | undefined
    >
  >;
  body?: Readonly<Record<string, unknown>>;
}

function first(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value)
    ? value[0]
    : value;
}

@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly maximum: number;
  private readonly windowSeconds: number;

  constructor(
    @Inject(GATEWAY_CONFIG)
    config: GatewayConfig,
  ) {
    this.maximum = config.authSignInRateLimit;
    this.windowSeconds = config.authSignInRateWindowSeconds;
    this.redis = new Redis({
      host: config.rateLimitRedisHost,
      port: config.rateLimitRedisPort,
      ...(config.rateLimitRedisPassword ? { password: config.rateLimitRedisPassword } : {}),
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request =
      context.switchToHttp().getRequest<RequestLike>();

    const email =
      typeof request.body?.email === "string"
        ? request.body.email
            .trim()
            .toLowerCase()
        : null;

    const refreshToken = readCookie(
      first(request.headers?.cookie),
      REFRESH_COOKIE,
    );

    /*
     * AUTH_RATE_LIMIT_CREDENTIAL_SCOPE
     *
     * Login:
     *   IP + correo.
     *
     * Refresh:
     *   IP + hash del refresh token.
     *
     * Antes todos los refresh sin email compartían
     * la misma clave "<ip>|none", por lo que varias
     * pestañas/usuarios podían agotar entre sí el
     * límite de login.
     */
    const kind = email
      ? "signin"
      : refreshToken
        ? "refresh"
        : "anonymous";

    const credential = email
      ? email
      : refreshToken
        ? createHash("sha256")
            .update(refreshToken)
            .digest("hex")
        : "none";

    const fingerprint = createHash(
      "sha256",
    )
      .update(
        `${request.ip ?? "unknown"}|${credential}`,
      )
      .digest("hex");

    const bucket = Math.floor(
      Date.now() /
        (this.windowSeconds * 1000),
    );

    const key =
      `rq:gateway:rate:auth:${kind}:` +
      `${bucket}:${fingerprint}`;

    const result = await this.redis
      .multi()
      .incr(key)
      .expire(
        key,
        this.windowSeconds,
        "NX",
      )
      .exec();

    const attempts = Number(
      result?.[0]?.[1] ??
        this.maximum + 1,
    );

    if (attempts > this.maximum) {
      const ttl = Math.max(
        1,
        await this.redis.ttl(key),
      );

      throw new HttpException(
        {
          code: "AUTH_RATE_LIMITED",
          statusCode:
            HttpStatus.TOO_MANY_REQUESTS,
          message:
            kind === "signin"
              ? "Demasiados intentos de inicio de sesión. Intenta nuevamente más tarde."
              : "Demasiadas renovaciones de sesión. Intenta nuevamente más tarde.",
          retryAfterSeconds: ttl,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
