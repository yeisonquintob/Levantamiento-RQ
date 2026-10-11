import { UsersClientService } from "../users/users-client.service";
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
  ProjectDeleteResult,
} from "@levantamiento-rq/shared-contracts";

import { AiAnalysisClientService } from "../analysis/ai-analysis-client.service";
import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { DocumentsClientService } from "../documents/documents-client.service";
import { OperationsClientService } from "../operations/operations-client.service";
import { SourcesClientService } from "../sources/sources-client.service";
import { WorkflowClientService } from "../workflow/workflow-client.service";
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

function correlationId(request: RequestLike): string {
  return (
    firstHeader(request.headers["x-correlation-id"])?.trim() || randomUUID()
  );
}

@ApiTags("projects")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("projects")
export class ProjectsGatewayController {
  constructor(
    private readonly projects: ProjectsClientService,
    private readonly users: UsersClientService,
    private readonly sources: SourcesClientService,
    private readonly documents: DocumentsClientService,
    private readonly analysis: AiAnalysisClientService,
    private readonly workflow: WorkflowClientService,
    private readonly operations: OperationsClientService,
  ) {}

  @Get("audit-events")
  async auditHistory(
    @Req() request: RequestLike,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    const token = requireAccessToken(request);
    return this.users.resolveAuditActors(
      await this.projects.auditHistory(token, query),
      token,
    );
  }

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

  @ApiOperation({
    summary:
      "Eliminar definitivamente el proyecto y todos sus datos relacionados",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Delete(":projectId")
  @HttpCode(200)
  async deleteProject(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
  ): Promise<ProjectDeleteResult> {
    const accessToken = requireAccessToken(request);
    const correlation = correlationId(request);
    const analysis = await this.analysis.purgeProject(
      accessToken,
      correlation,
      projectId,
    );
    const workflow = await this.workflow.purgeProject(
      accessToken,
      correlation,
      projectId,
    );
    const operations = await this.operations.purgeProject(
      accessToken,
      correlation,
      projectId,
    );
    const documents = await this.documents.purgeProject(
      accessToken,
      correlation,
      projectId,
    );
    const sources = await this.sources.purgeProject(accessToken, projectId);
    const project = await this.projects.deleteProject(accessToken, projectId);

    return {
      deleted: true,
      projectId: project.projectId,
      code: project.code,
      removed: {
        sources: sources.count,
        documents: documents.count,
        analysisRequests: analysis.count,
        reviews: workflow.count,
        operations: operations.count,
      },
    };
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
import { randomUUID } from "node:crypto";
