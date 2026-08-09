import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  ExportRequestDetail,
  ExportRequestListResponse,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

@Injectable()
export class OperationsClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  createExport(
    accessToken: string,
    correlationId: string,
    idempotencyKey: string | null,
    projectId: string,
    documentId: string,
    versionNumber: string,
    body: unknown,
  ): Promise<ExportRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/exports`,
      "POST",
      accessToken,
      correlationId,
      idempotencyKey,
      body,
    );
  }

  listExports(
    accessToken: string,
    correlationId: string,
    projectId: string,
    documentId: string,
  ): Promise<ExportRequestListResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/exports`,
      "GET",
      accessToken,
      correlationId,
      null,
    );
  }

  getExport(
    accessToken: string,
    correlationId: string,
    exportRequestId: string,
  ): Promise<ExportRequestDetail> {
    return this.request(
      `/api/v1/exports/${encodeURIComponent(exportRequestId)}`,
      "GET",
      accessToken,
      correlationId,
      null,
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
      response = await fetch(`${this.config.operationsServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.operationsTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Operations Service no está disponible.",
      );
    }
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = { message: text };
    }
    if (!response.ok) throw new HttpException(payload, response.status);
    return payload as T;
  }
}
