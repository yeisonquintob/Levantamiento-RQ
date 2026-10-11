import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import type { PrototypeGenerationCreateRequest } from "@levantamiento-rq/shared-contracts";
import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { PrototypesClientService } from "./prototypes-client.service";
interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
function token(request: RequestLike): string {
  const cookie = readCookie(first(request.headers.cookie), ACCESS_COOKIE);
  const bearer = first(request.headers.authorization)?.match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  if (!cookie && !bearer) throw new UnauthorizedException("Sesión requerida.");
  return cookie || bearer || "";
}
@ApiTags("prototypes")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("prototypes/generations")
export class PrototypesGatewayController {
  constructor(private readonly prototypes: PrototypesClientService) {}
  @Get("providers")
  aiOptions(@Req() request: RequestLike) {
    return this.prototypes.aiOptions(token(request));
  }
  @Get()
  @ApiOperation({ summary: "Listar historial de prototipos" })
  list(@Req() request: RequestLike) {
    return this.prototypes.list(token(request));
  }
  @Post()
  @ApiOperation({ summary: "Preparar fuente Markdown de prototipo" })
  create(
    @Req() request: RequestLike,
    @Body() body: PrototypeGenerationCreateRequest | unknown,
  ) {
    return this.prototypes.create(token(request), body);
  }
  @Get(":id")
  @ApiOperation({ summary: "Consultar generación de prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  get(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.get(token(request), id);
  }
  @Get(":id/screens")
  @ApiOperation({ summary: "Listar pantallas de prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  screens(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.screens(token(request), id);
  }
  @Post(":id/plan")
  @ApiOperation({ summary: "Planificar las pantallas de un prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  plan(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.plan(token(request), id);
  }
  @Post(":id/screens/:screenId/detail")
  @ApiOperation({ summary: "Detallar una pantalla con la IA elegida" })
  detailScreen(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Param("screenId") screenId: string,
  ) {
    return this.prototypes.detailScreen(token(request), id, screenId);
  }
  @Post(":id/visual-specifications")
  @ApiOperation({ summary: "Preparar especificaciones visuales del prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  buildVisualSpecifications(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.prototypes.buildVisualSpecifications(token(request), id, body);
  }
  @Get(":id/visual-specifications")
  @ApiOperation({ summary: "Listar especificaciones visuales del prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  visualSpecifications(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.visualSpecifications(token(request), id);
  }
  @Get(":id/prompt-export")
  @ApiOperation({ summary: "Prompts para generar las imágenes en otra IA" })
  promptExport(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.promptExport(token(request), id);
  }
  @Post(":id/images/import")
  @ApiOperation({ summary: "Importar una imagen generada fuera del sistema" })
  importImage(
    @Req() request: RequestLike,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.prototypes.importImage(token(request), id, body);
  }
  @Post(":id/images")
  @ApiOperation({ summary: "Iniciar generación de imágenes de prototipo" })
  startImages(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.startImages(token(request), id);
  }
  @Get(":id/images")
  @ApiOperation({ summary: "Listar imágenes de prototipo" })
  images(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.images(token(request), id);
  }
  @Get(":id/image-progress")
  @ApiOperation({ summary: "Consultar progreso de imágenes de prototipo" })
  imageProgress(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.imageProgress(token(request), id);
  }
  @Post(":id/images/retry-failed")
  @ApiOperation({ summary: "Reintentar imágenes fallidas del prototipo" })
  retryFailedImages(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.retryFailedImages(token(request), id);
  }
  @Post(":id/stop")
  @ApiOperation({ summary: "Detener generación de prototipo" })
  stop(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.stop(token(request), id);
  }
  @Delete(":id")
  @ApiOperation({ summary: "Eliminar completamente un prototipo" })
  remove(@Req() request: RequestLike, @Param("id") id: string) {
    return this.prototypes.remove(token(request), id);
  }
}
