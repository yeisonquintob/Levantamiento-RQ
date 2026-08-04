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
  AddProjectParticipantRequest,
  CreateProjectRequest,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { ProjectsClientService } from "./projects-client.service";

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

@ApiTags("projects")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("projects")
export class ProjectsGatewayController {
  constructor(private readonly projects: ProjectsClientService) {}

  @ApiOperation({ summary: "Consultar indicadores de proyectos" })
  @ApiResponse({ status: 200, description: "Indicadores disponibles." })
  @Get("summary")
  summary(@Req() request: RequestLike) {
    return this.projects.summary(requireAccessToken(request));
  }

  @ApiOperation({ summary: "Listar proyectos del usuario" })
  @ApiResponse({ status: 200, description: "Listado paginado." })
  @Get()
  list(
    @Req() request: RequestLike,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.projects.list(requireAccessToken(request), query);
  }

  @ApiOperation({ summary: "Crear proyecto" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["title", "requestingArea", "templateId"],
      properties: {
        title: { type: "string", minLength: 3, maxLength: 200 },
        requestingArea: { type: "string", minLength: 2, maxLength: 160 },
        description: { type: "string", nullable: true, maxLength: 2000 },
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
  create(
    @Req() request: RequestLike,
    @Body() body: CreateProjectRequest | unknown,
  ) {
    return this.projects.create(requireAccessToken(request), body);
  }

  @ApiOperation({ summary: "Consultar detalle del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get(":projectId")
  getById(@Req() request: RequestLike, @Param("projectId") projectId: string) {
    return this.projects.getById(requireAccessToken(request), projectId);
  }

  @ApiOperation({ summary: "Actualizar proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Patch(":projectId")
  update(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: UpdateProjectRequest | unknown,
  ) {
    return this.projects.update(requireAccessToken(request), projectId, body);
  }

  @ApiOperation({ summary: "Agregar participante" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Post(":projectId/participants")
  addParticipant(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: AddProjectParticipantRequest | unknown,
  ) {
    return this.projects.addParticipant(
      requireAccessToken(request),
      projectId,
      body,
    );
  }

  @ApiOperation({ summary: "Retirar participante" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "userId", format: "uuid" })
  @Delete(":projectId/participants/:userId")
  @HttpCode(200)
  removeParticipant(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("userId") userId: string,
  ) {
    return this.projects.removeParticipant(
      requireAccessToken(request),
      projectId,
      userId,
    );
  }
}
