import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import { ProjectsAccessTokenGuard } from "./projects-access-token.guard";
import { parseProjectId } from "./projects-input";
import type { ProjectsRequest } from "./projects-request";
import { parseAreaInput, ProjectAreasService } from "./project-areas.service";

function requireActor(request: ProjectsRequest): AuthenticatedUser {
  if (!request.authPrincipal) {
    throw new Error("No se resolvió el usuario autenticado.");
  }
  return request.authPrincipal;
}

@ApiTags("project-areas")
@ApiBearerAuth()
@UseGuards(ProjectsAccessTokenGuard)
@Controller("project-areas")
export class ProjectAreasController {
  constructor(private readonly areas: ProjectAreasService) {}

  @ApiOperation({ summary: "Listar el catálogo de áreas solicitantes" })
  @Get()
  list() {
    return this.areas.list();
  }

  @ApiOperation({ summary: "Agregar un área (administrador)" })
  @Post()
  create(@Req() request: ProjectsRequest, @Body() body: unknown) {
    return this.areas.create(requireActor(request), parseAreaInput(body, true));
  }

  @ApiOperation({
    summary: "Cambiar nombre o icono de un área (administrador)",
  })
  @Patch(":areaId")
  rename(
    @Req() request: ProjectsRequest,
    @Param("areaId") areaId: string,
    @Body() body: unknown,
  ) {
    return this.areas.update(
      requireActor(request),
      parseProjectId(areaId),
      parseAreaInput(body, false),
    );
  }

  @ApiOperation({ summary: "Quitar un área del catálogo (administrador)" })
  @Delete(":areaId")
  remove(@Req() request: ProjectsRequest, @Param("areaId") areaId: string) {
    return this.areas.remove(requireActor(request), parseProjectId(areaId));
  }
}
