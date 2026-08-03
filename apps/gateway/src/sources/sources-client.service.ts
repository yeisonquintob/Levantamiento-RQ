import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  CreateTextSourceRequest,
  SourceDetail,
  SourceListResponse,
  SourceMetrics,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

type SourcesMethod = "GET" | "POST" | "PATCH" | "DELETE";

@Injectable()
export class SourcesClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  list(
    accessToken: string,
    projectId: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<SourceListResponse> {
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

    return this.request<SourceListResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources${suffix}`,
      "GET",
      accessToken,
    );
  }

  summary(accessToken: string, projectId: string): Promise<SourceMetrics> {
    return this.request<SourceMetrics>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/summary`,
      "GET",
      accessToken,
    );
  }

  getById(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "GET",
      accessToken,
    );
  }

  create(
    accessToken: string,
    projectId: string,
    body: CreateTextSourceRequest | unknown,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources`,
      "POST",
      accessToken,
      body,
    );
  }

  update(
    accessToken: string,
    projectId: string,
    sourceId: string,
    body: UpdateSourceRequest | unknown,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "PATCH",
      accessToken,
      body,
    );
  }

  archive(
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    return this.request<SourceDetail>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
      "DELETE",
      accessToken,
    );
  }

  private async request<T>(
    path: string,
    method: SourcesMethod,
    accessToken: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }

    let response: Response;

    try {
      response = await fetch(`${this.config.sourcesServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.sourcesTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible.",
      );
    }

    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = { message: text };
      }
    }

    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "Sources Service rechazó la solicitud." },
        response.status,
      );
    }

    return payload as T;
  }
}
