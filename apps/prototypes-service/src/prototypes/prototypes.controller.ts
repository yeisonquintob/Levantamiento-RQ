import {
  BadRequestException,
  Body,
  Controller,
  ConflictException,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from "@nestjs/swagger";
import {
  parseGenerationId,
  parsePrototypeGenerationCreate,
  parsePrototypeScreenSelection,
} from "./prototype-input";
import { PrototypeGenerationService } from "./prototype-generation.service";
import { PrototypePlanningService } from "../planning/prototype-planning.service";
import { PrototypeVisualSpecificationService } from "../visual/prototype-visual-specification.service";
import { PrototypesAccessTokenGuard } from "./prototypes-access-token.guard";
import { PrototypeImageGenerationService } from "../images/prototype-image-generation.service";
import type { PrototypesRequest } from "./prototypes-request";
import { AiAnalysisStructuredExecutionClient } from "../planning/ai-analysis-structured-execution.client";

@ApiTags("prototypes")
@ApiBearerAuth()
@UseGuards(PrototypesAccessTokenGuard)
@Controller("prototypes/generations")
export class PrototypesController {
  constructor(
    private readonly prototypes: PrototypeGenerationService,
    private readonly planning: PrototypePlanningService,
    private readonly visualSpecifications: PrototypeVisualSpecificationService,
    private readonly images: PrototypeImageGenerationService,
    private readonly aiClient: AiAnalysisStructuredExecutionClient,
  ) {}
  @Post()
  @ApiOperation({ summary: "Preparar una fuente Markdown para prototipo" })
  async create(@Req() request: PrototypesRequest, @Body() body: unknown) {
    if (!request.authPrincipal)
      throw new Error("No se resolvió el contexto autenticado.");
    const input = parsePrototypeGenerationCreate(body);
    if (input.plannerConfigurationId || input.imageConfigurationId) {
      const options = await this.aiClient.options();
      for (const [id, choices] of [
        [input.plannerConfigurationId, options.planning],
        [input.imageConfigurationId, options.images],
      ] as const) {
        if (
          id &&
          !choices.some(
            (p) => p.id.toLowerCase() === id.toLowerCase() && p.available,
          )
        )
          throw new ConflictException(
            "Selecciona modelos habilitados y compatibles con cada paso.",
          );
      }
    }
    return this.prototypes.createSource(input, request.authPrincipal.id);
  }

  @Get("providers")
  aiOptions(@Req() request: PrototypesRequest) {
    this.actorId(request);
    return this.aiClient.options();
  }

  @Get()
  @ApiOperation({ summary: "Listar el historial de prototipos del usuario" })
  list(@Req() request: PrototypesRequest) {
    return this.prototypes.listGenerations(this.actorId(request));
  }

  @Get(":id/prompt-export")
  @ApiOperation({ summary: "Prompts para generar las imágenes en otra IA" })
  @ApiParam({ name: "id", format: "uuid" })
  promptExport(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.exportPrompts(
      parseGenerationId(id),
      this.actorId(request),
    );
  }

  @Post(":id/images/import")
  @ApiOperation({ summary: "Importar una imagen generada fuera del sistema" })
  @ApiParam({ name: "id", format: "uuid" })
  importImage(
    @Req() request: PrototypesRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = body as { fileName?: unknown; imageBase64?: unknown } | null;
    if (
      !input ||
      typeof input.fileName !== "string" ||
      !input.fileName.trim() ||
      input.fileName.length > 260 ||
      typeof input.imageBase64 !== "string"
    )
      throw new BadRequestException("La imagen importada no es válida.");
    return this.images.importImage(
      parseGenerationId(id),
      this.actorId(request),
      input.fileName.trim(),
      input.imageBase64,
    );
  }

  @Post(":id/images")
  @ApiOperation({ summary: "Iniciar la generación asíncrona de imágenes" })
  imagesStart(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.start(parseGenerationId(id), this.actorId(request));
  }

  @Get(":id/images")
  @ApiOperation({ summary: "Listar imágenes generadas y su estado" })
  imagesList(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.list(parseGenerationId(id), this.actorId(request));
  }

  @Get(":id/image-progress")
  @ApiOperation({ summary: "Consultar el avance de generación de imágenes" })
  imageProgress(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.progress(parseGenerationId(id), this.actorId(request));
  }

  @Post(":id/images/retry-failed")
  @ApiOperation({ summary: "Reintentar únicamente las imágenes fallidas" })
  retryFailedImages(
    @Req() request: PrototypesRequest,
    @Param("id") id: string,
  ) {
    return this.images.retryFailed(
      parseGenerationId(id),
      this.actorId(request),
    );
  }
  @Post(":id/stop")
  @ApiOperation({ summary: "Detener la generación de imágenes" })
  stop(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.stop(parseGenerationId(id), this.actorId(request));
  }
  @Delete(":id")
  @ApiOperation({ summary: "Eliminar completamente un prototipo" })
  remove(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.images.deleteGeneration(
      parseGenerationId(id),
      this.actorId(request),
    );
  }
  @Get(":id")
  @ApiOperation({ summary: "Consultar una generación de prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  get(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.prototypes.getGeneration(
      parseGenerationId(id),
      this.actorId(request),
    );
  }
  @Get(":id/screens")
  @ApiOperation({ summary: "Listar pantallas de una generación" })
  @ApiParam({ name: "id", format: "uuid" })
  screens(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.prototypes.listScreens(
      parseGenerationId(id),
      this.actorId(request),
    );
  }

  @Post(":id/plan")
  @ApiOperation({ summary: "Planificar las pantallas de un prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  plan(@Req() request: PrototypesRequest, @Param("id") id: string) {
    return this.planning.planGeneration(
      parseGenerationId(id),
      this.actorId(request),
      request.correlationId,
    );
  }

  @Post(":id/screens/:screenId/detail")
  @ApiOperation({ summary: "Detallar una pantalla con la IA elegida" })
  @ApiParam({ name: "id", format: "uuid" })
  @ApiParam({ name: "screenId", format: "uuid" })
  detailScreen(
    @Req() request: PrototypesRequest,
    @Param("id") id: string,
    @Param("screenId") screenId: string,
  ) {
    return this.planning.detailScreen(
      parseGenerationId(id),
      parseGenerationId(screenId),
      this.actorId(request),
      request.correlationId,
    );
  }

  @Post(":id/visual-specifications")
  @ApiOperation({ summary: "Preparar especificaciones visuales del prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  buildVisualSpecifications(
    @Req() request: PrototypesRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.visualSpecifications.buildForGeneration(
      parseGenerationId(id),
      this.actorId(request),
      parsePrototypeScreenSelection(body),
    );
  }

  @Get(":id/visual-specifications")
  @ApiOperation({ summary: "Listar especificaciones visuales del prototipo" })
  @ApiParam({ name: "id", format: "uuid" })
  listVisualSpecifications(
    @Req() request: PrototypesRequest,
    @Param("id") id: string,
  ) {
    return this.visualSpecifications.list(
      parseGenerationId(id),
      this.actorId(request),
    );
  }

  private actorId(request: PrototypesRequest): string {
    if (!request.authPrincipal)
      throw new Error("No se resolvió el contexto autenticado.");
    return request.authPrincipal.id;
  }
}
