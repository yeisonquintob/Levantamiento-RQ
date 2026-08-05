import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import type { SourceDetail } from "@levantamiento-rq/shared-contracts";

import {
  DOCUMENTS_AUTH_CONFIG,
  type DocumentsAuthConfig,
} from "../templates/documents-auth.config";

@Injectable()
export class DocumentsSourcesAccessClient {
  constructor(
    @Inject(DOCUMENTS_AUTH_CONFIG)
    private readonly config: DocumentsAuthConfig,
  ) {}

  async requireSource(
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
        "Sources Service no está disponible para validar la evidencia.",
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
        payload ?? { message: "No fue posible validar la fuente." },
        response.status,
      );
    }

    return payload as SourceDetail;
  }
}
