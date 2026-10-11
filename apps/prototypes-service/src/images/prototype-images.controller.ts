import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { parseGenerationId } from "../prototypes/prototype-input";
import { PrototypesAccessTokenGuard } from "../prototypes/prototypes-access-token.guard";
import type { PrototypesRequest } from "../prototypes/prototypes-request";
import { PrototypeImageGenerationService } from "./prototype-image-generation.service";

@ApiTags("prototypes")
@ApiBearerAuth()
@UseGuards(PrototypesAccessTokenGuard)
@Controller("prototypes/images")
export class PrototypeImagesController {
  constructor(private readonly images: PrototypeImageGenerationService) {}
  @Post(":imageId/retry")
  @ApiOperation({ summary: "Reintentar una imagen fallida" })
  retry(@Req() request: PrototypesRequest, @Param("imageId") imageId: string) {
    return this.images.retry(parseGenerationId(imageId), this.actorId(request));
  }
  @Post(":imageId/regenerate")
  @ApiOperation({ summary: "Regenerar explícitamente una imagen completada" })
  regenerate(
    @Req() request: PrototypesRequest,
    @Param("imageId") imageId: string,
  ) {
    return this.images.regenerate(
      parseGenerationId(imageId),
      this.actorId(request),
    );
  }
  @Get(":imageId/content")
  @ApiOperation({ summary: "Descargar una imagen privada de prototipo" })
  @ApiParam({ name: "imageId", format: "uuid" })
  async content(
    @Req() request: PrototypesRequest,
    @Param("imageId") imageId: string,
    @Res() reply: FastifyReply,
  ) {
    const content = await this.images.content(
      parseGenerationId(imageId),
      this.actorId(request),
    );
    return reply
      .header("content-type", "image/png")
      .header("cache-control", "private, max-age=300")
      .send(content);
  }
  private actorId(request: PrototypesRequest) {
    if (!request.authPrincipal)
      throw new Error("No se resolvió el contexto autenticado.");
    return request.authPrincipal.id;
  }
}
