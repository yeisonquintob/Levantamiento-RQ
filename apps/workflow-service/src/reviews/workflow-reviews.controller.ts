import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";

import type { AuthenticatedUser } from "@levantamiento-rq/shared-contracts";

import {
  parseAddComment,
  parseCreateReview,
  parseDecision,
  parseDocumentId,
  parseProjectId,
  parseReviewId,
  parseVersionNumber,
} from "./workflow-input";
import { WorkflowAccessTokenGuard } from "./workflow-access-token.guard";
import type { WorkflowRequest } from "./workflow-request";
import {
  type WorkflowActorContext,
  WorkflowReviewsService,
} from "./workflow-reviews.service";

function actorContext(request: WorkflowRequest): WorkflowActorContext {
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
    idempotencyKey: request.idempotencyKey ?? null,
  };
}

const decisionSchema = {
  type: "object",
  required: ["expectedReviewRevision", "expectedDocumentRevision"],
  properties: {
    expectedReviewRevision: { type: "integer", minimum: 1 },
    expectedDocumentRevision: { type: "integer", minimum: 1 },
    comment: { type: "string", maxLength: 4000, nullable: true },
  },
} as const;

@ApiTags("workflow")
@ApiBearerAuth("access-token")
@ApiHeader({
  name: "x-idempotency-key",
  required: false,
  description: "Clave repetible para mutaciones, máximo 120 caracteres.",
})
@UseGuards(WorkflowAccessTokenGuard)
@Controller()
export class WorkflowReviewsController {
  constructor(private readonly reviews: WorkflowReviewsService) {}

  @ApiOperation({ summary: "Solicitar revisión de una versión documental" })
  @ApiParam({ name: "projectId", format: "uuid" })
  @ApiParam({ name: "documentId", format: "uuid" })
  @ApiParam({ name: "versionNumber", type: "integer" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["expectedDocumentRevision"],
      properties: {
        expectedDocumentRevision: { type: "integer", minimum: 1 },
        comment: { type: "string", maxLength: 4000, nullable: true },
      },
    },
  })
  @ApiResponse({ status: 201, description: "Revisión creada y asignada." })
  @Post(
    "projects/:projectId/documents/:documentId/versions/:versionNumber/reviews",
  )
  create(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: unknown,
  ) {
    return this.reviews.create(
      actorContext(request),
      parseProjectId(projectId),
      parseDocumentId(documentId),
      parseVersionNumber(versionNumber),
      parseCreateReview(body),
    );
  }

  @ApiOperation({ summary: "Listar revisiones de un proyecto" })
  @Get("projects/:projectId/reviews")
  list(@Req() request: WorkflowRequest, @Param("projectId") projectId: string) {
    return this.reviews.list(actorContext(request), parseProjectId(projectId));
  }

  @ApiOperation({ summary: "Consultar revisión, asignaciones y actividad" })
  @Get("projects/:projectId/reviews/:reviewId")
  getById(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
  ) {
    return this.reviews.getById(
      actorContext(request),
      parseProjectId(projectId),
      parseReviewId(reviewId),
    );
  }

  @ApiOperation({ summary: "Agregar un comentario trazable" })
  @ApiBody({
    schema: {
      type: "object",
      required: ["expectedReviewRevision", "comment"],
      properties: {
        expectedReviewRevision: { type: "integer", minimum: 1 },
        comment: { type: "string", minLength: 1, maxLength: 4000 },
      },
    },
  })
  @Post("projects/:projectId/reviews/:reviewId/comments")
  @HttpCode(200)
  addComment(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.reviews.addComment(
      actorContext(request),
      parseProjectId(projectId),
      parseReviewId(reviewId),
      parseAddComment(body),
    );
  }

  @ApiOperation({ summary: "Solicitar correcciones a la versión" })
  @ApiBody({ schema: decisionSchema })
  @Post("projects/:projectId/reviews/:reviewId/request-changes")
  @HttpCode(200)
  requestChanges(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.reviews.requestChanges(
      actorContext(request),
      parseProjectId(projectId),
      parseReviewId(reviewId),
      parseDecision(body),
    );
  }

  @ApiOperation({ summary: "Aprobar y bloquear la versión documental" })
  @ApiBody({ schema: decisionSchema })
  @Post("projects/:projectId/reviews/:reviewId/approve")
  @HttpCode(200)
  approve(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.reviews.approve(
      actorContext(request),
      parseProjectId(projectId),
      parseReviewId(reviewId),
      parseDecision(body),
    );
  }

  @ApiOperation({ summary: "Rechazar definitivamente la versión" })
  @ApiBody({ schema: decisionSchema })
  @Post("projects/:projectId/reviews/:reviewId/reject")
  @HttpCode(200)
  reject(
    @Req() request: WorkflowRequest,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: unknown,
  ) {
    return this.reviews.reject(
      actorContext(request),
      parseProjectId(projectId),
      parseReviewId(reviewId),
      parseDecision(body),
    );
  }
}
