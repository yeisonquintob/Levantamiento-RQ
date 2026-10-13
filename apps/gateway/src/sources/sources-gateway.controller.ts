import {
  BadRequestException,
  Inject,
  PayloadTooLargeException,
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
  ProcessSourcesRequest,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";
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

function firstHeader(value: string | string[] | undefined): string | undefined {
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

  const authorization = firstHeader(request.headers.authorization);
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
  constructor(
    private readonly sources: SourcesClientService,
    @Inject(GATEWAY_CONFIG) private readonly config: GatewayConfig,
  ) {}

  @ApiOperation({ summary: "Consultar indicadores de fuentes" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get("summary")
  summary(@Req() request: RequestLike, @Param("projectId") projectId: string) {
    return this.sources.summary(requireAccessToken(request), projectId);
  }

  @ApiOperation({ summary: "Listar fuentes del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get()
  list(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.sources.list(requireAccessToken(request), projectId, query);
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
    return this.sources.create(requireAccessToken(request), projectId, body);
  }

  @ApiOperation({
    summary: "Cargar varios archivos pendientes de procesamiento",
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
            "JSON ordenado con fileName, classification opcional y description.",
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
    // La credencial se exige antes de leer ningún archivo (el Gateway también corta antes del cuerpo las
    // peticiones sin credencial) y se comprueba con una consulta ligera al servicio de fuentes que el usuario
    // PUEDE subir archivos a este proyecto (permiso de gestión, el mismo de la carga): el multipart se lee de
    // forma perezosa, así que quien no tiene acceso o permiso nunca llega a cargar archivos en el Gateway.
    const accessToken = requireAccessToken(request);
    await this.sources.uploadAccess(accessToken, projectId);

    if (!request.isMultipart()) {
      throw new BadRequestException("La carga debe usar multipart/form-data.");
    }

    const files: GatewayUploadFile[] = [];
    let metadata: string | null = null;
    // Bytes de archivo ya retenidos: el límite total del lote se aplica MIENTRAS se lee, no al final.
    let receivedBytes = 0;

    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file as AsyncIterable<Buffer>) {
            receivedBytes += chunk.length;
            if (receivedBytes > this.config.sourcesMaxBatchBytes) {
              throw new PayloadTooLargeException(
                "El tamaño total de la carga supera el límite permitido.",
              );
            }
            chunks.push(chunk);
          }
          files.push({
            fileName: part.filename,
            mediaType: part.mimetype,
            buffer: Buffer.concat(chunks),
          });
        } else if (
          part.fieldname === "metadata" &&
          typeof part.value === "string"
        ) {
          metadata = part.value;
        }
      }
    } catch (error) {
      // Los límites de @fastify/multipart (tamaño, número de archivos o de partes) llegan como errores
      // del servidor HTTP: sin esta traducción el usuario recibía un 500 en vez de un 413.
      const code = (error as { code?: unknown } | null)?.code;
      if (
        code === "FST_REQ_FILE_TOO_LARGE" ||
        code === "FST_FILES_LIMIT" ||
        code === "FST_PARTS_LIMIT"
      ) {
        throw new PayloadTooLargeException(
          "La carga supera el tamaño o el número de archivos permitido.",
        );
      }
      throw error;
    }

    if (!metadata) {
      throw new BadRequestException(
        "Debes enviar la configuración de los archivos.",
      );
    }

    return this.sources.uploadFiles(accessToken, projectId, files, metadata);
  }

  @ApiOperation({ summary: "Procesar las fuentes seleccionadas" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["sourceIds"],
      properties: {
        sourceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { type: "string", format: "uuid" },
        },
      },
    },
  })
  @Post("process")
  processSelected(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: ProcessSourcesRequest | unknown,
  ) {
    return this.sources.processSelected(
      requireAccessToken(request),
      projectId,
      body,
    );
  }

  @ApiOperation({
    summary: "Procesar todas las fuentes pendientes o con error",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Post("process-all")
  processAll(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
  ) {
    return this.sources.processAll(requireAccessToken(request), projectId);
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
      .header("content-disposition", attachmentDisposition(file.fileName))
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
