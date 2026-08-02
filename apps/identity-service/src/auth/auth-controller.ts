import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";

import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type {
  AuthSessionResponse,
  AuthenticatedUser,
  SignOutResponse,
} from "@levantamiento-rq/shared-contracts";

import { AccessTokenGuard } from "./access-token.guard";
import { PermissionsGuard } from "./permissions.guard";
import type { AuthenticatedRequest } from "./auth-request";
import { AuthService } from "./auth-service";

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }
  return value as Readonly<Record<string, unknown>>;
}

function requiredText(
  record: Readonly<Record<string, unknown>>,
  name: string,
  minimum: number,
  maximum: number,
): string {
  const value = record[name];

  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(
      `${name} debe tener entre ${minimum} y ${maximum} caracteres.`,
    );
  }

  return value.trim();
}

@ApiTags("authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: "Validar credenciales y crear tokens" })
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
  @ApiResponse({ status: 200, description: "Tokens y usuario autenticado." })
  @ApiResponse({ status: 401, description: "Credenciales inválidas." })
  @Post("sign-in")
  @HttpCode(200)
  signIn(
    @Body() body: unknown,
    @Headers("x-client-user-agent") userAgent?: string,
    @Headers("x-client-ip") ipAddress?: string,
  ): Promise<AuthSessionResponse> {
    const record = asRecord(body);

    return this.authService.signIn(
      {
        email: requiredText(record, "email", 3, 320),
        password: requiredText(record, "password", 8, 256),
      },
      { userAgent, ipAddress },
    );
  }

  @ApiOperation({ summary: "Rotar el refresh token" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["refreshToken"],
      properties: { refreshToken: { type: "string", minLength: 20 } },
    },
  })
  @ApiResponse({ status: 200, description: "Tokens renovados." })
  @ApiResponse({
    status: 401,
    description: "Refresh token inválido o revocado.",
  })
  @Post("refresh")
  @HttpCode(200)
  refresh(
    @Body() body: unknown,
    @Headers("x-client-user-agent") userAgent?: string,
    @Headers("x-client-ip") ipAddress?: string,
  ): Promise<AuthSessionResponse> {
    const record = asRecord(body);

    return this.authService.refresh(
      requiredText(record, "refreshToken", 20, 8192),
      { userAgent, ipAddress },
    );
  }

  @ApiOperation({ summary: "Revocar el refresh token" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["refreshToken"],
      properties: { refreshToken: { type: "string", minLength: 20 } },
    },
  })
  @ApiResponse({ status: 200, description: "Sesión revocada." })
  @Post("sign-out")
  @HttpCode(200)
  async signOut(@Body() body: unknown): Promise<SignOutResponse> {
    const record = asRecord(body);
    await this.authService.signOut(
      requiredText(record, "refreshToken", 20, 8192),
    );
    return { signedOut: true };
  }

  @ApiOperation({ summary: "Consultar identidad desde access token" })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: "Identidad autenticada." })
  @ApiResponse({ status: 401, description: "Access token ausente o inválido." })
  @Get("me")
  @UseGuards(AccessTokenGuard, PermissionsGuard)
  me(@Req() request: AuthenticatedRequest): AuthenticatedUser {
    if (!request.authPrincipal) {
      throw new BadRequestException("No se resolvió la identidad.");
    }
    return request.authPrincipal;
  }
}
