import { Inject, Injectable } from "@nestjs/common";
import type {
  PrototypeImageGenerationInternalRequest,
  PrototypeImageGenerationInternalResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  PROTOTYPES_AUTH_CONFIG,
  type PrototypesAuthConfig,
} from "../prototypes/prototypes-auth.config";
import { PrototypesServiceToken } from "../prototypes/prototypes-service-token.service";
import { PrototypeImageProviderError } from "./prototype-image.provider";

@Injectable()
export class AiAnalysisImageGenerationClient {
  constructor(
    @Inject(PROTOTYPES_AUTH_CONFIG)
    private readonly config: PrototypesAuthConfig,
    private readonly serviceToken: PrototypesServiceToken,
  ) {}
  async generate(
    body: PrototypeImageGenerationInternalRequest,
    correlationId: string,
  ): Promise<PrototypeImageGenerationInternalResponse> {
    let response: Response;
    try {
      response = await fetch(
        `${this.config.aiAnalysisServiceUrl}/api/v1/internal/image-generations`,
        {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${await this.serviceToken.issue()}`,
            "content-type": "application/json",
            "x-correlation-id": correlationId,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.aiAnalysisTimeoutMs),
        },
      );
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      throw new PrototypeImageProviderError(
        timeout ? "OPENAI_IMAGE_TIMEOUT" : "AI_ANALYSIS_UNAVAILABLE",
        timeout
          ? "OpenAI excedió el tiempo permitido."
          : "AI Analysis no está disponible.",
        true,
      );
    }
    const payload = (await response.json().catch(() => null)) as
      | (PrototypeImageGenerationInternalResponse & {
          errorCode?: string;
          message?: string;
        })
      | null;
    if (!response.ok || !payload) {
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      throw new PrototypeImageProviderError(
        payload?.errorCode ?? `AI_ANALYSIS_HTTP_${response.status}`,
        payload?.message ?? "No fue posible generar la imagen.",
        retryable,
      );
    }
    return payload;
  }
}
