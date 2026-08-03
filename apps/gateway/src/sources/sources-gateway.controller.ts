import {
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
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type {
  CreateTextSourceRequest,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { SourcesClientService } from "./sources-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
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
        title: { type: "string", minLength: 3, maxLength: 240 },
        content: { type: "string", minLength: 1, maxLength: 200000 },
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

  @ApiOperation({ summary: "Actualizar una fuente textual" })
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

  @ApiOperation({ summary: "Archivar una fuente" })
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
