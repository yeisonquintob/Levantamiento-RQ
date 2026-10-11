import { AiProviderError } from "./ai-text-provider";
import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiTextProvider,
} from "./ai-text-provider";
import {
  cloudNumber,
  cloudObject,
  executeCloudStructured,
  generateCloudDraft,
  sumTokens,
  type CloudRestSpec,
  type CloudStructuredParams,
  type CloudStructuredResult,
} from "./cloud-text-provider";
import type { ResolvedAiProvider } from "../providers/ai-provider-configurations.service";

export const ANTHROPIC_VERSION = "2023-06-01";

export const anthropicMessagesSpec: CloudRestSpec = {
  code: "ANTHROPIC",
  label: "Claude (Anthropic)",
  buildRequest({ configuration, apiKey }, params) {
    return {
      url: `${configuration.baseUrl}/messages`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: {
        model: configuration.model,
        max_tokens: params.maxOutputTokens,
        system: [
          params.systemInstruction,
          "Responde únicamente con un objeto JSON válido, sin texto adicional ni bloques de código, que cumpla exactamente este esquema JSON:",
          JSON.stringify(params.schema),
        ].join("\n\n"),
        messages: [{ role: "user", content: params.userPrompt }],
      },
    };
  },
  readResponse(payload, headers) {
    const stopReason =
      typeof payload.stop_reason === "string" ? payload.stop_reason : null;
    if (stopReason === "refusal") {
      throw new AiProviderError(
        "ANTHROPIC_REFUSED",
        "Claude (Anthropic) rechazó procesar la solicitud.",
        false,
      );
    }
    const text = (Array.isArray(payload.content) ? payload.content : [])
      .map((block) => cloudObject(block))
      .filter((block) => block?.type === "text")
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .join("");
    const usage = cloudObject(payload.usage);
    return {
      text,
      truncated: stopReason === "max_tokens",
      providerRequestId:
        headers.get("request-id") ??
        (typeof payload.id === "string" ? payload.id : null),
      inputTokens: sumTokens(
        usage?.input_tokens,
        usage?.cache_creation_input_tokens,
        usage?.cache_read_input_tokens,
      ),
      outputTokens: cloudNumber(usage?.output_tokens),
    };
  },
};

export class AnthropicMessagesProvider implements AiTextProvider {
  constructor(private readonly resolved: ResolvedAiProvider) {}

  generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    return generateCloudDraft(anthropicMessagesSpec, this.resolved, request);
  }

  generateStructured(
    params: CloudStructuredParams,
  ): Promise<CloudStructuredResult> {
    return executeCloudStructured(anthropicMessagesSpec, this.resolved, params);
  }
}
