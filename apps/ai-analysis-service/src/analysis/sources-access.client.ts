import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { SourceDetail } from "@levantamiento-rq/shared-contracts";

import {
  AI_ANALYSIS_AUTH_CONFIG,
  type AiAnalysisAuthConfig,
} from "./ai-analysis-auth.config";

@Injectable()
export class AiAnalysisSourcesAccessClient {
  constructor(
    @Inject(AI_ANALYSIS_AUTH_CONFIG)
    private readonly config: AiAnalysisAuthConfig,
  ) {}

  requireReadySources(
    projectId: string,
    sourceIds: readonly string[],
    accessToken: string,
    correlationId: string,
  ): Promise<readonly SourceDetail[]> {
    return Promise.all(
      sourceIds.map((sourceId) =>
        this.requireReadySource(
          projectId,
          sourceId,
          accessToken,
          correlationId,
        ),
      ),
    );
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

    if (source.projectId !== projectId) {
      throw new ConflictException(
        `La fuente ${sourceId} no pertenece al proyecto solicitado.`,
      );
    }

    if (source.status !== "ACTIVE") {
      throw new ConflictException(
        `La fuente ${sourceId} no está activa.`,
      );
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
