import { Injectable } from "@nestjs/common";

import { parseAiAnalysisDraft } from "./ai-analysis-draft";
import {
  AiProviderError,
  type AiGenerationRequest,
  type AiGenerationResponse,
  type AiTextProvider,
} from "./ai-text-provider";
import type { ResolvedAiProvider } from "../providers/ai-provider-configurations.service";

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function outputText(payload: Readonly<Record<string, unknown>>): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  if (!Array.isArray(payload.output)) {
    throw new AiProviderError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI no devolvió contenido.",
      false,
    );
  }
  for (const output of payload.output) {
    const message = object(output);
    if (!message || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      const item = object(content);
      if (item?.type === "output_text" && typeof item.text === "string") {
        return item.text;
      }
    }
  }
  throw new AiProviderError(
    "OPENAI_INVALID_RESPONSE",
    "OpenAI no devolvió texto estructurado.",
    false,
  );
}

@Injectable()
export class OpenAiResponsesProvider implements AiTextProvider {
  constructor(private readonly resolved: ResolvedAiProvider) {}

  async generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    const { configuration, apiKey } = this.resolved;
    let response: Response;

    try {
      response = await fetch(`${configuration.baseUrl}/responses`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuration.model,
          store: false,
          max_output_tokens: configuration.maxOutputTokens,
          input: [
            { role: "system", content: request.systemInstruction },
            { role: "user", content: request.userPrompt },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "requirement_document_analysis",
              strict: true,
              schema: request.schema,
            },
          },
        }),
        signal: AbortSignal.timeout(configuration.timeoutMs),
      });
    } catch (error) {
      const timeout = error instanceof Error && error.name === "TimeoutError";
      throw new AiProviderError(
        timeout ? "OPENAI_TIMEOUT" : "OPENAI_UNAVAILABLE",
        timeout
          ? "OpenAI excedió el tiempo límite."
          : "No fue posible conectar con OpenAI.",
        true,
      );
    }

    const raw = await response.text();
    let payload: Readonly<Record<string, unknown>>;
    try {
      payload = object(raw ? JSON.parse(raw) : null) ?? {};
    } catch {
      throw new AiProviderError(
        "OPENAI_INVALID_RESPONSE",
        "OpenAI devolvió JSON inválido.",
        false,
      );
    }

    if (!response.ok) {
      const retryable =
        response.status === 408 ||
        response.status === 409 ||
        response.status === 429 ||
        response.status >= 500;
      throw new AiProviderError(
        `OPENAI_HTTP_${response.status}`,
        response.status === 401
          ? "La credencial de OpenAI fue rechazada."
          : `OpenAI rechazó la ejecución con HTTP ${response.status}.`,
        retryable,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText(payload));
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError(
        "OPENAI_INVALID_JSON",
        "La salida estructurada no contiene JSON válido.",
        false,
      );
    }

    const usage = object(payload.usage);
    return {
      draft: parseAiAnalysisDraft(parsed),
      providerRequestId: typeof payload.id === "string" ? payload.id : null,
      inputTokens:
        typeof usage?.input_tokens === "number" ? usage.input_tokens : null,
      outputTokens:
        typeof usage?.output_tokens === "number" ? usage.output_tokens : null,
    };
  }
}
