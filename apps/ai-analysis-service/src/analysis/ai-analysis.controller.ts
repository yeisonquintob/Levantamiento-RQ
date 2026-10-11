import {
  Body,
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
  parseAiAnalysisTokenEstimateRequest,
  parseAnalysisRequestId,
  parseCreateAiAnalysisRequest,
  parseProcessRequirementDiscussionRequest,
  parseProjectId,
  parseReviewAiAnalysisResult,
} from "./ai-analysis-input";
import type { AiAnalysisRequest } from "./ai-analysis-request";
import {
  type AiAnalysisActorContext,
  AiAnalysisService,
} from "./ai-analysis.service";
import { RequirementDiscussionService } from "../discussion/requirement-discussion.service";

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
  constructor(
    private readonly analysis: AiAnalysisService,
    private readonly discussion: RequirementDiscussionService,
  ) {}

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
        purpose: {
          type: "string",
          enum: ["INITIAL_DRAFT", "AI_VERSION"],
          default: "INITIAL_DRAFT",
          description:
            "Límite funcional de la llamada: borrador inicial o nueva versión solicitada explícitamente con IA.",
        },
        instruction: {
          type: "string",
          maxLength: 20_000,
          description:
            "Instrucción opcional del usuario para una nueva versión con IA.",
        },
        sectionInstructions: {
          type: "array",
          maxItems: 14,
          uniqueItems: true,
          description:
            "Cambios explícitos dirigidos a un punto del documento. El backend los aplica a esa sección y propaga sus dependencias.",
          items: {
            type: "object",
            required: ["sectionKey", "instruction"],
            properties: {
              sectionKey: { type: "string" },
              instruction: {
                type: "string",
                minLength: 1,
                maxLength: 6000,
              },
            },
          },
        },
        idempotencyKey: {
          type: "string",
          minLength: 8,
          maxLength: 120,
          pattern: "^[A-Za-z0-9._:-]+$",
          description:
            "Clave estable que impide duplicar la generación y la versión documental.",
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
    description:
      "Solicitud idempotente registrada en PENDING; el worker genera y aplica el DRAFT automáticamente.",
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

  @ApiOperation({
    summary: "Estimar tokens del prompt sin ejecutar el proveedor de IA",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["documentId", "sourceIds"],
      properties: {
        documentId: { type: "string", format: "uuid" },
        sourceIds: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          uniqueItems: true,
          items: { type: "string", format: "uuid" },
        },
        purpose: {
          type: "string",
          enum: ["INITIAL_DRAFT", "AI_VERSION"],
          default: "AI_VERSION",
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description:
      "Estimación calculada localmente con la misma regla preventiva usada antes de OpenAI.",
  })
  @Post("projects/:projectId/analysis-requests/token-estimate")
  @HttpCode(200)
  estimateTokens(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.analysis.estimateTokens(
      context(request),
      parseProjectId(projectId),
      parseAiAnalysisTokenEstimateRequest(body),
    );
  }

  @ApiOperation({
    summary: "Consultar los motores disponibles para procesar una discusión",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Get("projects/:projectId/analysis-requests/discussion/capabilities")
  discussionCapabilities(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.discussion.capabilities(
      context(request),
      parseProjectId(projectId),
    );
  }

  @ApiOperation({
    summary:
      "Procesar las respuestas y la conversación con el motor de IA solicitado",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiResponse({
    status: 200,
    description:
      "Respuestas consolidadas en el orden original por IA local o IA nube.",
  })
  @Post("projects/:projectId/analysis-requests/discussion/process")
  @HttpCode(200)
  processDiscussion(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    return this.discussion.process(
      context(request),
      parseProjectId(projectId),
      parseProcessRequirementDiscussionRequest(body),
    );
  }

  @ApiOperation({ summary: "Detener el procesamiento activo de una discusión" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @Post("projects/:projectId/analysis-requests/discussion/cancel")
  @HttpCode(200)
  cancelDiscussion(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.discussion.cancel(context(request), parseProjectId(projectId));
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

  @ApiOperation({
    summary: "Eliminar definitivamente los análisis del proyecto",
  })
  @Delete("projects/:projectId/analysis-requests")
  @HttpCode(200)
  purgeProject(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
  ) {
    return this.analysis.purgeProject(
      context(request),
      parseProjectId(projectId),
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

  @ApiOperation({
    summary: "Consultar el prompt del borrador inicial generado desde Fuentes",
  })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "analysisRequestId", format: "uuid" })
  @Get("projects/:projectId/analysis-requests/:analysisRequestId/prompt")
  getPrompt(
    @Req() request: AiAnalysisRequest,
    @Param("projectId") projectId: string,
    @Param("analysisRequestId") analysisRequestId: string,
  ) {
    return this.analysis.getPrompt(
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
