import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  ApplyAiAnalysisDraftRequest,
  DocumentVersionDetail,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  type AiAnalysisAuthConfig,
} from "./ai-analysis-auth.config";

function sameUuid(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class AiAnalysisDocumentsAccessClient {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  async requireCurrentVersion(
    projectId: string,
    documentId: string,
    documentVersionId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<RequirementDocumentDetail> {
    let response: Response;

    try {
      response = await fetch(
        `${this.config.documentsServiceUrl}/api/v1/documents/${encodeURIComponent(documentId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(this.config.documentsTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Documents Service no está disponible para validar el documento.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "No fue posible validar el documento." },
        response.status,
      );
    }

    const document = payload as RequirementDocumentDetail;

    if (!sameUuid(document.projectId, projectId)) {
      throw new ConflictException(
        "El documento no pertenece al proyecto solicitado.",
      );
    }

    if (document.archivedAt || document.status === "ARCHIVED") {
      throw new ConflictException(
        "No se puede crear un análisis para un documento archivado.",
      );
    }

    if (!sameUuid(document.currentVersionDetail?.id, documentVersionId)) {
      throw new ConflictException(
        "Solo se puede analizar la versión actual del documento.",
      );
    }

    if (document.currentVersionDetail.status !== "DRAFT") {
      throw new ConflictException(
        "La IA solo puede completar la versión DRAFT actual; nunca sobrescribe una versión en revisión o aprobada.",
      );
    }

    return document;
  }

  async applyAiDraft(
    documentId: string,
    versionNumber: number,
    input: ApplyAiAnalysisDraftRequest,
    accessToken: string,
    correlationId: string,
  ): Promise<DocumentVersionDetail> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.documentsServiceUrl}/api/v1/documents/${encodeURIComponent(documentId)}/versions/${versionNumber}/apply-ai-draft`,
        {
          method: "PATCH",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(this.config.documentsTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Documents Service no está disponible para aplicar el borrador.",
      );
    }
    const payload = await this.readPayload(response);
    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "No fue posible aplicar el borrador de IA." },
        response.status,
      );
    }
    return payload as DocumentVersionDetail;
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
