import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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

import { AiAnalysisAccessTokenGuard } from "./ai-analysis-access-token.guard";
import {
  parseAiAnalysisRequestListQuery,
  parseAnalysisRequestId,
  parseCreateAiAnalysisRequest,
  parseProjectId,
  parseReviewAiAnalysisResult,
} from "./ai-analysis-input";
import type { AiAnalysisRequest } from "./ai-analysis-request";
import {
  type AiAnalysisActorContext,
  AiAnalysisService,
} from "./ai-analysis.service";

function context(request: AiAnalysisRequest): AiAnalysisActorContext {
  if (
    !request.authPrincipal ||
    !request.accessToken ||
    !request.correlationId
  ) {
    throw new Error("No se resolvió el contexto autenticado.");
  }

  return {
    actor: request.authPrincipal as AuthenticatedUser,
    accessToken: request.accessToken,
    correlationId: request.correlationId,
  };
}

@ApiTags("analysis")
@ApiBearerAuth("access-token")
@UseGuards(AiAnalysisAccessTokenGuard)
@Controller()
export class AiAnalysisController {
  constructor(private readonly analysis: AiAnalysisService) {}

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
        documentVersionId: { type: "string", format: "uuid" },
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
  @Post("projects/:projectId/analysis-requests")
  create(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.create(
      context(request),
      parseProjectId(projectId),
      parseCreateAiAnalysisRequest(body),
    );
  }

  @ApiOperation({ summary: "Listar solicitudes de análisis del proyecto" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get("projects/:projectId/analysis-requests")
  list(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Query() query: unknown,
  ) {
    return this.analysis.list(
      context(request),
      parseProjectId(projectId),
      parseAiAnalysisRequestListQuery(query),
    );
  }

  @ApiOperation({ summary: "Consultar una solicitud de análisis" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "analysisRequestId", format: "uuid" })
  @Get("projects/:projectId/analysis-requests/:analysisRequestId")
  getById(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.getById(
      context(request),
      parseProjectId(projectId),
      parseAnalysisRequestId(analysisRequestId),
    );
  }

  @ApiOperation({ summary: "Cancelar una solicitud pendiente" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "analysisRequestId", format: "uuid" })
  @Post("projects/:projectId/analysis-requests/:analysisRequestId/cancel")
  @HttpCode(200)
  cancel(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.cancel(
      context(request),
      parseProjectId(projectId),
      parseAnalysisRequestId(analysisRequestId),
    );
  }

  @ApiOperation({ summary: "Reintentar una solicitud fallida" })
  @Post("projects/:projectId/analysis-requests/:analysisRequestId/retry")
  @HttpCode(200)
  retry(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.retry(
      context(request),
      parseProjectId(projectId),
      parseAnalysisRequestId(analysisRequestId),
    );
  }

  @ApiOperation({
    summary: "Aceptar y aplicar el resultado al borrador documental",
  })
  @Post(
    "projects/:projectId/analysis-requests/:analysisRequestId/result/accept",
  )
  @HttpCode(200)
  acceptResult(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.acceptResult(
      context(request),
      parseProjectId(projectId),
      parseAnalysisRequestId(analysisRequestId),
      parseReviewAiAnalysisResult(body),
    );
  }

  @ApiOperation({ summary: "Rechazar el resultado generado" })
  @Post(
    "projects/:projectId/analysis-requests/:analysisRequestId/result/reject",
  )
  @HttpCode(200)
  rejectResult(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.rejectResult(
      context(request),
      parseProjectId(projectId),
      parseAnalysisRequestId(analysisRequestId),
      parseReviewAiAnalysisResult(body),
    );
  }
}
