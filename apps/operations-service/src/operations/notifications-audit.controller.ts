import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { NotificationsAuditService } from "./notifications-audit.service";
import { OperationsAccessTokenGuard } from "./operations-access-token.guard";
import {
  parseAuditEventListQuery,
  parseNotificationId,
  parseNotificationListQuery,
  parseProjectId,
} from "./operations-input";
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

@ApiTags("notifications", "audit")
@ApiBearerAuth()
@UseGuards(OperationsAccessTokenGuard)
@Controller()
export class NotificationsAuditController {
  constructor(private readonly service: NotificationsAuditService) {}

  @Get("admin/audit/approvals")
  approvalsHistory(
    @Req() request: OperationsRequest,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.service.approvalsHistory(context(request), query);
  }

  @ApiOperation({
    summary: "Listar las notificaciones del usuario autenticado",
  })
  @Get("notifications")
  listNotifications(
    @Req() request: OperationsRequest,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.service.listNotifications(
      context(request),
      parseNotificationListQuery(query),
    );
  }

  @ApiOperation({ summary: "Marcar una notificación propia como leída" })
  @Post("notifications/:notificationId/read")
  @HttpCode(200)
  markRead(
    @Req() request: OperationsRequest,
    @Param("notificationId") notificationId: string,
  ) {
    return this.service.markRead(
      context(request),
      parseNotificationId(notificationId),
    );
  }

  @ApiOperation({ summary: "Eliminar todas las notificaciones propias" })
  @Delete("notifications")
  @HttpCode(200)
  clearNotifications(@Req() request: OperationsRequest) {
    return this.service.clearNotifications(context(request));
  }

  @ApiOperation({ summary: "Consultar la auditoría de un proyecto accesible" })
  @Get("projects/:projectId/audit-events")
  listAudit(
    @Req() request: OperationsRequest,
    @Param("projectId") projectId: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.service.listAudit(
      context(request),
      parseProjectId(projectId),
      parseAuditEventListQuery(query),
    );
  }
}
