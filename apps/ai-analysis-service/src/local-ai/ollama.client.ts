import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { Agent } from "undici";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";
import { writeAiProviderTrace } from "../execution/ai-provider-trace";
import { LOCAL_AI_CONFIG, type LocalAiConfig } from "./ollama.config";

export class LocalAiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LocalAiError";
  }
}

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function errorSnapshot(error: unknown): Readonly<Record<string, unknown>> {
  return error instanceof Error
    ? {
        name: error.name,
        message: error.message,
        ...(error.cause ? { cause: String(error.cause) } : {}),
      }
    : { name: "UnknownError", message: String(error) };
}

// PASO_8C_OLLAMA_HTTP_SAFE_DETAIL_V1
// Ollama suele responder errores HTTP como {"error":"detalle técnico"}.
// Solo exponemos ese campo, con longitud acotada y rechazo de patrones que
// puedan parecer credenciales. Nunca devolvemos el body completo.

// PASO_8E_LINT_CONTROL_REGEX_V1
// Se evita no-control-regex sin desactivar ESLint. La semántica es la misma:
// U+0000..U+001F y U+007F se sustituyen por un espacio.
function replaceAsciiControlCharacters(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    sanitized += codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
  }
  return sanitized;
}
export function safeOllamaHttpErrorDetail(text: string): string | null {
  let parsed: Readonly<Record<string, unknown>> | null = null;
  try {
    parsed = object(JSON.parse(text));
  } catch {
    return null;
  }

  const error = parsed?.error;
  if (typeof error !== "string") return null;

  const normalized = replaceAsciiControlCharacters(error)
    .replace(/\s+/gu, " ")
    .trim();

  if (!normalized || normalized.length > 1_000) return null;

  if (
    /(?:authorization|bearer\s+[a-z0-9._-]+|api[_\s-]?key|password|contrase(?:ñ|n)a|sk-[a-z0-9_-]{10,})/iu.test(
      normalized,
    )
  ) {
    return null;
  }

  return normalized;
}

export interface OllamaGenerateTraceContext {
  sourceId?: string;
  sourceTitle?: string;
  sourceClassification?: string;
  onTraceId?: (traceId: string) => void;
}

// PASO_5_PERFILES_LOCAL_EXTRACT_DOCUMENT_V1
export type LocalAiExecutionProfile = "LOCAL_EXTRACT" | "LOCAL_DOCUMENT";

type OllamaStructuredTransport = "AUTO" | "GENERATE" | "CHAT";
type OllamaStructuredThinking = "LOW" | "DISABLED";

export interface ResolvedLocalAiExecutionProfile {
  structuredTransport: OllamaStructuredTransport;
  structuredThinking: OllamaStructuredThinking;
}

export function resolveLocalAiExecutionProfile(
  profile: LocalAiExecutionProfile,
): ResolvedLocalAiExecutionProfile {
  return profile === "LOCAL_EXTRACT"
    ? {
        structuredTransport: "CHAT",
        structuredThinking: "DISABLED",
      }
    : {
        structuredTransport: "AUTO",
        structuredThinking: "LOW",
      };
}

// PASO_11_DISCUSSION_LOCAL_GENERATE_COMPAT_V1
// Las opciones de bajo nivel se conservan para flujos aislados como Discusión.
// Los perfiles LOCAL_EXTRACT / LOCAL_DOCUMENT son la vía explícita del pipeline
// documental local y mantienen exactamente los comportamientos ya validados.
export interface OllamaRuntimeLimitsOverride {
  readonly contextTokens?: number;
  readonly maxOutputTokens?: number;
  readonly timeoutMs?: number;
}

export interface OllamaGenerateOptions {
  profile?: LocalAiExecutionProfile;
  structuredTransport?: OllamaStructuredTransport;
  structuredThinking?: OllamaStructuredThinking;
  /**
   * LOCAL_ONLY_V2 puede REDUCIR límites por inferencia.
   * Nunca permite superar la configuración global del proveedor.
   * Sin este campo, el comportamiento histórico queda idéntico.
   */
  runtimeLimits?: OllamaRuntimeLimitsOverride;
}

// PASO_8_CONTEXTO_LOCAL_POR_BLOQUE_V1
// maxInputTokens conserva el presupuesto documental del proveedor.
// Una sola inferencia no intenta mantener todo el proyecto en num_ctx.
export const OLLAMA_RUNTIME_CONTEXT_CAP = 65_536;

// PASO_8D_QWEN35_CHAT_STRUCTURED_V1
// qwen3.5 tiene incidencias conocidas en Ollama al combinar /api/generate,
// thinking y structured outputs. Para este modelo usamos /api/chat y un nivel
// de razonamiento bajo; el resto de modelos conserva /api/generate.
export function useChatForStructuredOllama(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  const slash = normalized.lastIndexOf("/");
  const modelName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return modelName === "qwen3.5" || modelName.startsWith("qwen3.5:");
}

// PASO_10_OLLAMA_GRAMMAR_JSON_FALLBACK_V1
// Algunos schemas válidos para AJV pueden ser rechazados por la conversión
// JSON-Schema -> grammar del runtime de Ollama/llama.cpp. El fallback solo se
// activa para ese HTTP 400 específico; no oculta otros errores de proveedor.
export function isOllamaStructuredGrammarFailure(error: unknown): boolean {
  if (!(error instanceof LocalAiError) || error.code !== "OLLAMA_HTTP_400") {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("failed to parse grammar") ||
    message.includes("invalid format schema") ||
    (message.includes("failed to initialize samplers") &&
      message.includes("grammar"))
  );
}

function boundedRuntimeLimit(
  requested: number | undefined,
  configured: number,
  minimum: number,
  name: string,
): number {
  if (requested === undefined) return configured;
  if (!Number.isInteger(requested) || requested < minimum) {
    throw new Error(`${name} debe ser un entero >= ${minimum}.`);
  }
  return Math.min(requested, configured);
}

export function effectiveOllamaLimits(
  prompt: string,
  configuredContextTokens: number,
  configuredOutputTokens = 8192,
): {
  contextTokens: number;
  outputTokens: number;
  estimatedPromptTokens: number;
} {
  const estimatedPromptTokens = Math.max(1, Math.ceil(prompt.length / 4));
  const desiredContext =
    estimatedPromptTokens + Math.min(configuredOutputTokens, 8192) + 1024;
  const roundedContext =
    2 ** Math.ceil(Math.log2(Math.max(8192, desiredContext)));
  const contextTokens = Math.min(
    configuredContextTokens,
    roundedContext,
    OLLAMA_RUNTIME_CONTEXT_CAP,
  );
  const outputTokens = Math.max(
    256,
    Math.min(
      configuredOutputTokens,
      8192,
      contextTokens - estimatedPromptTokens - 1024,
    ),
  );
  return { contextTokens, outputTokens, estimatedPromptTokens };
}

// PASO_13_TELEMETRIA_RENDIMIENTO_OLLAMA_V1
// Ollama devuelve estas duraciones en nanosegundos.
// Solo extraemos métricas operativas agregadas; no contenido.
export interface OllamaRuntimeTelemetry {
  totalDurationMs?: number;
  loadDurationMs?: number;
  promptEvalDurationMs?: number;
  evalDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  promptTokensPerSecond?: number;
  outputTokensPerSecond?: number;
}

function finiteRuntimeMetric(
  value: Readonly<Record<string, unknown>> | null,
  key: string,
): number | null {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : null;
}

function roundRuntimeMetric(value: number): number {
  return Number(value.toFixed(2));
}

function nsToMs(value: number | null): number | undefined {
  return value === null ? undefined : roundRuntimeMetric(value / 1_000_000);
}

function runtimeTokensPerSecond(
  tokens: number | null,
  durationNs: number | null,
): number | undefined {
  if (tokens === null || durationNs === null || durationNs <= 0) {
    return undefined;
  }
  return roundRuntimeMetric(tokens / (durationNs / 1_000_000_000));
}

export function ollamaRuntimeTelemetry(
  payload: unknown,
): OllamaRuntimeTelemetry {
  const value = object(payload);
  if (!value) return {};

  const totalNs = finiteRuntimeMetric(value, "total_duration");
  const loadNs = finiteRuntimeMetric(value, "load_duration");
  const promptNs = finiteRuntimeMetric(value, "prompt_eval_duration");
  const evalNs = finiteRuntimeMetric(value, "eval_duration");
  const inputTokens = finiteRuntimeMetric(value, "prompt_eval_count");
  const outputTokens = finiteRuntimeMetric(value, "eval_count");

  const totalDurationMs = nsToMs(totalNs);
  const loadDurationMs = nsToMs(loadNs);
  const promptEvalDurationMs = nsToMs(promptNs);
  const evalDurationMs = nsToMs(evalNs);
  const promptTokensPerSecond = runtimeTokensPerSecond(inputTokens, promptNs);
  const outputTokensPerSecond = runtimeTokensPerSecond(outputTokens, evalNs);

  return {
    ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
    ...(loadDurationMs !== undefined ? { loadDurationMs } : {}),
    ...(promptEvalDurationMs !== undefined ? { promptEvalDurationMs } : {}),
    ...(evalDurationMs !== undefined ? { evalDurationMs } : {}),
    ...(inputTokens !== null ? { inputTokens } : {}),
    ...(outputTokens !== null ? { outputTokens } : {}),
    ...(promptTokensPerSecond !== undefined ? { promptTokensPerSecond } : {}),
    ...(outputTokensPerSecond !== undefined ? { outputTokensPerSecond } : {}),
  };
}

@Injectable()
export class OllamaClient {
  constructor(
    @Inject(LOCAL_AI_CONFIG) private readonly config: LocalAiConfig,
  ) {}

  private get openAiCompatible(): boolean {
    return this.config.api === "OPENAI_COMPATIBLE";
  }

  async health(): Promise<void> {
    if (this.openAiCompatible) {
      const listing = object(
        await this.request("/v1/models", undefined, 30_000),
      );
      const available =
        Array.isArray(listing?.data) &&
        listing.data.some((entry) => object(entry)?.id === this.config.model);
      if (!available)
        throw new LocalAiError(
          "OLLAMA_MODEL_NOT_INSTALLED",
          `El modelo ${this.config.model} no está disponible en el servidor.`,
          false,
        );
      return;
    }
    const payload = await this.request("/api/tags", undefined, 30_000);
    const models = object(payload)?.models;
    const installed =
      Array.isArray(models) &&
      models.some((entry) => {
        const model = object(entry);
        return (
          model?.name === this.config.model ||
          model?.model === this.config.model
        );
      });
    if (!installed)
      throw new LocalAiError(
        "OLLAMA_MODEL_NOT_INSTALLED",
        `El modelo ${this.config.model} no está instalado.`,
        false,
      );
  }

  async generate(
    prompt: string,
    schema: Readonly<Record<string, unknown>>,
    images?: readonly string[],
    traceContext: OllamaGenerateTraceContext = {},
    cancellationSignal?: AbortSignal,
    options: OllamaGenerateOptions = {},
  ): Promise<string> {
    const traceId = randomUUID();
    traceContext.onTraceId?.(traceId);
    const startedAt = Date.now();
    let succeeded = false;
    const runtimeContextTokens = boundedRuntimeLimit(
      options.runtimeLimits?.contextTokens,
      this.config.contextTokens,
      1_024,
      "runtimeLimits.contextTokens",
    );
    const runtimeOutputTokens = boundedRuntimeLimit(
      options.runtimeLimits?.maxOutputTokens,
      this.config.maxOutputTokens ?? 8192,
      256,
      "runtimeLimits.maxOutputTokens",
    );
    const runtimeTimeoutMs = boundedRuntimeLimit(
      options.runtimeLimits?.timeoutMs,
      this.config.timeoutMs,
      1_000,
      "runtimeLimits.timeoutMs",
    );
    const limits = effectiveOllamaLimits(
      `${prompt}\n${JSON.stringify(schema)}`,
      runtimeContextTokens,
      runtimeOutputTokens,
    );
    if (this.openAiCompatible) {
      try {
        const result = await this.generateOpenAiCompatible(
          prompt,
          schema,
          images,
          traceId,
          limits.outputTokens,
          runtimeTimeoutMs,
          cancellationSignal,
        );
        succeeded = true;
        return result;
      } finally {
        getRuntimeMetrics("ai-analysis-service").observeOperation(
          "local_ai_source_analysis",
          succeeded ? "succeeded" : "failed",
          Date.now() - startedAt,
        );
      }
    }
    const profileOptions = options.profile
      ? resolveLocalAiExecutionProfile(options.profile)
      : null;
    const structuredTransport =
      profileOptions?.structuredTransport ??
      options.structuredTransport ??
      "AUTO";
    const structuredThinking =
      profileOptions?.structuredThinking ?? options.structuredThinking ?? "LOW";
    const forceGenerate = structuredTransport === "GENERATE";
    const forceChat = structuredTransport === "CHAT";
    const useChat =
      forceChat ||
      (!forceGenerate && useChatForStructuredOllama(this.config.model));
    const endpoint = useChat ? "/api/chat" : "/api/generate";
    const chatThink =
      structuredThinking === "DISABLED" ? false : ("low" as const);
    const requestBody = useChat
      ? {
          model: this.config.model,
          messages: [
            {
              role: "user",
              content: prompt,
              ...(images?.length ? { images } : {}),
            },
          ],
          stream: false,
          // PASO_3_LOCAL_ONLY_PREANALISIS_THINK_FALSE_V1
          // El default sigue siendo "low"; solo LOCAL_ONLY puede enviar DISABLED.
          think: chatThink,
          format: schema,
          options: {
            num_ctx: limits.contextTokens,
            num_predict: limits.outputTokens,
            temperature: 0,
          },
        }
      : {
          model: this.config.model,
          prompt,
          ...(images?.length ? { images } : {}),
          stream: false,
          think: false,
          format: schema,
          options: {
            num_ctx: limits.contextTokens,
            num_predict: limits.outputTokens,
            temperature: 0,
          },
        };
    await writeAiProviderTrace(traceId, "request", {
      provider: "OLLAMA",
      model: this.config.model,
      url: `${this.config.baseUrl}${endpoint}`,
      method: "POST",
      timeoutMs: runtimeTimeoutMs,
      sourceId: traceContext.sourceId ?? null,
      sourceTitle: traceContext.sourceTitle ?? null,
      sourceClassification: traceContext.sourceClassification ?? null,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      requestBody: {
        ...requestBody,
        ...(images?.length
          ? {
              images: images.map((image, index) => ({
                index,
                encodedCharacters: image.length,
                decodedBytes: Buffer.from(image, "base64").byteLength,
                content: "[BINARY_REDACTED]",
              })),
            }
          : {}),
      },
    });
    try {
      let payload: unknown;
      let structuredFallbackUsed = false;
      try {
        payload = await this.request(
          endpoint,
          requestBody,
          runtimeTimeoutMs,
          traceId,
          cancellationSignal,
        );
      } catch (error) {
        if (!(useChat && isOllamaStructuredGrammarFailure(error))) {
          throw error;
        }

        structuredFallbackUsed = true;
        const fallbackPrompt = [
          prompt,
          "OLLAMA_JSON_MODE_FALLBACK_V1",
          "La gramática estructurada no pudo inicializarse. Responde JSON válido que cumpla exactamente el siguiente esquema. No agregues texto fuera del JSON.",
          `ESQUEMA_JSON_REQUERIDO=${JSON.stringify(schema)}`,
        ].join("\n\n");

        const fallbackRequestBody = {
          ...requestBody,
          messages: [
            {
              role: "user",
              content: fallbackPrompt,
              ...(images?.length ? { images } : {}),
            },
          ],
          format: "json" as const,
        };

        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OLLAMA",
          model: this.config.model,
          phase: "OLLAMA_STRUCTURED_GRAMMAR_JSON_FALLBACK",
          code: "OLLAMA_STRUCTURED_GRAMMAR_JSON_FALLBACK",
          fallbackFormat: "json",
          schemaPreservedInPrompt: true,
        });

        payload = await this.request(
          endpoint,
          fallbackRequestBody,
          runtimeTimeoutMs,
          traceId,
          cancellationSignal,
        );
      }

      const payloadObject = object(payload);
      const response = useChat
        ? object(payloadObject?.message)?.content
        : payloadObject?.response;
      const doneReason =
        typeof payloadObject?.done_reason === "string"
          ? payloadObject.done_reason
          : null;
      const done = payloadObject?.done;
      const promptEvalCount =
        typeof payloadObject?.prompt_eval_count === "number"
          ? payloadObject.prompt_eval_count
          : null;
      const evalCount =
        typeof payloadObject?.eval_count === "number"
          ? payloadObject.eval_count
          : null;

      const runtimeTelemetry = ollamaRuntimeTelemetry(payloadObject);
      if (Object.keys(runtimeTelemetry).length > 0) {
        await writeAiProviderTrace(traceId, "runtime-metrics", {
          provider: "OLLAMA",
          model: this.config.model,
          phase: "OLLAMA_RUNTIME_METRICS_V1",
          ...runtimeTelemetry,
          effectiveContextTokens: limits.contextTokens,
          effectiveOutputTokens: limits.outputTokens,
          structuredFallbackUsed,
        });
      }

      /*
       * OLLAMA_OUTPUT_TRUNCATION_GUARD_V4_3
       *
       * No repara JSON incompleto. Si Ollama informa que terminó por
       * longitud (o devuelve done=false), falla cerrado para que el
       * analizador reprocesе únicamente ese segmento en partes menores.
       */
      if (doneReason === "length" || done === false) {
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OLLAMA",
          model: this.config.model,
          phase: "OLLAMA_OUTPUT_TRUNCATED",
          code: "OLLAMA_OUTPUT_TRUNCATED",
          ...(promptEvalCount !== null ? { inputTokens: promptEvalCount } : {}),
          ...(evalCount !== null ? { outputTokens: evalCount } : {}),
          effectiveMaxOutputTokens: limits.outputTokens,
          retryable: false,
        });
        throw new LocalAiError(
          "OLLAMA_OUTPUT_TRUNCATED",
          "Ollama alcanzó el límite de salida antes de completar el JSON.",
          false,
        );
      }

      if (typeof response !== "string" || !response.trim()) {
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OLLAMA",
          model: this.config.model,
          phase: "OLLAMA_STRUCTURED_CONTENT",
          error: {
            name: "LocalAiError",
            message: "Ollama no devolvió contenido estructurado.",
          },
        });
        throw new LocalAiError(
          "OLLAMA_INVALID_RESPONSE",
          "Ollama no devolvió contenido estructurado.",
          false,
        );
      }
      succeeded = true;
      return response;
    } finally {
      getRuntimeMetrics("ai-analysis-service").observeOperation(
        "local_ai_source_analysis",
        succeeded ? "succeeded" : "failed",
        Date.now() - startedAt,
      );
    }
  }

  /**
   * Servidores compatibles con OpenAI (llama.cpp / llama-swap): chat
   * completions con salida estructurada por esquema JSON. Los códigos de error
   * se conservan (OLLAMA_*) para reutilizar el manejo de truncamiento y reintentos.
   */
  private async generateOpenAiCompatible(
    prompt: string,
    schema: Readonly<Record<string, unknown>>,
    images: readonly string[] | undefined,
    traceId: string,
    maxOutputTokens: number,
    timeoutMs: number,
    cancellationSignal?: AbortSignal,
  ): Promise<string> {
    const content = images?.length
      ? [
          { type: "text", text: prompt },
          ...images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${image}` },
          })),
        ]
      : prompt;
    const requestBody = {
      model: this.config.model,
      messages: [{ role: "user", content }],
      stream: false,
      temperature: 0,
      max_tokens: maxOutputTokens,
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_output", strict: true, schema },
      },
    };
    await writeAiProviderTrace(traceId, "request", {
      provider: "OPENAI_COMPATIBLE",
      model: this.config.model,
      url: `${this.config.baseUrl}/v1/chat/completions`,
      method: "POST",
      timeoutMs,
      requestBody: images?.length
        ? { ...requestBody, messages: "[BINARY_REDACTED]" }
        : requestBody,
    });
    const payload = object(
      await this.request(
        "/v1/chat/completions",
        requestBody,
        timeoutMs,
        traceId,
        cancellationSignal,
      ),
    );
    const choice = Array.isArray(payload?.choices)
      ? object(payload.choices[0])
      : null;
    const usage = object(payload?.usage);
    if (choice?.finish_reason === "length") {
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI_COMPATIBLE",
        model: this.config.model,
        phase: "OLLAMA_OUTPUT_TRUNCATED",
        code: "OLLAMA_OUTPUT_TRUNCATED",
        ...(typeof usage?.prompt_tokens === "number"
          ? { inputTokens: usage.prompt_tokens }
          : {}),
        ...(typeof usage?.completion_tokens === "number"
          ? { outputTokens: usage.completion_tokens }
          : {}),
        effectiveMaxOutputTokens: maxOutputTokens,
        retryable: false,
      });
      throw new LocalAiError(
        "OLLAMA_OUTPUT_TRUNCATED",
        "El servidor alcanzó el límite de salida antes de completar el JSON.",
        false,
      );
    }
    const message = object(choice?.message)?.content;
    if (typeof message !== "string" || !message.trim()) {
      throw new LocalAiError(
        "OLLAMA_INVALID_RESPONSE",
        "El servidor no devolvió contenido estructurado.",
        false,
      );
    }
    return message;
  }

  private async request(
    path: string,
    body?: unknown,
    timeoutMs = this.config.timeoutMs,
    traceId?: string,
    cancellationSignal?: AbortSignal,
  ): Promise<unknown> {
    const startedAt = Date.now();

    /*
     * OLLAMA_HTTP_TIMEOUT_GUARD_V4_2
     *
     * Node fetch utiliza Undici. El dispatcher puede tener timeouts HTTP
     * internos independientes del timeout definido por la aplicación.
     *
     * Para Ollama desactivamos SOLO headersTimeout/bodyTimeout del
     * dispatcher. La autoridad temporal sigue siendo:
     *
     *   AbortSignal.timeout(timeoutMs)
     *
     * Por ejemplo, si la UI configura 600000 ms, Ollama podrá superar
     * 300000 ms, pero seguirá siendo cancelado al llegar a 600000 ms.
     */
    const dispatcher = new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
    });

    try {
      let response: Response;

      try {
        response = await fetch(`${this.config.baseUrl}${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers:
            body === undefined
              ? { accept: "application/json" }
              : {
                  accept: "application/json",
                  "content-type": "application/json",
                },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: cancellationSignal
            ? AbortSignal.any([
                AbortSignal.timeout(timeoutMs),
                cancellationSignal,
              ])
            : AbortSignal.timeout(timeoutMs),
          dispatcher,
          // Node fetch accepts the installed Undici dispatcher at runtime;
          // @types/node may reference a different version of its dispatcher types.
        } as unknown as RequestInit);
      } catch (error) {
        if (traceId) {
          await writeAiProviderTrace(traceId, "transport-error", {
            provider: "OLLAMA",
            model: this.config.model,
            durationMs: Date.now() - startedAt,
            error: errorSnapshot(error),
          });
        }

        const timeout =
          error instanceof Error &&
          (error.name === "TimeoutError" || error.name === "AbortError");

        if (cancellationSignal?.aborted) {
          throw new LocalAiError(
            "OLLAMA_CANCELLED",
            "El análisis local fue cancelado por el usuario.",
            false,
          );
        }

        const unavailable = path === "/api/tags" || path === "/v1/models";

        throw new LocalAiError(
          timeout
            ? "OLLAMA_TIMEOUT"
            : unavailable
              ? "OLLAMA_UNAVAILABLE"
              : "OLLAMA_CONNECTION_INTERRUPTED",
          timeout
            ? "Ollama excedió el tiempo límite."
            : unavailable
              ? "No fue posible conectar con Ollama."
              : "Ollama interrumpió la conexión durante la inferencia.",
          true,
        );
      }

      const declaredLength = Number(
        response.headers.get("content-length") ?? 0,
      );

      if (declaredLength > this.config.maxResponseBytes) {
        if (traceId) {
          await writeAiProviderTrace(traceId, "validation-error", {
            provider: "OLLAMA",
            model: this.config.model,
            phase: "OLLAMA_RESPONSE_SIZE_HEADER",
            declaredLength,
            maximumBytes: this.config.maxResponseBytes,
          });
        }

        throw new LocalAiError(
          "OLLAMA_RESPONSE_TOO_LARGE",
          "La respuesta de Ollama excede el límite permitido.",
          false,
        );
      }

      const text = await response.text();

      if (traceId) {
        await writeAiProviderTrace(traceId, "response", {
          provider: "OLLAMA",
          model: this.config.model,
          status: response.status,
          ok: response.ok,
          durationMs: Date.now() - startedAt,
          contentType: response.headers.get("content-type"),
          bodyRaw: text,
        });
      }

      if (!response.ok) {
        const safeDetail = safeOllamaHttpErrorDetail(text);
        throw new LocalAiError(
          `OLLAMA_HTTP_${response.status}`,
          safeDetail
            ? `Ollama rechazó la solicitud con HTTP ${response.status}. Detalle de Ollama: ${safeDetail}`
            : `Ollama rechazó la solicitud con HTTP ${response.status}.`,
          response.status >= 500 || response.status === 429,
        );
      }

      if (Buffer.byteLength(text) > this.config.maxResponseBytes) {
        if (traceId) {
          await writeAiProviderTrace(traceId, "validation-error", {
            provider: "OLLAMA",
            model: this.config.model,
            phase: "OLLAMA_RESPONSE_SIZE_BODY",
            actualBytes: Buffer.byteLength(text),
            maximumBytes: this.config.maxResponseBytes,
          });
        }

        throw new LocalAiError(
          "OLLAMA_RESPONSE_TOO_LARGE",
          "La respuesta de Ollama excede el límite permitido.",
          false,
        );
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        if (traceId) {
          await writeAiProviderTrace(traceId, "validation-error", {
            provider: "OLLAMA",
            model: this.config.model,
            phase: "OLLAMA_RESPONSE_JSON",
            error: errorSnapshot(error),
            bodyRaw: text,
          });
        }

        throw new LocalAiError(
          "OLLAMA_INVALID_JSON",
          "Ollama devolvió JSON inválido.",
          false,
        );
      }
    } finally {
      await dispatcher.close();
    }
  }
}
