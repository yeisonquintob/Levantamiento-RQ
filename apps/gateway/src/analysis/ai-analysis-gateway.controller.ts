import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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

import type { CreateAiAnalysisRequest } from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { AiAnalysisClientService } from "./ai-analysis-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function accessToken(request: RequestLike): string {
  const cookie = readCookie(first(request.headers.cookie), ACCESS_COOKIE);

  if (cookie) {
    return cookie;
  }

  const match = first(request.headers.authorization)?.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) {
    throw new UnauthorizedException("Sesión requerida.");
  }

  return match[1];
}

function correlationId(request: RequestLike): string {
  return first(request.headers["x-correlation-id"])?.trim() || randomUUID();
}

@ApiTags("analysis")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@Controller("projects/:projectId/analysis-requests")
export class AiAnalysisGatewayController {
  constructor(private readonly analysis: AiAnalysisClientService) {}

  @ApiOperation({ summary: "Crear una solicitud de análisis" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["documentId", "documentVersionId", "sourceIds"],
      properties: {
        analysisType: {
          type: "string",
          enum: ["REQUIREMENT_DOCUMENT"],
        },
        documentId: { type: "string", format: "uuid" },
        documentVersionId: {
          type: "string",
          format: "uuid",
        },
        sourceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", format: "uuid" },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Solicitud registrada en estado PENDING.",
  })
  @Post()
  create(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Body() body: CreateAiAnalysisRequest | unknown,
  ) {
    return this.analysis.create(
      accessToken(request),
      correlationId(request),
      projectId,
      body,
    );
  }

  @ApiOperation({
    summary: "Listar solicitudes de análisis del proyecto",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get()
  list(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Query() query: Readonly<Record<string, unknown>>,
  ) {
    return this.analysis.list(
      accessToken(request),
      correlationId(request),
      projectId,
      query,
    );
  }

  @ApiOperation({
    summary: "Consultar una solicitud de análisis",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "analysisRequestId", format: "uuid" })
  @Get(":analysisRequestId")
  getById(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.getById(
      accessToken(request),
      correlationId(request),
      projectId,
      analysisRequestId,
    );
  }

  @ApiOperation({
    summary: "Cancelar una solicitud de análisis pendiente",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "analysisRequestId", format: "uuid" })
  @Post(":analysisRequestId/cancel")
  @HttpCode(200)
  cancel(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.cancel(
      accessToken(request),
      correlationId(request),
      projectId,
      analysisRequestId,
    );
  }

  @ApiOperation({ summary: "Reintentar una solicitud de análisis fallida" })
  @Post(":analysisRequestId/retry")
  @HttpCode(200)
  retry(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.retry(
      accessToken(request),
      correlationId(request),
      projectId,
      analysisRequestId,
    );
  }

  @ApiOperation({ summary: "Aceptar y aplicar el resultado de IA" })
  @Post(":analysisRequestId/result/accept")
  @HttpCode(200)
  acceptResult(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.reviewResult(
      accessToken(request),
      correlationId(request),
      projectId,
      analysisRequestId,
      "accept",
      body,
    );
  }

  @ApiOperation({ summary: "Rechazar el resultado de IA" })
  @Post(":analysisRequestId/result/reject")
  @HttpCode(200)
  rejectResult(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.reviewResult(
      accessToken(request),
      correlationId(request),
      projectId,
      analysisRequestId,
      "reject",
      body,
    );
  }
}
