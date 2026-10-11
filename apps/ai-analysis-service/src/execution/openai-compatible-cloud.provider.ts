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
  type CloudRestSpec,
  type CloudStructuredParams,
  type CloudStructuredResult,
} from "./cloud-text-provider";
import type { ResolvedAiProvider } from "../providers/ai-provider-configurations.service";

export type OpenAiCompatibleCloudCode = "GROQ" | "CEREBRAS";

const LABELS: Readonly<Record<OpenAiCompatibleCloudCode, string>> = {
  GROQ: "Groq",
  CEREBRAS: "Cerebras",
};

/** Chat Completions compatible con OpenAI, compartido por Groq y Cerebras. */
export function openAiCompatibleCloudSpec(
  code: OpenAiCompatibleCloudCode,
): CloudRestSpec {
  return {
    code,
    label: LABELS[code],
    buildRequest({ configuration, apiKey }, params) {
      return {
        url: `${configuration.baseUrl}/chat/completions`,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: {
          model: configuration.model,
          messages: [
            { role: "system", content: params.systemInstruction },
            { role: "user", content: params.userPrompt },
          ],
          max_completion_tokens: params.maxOutputTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "structured_output",
              strict: code !== "GROQ",
              schema: params.schema,
            },
          },
        },
      };
    },
    readResponse(payload, headers) {
      const choice = cloudObject(
        Array.isArray(payload.choices) ? payload.choices[0] : null,
      );
      const message = cloudObject(choice?.message);
      const usage = cloudObject(payload.usage);
      return {
        text: typeof message?.content === "string" ? message.content : "",
        truncated: choice?.finish_reason === "length",
        providerRequestId:
          typeof payload.id === "string"
            ? payload.id
            : headers.get("x-request-id"),
        inputTokens: cloudNumber(usage?.prompt_tokens),
        outputTokens: cloudNumber(usage?.completion_tokens),
      };
    },
  };
}

export class OpenAiCompatibleCloudProvider implements AiTextProvider {
  private readonly spec: CloudRestSpec;

  constructor(
    private readonly resolved: ResolvedAiProvider,
    code: OpenAiCompatibleCloudCode,
  ) {
    this.spec = openAiCompatibleCloudSpec(code);
  }

  generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    return generateCloudDraft(this.spec, this.resolved, request);
  }

  generateStructured(
    params: CloudStructuredParams,
  ): Promise<CloudStructuredResult> {
    return executeCloudStructured(this.spec, this.resolved, params);
  }
}
