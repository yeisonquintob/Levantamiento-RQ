import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";

import type {
  AddWorkflowCommentRequest,
  CreateWorkflowReviewRequest,
  DecideWorkflowReviewRequest,
} from "@levantamiento-rq/shared-contracts";

import { ACCESS_COOKIE, readCookie } from "../auth/cookies";
import { WorkflowClientService } from "./workflow-client.service";

interface RequestLike {
  headers: Readonly<Record<string, string | string[] | undefined>>;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function accessToken(request: RequestLike): string {
  const cookie = readCookie(first(request.headers.cookie), ACCESS_COOKIE);

  if (cookie) return cookie;

  const match = first(request.headers.authorization)?.match(/^Bearer\s+(.+)$/i);

  if (!match?.[1]) throw new UnauthorizedException("Sesión requerida.");

  return match[1];
}

function correlationId(request: RequestLike): string {
  return first(request.headers["x-correlation-id"])?.trim() || randomUUID();
}

function idempotencyKey(request: RequestLike): string | null {
  return first(request.headers["x-idempotency-key"])?.trim() || null;
}

@ApiTags("workflow")
@ApiCookieAuth("rq_access")
@ApiBearerAuth()
@ApiHeader({
  name: "x-idempotency-key",
  required: false,
  description: "Obligatoria en mutaciones de Workflow.",
})
@Controller()
export class WorkflowGatewayController {
  constructor(private readonly workflow: WorkflowClientService) {}

  @ApiOperation({ summary: "Solicitar revisión documental" })
  @Post(
    "projects/:projectId/documents/:documentId/versions/:versionNumber/reviews",
  )
  create(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("documentId") documentId: string,
    @Param("versionNumber") versionNumber: string,
    @Body() body: CreateWorkflowReviewRequest | unknown,
  ) {
    return this.workflow.create(
      accessToken(request),
      correlationId(request),
      idempotencyKey(request),
      projectId,
      documentId,
      versionNumber,
      body,
    );
  }

  @ApiOperation({ summary: "Listar revisiones del proyecto" })
  @Get("projects/:projectId/reviews")
  list(@Req() request: RequestLike, @Param("projectId") projectId: string) {
    return this.workflow.list(
      accessToken(request),
      correlationId(request),
      projectId,
    );
  }

  @ApiOperation({ summary: "Consultar una revisión" })
  @Get("projects/:projectId/reviews/:reviewId")
  getById(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
  ) {
    return this.workflow.getById(
      accessToken(request),
      correlationId(request),
      projectId,
      reviewId,
    );
  }

  @ApiOperation({ summary: "Agregar comentario de revisión" })
  @Post("projects/:projectId/reviews/:reviewId/comments")
  @HttpCode(200)
  comment(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: AddWorkflowCommentRequest | unknown,
  ) {
    return this.workflow.comment(
      accessToken(request),
      correlationId(request),
      idempotencyKey(request),
      projectId,
      reviewId,
      body,
    );
  }

  @ApiOperation({ summary: "Solicitar correcciones" })
  @Post("projects/:projectId/reviews/:reviewId/request-changes")
  @HttpCode(200)
  requestChanges(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: DecideWorkflowReviewRequest | unknown,
  ) {
    return this.decide("request-changes", request, projectId, reviewId, body);
  }

  @ApiOperation({ summary: "Aprobar y bloquear la versión" })
  @Post("projects/:projectId/reviews/:reviewId/approve")
  @HttpCode(200)
  approve(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: DecideWorkflowReviewRequest | unknown,
  ) {
    return this.decide("approve", request, projectId, reviewId, body);
  }

  @ApiOperation({ summary: "Rechazar definitivamente la versión" })
  @Post("projects/:projectId/reviews/:reviewId/reject")
  @HttpCode(200)
  reject(
    @Req() request: RequestLike,
    @Param("projectId") projectId: string,
    @Param("reviewId") reviewId: string,
    @Body() body: DecideWorkflowReviewRequest | unknown,
  ) {
    return this.decide("reject", request, projectId, reviewId, body);
  }

  private decide(
    action: "request-changes" | "approve" | "reject",
    request: RequestLike,
    projectId: string,
    reviewId: string,
    body: DecideWorkflowReviewRequest | unknown,
  ) {
    return this.workflow.decide(
      action,
      accessToken(request),
      correlationId(request),
      idempotencyKey(request),
      projectId,
      reviewId,
      body,
    );
  }
}
