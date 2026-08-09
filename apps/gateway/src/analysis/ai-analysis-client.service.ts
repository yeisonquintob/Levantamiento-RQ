import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AiProviderConfigurationListResponse,
  AiProviderConfigurationSummary,
  AiProviderConnectionTestResult,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  CreateAiAnalysisRequest,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

type AiAnalysisMethod = "GET" | "POST" | "PATCH" | "DELETE";

@Injectable()
export class AiAnalysisClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  create(
    accessToken: string,
    correlationId: string,
    projectId: string,
    body: CreateAiAnalysisRequest | unknown,
  ): Promise<AiAnalysisRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  list(
    accessToken: string,
    correlationId: string,
    projectId: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<AiAnalysisRequestListResponse> {
    const search = new URLSearchParams();

    for (const [name, value] of Object.entries(query)) {
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        search.set(name, String(value));
      }
    }

    const suffix = search.size > 0 ? `?${search.toString()}` : "";

    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests${suffix}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  getById(
    accessToken: string,
    correlationId: string,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(analysisRequestId)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  cancel(
    accessToken: string,
    correlationId: string,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(analysisRequestId)}/cancel`,
      "POST",
      accessToken,
      correlationId,
    );
  }

  retry(
    accessToken: string,
    correlationId: string,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(analysisRequestId)}/retry`,
      "POST",
      accessToken,
      correlationId,
    );
  }

  reviewResult(
    accessToken: string,
    correlationId: string,
    projectId: string,
    analysisRequestId: string,
    action: "accept" | "reject",
    body: unknown,
  ): Promise<AiAnalysisRequestDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(analysisRequestId)}/result/${action}`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  listProviders(
    accessToken: string,
    correlationId: string,
  ): Promise<AiProviderConfigurationListResponse> {
    return this.request(
      "/api/v1/admin/ai-providers",
      "GET",
      accessToken,
      correlationId,
    );
  }

  createProvider(
    accessToken: string,
    correlationId: string,
    body: unknown,
  ): Promise<AiProviderConfigurationSummary> {
    return this.request(
      "/api/v1/admin/ai-providers",
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  updateProvider(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
    body: unknown,
  ): Promise<AiProviderConfigurationSummary> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}`,
      "PATCH",
      accessToken,
      correlationId,
      body,
    );
  }

  rotateProviderCredential(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
    body: unknown,
  ): Promise<AiProviderConfigurationSummary> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}/credential`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  testProvider(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
  ): Promise<AiProviderConnectionTestResult> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}/test`,
      "POST",
      accessToken,
      correlationId,
    );
  }

  deleteProvider(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
  ): Promise<{ deleted: true; id: string }> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}`,
      "DELETE",
      accessToken,
      correlationId,
    );
  }

  private async request<T>(
    path: string,
    method: AiAnalysisMethod,
    accessToken: string,
    correlationId: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-correlation-id": correlationId,
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;

    try {
      response = await fetch(`${this.config.aiAnalysisServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.aiAnalysisTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "AI Analysis Service no está disponible.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? {
          message: "AI Analysis Service rechazó la solicitud.",
        },
        response.status,
      );
    }

    return payload as T;
  }

  private async readPayload(response: Response): Promise<unknown> {
    const text = await response.text();

    if (!text) {
      return null;
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }
}
