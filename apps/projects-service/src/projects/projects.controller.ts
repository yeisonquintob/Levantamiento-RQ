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

import { ProjectsAccessTokenGuard } from "./projects-access-token.guard";
import {
  parseAddParticipant,
  parseCreateProject,
  parseParticipantUserId,
  parseProjectId,
  parseProjectListQuery,
  parseUpdateProject,
} from "./projects-input";
import type { ProjectsRequest } from "./projects-request";
import { ProjectsService } from "./projects.service";

function requireActor(request: ProjectsRequest): AuthenticatedUser {
  if (!request.authPrincipal) {
    throw new Error("No se resolvió el usuario autenticado.");
  }

  return request.authPrincipal;
}

function requireAccessToken(request: ProjectsRequest): string {
  if (!request.accessToken) {
    throw new Error("No se resolvió el token de acceso.");
  }

  return request.accessToken;
}

@ApiTags("projects")
@ApiBearerAuth()
@UseGuards(ProjectsAccessTokenGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @ApiOperation({ summary: "Consultar indicadores de proyectos accesibles" })
  @ApiResponse({ status: 200, description: "Indicadores calculados." })
  @Get("summary")
  summary(@Req() request: ProjectsRequest) {
    return this.projects.metrics(requireActor(request));
  }

  @ApiOperation({ summary: "Listar proyectos accesibles" })
  @ApiResponse({ status: 200, description: "Listado paginado de proyectos." })
  @Get()
  list(@Req() request: ProjectsRequest, @Query() query: unknown) {
    return this.projects.list(
      requireActor(request),
      parseProjectListQuery(query),
    );
  }

  @ApiOperation({ summary: "Crear un proyecto" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["title", "requestingArea", "templateId"],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 200 },
        requestingArea: { type: "string", minLength: 2, maxLength: 160 },
        description: {
          type: "string",
          nullable: true,
          maxLength: 2000,
        },
        templateId: {
          type: "string",
          format: "uuid",
          description: "Versión publicada exacta de la plantilla.",
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Proyecto creado." })
  @Post()
  create(@Req() request: ProjectsRequest, @Body() body: unknown) {
    return this.projects.create(
      requireActor(request),
      requireAccessToken(request),
      parseCreateProject(body),
    );
  }

  @ApiOperation({ summary: "Consultar un proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Detalle del proyecto." })
  @ApiResponse({ status: 404, description: "Proyecto no encontrado." })
  @Get(":projectId")
  getById(
    @Req() request: ProjectsRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.projects.getById(
      requireActor(request),
      parseProjectId(projectId),
    );
  }

  @ApiOperation({ summary: "Actualizar un proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Proyecto actualizado." })
  @Patch(":projectId")
  update(
    @Req() request: ProjectsRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.update(
      requireActor(request),
      parseProjectId(projectId),
      parseUpdateProject(body),
    );
  }

  @ApiOperation({ summary: "Agregar participante al proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiResponse({ status: 201, description: "Participante agregado." })
  @Post(":projectId/participants")
  addParticipant(
    @Req() request: ProjectsRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.projects.addParticipant(
      requireActor(request),
      parseProjectId(projectId),
      parseAddParticipant(body),
    );
  }

  @ApiOperation({ summary: "Retirar participante del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "userId", format: "uuid" })
  @ApiResponse({ status: 200, description: "Participante retirado." })
  @Delete(":projectId/participants/:userId")
  @HttpCode(200)
  removeParticipant(
    @Req() request: ProjectsRequest,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ) {
    return this.projects.removeParticipant(
      requireActor(request),
      parseProjectId(projectId),
      parseParticipantUserId(userId),
    );
  }
}
