import { createHash, randomUUID } from "node:crypto";

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

import type {
  AuthSessionResponse,
  AuthenticatedUser,
} from "@levantamiento-rq/shared-contracts";

import { AUTH_CONFIG, type AuthConfig } from "./auth-config";

interface RefreshClaims {
  userId: string;
  sessionId: string;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new UnauthorizedException(`Token inválido: ${name}.`);
  }
  return value;
}

function requireStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new UnauthorizedException("Token inválido.");
  }
  return value;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(AUTH_CONFIG)
    private readonly config: AuthConfig,
  ) {}

  hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async issueSession(
    user: AuthenticatedUser,
    sessionId: string = randomUUID(),
  ): Promise<AuthSessionResponse> {
    const now = Math.floor(Date.now() / 1000);
    const accessSecret = new TextEncoder().encode(this.config.accessSecret);
    const refreshSecret = new TextEncoder().encode(this.config.refreshSecret);

    const accessToken = await new SignJWT({
      typ: "access",
      sid: sessionId,
      email: user.email,
      name: user.displayName,
      roles: [...user.roles],
      permissions: [...user.permissions],
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.accessTtlSeconds)
      .setJti(randomUUID())
      .sign(accessSecret);

    const refreshToken = await new SignJWT({
      typ: "refresh",
      sid: sessionId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuer(this.config.issuer)
      .setAudience(this.config.audience)
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.refreshTtlSeconds)
      .setJti(randomUUID())
      .sign(refreshSecret);

    return {
      user,
      accessToken,
      refreshToken,
      accessTokenExpiresInSeconds: this.config.accessTtlSeconds,
      refreshTokenExpiresInSeconds: this.config.refreshTtlSeconds,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const { payload } = await this.verify(
      token,
      this.config.accessSecret,
      "access",
    );

    return {
      id: requireText(payload.sub, "sub"),
      email: requireText(payload.email, "email"),
      displayName: requireText(payload.name, "name"),
      roles: requireStringArray(payload.roles),
      permissions: requireStringArray(payload.permissions),
    };
  }

  async verifyRefreshToken(token: string): Promise<RefreshClaims> {
    const { payload } = await this.verify(
      token,
      this.config.refreshSecret,
      "refresh",
    );

    return {
      userId: requireText(payload.sub, "sub"),
      sessionId: requireText(payload.sid, "sid"),
    };
  }

  private async verify(
    token: string,
    secret: string,
    expectedType: string,
  ): Promise<{ payload: JWTPayload }> {
    try {
      const result = await jwtVerify(
        token,
        new TextEncoder().encode(secret),
        {
          issuer: this.config.issuer,
          audience: this.config.audience,
          algorithms: ["HS256"],
        },
      );

      if (result.payload.typ !== expectedType) {
        throw new UnauthorizedException("Tipo de token inválido.");
      }

      return { payload: result.payload };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Token inválido o vencido.");
    }
  }
}
