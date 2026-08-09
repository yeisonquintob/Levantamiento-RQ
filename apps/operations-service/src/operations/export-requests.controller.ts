import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import { ExportRequestsService } from "./export-requests.service";
import { OperationsAccessTokenGuard } from "./operations-access-token.guard";
import {
  parseCreateExport,
  parseDocumentId,
  parseExportRequestId,
  parseProjectId,
  parseVersionNumber,
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
    idempotencyKey: request.idempotencyKey ?? null,
    userAgent: Array.isArray(request.headers["user-agent"])
      ? request.headers["user-agent"][0]
      : request.headers["user-agent"],
  };
}

@ApiTags("exports")
@ApiBearerAuth()
@ApiHeader({
  name: "x-idempotency-key",
  required: false,
  description: "Obligatoria al solicitar una exportación.",
})
@UseGuards(OperationsAccessTokenGuard)
@Controller()
export class ExportRequestsController {
  constructor(private readonly exports: ExportRequestsService) {}

  @ApiOperation({ summary: "Solicitar exportación de una versión aprobada" })
  @Post(
    "projects/:projectId/documents/:documentId/versions/:versionNumber/exports",
  )
  create(
    @Req() request: OperationsRequest,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.exports.create(
      context(request),
      parseProjectId(projectId),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseCreateExport(body),
    );
  }

  @ApiOperation({ summary: "Consultar historial de exportaciones" })
  @Get("projects/:projectId/documents/:documentId/exports")
  list(
    @Req() request: OperationsRequest,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
  ) {
    return this.exports.list(
      context(request),
      parseProjectId(projectId),
      parseDocumentId(documentId),
    );
  }

  @ApiOperation({ summary: "Consultar una exportación" })
  @Get("exports/:exportRequestId")
  getById(
    @Req() request: OperationsRequest,
    @Param("exportRequestId") exportRequestId: string,
  ) {
    return this.exports.getById(
      context(request),
      parseExportRequestId(exportRequestId),
    );
  }
}
