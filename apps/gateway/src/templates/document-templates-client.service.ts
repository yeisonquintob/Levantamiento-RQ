import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  CloneDocumentTemplateRequest,
  CreateDocumentTemplateRequest,
  DocumentTemplateDetail,
  DocumentTemplateListResponse,
  DocumentTemplateMetrics,
  UpdateDocumentTemplateRequest,
} from "@levantamiento-rq/shared-contracts";

import { GATEWAY_CONFIG, type GatewayConfig } from "../config/gateway-config";

type DocumentsMethod = "GET" | "POST" | "PATCH";

@Injectable()
export class DocumentTemplatesClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  list(
    accessToken: string,
    query: Readonly<Record<string, unknown>>,
  ): Promise<DocumentTemplateListResponse> {
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

    return this.request<DocumentTemplateListResponse>(
      `/api/v1/templates${suffix}`,
      "GET",
      accessToken,
    );
  }

  summary(accessToken: string): Promise<DocumentTemplateMetrics> {
    return this.request<DocumentTemplateMetrics>(
      "/api/v1/templates/summary",
      "GET",
      accessToken,
    );
  }

  getById(
    accessToken: string,
    templateId: string,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      `/api/v1/templates/${encodeURIComponent(templateId)}`,
      "GET",
      accessToken,
    );
  }

  create(
    accessToken: string,
    body: CreateDocumentTemplateRequest | unknown,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      "/api/v1/templates",
      "POST",
      accessToken,
      body,
    );
  }

  update(
    accessToken: string,
    templateId: string,
    body: UpdateDocumentTemplateRequest | unknown,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      `/api/v1/templates/${encodeURIComponent(templateId)}`,
      "PATCH",
      accessToken,
      body,
    );
  }

  publish(
    accessToken: string,
    templateId: string,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      `/api/v1/templates/${encodeURIComponent(templateId)}/publish`,
      "POST",
      accessToken,
    );
  }

  retire(
    accessToken: string,
    templateId: string,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      `/api/v1/templates/${encodeURIComponent(templateId)}/retire`,
      "POST",
      accessToken,
    );
  }

  clone(
    accessToken: string,
    templateId: string,
    body: CloneDocumentTemplateRequest | unknown,
  ): Promise<DocumentTemplateDetail> {
    return this.request<DocumentTemplateDetail>(
      `/api/v1/templates/${encodeURIComponent(templateId)}/clone`,
      "POST",
      accessToken,
      body,
    );
  }

  private async request<T>(
    path: string,
    method: DocumentsMethod,
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
      response = await fetch(`${this.config.documentsServiceUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.documentsTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Documents Service no está disponible.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? {
          message: "Documents Service rechazó la solicitud.",
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
