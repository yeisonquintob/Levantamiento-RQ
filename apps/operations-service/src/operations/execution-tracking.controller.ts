import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { ExecutionTrackingService } from "./execution-tracking.service";
import { OperationsAccessTokenGuard } from "./operations-access-token.guard";
import { parseExecutionTaskUpdates, parseProjectId } from "./operations-input";
import type { OperationsRequest } from "./operations-request";

function context(request: OperationsRequest) {
  if (
    !request.authPrincipal ||
    !request.accessToken ||
    !request.correlationId
  ) {
    throw new Error("No se resolvió el contexto autenticado.");
  }
  return {
    actor: request.authPrincipal,
    accessToken: request.accessToken,
    correlationId: request.correlationId,
    ipAddress: request.ip?.slice(0, 64) ?? null,
    userAgent: Array.isArray(request.headers["user-agent"])
      ? request.headers["user-agent"][0]
      : request.headers["user-agent"],
  };
}

@ApiTags("execution")
@ApiBearerAuth()
@UseGuards(OperationsAccessTokenGuard)
@Controller()
export class ExecutionTrackingController {
  constructor(private readonly service: ExecutionTrackingService) {}

  @ApiOperation({ summary: "Estado de ejecución de las tareas de un proyecto" })
  @Get("projects/:projectId/execution/tasks")
  list(
    @Req() request: OperationsRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.service.list(context(request), parseProjectId(projectId));
  }

  @ApiOperation({
    summary: "Marcar o actualizar el estado de tareas de un proyecto",
  })
  @Put("projects/:projectId/execution/tasks")
  @HttpCode(200)
  update(
    @Req() request: OperationsRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.service.update(
      context(request),
      parseProjectId(projectId),
      parseExecutionTaskUpdates(body),
    );
  }
}
