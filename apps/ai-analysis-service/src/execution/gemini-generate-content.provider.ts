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

const GEMINI_MAX_RESPONSE_SCHEMA_CHARS = 20_000;

function geminiAcceptsResponseSchema(schema: unknown): boolean {
  try {
    const serialized = JSON.stringify(schema);
    return (
      typeof serialized === "string" &&
      serialized.length <= GEMINI_MAX_RESPONSE_SCHEMA_CHARS
    );
  } catch {
    return false;
  }
}

export const geminiGenerateContentSpec: CloudRestSpec = {
  code: "GEMINI",
  label: "Gemini (Google AI Studio)",
  buildRequest({ configuration, apiKey }, params) {
    const model = configuration.model.replace(/^models\//u, "");
    const responseSchema = geminiAcceptsResponseSchema(params.schema)
      ? { responseJsonSchema: params.schema }
      : {};
    return {
      url: `${configuration.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: {
        systemInstruction: { parts: [{ text: params.systemInstruction }] },
        contents: [{ role: "user", parts: [{ text: params.userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          ...responseSchema,
          maxOutputTokens: params.maxOutputTokens,
        },
      },
    };
  },
  readResponse(payload, headers) {
    const feedback = cloudObject(payload.promptFeedback);
    const candidate = cloudObject(
      Array.isArray(payload.candidates) ? payload.candidates[0] : null,
    );
    const finishReason =
      typeof candidate?.finishReason === "string"
        ? candidate.finishReason
        : null;
    if (
      typeof feedback?.blockReason === "string" ||
      finishReason === "SAFETY" ||
      finishReason === "PROHIBITED_CONTENT" ||
      finishReason === "BLOCKLIST"
    ) {
      throw new AiProviderError(
        "GEMINI_BLOCKED",
        "Gemini (Google AI Studio) bloqueó la solicitud por sus políticas de seguridad.",
        false,
      );
    }
    const content = cloudObject(candidate?.content);
    const text = (Array.isArray(content?.parts) ? content.parts : [])
      .map((part) => cloudObject(part))
      .filter((part) => part?.thought !== true)
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
    const usage = cloudObject(payload.usageMetadata);
    return {
      text,
      truncated: finishReason === "MAX_TOKENS",
      providerRequestId:
        typeof payload.responseId === "string"
          ? payload.responseId
          : headers.get("x-request-id"),
      inputTokens: cloudNumber(usage?.promptTokenCount),
      outputTokens: sumTokens(
        usage?.candidatesTokenCount,
        usage?.thoughtsTokenCount,
      ),
    };
  },
};

export class GeminiGenerateContentProvider implements AiTextProvider {
  constructor(private readonly resolved: ResolvedAiProvider) {}

  generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    return generateCloudDraft(
      geminiGenerateContentSpec,
      this.resolved,
      request,
    );
  }

  generateStructured(
    params: CloudStructuredParams,
  ): Promise<CloudStructuredResult> {
    return executeCloudStructured(
      geminiGenerateContentSpec,
      this.resolved,
      params,
    );
  }
}
