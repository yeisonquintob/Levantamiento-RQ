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

import {
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type {
  GatewayAuthSessionResponse,
  SignOutResponse,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";
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

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@ApiTags("authentication")
@Controller("auth")
export class AuthGatewayController {
  constructor(
    private readonly identity: IdentityClientService,
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  @ApiOperation({ summary: "Iniciar sesión mediante el Gateway" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["email", "password"],
      properties: {
        email: {
          type: "string",
          format: "email",
          example: "usuario@empresa.com",
        },
        password: { type: "string", format: "password", minLength: 8 },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: "Sesión creada y cookies HttpOnly emitidas.",
  })
  @ApiResponse({ status: 401, description: "Credenciales inválidas." })
  @Post("sign-in")
  @HttpCode(200)
  async signIn(
    @Body() body: unknown,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike,
  ): Promise<GatewayAuthSessionResponse> {
    const session = await this.identity.signIn(body, {
      userAgent: firstHeader(request.headers["user-agent"]),
      ipAddress: firstHeader(request.headers["x-forwarded-for"]) ?? request.ip,
    });

    this.setSessionCookies(reply, session);

    return {
      user: session.user,
      accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
    };
  }

  @ApiOperation({ summary: "Renovar la sesión" })
  @ApiCookieAuth("rq_refresh")
  @ApiResponse({ status: 200, description: "Sesión renovada." })
  @ApiResponse({ status: 401, description: "Sesión de renovación inválida." })
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
      throw new UnauthorizedException("No existe una sesión de renovación.");
    }

    const session = await this.identity.refresh(refreshToken, {
      userAgent: firstHeader(request.headers["user-agent"]),
      ipAddress: firstHeader(request.headers["x-forwarded-for"]) ?? request.ip,
    });

    this.setSessionCookies(reply, session);

    return {
      user: session.user,
      accessTokenExpiresInSeconds: session.accessTokenExpiresInSeconds,
    };
  }

  @ApiOperation({ summary: "Cerrar la sesión" })
  @ApiCookieAuth("rq_refresh")
  @ApiResponse({
    status: 200,
    description: "Sesión cerrada y cookies eliminadas.",
  })
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

  @ApiOperation({ summary: "Consultar el usuario autenticado" })
  @ApiCookieAuth("rq_access")
  @ApiResponse({ status: 200, description: "Identidad autenticada." })
  @ApiResponse({ status: 401, description: "Sesión requerida." })
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
