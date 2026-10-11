import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";

import { MicrosoftAuthService } from "./microsoft-auth.service";

function requiredText(
  body: unknown,
  name: string,
  maximum: number,
): string {
  const value =
    body && typeof body === "object"
      ? (body as Readonly<Record<string, unknown>>)[name]
      : undefined;

  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new BadRequestException(`${name} no es válido.`);
  }

  return value.trim();
}

@ApiTags("authentication")
@Controller("auth/microsoft")
export class MicrosoftAuthController {
  constructor(private readonly microsoft: MicrosoftAuthService) {}

  @ApiOperation({ summary: "Preparar el acceso con Microsoft Entra ID" })
  @ApiResponse({ status: 200, description: "URL de autorización y transacción." })
  @ApiResponse({ status: 503, description: "Acceso con Microsoft no configurado." })
  @Post("authorize")
  @HttpCode(200)
  authorize(@Body() body: unknown) {
    return this.microsoft.authorize(requiredText(body, "webOrigin", 300));
  }

  @ApiOperation({ summary: "Completar el acceso con Microsoft Entra ID" })
  @ApiResponse({ status: 200, description: "Sesión creada." })
  @ApiResponse({ status: 401, description: "Identidad no válida o sin acceso." })
  @Post("callback")
  @HttpCode(200)
  callback(
    @Body() body: unknown,
    @Headers("x-client-user-agent") userAgent?: string,
    @Headers("x-client-ip") ipAddress?: string,
  ) {
    return this.microsoft.complete(
      {
        code: requiredText(body, "code", 4096),
        state: requiredText(body, "state", 512),
        transaction: requiredText(body, "transaction", 2048),
      },
      { userAgent, ipAddress },
    );
  }
}
