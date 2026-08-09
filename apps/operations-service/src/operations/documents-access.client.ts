import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  DocumentVersionDetail,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

import {
  OPERATIONS_AUTH_CONFIG,
  type OperationsAuthConfig,
} from "./operations-auth.config";

@Injectable()
export class OperationsDocumentsAccessClient {
  constructor(
    @Inject(OPERATIONS_AUTH_CONFIG)
    private readonly config: OperationsAuthConfig,
  ) {}

  async requireApprovedVersion(
    projectId: string,
    documentId: string,
    versionNumber: number,
    accessToken: string,
    correlationId: string,
  ): Promise<{
    document: RequirementDocumentDetail;
    version: DocumentVersionDetail;
  }> {
    const [document, version] = await Promise.all([
      this.request<RequirementDocumentDetail>(
        `/api/v1/documents/${encodeURIComponent(documentId)}`,
        accessToken,
        correlationId,
      ),
      this.request<DocumentVersionDetail>(
        `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${versionNumber}`,
        accessToken,
        correlationId,
      ),
    ]);
    if (document.projectId.toLowerCase() !== projectId.toLowerCase()) {
      throw new ConflictException(
        "El documento no pertenece al proyecto solicitado.",
      );
    }
    if (
      version.versionNumber !== versionNumber ||
      version.status !== "APPROVED"
    ) {
      throw new ConflictException(
        "Solo una versión APPROVED exacta puede exportarse.",
      );
    }
    return { document, version };
  }

  private async request<T>(
    path: string,
    accessToken: string,
    correlationId: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.documentsServiceUrl}${path}`, {
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "x-correlation-id": correlationId,
        },
        signal: AbortSignal.timeout(this.config.documentsTimeoutMs),
      });
    } catch {
      throw new ServiceUnavailableException(
        "Documents Service no está disponible.",
      );
    }
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      payload = { message: text };
    }
    if (!response.ok) {
      throw new HttpException(
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : {
              message:
                typeof payload === "string"
                  ? payload
                  : "Documents Service rechazó la solicitud.",
            },
        response.status,
      );
    }
    return payload as T;
  }
}
