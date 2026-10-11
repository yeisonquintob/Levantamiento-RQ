import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { PrototypesClientService } from "./prototypes-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function accessToken(request: RequestLike) {
  const token =
    readCookie(first(request.headers.cookie), ACCESS_COOKIE) ||
    first(request.headers.authorization)?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new UnauthorizedException("Sesión requerida.");
  return token;
}
@ApiTags("prototypes")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("prototypes/images")
export class PrototypeImagesGatewayController {
  constructor(private readonly prototypes: PrototypesClientService) {}
  @Post(":imageId/retry")
  @ApiOperation({ summary: "Reintentar una imagen fallida" })
  retry(@Req() request: RequestLike, @Param("imageId") imageId: string) {
    return this.prototypes.retryImage(accessToken(request), imageId);
  }
  @Post(":imageId/regenerate")
  @ApiOperation({ summary: "Regenerar una imagen completada" })
  regenerate(@Req() request: RequestLike, @Param("imageId") imageId: string) {
    return this.prototypes.regenerateImage(accessToken(request), imageId);
  }
  @Get(":imageId/content")
  @ApiOperation({ summary: "Servir una imagen privada de prototipo" })
  async content(
    @Req() request: RequestLike,
    @Param("imageId") imageId: string,
    @Res() reply: FastifyReply,
  ) {
    const content = await this.prototypes.imageContent(
      accessToken(request),
      imageId,
    );
    return reply
      .header("content-type", "image/png")
      .header("cache-control", "private, max-age=300")
      .send(content);
  }
}
