import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";

import type {
  GatewayAuthSessionResponse,
  SignOutResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from "../config/gateway-config";
import {
  ACCESS_COOKIE,
  readCookie,
  REFRESH_COOKIE,
  serializeCookie,
} from "./cookies";
import { IdentityClientService } from "./identity-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  ip?: string;
}

interface ReplyLike {
  header(name: string, value: string | readonly string[]): unknown;
}

function firstHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller("auth")
export class AuthGatewayController {
  constructor(
    private readonly identity: IdentityClientService,
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<GatewayAuthSessionResponse> {
    const session = await this.identity.signIn(body, {
      userAgent: firstHeader(request.headers["user-agent"]),
      ipAddress:
        firstHeader(request.headers["x-forwarded-for"]) ?? request.ip,
    });

    this.setSessionCookies(reply, session);

    return {
      user: session.user,
      accessTokenExpiresInSeconds:
        session.accessTokenExpiresInSeconds,
    };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<GatewayAuthSessionResponse> {
    const refreshToken = readCookie(
      firstHeader(request.headers.cookie),
      REFRESH_COOKIE,
    );

    if (!refreshToken) {
      throw new UnauthorizedException(
        "No existe una sesión de renovación.",
      );
    }

    const session = await this.identity.refresh(refreshToken, {
      userAgent: firstHeader(request.headers["user-agent"]),
      ipAddress:
        firstHeader(request.headers["x-forwarded-for"]) ?? request.ip,
    });

    this.setSessionCookies(reply, session);

    return {
      user: session.user,
      accessTokenExpiresInSeconds:
        session.accessTokenExpiresInSeconds,
    };
  }

  @Post("sign-out")
  @HttpCode(200)
  async signOut(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<SignOutResponse> {
    const refreshToken = readCookie(
      firstHeader(request.headers.cookie),
      REFRESH_COOKIE,
    );

    try {
      if (refreshToken) {
        await this.identity.signOut(refreshToken);
      }
    } finally {
      reply.header("set-cookie", [
        serializeCookie(ACCESS_COOKIE, "", {
          maxAge: 0,
          path: "/",
          secure: this.config.cookieSecure,
        }),
        serializeCookie(REFRESH_COOKIE, "", {
          maxAge: 0,
          path: "/api/v1/auth",
          secure: this.config.cookieSecure,
        }),
      ]);
    }

    return { signedOut: true };
  }

  @Get("me")
  me(@Req() request: RequestLike) {
    const accessToken = readCookie(
      firstHeader(request.headers.cookie),
      ACCESS_COOKIE,
    );

    if (!accessToken) {
      throw new UnauthorizedException("Sesión requerida.");
    }

    return this.identity.me(accessToken);
  }

  private setSessionCookies(
    reply: ReplyLike,
    session: {
      accessToken: string;
      refreshToken: string;
      accessTokenExpiresInSeconds: number;
      refreshTokenExpiresInSeconds: number;
    },
  ): void {
    reply.header("set-cookie", [
      serializeCookie(ACCESS_COOKIE, session.accessToken, {
        maxAge: session.accessTokenExpiresInSeconds,
        path: "/",
        secure: this.config.cookieSecure,
      }),
      serializeCookie(REFRESH_COOKIE, session.refreshToken, {
        maxAge: session.refreshTokenExpiresInSeconds,
        path: "/api/v1/auth",
        secure: this.config.cookieSecure,
      }),
    ]);
  }
}
