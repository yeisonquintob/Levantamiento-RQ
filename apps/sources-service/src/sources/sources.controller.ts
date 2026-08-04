import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { SourcesAccessTokenGuard } from "./sources-access-token.guard";
import {
  parseCreateTextSource,
  parseProjectId,
  parseSourceId,
  parseSourceListQuery,
  parseUpdateSource,
  parseUploadMetadata,
} from "./sources-input";
import type { SourcesRequest } from "./sources-request";
import {
  type IncomingSourceFile,
  SourcesService,
} from "./sources.service";

function requireContext(request: SourcesRequest): {
  actor: AuthenticatedUser;
  accessToken: string;
} {
  if (!request.authPrincipal || !request.accessToken) {
    throw new Error("No se resolvió el contexto autenticado.");
  }

  return {
    actor: request.authPrincipal,
    accessToken: request.accessToken,
  };
}

function attachmentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags("sources")
@ApiBearerAuth()
@UseGuards(SourcesAccessTokenGuard)
@Controller("projects/:projectId/sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @ApiOperation({
    summary: "Consultar indicadores de fuentes del proyecto",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get("summary")
  summary(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
  ) {
    const context = requireContext(request);

    return this.sources.metrics(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
    );
  }

  @ApiOperation({ summary: "Listar fuentes del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get()
  list(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Query() query: unknown,
  ) {
    const context = requireContext(request);

    return this.sources.list(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceListQuery(query),
    );
  }

  @ApiOperation({
    summary: "Crear nota, conversación o transcripción",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["sourceType", "title", "content"],
      properties: {
        sourceType: {
          type: "string",
          enum: ["NOTE", "CONVERSATION", "TRANSCRIPT"],
        },
        title: { type: "string", minLength: 3, maxLength: 240 },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 200000,
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Fuente textual creada.",
  })
  @Post()
  create(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const context = requireContext(request);

    return this.sources.createText(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseCreateTextSource(body),
    );
  }

  @ApiOperation({
    summary: "Cargar y procesar varios archivos",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["metadata", "files"],
      properties: {
        metadata: {
          type: "string",
          description:
            "JSON ordenado con fileName, classification y description.",
        },
        files: {
          type: "array",
          items: {
            type: "string",
            format: "binary",
          },
        },
      },
    },
  })
  @Post("files")
  async uploadFiles(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
  ) {
    if (!request.isMultipart()) {
      throw new BadRequestException(
        "La carga debe usar multipart/form-data.",
      );
    }

    const context = requireContext(request);
    const rawFiles: Array<{
      fileName: string;
      mediaType: string;
      buffer: Buffer;
    }> = [];
    let metadataValue: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        rawFiles.push({
          fileName: part.filename,
          mediaType: part.mimetype,
          buffer: await part.toBuffer(),
        });
      } else if (
        part.fieldname === "metadata" &&
        typeof part.value === "string"
      ) {
        metadataValue = part.value;
      }
    }

    const metadata = parseUploadMetadata(metadataValue);

    if (metadata.length !== rawFiles.length) {
      throw new BadRequestException(
        "Cada archivo debe tener una clasificación y descripción asociadas.",
      );
    }

    const files: IncomingSourceFile[] = rawFiles.map((file, index) => {
      const item = metadata[index];

      if (!item || item.fileName !== file.fileName) {
        throw new BadRequestException(
          "La configuración de archivos no coincide con los archivos seleccionados.",
        );
      }

      return {
        ...file,
        classification: item.classification,
        description: item.description ?? null,
      };
    });

    return this.sources.uploadFiles(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      files,
    );
  }

  @ApiOperation({ summary: "Descargar un archivo de fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Get(":sourceId/download")
  async download(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
    @Res() reply: FastifyReply,
  ) {
    const context = requireContext(request);
    const file = await this.sources.download(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceId(sourceId),
    );

    return reply
      .header("content-type", file.mediaType)
      .header(
        "content-disposition",
        attachmentDisposition(file.fileName),
      )
      .header("content-length", String(file.buffer.length))
      .send(file.buffer);
  }

  @ApiOperation({ summary: "Reprocesar un archivo" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Post(":sourceId/reprocess")
  reprocess(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    const context = requireContext(request);

    return this.sources.reprocess(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceId(sourceId),
    );
  }

  @ApiOperation({ summary: "Consultar detalle de una fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Get(":sourceId")
  getById(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    const context = requireContext(request);

    return this.sources.getById(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceId(sourceId),
    );
  }

  @ApiOperation({ summary: "Actualizar una fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Patch(":sourceId")
  update(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
    @Body() body: unknown,
  ) {
    const context = requireContext(request);

    return this.sources.update(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceId(sourceId),
      parseUpdateSource(body),
    );
  }

  @ApiOperation({ summary: "Eliminar una fuente de la vista activa" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Delete(":sourceId")
  @HttpCode(200)
  archive(
    @Req() request: SourcesRequest,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    const context = requireContext(request);

    return this.sources.archive(
      context.actor,
      context.accessToken,
      parseProjectId(projectId),
      parseSourceId(sourceId),
    );
  }
}
