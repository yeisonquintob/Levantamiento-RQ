import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type {
  SourceDetail,
  SourceListResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  type AiAnalysisAuthConfig,
} from "./ai-analysis-auth.config";

function sameUuid(left: string | null | undefined, right: string): boolean {
  return typeof left === "string" && left.toLowerCase() === right.toLowerCase();
}

@Injectable()
export class AiAnalysisSourcesAccessClient {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  async requireReadySources(
    projectId: string,
    sourceIds: readonly string[],
    accessToken: string,
    correlationId: string,
    includeDiscussionSource = true,
  ): Promise<readonly SourceDetail[]> {
    const selected = await Promise.all(
      sourceIds.map((sourceId) =>
        this.requireReadySource(
          projectId,
          sourceId,
          accessToken,
          correlationId,
        ),
      ),
    );
    const discussion = includeDiscussionSource
      ? await this.readyDiscussionSource(projectId, accessToken, correlationId)
      : null;
    if (
      !discussion ||
      selected.some((source) => sameUuid(source.id, discussion.id))
    ) {
      return selected;
    }
    return [...selected, discussion];
  }

  private async readyDiscussionSource(
    projectId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<SourceDetail | null> {
    let response: Response;
    try {
      const query = new URLSearchParams({
        page: "1",
        pageSize: "50",
        sourceType: "CONVERSATION",
        processingStatus: "READY",
        status: "ACTIVE",
      });
      response = await fetch(
        `${this.config.sourcesServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}/sources?${query.toString()}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(this.config.sourcesTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible para incluir la discusión del proyecto.",
      );
    }
    const payload = await this.readPayload(response);
    if (!response.ok) {
      throw new HttpException(
        payload ?? {
          message: "No fue posible consultar la discusión del proyecto.",
        },
        response.status,
      );
    }
    const list = payload as SourceListResponse;
    if (!Array.isArray(list?.items)) return null;
    const summary = list.items
      .filter(
        (source) =>
          source.sourceType === "CONVERSATION" &&
          source.title
            .trim()
            .toLocaleLowerCase("es")
            .startsWith("preguntas de análisis ·"),
      )
      .sort(
        (left, right) =>
          Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
      )[0];
    return summary
      ? this.requireReadySource(
          projectId,
          summary.id,
          accessToken,
          correlationId,
        )
      : null;
  }

  async downloadInternalImage(
    projectId: string,
    sourceId: string,
    serviceToken: string,
    correlationId: string,
  ): Promise<{ buffer: Buffer; mediaType: string; sha256: string }> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.sourcesServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}/internal-ai-image`,
        {
          headers: {
            accept: "image/png,image/jpeg,image/webp",
            authorization: `Bearer ${serviceToken}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(this.config.sourcesTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible para obtener la imagen privada.",
      );
    }
    if (!response.ok) {
      throw new HttpException(
        (await this.readPayload(response)) ?? {
          message: "No fue posible obtener la imagen privada.",
        },
        response.status,
      );
    }
    const mediaType = response.headers.get("content-type") ?? "";
    const sha256 = response.headers.get("x-source-sha256") ?? "";
    if (
      !new Set(["image/png", "image/jpeg", "image/webp"]).has(mediaType) ||
      !/^[a-f0-9]{64}$/u.test(sha256)
    ) {
      throw new ConflictException(
        "Sources devolvió metadatos de imagen inválidos.",
      );
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      mediaType,
      sha256,
    };
  }

  private async requireReadySource(
    projectId: string,
    sourceId: string,
    accessToken: string,
    correlationId: string,
  ): Promise<SourceDetail> {
    let response: Response;

    try {
      response = await fetch(
        `${this.config.sourcesServiceUrl}/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${accessToken}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(this.config.sourcesTimeoutMs),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        "Sources Service no está disponible para validar las fuentes.",
      );
    }

    const payload = await this.readPayload(response);

    if (!response.ok) {
      throw new HttpException(
        payload ?? { message: "No fue posible validar una fuente." },
        response.status,
      );
    }

    const source = payload as SourceDetail;

    if (!sameUuid(source.projectId, projectId)) {
      throw new ConflictException(
        `La fuente ${sourceId} no pertenece al proyecto solicitado.`,
      );
    }

    if (source.status !== "ACTIVE") {
      throw new ConflictException(`La fuente ${sourceId} no está activa.`);
    }

    if (source.processingStatus !== "READY") {
      throw new ConflictException(
        `La fuente ${sourceId} debe estar en estado READY.`,
      );
    }

    return source;
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
