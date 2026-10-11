import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import {
  KpiObjectiveReferenceError,
  parseAiAnalysisDraft,
} from "./ai-analysis-draft";
import {
  applyKpiObjectiveRepairPatch,
  buildKpiObjectiveRepairPrompt,
  buildKpiObjectiveRepairSchema,
  extractKpiRepairContext,
  KPI_OBJECTIVE_REPAIR_SYSTEM_INSTRUCTION,
} from "./ai-kpi-objective-repair";
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
import type { ResolvedAiProvider } from "../providers/ai-provider-configurations.service";

function object(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function outputText(payload: Readonly<Record<string, unknown>>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    throw new AiProviderError(
      "OPENAI_INVALID_RESPONSE",
      "OpenAI no devolvió contenido.",
      true,
    );
  }

  const parts: string[] = [];

  for (const output of payload.output) {
    const message = object(output);

    if (!message || !Array.isArray(message.content)) continue;

    for (const content of message.content) {
      const item = object(content);

      if (item?.type === "output_text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
  }

  const joined = parts.join("");

  if (joined.trim()) {
    return joined;
  }

  throw new AiProviderError(
    "OPENAI_INVALID_RESPONSE",
    "OpenAI no devolvió texto estructurado.",
    true,
  );
}

function errorSnapshot(error: unknown): Readonly<Record<string, unknown>> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: "UnknownError",
    message: String(error),
  };
}

function providerFailure(payload: Readonly<Record<string, unknown>>): {
  code: string | null;
  message: string | null;
} {
  const error = object(payload.error);
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message : null,
  };
}

const OPENAI_BACKGROUND_OUTPUT_THRESHOLD = 16_000;
const OPENAI_BACKGROUND_POLL_INTERVAL_MS = 2_000;
const OPENAI_BACKGROUND_POLL_REQUEST_TIMEOUT_MS = 30_000;

function isPendingResponseStatus(status: unknown): boolean {
  return status === "queued" || status === "in_progress";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function effectiveOpenAiTimeoutMs(
  configuredTimeoutMs: number,
  maxOutputTokens: number,
  attempt = 1,
): number {
  const largeStructuredOutputFloor = maxOutputTokens > 16_000 ? 240_000 : 0;
  const retryTimeout = configuredTimeoutMs + Math.max(0, attempt - 1) * 60_000;
  return Math.min(
    600_000,
    Math.max(configuredTimeoutMs, largeStructuredOutputFloor, retryTimeout),
  );
}

@Injectable()
export class OpenAiResponsesProvider implements AiTextProvider {
  constructor(private readonly resolved: ResolvedAiProvider) {}

  private async retrieveBackgroundResponse(
    responseId: string,
    url: string,
    apiKey: string,
    deadline: number,
    traceId: string,
    startedAt: number,
  ): Promise<Readonly<Record<string, unknown>>> {
    let firstPoll = true;
    let lastTracedStatus: string | null = null;
    let lastTransportErrorName: string | null = null;

    while (Date.now() < deadline) {
      if (!firstPoll) {
        await delay(
          Math.min(
            OPENAI_BACKGROUND_POLL_INTERVAL_MS,
            Math.max(1, deadline - Date.now()),
          ),
        );
      }
      firstPoll = false;

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;

      let response: Response;
      let raw: string;
      try {
        response = await fetch(`${url}/${encodeURIComponent(responseId)}`, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          signal: AbortSignal.timeout(
            Math.max(
              1,
              Math.min(OPENAI_BACKGROUND_POLL_REQUEST_TIMEOUT_MS, remainingMs),
            ),
          ),
        });

        /*
         * OPENAI_BACKGROUND_BODY_TIMEOUT_RECOVERY_V1
         *
         * El mismo AbortSignal puede vencer después de recibir los headers y
         * mientras undici todavía consume el body. response.text() debe quedar
         * dentro del mismo manejo recuperable del poll para no convertir un
         * timeout transitorio de GET /responses/{id} en AI_EXECUTION_FAILED.
         * El trabajo remoto conserva el mismo responseId y se consulta de nuevo.
         */
        raw = await response.text();
      } catch (error) {
        const snapshot = errorSnapshot(error);
        const errorName =
          typeof snapshot.name === "string" ? snapshot.name : "UnknownError";
        if (errorName !== lastTransportErrorName) {
          await writeAiProviderTrace(traceId, "transport-error", {
            provider: "OPENAI",
            model: this.resolved.configuration.model,
            phase: "OPENAI_BACKGROUND_RETRIEVE",
            responseId,
            durationMs: Date.now() - startedAt,
            errorName,
          });
          lastTransportErrorName = errorName;
        }
        continue;
      }

      lastTransportErrorName = null;

      if (!response.ok) {
        await writeAiProviderTrace(traceId, "response", {
          provider: "OPENAI",
          model: this.resolved.configuration.model,
          phase: "OPENAI_BACKGROUND_RETRIEVE",
          responseId,
          status: response.status,
          ok: false,
          durationMs: Date.now() - startedAt,
          openAiRequestId:
            response.headers.get("x-request-id") ??
            response.headers.get("request-id") ??
            null,
          contentType: response.headers.get("content-type"),
        });

        if (
          response.status === 404 ||
          response.status === 408 ||
          response.status === 409 ||
          response.status === 429 ||
          response.status >= 500
        ) {
          continue;
        }

        throw new AiProviderError(
          `OPENAI_HTTP_${response.status}`,
          response.status === 401
            ? "La credencial de OpenAI fue rechazada."
            : `OpenAI rechazó la consulta de la ejecución con HTTP ${response.status}.`,
          false,
        );
      }

      let payload: Readonly<Record<string, unknown>>;
      try {
        payload = object(raw ? JSON.parse(raw) : null) ?? {};
      } catch (error) {
        const snapshot = errorSnapshot(error);
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OPENAI",
          model: this.resolved.configuration.model,
          phase: "OPENAI_BACKGROUND_RESPONSE_JSON",
          responseId,
          errorName:
            typeof snapshot.name === "string" ? snapshot.name : "UnknownError",
          errorMessage:
            typeof snapshot.message === "string"
              ? snapshot.message
              : "JSON inválido",
        });
        throw new AiProviderError(
          "OPENAI_INVALID_RESPONSE",
          "OpenAI devolvió JSON inválido al consultar la ejecución.",
          true,
        );
      }

      const responseStatus =
        typeof payload.status === "string" ? payload.status : "unknown";
      if (
        responseStatus !== lastTracedStatus ||
        !isPendingResponseStatus(responseStatus)
      ) {
        await writeAiProviderTrace(traceId, "response", {
          provider: "OPENAI",
          model: this.resolved.configuration.model,
          phase: "OPENAI_BACKGROUND_RETRIEVE",
          responseId,
          status: response.status,
          ok: true,
          responseStatus,
          durationMs: Date.now() - startedAt,
          openAiRequestId:
            response.headers.get("x-request-id") ??
            response.headers.get("request-id") ??
            null,
          contentType: response.headers.get("content-type"),
        });
        lastTracedStatus = responseStatus;
      }

      if (!isPendingResponseStatus(payload.status)) return payload;
    }

    /*
     * OPENAI_BACKGROUND_RESUME_V1
     * No cancelamos el trabajo remoto cuando vence solo la espera local.
     * El responseId persistido permite que el siguiente intento continúe con
     * GET /responses/{id} en lugar de crear otra generación.
     */
    throw new AiProviderError(
      "OPENAI_TIMEOUT",
      "OpenAI continúa procesando la respuesta en segundo plano; la ejecución se reanudará con el mismo identificador.",
      true,
    );
  }

  /**
   * AI_ANALYSIS_KPI_OBJECTIVE_LOCALIZED_REPAIR_V1
   * Reintento localizado de `scope.content.kpis`: una sola llamada pequeña con
   * la lista exacta de objetivos permitidos. Devuelve null ante cualquier
   * fallo (fail-closed) y el borrador original sigue rechazado. Solo se
   * registran contadores en la traza, nunca texto del documento.
   */
  private async repairKpiObjectives(
    parsed: unknown,
    traceId: string,
    timeoutMs: number,
    noMatchIndexes: readonly number[],
  ): Promise<{
    draft: ReturnType<typeof parseAiAnalysisDraft>;
    inputTokens: number;
    outputTokens: number;
  } | null> {
    const { configuration, apiKey } = this.resolved;
    const trace = (outcome: string, extra: Record<string, unknown> = {}) =>
      writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "KPI_OBJECTIVE_REPAIR",
        outcome,
        ...extra,
      });

    const context = extractKpiRepairContext(parsed);
    if (!context) {
      await trace("NOT_APPLICABLE");
      return null;
    }
    // Solo los KPI SIN coincidencia segura se reparan, identificados por nombre.
    const targetNames = noMatchIndexes.map(
      (index) => context.kpis[index]?.name,
    );
    if (targetNames.some((name) => name === undefined)) {
      await trace("NOT_APPLICABLE");
      return null;
    }
    const targets = targetNames as string[];
    const counters = {
      objectiveCount: context.objectives.length,
      kpiCount: context.kpis.length,
      targetCount: targets.length,
    };

    const prompt = buildKpiObjectiveRepairPrompt(context, targets);
    const dlp = inspectAiOutboundContent(prompt, resolveAiDlpPolicy());
    if (dlp.action === "BLOCK") {
      await trace("DLP_BLOCKED", counters);
      return null;
    }

    let payload: Readonly<Record<string, unknown>> | null;
    try {
      const response = await fetch(`${configuration.baseUrl}/responses`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: configuration.model,
          store: false,
          max_output_tokens: Math.min(configuration.maxOutputTokens, 8_000),
          input: [
            {
              role: "system",
              content: KPI_OBJECTIVE_REPAIR_SYSTEM_INSTRUCTION,
            },
            { role: "user", content: dlp.content },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "kpi_objective_patch",
              strict: true,
              schema: buildKpiObjectiveRepairSchema(context, targets),
            },
          },
        }),
        signal: AbortSignal.timeout(Math.min(timeoutMs, 180_000)),
      });
      if (!response.ok) {
        await trace("HTTP_ERROR", { ...counters, status: response.status });
        return null;
      }
      payload = object(await response.json());
    } catch {
      await trace("TRANSPORT_ERROR", counters);
      return null;
    }
    if (!payload) {
      await trace("INVALID_RESPONSE", counters);
      return null;
    }
    const status = payload.status;
    if (typeof status === "string" && status !== "completed") {
      await trace("NOT_COMPLETED", { ...counters, responseStatus: status });
      return null;
    }

    let patch: unknown;
    try {
      patch = JSON.parse(outputText(payload));
    } catch {
      await trace("INVALID_JSON", counters);
      return null;
    }

    const repairedRaw = applyKpiObjectiveRepairPatch(parsed, patch, targets);
    if (repairedRaw === null) {
      await trace("INVALID_PATCH", counters);
      return null;
    }
    let draft: ReturnType<typeof parseAiAnalysisDraft>;
    try {
      draft = parseAiAnalysisDraft(repairedRaw);
    } catch {
      await trace("REVALIDATION_FAILED", counters);
      return null;
    }
    await trace("SUCCEEDED", counters);

    const usage = object(payload.usage);
    return {
      draft: {
        ...draft,
        warnings: [
          ...draft.warnings,
          "Los KPI de Alcance se corrigieron con un reintento localizado: cada objetivo relacionado es una copia exacta de un objetivo específico generado. Requiere revisión humana.",
        ],
      } as ReturnType<typeof parseAiAnalysisDraft>,
      inputTokens:
        typeof usage?.input_tokens === "number" ? usage.input_tokens : 0,
      outputTokens:
        typeof usage?.output_tokens === "number" ? usage.output_tokens : 0,
    };
  }

  async generate(request: AiGenerationRequest): Promise<AiGenerationResponse> {
    const { configuration, apiKey } = this.resolved;
    const traceId = randomUUID();
    const startedAt = Date.now();
    const url = `${configuration.baseUrl}/responses`;
    const timeoutMs = effectiveOpenAiTimeoutMs(
      configuration.timeoutMs,
      configuration.maxOutputTokens,
      request.attempt,
    );
    const useBackgroundMode =
      configuration.maxOutputTokens > OPENAI_BACKGROUND_OUTPUT_THRESHOLD;

    let payload: Readonly<Record<string, unknown>>;

    if (useBackgroundMode && request.resumeProviderRequestId) {
      const responseId = request.resumeProviderRequestId.trim();
      if (!responseId || responseId.length > 200) {
        throw new AiProviderError(
          "OPENAI_INVALID_RESPONSE_ID",
          "El identificador persistido de OpenAI no es válido.",
          false,
        );
      }

      await request.onProviderRequestId?.(responseId);
      await writeAiProviderTrace(traceId, "request", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "OPENAI_BACKGROUND_RESUME",
        method: "GET",
        timeoutMs,
        configuredTimeoutMs: configuration.timeoutMs,
        effectiveMaxOutputTokens: configuration.maxOutputTokens,
        attempt: request.attempt ?? 1,
      });

      payload = await this.retrieveBackgroundResponse(
        responseId,
        url,
        apiKey,
        startedAt + timeoutMs,
        traceId,
        startedAt,
      );
    } else {
      const dlpDecision = inspectAiOutboundContent(
        request.userPrompt,
        resolveAiDlpPolicy(),
      );

      if (dlpDecision.action === "BLOCK") {
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OPENAI",
          model: configuration.model,
          phase: "DLP_OUTBOUND_BLOCK",
          findingCount: dlpDecision.findings.length,
          code: "OPENAI_DLP_BLOCKED",
        });
        throw new AiProviderError(
          "OPENAI_DLP_BLOCKED",
          "La solicitud contiene información sensible y fue bloqueada antes de salir del sistema.",
          false,
        );
      }

      const requestBody = {
        model: configuration.model,
        // Background conserva temporalmente la respuesta durante el periodo
        // de polling aun con store=false, sin ampliar su retención posterior.
        store: false,
        ...(useBackgroundMode ? { background: true } : {}),
        max_output_tokens: configuration.maxOutputTokens,
        input: [
          { role: "system", content: request.systemInstruction },
          { role: "user", content: dlpDecision.content },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "requirement_document_analysis",
            strict: true,
            schema: request.schema,
          },
        },
      };

      await writeAiProviderTrace(traceId, "request", {
        provider: "OPENAI",
        model: configuration.model,
        method: "POST",
        timeoutMs,
        configuredTimeoutMs: configuration.timeoutMs,
        effectiveMaxOutputTokens: configuration.maxOutputTokens,
        attempt: request.attempt ?? 1,
      });

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const snapshot = errorSnapshot(error);
        const errorName =
          typeof snapshot.name === "string" ? snapshot.name : "UnknownError";
        await writeAiProviderTrace(traceId, "transport-error", {
          provider: "OPENAI",
          model: configuration.model,
          durationMs: Date.now() - startedAt,
          errorName,
        });
        const timeout = errorName === "TimeoutError";
        throw new AiProviderError(
          timeout ? "OPENAI_TIMEOUT" : "OPENAI_UNAVAILABLE",
          timeout
            ? "OpenAI excedió el tiempo límite antes de devolver un identificador reanudable."
            : "No fue posible conectar con OpenAI.",
          true,
        );
      }

      const raw = await response.text();
      await writeAiProviderTrace(traceId, "response", {
        provider: "OPENAI",
        model: configuration.model,
        status: response.status,
        ok: response.ok,
        durationMs: Date.now() - startedAt,
        openAiRequestId:
          response.headers.get("x-request-id") ??
          response.headers.get("request-id") ??
          null,
        contentType: response.headers.get("content-type"),
      });

      try {
        payload = object(raw ? JSON.parse(raw) : null) ?? {};
      } catch (error) {
        const snapshot = errorSnapshot(error);
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OPENAI",
          model: configuration.model,
          phase: "OPENAI_RESPONSE_JSON",
          errorName:
            typeof snapshot.name === "string" ? snapshot.name : "UnknownError",
          errorMessage:
            typeof snapshot.message === "string"
              ? snapshot.message
              : "JSON inválido",
        });
        throw new AiProviderError(
          "OPENAI_INVALID_RESPONSE",
          "OpenAI devolvió JSON inválido.",
          true,
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

      const providerRequestId =
        typeof payload.id === "string" ? payload.id : null;
      if (providerRequestId) {
        await request.onProviderRequestId?.(providerRequestId);
      }

      if (useBackgroundMode && isPendingResponseStatus(payload.status)) {
        if (!providerRequestId) {
          throw new AiProviderError(
            "OPENAI_INVALID_RESPONSE",
            "OpenAI inició la ejecución en segundo plano sin devolver un identificador.",
            true,
          );
        }
        payload = await this.retrieveBackgroundResponse(
          providerRequestId,
          url,
          apiKey,
          startedAt + timeoutMs,
          traceId,
          startedAt,
        );
      }
    }

    const responseStatus =
      typeof payload.status === "string" ? payload.status : null;
    const incompleteDetails = object(payload.incomplete_details);
    const incompleteReason =
      typeof incompleteDetails?.reason === "string"
        ? incompleteDetails.reason
        : null;

    if (responseStatus === "incomplete") {
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "OPENAI_RESPONSE_INCOMPLETE",
        responseStatus,
        incompleteReason: incompleteReason ?? "unknown",
        effectiveMaxOutputTokens: configuration.maxOutputTokens,
      });
      const outputLimitReached = incompleteReason === "max_output_tokens";
      throw new AiProviderError(
        "OPENAI_INCOMPLETE_OUTPUT",
        outputLimitReached
          ? `OpenAI alcanzó el límite de salida configurado (${configuration.maxOutputTokens} tokens). Aumenta Max output tokens antes de reintentar.`
          : `OpenAI devolvió una respuesta incompleta${
              incompleteReason ? `: ${incompleteReason}` : "."
            }`,
        !outputLimitReached,
      );
    }

    if (responseStatus === "failed" || responseStatus === "cancelled") {
      const failure = providerFailure(payload);
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "OPENAI_RESPONSE_NOT_COMPLETED",
        responseStatus,
        code: failure.code ?? "OPENAI_RESPONSE_NOT_COMPLETED",
        errorMessage:
          failure.message ?? "OpenAI no informó el detalle del fallo.",
      });
      throw new AiProviderError(
        failure.code ?? "OPENAI_RESPONSE_NOT_COMPLETED",
        failure.message
          ? `OpenAI no pudo completar la generación: ${failure.message}`
          : `OpenAI finalizó la respuesta con estado ${responseStatus}.`,
        true,
      );
    }

    if (responseStatus && responseStatus !== "completed") {
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "OPENAI_RESPONSE_PENDING",
        responseStatus,
      });
      throw new AiProviderError(
        "OPENAI_RESPONSE_NOT_COMPLETED",
        `OpenAI devolvió el estado ${responseStatus} en lugar de completed.`,
        true,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(outputText(payload));
    } catch (error) {
      const snapshot = errorSnapshot(error);
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "STRUCTURED_OUTPUT_JSON",
        errorName:
          typeof snapshot.name === "string" ? snapshot.name : "UnknownError",
        errorMessage:
          typeof snapshot.message === "string"
            ? snapshot.message
            : "JSON inválido",
      });
      if (error instanceof AiProviderError) throw error;
      throw new AiProviderError(
        "OPENAI_INVALID_JSON",
        "La salida estructurada no contiene JSON válido.",
        true,
      );
    }

    let draft;
    let repairInputTokens = 0;
    let repairOutputTokens = 0;
    try {
      draft = parseAiAnalysisDraft(parsed);
    } catch (error) {
      const validationError = errorSnapshot(error);
      await writeAiProviderTrace(traceId, "validation-error", {
        provider: "OPENAI",
        model: configuration.model,
        phase: "AI_ANALYSIS_DRAFT",
        errorName:
          typeof validationError.name === "string"
            ? validationError.name
            : "UnknownError",
        errorMessage:
          typeof validationError.message === "string"
            ? validationError.message
            : "Error de validación",
      });
      const validationMessage =
        typeof validationError.message === "string"
          ? validationError.message
          : "error de validación";
      const kpiError =
        error instanceof KpiObjectiveReferenceError ? error : null;
      const ambiguousCount =
        kpiError?.failures.filter((item) => item.reason === "AMBIGUOUS")
          .length ?? 0;
      const noMatchCount = (kpiError?.failures.length ?? 0) - ambiguousCount;
      let repaired: Awaited<
        ReturnType<OpenAiResponsesProvider["repairKpiObjectives"]>
      > = null;
      if (kpiError?.repairable) {
        repaired = await this.repairKpiObjectives(
          parsed,
          traceId,
          timeoutMs,
          kpiError.noMatchIndexes,
        );
      } else if (kpiError) {
        // Varias referencias plausibles: NO se llama al proveedor, porque
        // cualquier valor que escogiera sería una elección arbitraria.
        await writeAiProviderTrace(traceId, "validation-error", {
          provider: "OPENAI",
          model: configuration.model,
          phase: "KPI_OBJECTIVE_REPAIR",
          outcome: "AMBIGUOUS_NOT_REPAIRED",
          ambiguousCount,
          noMatchCount,
        });
      }
      if (repaired) {
        draft = repaired.draft;
        repairInputTokens = repaired.inputTokens;
        repairOutputTokens = repaired.outputTokens;
      } else {
        throw new AiProviderError(
          "OPENAI_STRUCTURED_OUTPUT_INVALID",
          `OpenAI devolvió una salida estructurada inconsistente: ${validationMessage}${
            ambiguousCount > 0
              ? " Hay varias referencias igualmente plausibles; no se reintenta para no elegir un objetivo de forma arbitraria."
              : kpiError
                ? " El reintento localizado no obtuvo una referencia única y segura a un objetivo específico."
                : ""
          }`,
          true,
          kpiError
            ? {
                cause:
                  ambiguousCount > 0
                    ? "KPI_OBJECTIVE_AMBIGUOUS"
                    : "KPI_OBJECTIVE_UNREPAIRED",
                ambiguousCount,
                noMatchCount,
              }
            : undefined,
        );
      }
    }

    const usage = object(payload.usage);
    return {
      draft,
      providerRequestId:
        typeof payload.id === "string"
          ? payload.id
          : (request.resumeProviderRequestId ?? null),
      // El reintento localizado consume tokens reales: se suman para que el
      // costo y los límites de uso reflejen el gasto verdadero.
      inputTokens:
        typeof usage?.input_tokens === "number"
          ? usage.input_tokens + repairInputTokens
          : null,
      outputTokens:
        typeof usage?.output_tokens === "number"
          ? usage.output_tokens + repairOutputTokens
          : null,
    };
  }
}
