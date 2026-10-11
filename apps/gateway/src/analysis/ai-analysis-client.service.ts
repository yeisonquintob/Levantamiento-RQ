import type { AuditHistoryResponse } from "@levantamiento-rq/shared-contracts";
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
  AiAnalysisPromptDetail,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiAnalysisTokenEstimateRequest,
  AiAnalysisTokenEstimateResponse,
  CreateAiAnalysisRequest,
  ProcessRequirementDiscussionRequest,
  ProcessRequirementDiscussionResponse,
  RequirementDiscussionCapabilitiesResponse,
  ProjectDomainPurgeResult,
  OllamaInstalledModelsResponse,
  ViabilityConfiguration,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

type AiAnalysisMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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

  estimateTokens(
    accessToken: string,
    correlationId: string,
    projectId: string,
    body: AiAnalysisTokenEstimateRequest | unknown,
  ): Promise<AiAnalysisTokenEstimateResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/token-estimate`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  processDiscussion(
    accessToken: string,
    correlationId: string,
    projectId: string,
    body: ProcessRequirementDiscussionRequest | unknown,
  ): Promise<ProcessRequirementDiscussionResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/discussion/process`,
      "POST",
      accessToken,
      correlationId,
      body,
      600_000,
    );
  }

  cancelDiscussion(
    accessToken: string,
    correlationId: string,
    projectId: string,
  ): Promise<{ cancelled: number }> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/discussion/cancel`,
      "POST",
      accessToken,
      correlationId,
    );
  }

  getDiscussionCapabilities(
    accessToken: string,
    correlationId: string,
    projectId: string,
  ): Promise<RequirementDiscussionCapabilitiesResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/discussion/capabilities`,
      "GET",
      accessToken,
      correlationId,
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

  purgeProject(
    accessToken: string,
    correlationId: string,
    projectId: string,
  ): Promise<ProjectDomainPurgeResult> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests`,
      "DELETE",
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

  getPrompt(
    accessToken: string,
    correlationId: string,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisPromptDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(analysisRequestId)}/prompt`,
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

  listOllamaModels(
    accessToken: string,
    correlationId: string,
    baseUrl: string,
  ): Promise<OllamaInstalledModelsResponse> {
    return this.request(
      `/api/v1/admin/ai-providers/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  listOpenAiCompatibleModels(
    accessToken: string,
    correlationId: string,
    baseUrl: string,
  ): Promise<OllamaInstalledModelsResponse> {
    return this.request(
      `/api/v1/admin/ai-providers/openai-compatible/models?baseUrl=${encodeURIComponent(baseUrl)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  listOpenAiModels(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
  ): Promise<{ models: { id: string }[] }> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}/openai/models`,
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

  duplicateProvider(
    accessToken: string,
    correlationId: string,
    providerConfigurationId: string,
    body: unknown,
  ): Promise<AiProviderConfigurationSummary> {
    return this.request(
      `/api/v1/admin/ai-providers/${encodeURIComponent(providerConfigurationId)}/duplicate`,
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

  getViabilityCriteria(
    accessToken: string,
    correlationId: string,
  ): Promise<ViabilityConfiguration> {
    return this.request(
      "/api/v1/viability-criteria",
      "GET",
      accessToken,
      correlationId,
    );
  }

  updateViabilityCriteria(
    accessToken: string,
    correlationId: string,
    body: unknown,
  ): Promise<ViabilityConfiguration> {
    return this.request(
      "/api/v1/viability-criteria",
      "PUT",
      accessToken,
      correlationId,
      body,
    );
  }

  auditHistory(
    accessToken: string,
    query: Readonly<Record<string, unknown>>,
    correlationId: string,
  ): Promise<AuditHistoryResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "string" || typeof value === "number")
        params.set(key, String(value));
    }
    return this.request(
      `/api/v1/admin/ai-providers/audit-events?${params}`,
      "GET",
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
    timeoutMs = this.config.aiAnalysisTimeoutMs,
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
        signal: AbortSignal.timeout(timeoutMs),
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
