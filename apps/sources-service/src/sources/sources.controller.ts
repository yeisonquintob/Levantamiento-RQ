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
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { SourcesAccessTokenGuard } from "./sources-access-token.guard";
import {
  parseCreateTextSource,
  parseProjectId,
  parseSourceId,
  parseSourceListQuery,
  parseUpdateSource,
} from "./sources-input";
import type { SourcesRequest } from "./sources-request";
import { SourcesService } from "./sources.service";

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

@ApiTags("sources")
@ApiBearerAuth()
@UseGuards(SourcesAccessTokenGuard)
@Controller("projects/:projectId/sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @ApiOperation({ summary: "Consultar indicadores de fuentes del proyecto" })
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

  @ApiOperation({ summary: "Crear nota, conversación o transcripción" })
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
  @ApiResponse({ status: 201, description: "Fuente textual creada." })
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

  @ApiOperation({ summary: "Actualizar una fuente textual" })
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

  @ApiOperation({ summary: "Archivar una fuente" })
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
