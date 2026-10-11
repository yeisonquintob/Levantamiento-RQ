import { randomUUID } from "node:crypto";

import { parseAiAnalysisDraft } from "./ai-analysis-draft";
import {
  inspectAiOutboundContent,
  resolveAiDlpPolicy,
} from "./ai-data-loss-prevention";
import { writeAiProviderTrace } from "./ai-provider-trace";
import {
  AiProviderError,
  type AiGenerationRequest,
  type AiGenerationResponse,
  type AiTextProvider,
} from "./ai-text-provider";
import { AnthropicMessagesProvider } from "./anthropic-messages.provider";
import { GeminiGenerateContentProvider } from "./gemini-generate-content.provider";
import { OpenAiCompatibleCloudProvider } from "./openai-compatible-cloud.provider";
import { OpenAiResponsesProvider } from "./openai-responses.provider";
import type { ResolvedAiProvider } from "../providers/ai-provider-configurations.service";

export type CloudRestProviderCode = "ANTHROPIC" | "GEMINI" | "GROQ" | "CEREBRAS";

export interface CloudStructuredParams {
  systemInstruction: string;
  userPrompt: string;
  schema: Readonly<Record<string, unknown>>;
  maxOutputTokens: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** La prueba de conexión solo exige una respuesta HTTP bien formada. */
  lenient?: boolean;
}

export interface CloudStructuredResult {
  text: string;
  providerRequestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface CloudRestResponse extends CloudStructuredResult {
  truncated: boolean;
}

export interface CloudRestRequest {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

/** Contrato REST específico de cada proveedor; el resto es común. */
export interface CloudRestSpec {
  code: CloudRestProviderCode;
  label: string;
  buildRequest(
    resolved: ResolvedAiProvider,
    params: CloudStructuredParams,
  ): CloudRestRequest;
  readResponse(
    payload: Readonly<Record<string, unknown>>,
    headers: Headers,
  ): CloudRestResponse;
}

export function cloudObject(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export function cloudNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function sumTokens(...values: unknown[]): number | null {
  const numbers = values.filter(
    (value): value is number => cloudNumber(value) !== null,
  );
  return numbers.length > 0
    ? numbers.reduce((total, value) => total + value, 0)
    : null;
}

/** Extrae el objeto JSON aunque el modelo lo envuelva en un bloque de código. */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  if (candidate.startsWith("{")) return candidate;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  return first >= 0 && last > first
    ? candidate.slice(first, last + 1)
    : candidate;
}

export async function executeCloudStructured(
  spec: CloudRestSpec,
  resolved: ResolvedAiProvider,
  params: CloudStructuredParams,
  attempt = 1,
): Promise<CloudStructuredResult> {
  const { configuration } = resolved;
  const traceId = randomUUID();
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? configuration.timeoutMs;
  const built = spec.buildRequest(resolved, params);

  await writeAiProviderTrace(traceId, "request", {
    provider: spec.code,
    model: configuration.model,
    method: "POST",
    timeoutMs,
    configuredTimeoutMs: configuration.timeoutMs,
    effectiveMaxOutputTokens: params.maxOutputTokens,
    attempt,
  });

  const timeout = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await fetch(built.url, {
      method: "POST",
      headers: { ...built.headers },
      body: JSON.stringify(built.body),
      signal: params.signal
        ? AbortSignal.any([timeout, params.signal])
        : timeout,
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    await writeAiProviderTrace(traceId, "transport-error", {
      provider: spec.code,
      model: configuration.model,
      durationMs: Date.now() - startedAt,
      errorName,
    });
    if (params.signal?.aborted) {
      throw new AiProviderError(
        `${spec.code}_CANCELLED`,
        `La solicitud a ${spec.label} fue cancelada.`,
        false,
      );
    }
    const timedOut = errorName === "TimeoutError";
    throw new AiProviderError(
      timedOut ? `${spec.code}_TIMEOUT` : `${spec.code}_UNAVAILABLE`,
      timedOut
        ? `${spec.label} excedió el tiempo límite configurado.`
        : `No fue posible conectar con ${spec.label}.`,
      true,
    );
  }

  const raw = await response.text();
  await writeAiProviderTrace(traceId, "response", {
    provider: spec.code,
    model: configuration.model,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    contentType: response.headers.get("content-type"),
  });

  if (!response.ok) {
    const retryable =
      response.status === 408 ||
      response.status === 409 ||
      response.status === 429 ||
      response.status >= 500;
    throw new AiProviderError(
      `${spec.code}_HTTP_${response.status}`,
      response.status === 401 || response.status === 403
        ? `La credencial de ${spec.label} fue rechazada.`
        : response.status === 404
          ? `${spec.label} no reconoce el modelo configurado (HTTP 404).`
          : `${spec.label} rechazó la ejecución con HTTP ${response.status}.`,
      retryable,
    );
  }

  let payload: Readonly<Record<string, unknown>>;
  try {
    payload = cloudObject(raw ? JSON.parse(raw) : null) ?? {};
  } catch {
    throw new AiProviderError(
      `${spec.code}_INVALID_RESPONSE`,
      `${spec.label} devolvió JSON inválido.`,
      true,
    );
  }

  const parsed = spec.readResponse(payload, response.headers);
  if (!params.lenient) {
    if (parsed.truncated) {
      throw new AiProviderError(
        `${spec.code}_INCOMPLETE_OUTPUT`,
        `${spec.label} alcanzó el límite de salida configurado (${params.maxOutputTokens} tokens). Aumenta Max output tokens antes de reintentar.`,
        false,
      );
    }
    if (!parsed.text.trim()) {
      throw new AiProviderError(
        `${spec.code}_INVALID_RESPONSE`,
        `${spec.label} no devolvió contenido.`,
        true,
      );
    }
  }
  return parsed;
}

/** Base común de los adaptadores REST de texto (DLP + JSON + borrador). */
export async function generateCloudDraft(
  spec: CloudRestSpec,
  resolved: ResolvedAiProvider,
  request: AiGenerationRequest,
): Promise<AiGenerationResponse> {
  const { configuration } = resolved;
  const dlp = inspectAiOutboundContent(
    request.userPrompt,
    resolveAiDlpPolicy(),
  );
  if (dlp.action === "BLOCK") {
    await writeAiProviderTrace(randomUUID(), "validation-error", {
      provider: spec.code,
      model: configuration.model,
      phase: "DLP_OUTBOUND_BLOCK",
      findingCount: dlp.findings.length,
      code: `${spec.code}_DLP_BLOCKED`,
    });
    throw new AiProviderError(
      `${spec.code}_DLP_BLOCKED`,
      "La solicitud contiene información sensible y fue bloqueada antes de salir del sistema.",
      false,
    );
  }

  const result = await executeCloudStructured(
    spec,
    resolved,
    {
      systemInstruction: request.systemInstruction,
      userPrompt: dlp.content,
      schema: request.schema,
      maxOutputTokens: configuration.maxOutputTokens,
    },
    request.attempt ?? 1,
  );
  if (result.providerRequestId) {
    await request.onProviderRequestId?.(result.providerRequestId);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonText(result.text));
  } catch {
    throw new AiProviderError(
      `${spec.code}_INVALID_JSON`,
      "La salida estructurada no contiene JSON válido.",
      true,
    );
  }

  let draft;
  try {
    draft = parseAiAnalysisDraft(parsed);
  } catch (error) {
    throw new AiProviderError(
      `${spec.code}_STRUCTURED_OUTPUT_INVALID`,
      `${spec.label} devolvió una salida estructurada inconsistente: ${
        error instanceof Error ? error.message : "error de validación"
      }`,
      true,
    );
  }

  return {
    draft,
    providerRequestId: result.providerRequestId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

export function isCloudRestProvider(
  providerType: string,
): providerType is CloudRestProviderCode {
  return (
    providerType === "ANTHROPIC" ||
    providerType === "GEMINI" ||
    providerType === "GROQ" ||
    providerType === "CEREBRAS"
  );
}

/** Selecciona el adaptador del proveedor nube ya resuelto y probado. */
export function createCloudTextProvider(
  resolved: ResolvedAiProvider,
): AiTextProvider {
  switch (resolved.configuration.providerType) {
    case "ANTHROPIC":
      return new AnthropicMessagesProvider(resolved);
    case "GEMINI":
      return new GeminiGenerateContentProvider(resolved);
    case "GROQ":
    case "CEREBRAS":
      return new OpenAiCompatibleCloudProvider(
        resolved,
        resolved.configuration.providerType,
      );
    case "OPENAI":
      return new OpenAiResponsesProvider(resolved);
    default:
      throw new AiProviderError(
        "CLOUD_PROVIDER_UNSUPPORTED",
        "El proveedor seleccionado no es un proveedor de IA nube compatible.",
        false,
      );
  }
}

/** Llamada JSON estructurada genérica (p. ej. discusión) sin borrador. */
export async function generateCloudStructuredJson(
  resolved: ResolvedAiProvider,
  params: CloudStructuredParams,
): Promise<CloudStructuredResult> {
  const providerType = resolved.configuration.providerType;
  const adapter =
    providerType === "ANTHROPIC"
      ? new AnthropicMessagesProvider(resolved)
      : providerType === "GEMINI"
        ? new GeminiGenerateContentProvider(resolved)
        : providerType === "GROQ" || providerType === "CEREBRAS"
          ? new OpenAiCompatibleCloudProvider(resolved, providerType)
          : null;
  if (!adapter) {
    throw new AiProviderError(
      "CLOUD_PROVIDER_UNSUPPORTED",
      "El proveedor seleccionado no usa un adaptador REST estructurado.",
      false,
    );
  }
  return adapter.generateStructured(params);
}

const CONNECTION_TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status"],
  properties: { status: { type: "string", enum: ["ok"] } },
} as const;

export interface CloudConnectionTestOutcome {
  succeeded: boolean;
  errorCode: string | null;
  message: string;
}

/** Prueba administrativa: petición fija y mínima, sin datos del usuario. */
export async function testCloudTextProvider(
  resolved: ResolvedAiProvider,
): Promise<CloudConnectionTestOutcome> {
  try {
    await generateCloudStructuredJson(resolved, {
      systemInstruction: "Responde únicamente con JSON válido.",
      userPrompt: 'Devuelve exactamente {"status":"ok"}.',
      schema: CONNECTION_TEST_SCHEMA,
      maxOutputTokens: 1024,
      timeoutMs: Math.min(resolved.configuration.timeoutMs, 60_000),
      lenient: true,
    });
    return { succeeded: true, errorCode: null, message: "" };
  } catch (error) {
    if (error instanceof AiProviderError) {
      return {
        succeeded: false,
        errorCode: error.code,
        message: error.message,
      };
    }
    return {
      succeeded: false,
      errorCode: `${resolved.configuration.providerType}_UNAVAILABLE`,
      message: `No fue posible validar ${resolved.configuration.providerType}.`,
    };
  }
}
