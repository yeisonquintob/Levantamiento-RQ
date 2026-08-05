import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  AppliedDocumentTemplate,
  ArchiveRequirementDocumentRequest,
  CreateDocumentVersionRequest,
  CreateRequirementDocumentRequest,
  DocumentHistoryEntry,
  DocumentSectionKey,
  DocumentTransitionRequest,
  DocumentVersionDetail,
  ReplaceDocumentFieldsRequest,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
  UpdateDocumentSectionRequest,
  UpdateRequirementDocumentRequest,
} from "@levantamiento-rq/shared-contracts";

import {
  GATEWAY_CONFIG,
  type GatewayConfig,
} from "../config/gateway-config";

type DocumentsMethod = "GET" | "POST" | "PATCH";

@Injectable()
export class DocumentsClientService {
  constructor(
    @Inject(GATEWAY_CONFIG)
    private readonly config: GatewayConfig,
  ) {}

  create(
    accessToken: string,
    correlationId: string,
    projectId: string,
    body: CreateRequirementDocumentRequest | unknown,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
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
  ): Promise<RequirementDocumentListResponse> {
    return this.request(
      `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  getById(
    accessToken: string,
    correlationId: string,
    documentId: string,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  getVersion(
    accessToken: string,
    correlationId: string,
    documentId: string,
    versionNumber: string,
  ): Promise<DocumentVersionDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  updateMetadata(
    accessToken: string,
    correlationId: string,
    documentId: string,
    body: UpdateRequirementDocumentRequest | unknown,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}`,
      "PATCH",
      accessToken,
      correlationId,
      body,
    );
  }

  createVersion(
    accessToken: string,
    correlationId: string,
    documentId: string,
    body: CreateDocumentVersionRequest | unknown,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  updateSection(
    accessToken: string,
    correlationId: string,
    documentId: string,
    versionNumber: string,
    sectionKey: DocumentSectionKey | string,
    body: UpdateDocumentSectionRequest | unknown,
  ): Promise<DocumentVersionDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/sections/${encodeURIComponent(sectionKey)}`,
      "PATCH",
      accessToken,
      correlationId,
      body,
    );
  }

  replaceFields(
    accessToken: string,
    correlationId: string,
    documentId: string,
    versionNumber: string,
    body: ReplaceDocumentFieldsRequest | unknown,
  ): Promise<DocumentVersionDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/fields`,
      "PATCH",
      accessToken,
      correlationId,
      body,
    );
  }

  transition(
    accessToken: string,
    correlationId: string,
    documentId: string,
    versionNumber: string,
    action: "submit-review" | "approve" | "reject",
    body: DocumentTransitionRequest | unknown,
  ): Promise<DocumentVersionDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionNumber)}/${action}`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  history(
    accessToken: string,
    correlationId: string,
    documentId: string,
  ): Promise<readonly DocumentHistoryEntry[]> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/history`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  appliedTemplate(
    accessToken: string,
    correlationId: string,
    documentId: string,
  ): Promise<AppliedDocumentTemplate> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/template`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  archive(
    accessToken: string,
    correlationId: string,
    documentId: string,
    body: ArchiveRequirementDocumentRequest | unknown,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/archive`,
      "POST",
      accessToken,
      correlationId,
      body,
    );
  }

  private async request<T>(
    path: string,
    method: DocumentsMethod,
    accessToken: string,
    correlationId: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "x-correlation-id": correlationId,
    };
    if (body !== undefined) headers["content-type"] = "application/json";

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
        payload ?? { message: "Documents Service rechazó la solicitud." },
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
