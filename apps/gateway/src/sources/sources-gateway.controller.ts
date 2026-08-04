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
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { MultipartFile } from "@fastify/multipart";
import type { FastifyReply } from "fastify";

import type {
  CreateTextSourceRequest,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import {
  type GatewayUploadFile,
  SourcesClientService,
} from "./sources-client.service";

interface MultipartField {
  type: "field";
  fieldname: string;
  value: unknown;
}

type GatewayMultipartPart = MultipartFile | MultipartField;

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
  isMultipart(): boolean;
  parts(): AsyncIterableIterator<GatewayMultipartPart>;
}

function firstHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireAccessToken(request: RequestLike): string {
  const cookieToken = readCookie(
    firstHeader(request.headers.cookie),
    ACCESS_COOKIE,
  );

  if (cookieToken) {
    return cookieToken;
  }

  const authorization = firstHeader(
    request.headers.authorization,
  );
  const match = authorization?.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new UnauthorizedException("Sesión requerida.");
  }

  return match[1];
}

function attachmentDisposition(fileName: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

@ApiTags("sources")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("projects/:projectId/sources")
export class SourcesGatewayController {
  constructor(private readonly sources: SourcesClientService) {}

  @ApiOperation({ summary: "Consultar indicadores de fuentes" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get("summary")
  summary(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
  ) {
    return this.sources.summary(
      requireAccessToken(request),
      projectId,
    );
  }

  @ApiOperation({ summary: "Listar fuentes del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get()
  list(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.sources.list(
      requireAccessToken(request),
      projectId,
      query,
    );
  }

  @ApiOperation({ summary: "Crear una fuente textual" })
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
        title: {
          type: "string",
          minLength: 3,
          maxLength: 240,
        },
        content: {
          type: "string",
          minLength: 1,
          maxLength: 200000,
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Fuente creada." })
  @Post()
  create(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: CreateTextSourceRequest | unknown,
  ) {
    return this.sources.create(
      requireAccessToken(request),
      projectId,
      body,
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
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
  ) {
    if (!request.isMultipart()) {
      throw new BadRequestException(
        "La carga debe usar multipart/form-data.",
      );
    }

    const files: GatewayUploadFile[] = [];
    let metadata: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        files.push({
          fileName: part.filename,
          mediaType: part.mimetype,
          buffer: await part.toBuffer(),
        });
      } else if (
        part.fieldname === "metadata" &&
        typeof part.value === "string"
      ) {
        metadata = part.value;
      }
    }

    if (!metadata) {
      throw new BadRequestException(
        "Cada archivo debe tener clasificación y descripción configuradas.",
      );
    }

    return this.sources.uploadFiles(
      requireAccessToken(request),
      projectId,
      files,
      metadata,
    );
  }

  @ApiOperation({ summary: "Descargar archivo de fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Get(":sourceId/download")
  async download(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
    @Res() reply: FastifyReply,
  ) {
    const file = await this.sources.download(
      requireAccessToken(request),
      projectId,
      sourceId,
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
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    return this.sources.reprocess(
      requireAccessToken(request),
      projectId,
      sourceId,
    );
  }

  @ApiOperation({ summary: "Consultar detalle de una fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Get(":sourceId")
  getById(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    return this.sources.getById(
      requireAccessToken(request),
      projectId,
      sourceId,
    );
  }

  @ApiOperation({ summary: "Actualizar una fuente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Patch(":sourceId")
  update(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
    @Body() body: UpdateSourceRequest | unknown,
  ) {
    return this.sources.update(
      requireAccessToken(request),
      projectId,
      sourceId,
      body,
    );
  }

  @ApiOperation({ summary: "Eliminar una fuente de la vista activa" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "sourceId", format: "uuid" })
  @Delete(":sourceId")
  @HttpCode(200)
  archive(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("sourceId") sourceId: string,
  ) {
    return this.sources.archive(
      requireAccessToken(request),
      projectId,
      sourceId,
    );
  }
}
