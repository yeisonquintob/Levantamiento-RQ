import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type AiProviderTraceStage =
  | "request"
  | "response"
  | "runtime-metrics"
  | "transport-error"
  | "validation-error"
  | "application-error"
  | "cache-hit"
  | "consolidated";

const SAFE_TEXT_FIELDS = new Set([
  "provider",
  "model",
  "phase",
  "method",
  "contentType",
  "openAiRequestId",
  "code",
  "name",
  "errorName",
  "responseStatus",
  "incompleteReason",
]);

const SAFE_NUMBER_FIELDS = new Set([
  "status",
  "durationMs",
  "timeoutMs",
  "configuredTimeoutMs",
  "attempt",
  "declaredLength",
  "maximumBytes",
  "actualBytes",
  "inputTokens",
  "outputTokens",
  "sourceCount",
  "findingCount",
  "effectiveMaxOutputTokens",
  "contradictionCount",
  "originalCharacters",
  "consolidatedCharacters",
  "originalTokens",
  "localAnalysisTokens",
  "snapshotTokens",
  "targetSnapshotTokens",
  "reductionPercentage",
  "findingsBefore",
  "findingsAfterExactDedup",
  "findingsAfterSemanticDedup",
  "criticalFindingsPreserved",
  "sourceCoverage",
  // PASO_13_TELEMETRIA_RENDIMIENTO_OLLAMA_V1
  "totalDurationMs",
  "loadDurationMs",
  "promptEvalDurationMs",
  "evalDurationMs",
  "promptTokensPerSecond",
  "outputTokensPerSecond",
  "effectiveContextTokens",
  "effectiveOutputTokens",
]);

const SAFE_BOOLEAN_FIELDS = new Set([
  "ok",
  "retryable",
  "cacheHit",
  "structuredFallbackUsed",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeDiagnosticMessage(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim().slice(0, 512);

  if (!normalized) {
    return "Error de validación sin detalle.";
  }

  const sensitivePatterns = [
    /\bsk-[A-Za-z0-9_-]{10,}\b/u,
    /\bBearer\s+\S+/iu,
    /\b(?:password|contraseña|api[_ -]?key|authorization|secret|token)\s*[:=]\s*\S+/iu,
    /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----/iu,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
  ];

  if (sensitivePatterns.some((pattern) => pattern.test(normalized))) {
    return "[DETALLE OCULTO POR SEGURIDAD]";
  }

  return normalized;
}

/**
 * Las trazas son diagnósticos operativos, no una copia de los payloads.
 * La lista permitida evita que nuevos call sites filtren prompts, fuentes,
 * documentos, imágenes, respuestas, credenciales o mensajes con secretos.
 */
export function sanitizeAiProviderTrace(
  data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (key === "errorMessage" && typeof value === "string") {
      safe[key] = sanitizeDiagnosticMessage(value);
      continue;
    }

    if (SAFE_TEXT_FIELDS.has(key) && typeof value === "string") {
      safe[key] = value.slice(0, 256);
      continue;
    }

    if (
      SAFE_NUMBER_FIELDS.has(key) &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      safe[key] = value;
      continue;
    }

    if (SAFE_BOOLEAN_FIELDS.has(key) && typeof value === "boolean") {
      safe[key] = value;
    }
  }

  const sensitivePayload = JSON.stringify(data);
  safe.metadataHash = sha256(sensitivePayload);
  safe.metadataBytes = Buffer.byteLength(sensitivePayload, "utf8");

  return safe;
}

function workspaceRoot(): string {
  let current = resolve(process.cwd());

  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) break;

    current = parent;
  }

  return resolve(process.cwd());
}

function markerPath(): string {
  return resolve(workspaceRoot(), "tmp", "ai-provider-trace.enabled");
}

export function aiProviderTraceEnabled(): boolean {
  if (process.env.NODE_ENV === "production") {
    return false;
  }

  return existsSync(markerPath());
}

export async function writeAiProviderTrace(
  traceId: string,
  stage: AiProviderTraceStage,
  data: Readonly<Record<string, unknown>>,
): Promise<void> {
  if (!aiProviderTraceEnabled()) {
    return;
  }

  try {
    const sanitized = sanitizeAiProviderTrace(data);
    const root = workspaceRoot();
    const directory = resolve(root, "logs", "ai-provider-trace");

    await mkdir(directory, { recursive: true });

    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replaceAll(".", "-");

    const provider =
      typeof sanitized.provider === "string"
        ? sanitized.provider.replaceAll(/[^A-Z0-9_-]/giu, "-").toUpperCase()
        : "AI";
    const filename = resolve(
      directory,
      `${timestamp}_${traceId}_${provider}_${stage}.json`,
    );

    await writeFile(
      filename,
      JSON.stringify(
        {
          traceId,
          stage,
          timestamp: new Date().toISOString(),
          ...sanitized,
        },
        null,
        2,
      ),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(
      `[AiProviderTrace] No fue posible escribir el trace: ${message}`,
    );
  }
}
