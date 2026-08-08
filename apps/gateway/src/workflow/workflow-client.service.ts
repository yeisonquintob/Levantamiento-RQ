import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AddWorkflowCommentRequest,
  CreateWorkflowReviewRequest,
  DecideWorkflowReviewRequest,
  WorkflowReviewDetail,
  WorkflowReviewListResponse,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

@Injectable()
export class WorkflowClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  create(
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    projectId: string,
    documentId: string,
    versionNumber: string,
    body: CreateWorkflowReviewRequest | unknown,
  ): Promise<WorkflowReviewDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/reviews`,
      "POST",
      accessToken,
      correlationId,
      idempotencyKey,
      body,
    );
  }

  list(
    accessToken: string,
    correlationId: string,
    projectId: string,
  ): Promise<WorkflowReviewListResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reviews`,
      "GET",
      accessToken,
      correlationId,
      null,
    );
  }

  getById(
    accessToken: string,
    correlationId: string,
    projectId: string,
    reviewId: string,
  ): Promise<WorkflowReviewDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewId)}`,
      "GET",
      accessToken,
      correlationId,
      null,
    );
  }

  comment(
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    projectId: string,
    reviewId: string,
    body: AddWorkflowCommentRequest | unknown,
  ): Promise<WorkflowReviewDetail> {
    return this.mutation(
      "comments",
      accessToken,
      correlationId,
      idempotencyKey,
      projectId,
      reviewId,
      body,
    );
  }

  decide(
    action: "request-changes" | "approve" | "reject",
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    projectId: string,
    reviewId: string,
    body: DecideWorkflowReviewRequest | unknown,
  ): Promise<WorkflowReviewDetail> {
    return this.mutation(
      action,
      accessToken,
      correlationId,
      idempotencyKey,
      projectId,
      reviewId,
      body,
    );
  }

  private mutation(
    action: "comments" | "request-changes" | "approve" | "reject",
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    projectId: string,
    reviewId: string,
    body: unknown,
  ): Promise<WorkflowReviewDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/reviews/${encodeURIComponent(reviewId)}/${action}`,
      "POST",
      accessToken,
      correlationId,
      idempotencyKey,
      body,
    );
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-correlation-id": correlationId,
    };

    if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;

    try {
      response = await fetch(`${this.config.workflowServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.workflowTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Workflow Service no está disponible.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "Workflow Service rechazó la solicitud." },
        response.status,
      );
    }

    return payload as T;
  }

  private async readPayload(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) return null;

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
