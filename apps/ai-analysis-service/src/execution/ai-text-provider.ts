import type { AiAnalysisDraft } from "@levantamiento-rq/shared-contracts";

export interface AiGenerationRequest {
  systemInstruction: string;
  userPrompt: string;
  schema: Readonly<Record<string, unknown>>;
  attempt?: number;
  idempotencyKey?: string;
  resumeProviderRequestId?: string | null;
  onProviderRequestId?: (providerRequestId: string) => Promise<void> | void;
}

export interface AiGenerationResponse {
  draft: AiAnalysisDraft;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiTextProvider {
  generate(request: AiGenerationRequest): Promise<AiGenerationResponse>;
}

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    /** Causa estructurada y sin contenido del documento (contadores/etiquetas). */
    readonly details?: Readonly<Record<string, string | number | boolean>>,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}
