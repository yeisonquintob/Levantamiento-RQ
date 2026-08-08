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
  WORKFLOW_AUTH_CONFIG,
  type WorkflowAuthConfig,
} from "./workflow-auth.config";

function sameUuid(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class WorkflowDocumentsAccessClient {
  constructor(
    @Inject(WORKFLOW_AUTH_CONFIG)
    private readonly config: WorkflowAuthConfig,
  ) {}

  async requireDraftVersion(
    projectId: string,
    documentId: string,
    versionNumber: number,
    expectedRevision: number,
    accessToken: string,
    correlationId: string,
  ): Promise<RequirementDocumentDetail> {
    const document = await this.getDocument(
      documentId,
      accessToken,
      correlationId,
    );

    if (!sameUuid(document.projectId, projectId)) {
      throw new ConflictException(
        "El documento no pertenece al proyecto solicitado.",
      );
    }

    const version = document.currentVersionDetail;

    if (document.archivedAt || document.status === "ARCHIVED") {
      throw new ConflictException("El documento está archivado.");
    }

    if (version.versionNumber !== versionNumber) {
      throw new ConflictException(
        "Solo la versión actual puede enviarse a revisión.",
      );
    }

    if (version.status !== "DRAFT") {
      throw new ConflictException(
        "La versión debe estar en estado DRAFT para iniciar una revisión.",
      );
    }

    if (version.revision !== expectedRevision) {
      throw new ConflictException(
        "La revisión documental está desactualizada. Recarga el documento.",
      );
    }

    return document;
  }

  getDocument(
    documentId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<RequirementDocumentDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}`,
      "GET",
      accessToken,
      correlationId,
    );
  }

  transition(
    documentId: string,
    versionNumber: number,
    action: "submit-review" | "approve" | "reject",
    expectedRevision: number,
    comment: string | null | undefined,
    accessToken: string,
    correlationId: string,
  ): Promise<DocumentVersionDetail> {
    return this.request(
      `/api/v1/documents/${encodeURIComponent(documentId)}/versions/${versionNumber}/${action}`,
      "POST",
      accessToken,
      correlationId,
      { expectedRevision, comment: comment ?? null },
    );
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST",
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
        "Documents Service no está disponible para coordinar el flujo.",
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
