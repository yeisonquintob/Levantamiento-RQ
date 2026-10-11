/*
 * PASO_12_CERTIFICACION_RUNTIME_REAL_LOCAL_ONLY_V1
 *
 * Dos inferencias reales contra Ollama:
 * 1) LOCAL_EXTRACT mediante OllamaSourceAnalyzerService.
 * 2) LOCAL_DOCUMENT mediante OllamaClient con JSON Schema.
 *
 * No escribe producción, BD ni configuración persistida.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import { loadLocalAiConfig } from "../apps/ai-analysis-service/src/local-ai/ollama.config.js";
import {
  effectiveOllamaLimits,
  OllamaClient,
  resolveLocalAiExecutionProfile,
} from "../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { OllamaSourceAnalyzerService } from "../apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.js";

const SOURCE_ID = "12000000-0000-4000-8000-000000000001";
const REPORT_PATH = "output/gates/local-only-step12-runtime-smoke.json";

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function sourceReferences(value: unknown, output: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) sourceReferences(item, output);
    return output;
  }
  if (!value || typeof value !== "object") return output;

  for (const [key, child] of Object.entries(
    value as Readonly<Record<string, unknown>>,
  )) {
    if (key === "sourceIds" && Array.isArray(child)) {
      for (const sourceId of child) {
        if (typeof sourceId === "string") output.push(sourceId);
      }
      continue;
    }
    sourceReferences(child, output);
  }
  return output;
}

async function main(): Promise<void> {
  const config = loadLocalAiConfig({
    ...process.env,
    LOCAL_AI_ENABLED: "true",
    OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    OLLAMA_MODEL: process.env.OLLAMA_MODEL ?? "qwen3.5:9b",
    LOCAL_AI_MAX_CONCURRENT_JOBS: "1",
    LOCAL_AI_TIMEOUT_MS: process.env.LOCAL_AI_TIMEOUT_MS ?? "600000",
    LOCAL_AI_CONTEXT_TOKENS: process.env.LOCAL_AI_CONTEXT_TOKENS ?? "300000",
    LOCAL_AI_MAX_OUTPUT_TOKENS:
      process.env.LOCAL_AI_MAX_OUTPUT_TOKENS ?? "8192",
    LOCAL_AI_FALLBACK_TO_RAW_SOURCES: "false",
    LOCAL_AI_MAX_RESPONSE_BYTES: "2097152",
  });

  if (config.baseUrl !== "http://127.0.0.1:11434") {
    throw new Error(
      `Paso 12 esperaba loopback http://127.0.0.1:11434 y recibió ${config.baseUrl}.`,
    );
  }
  if (config.model !== "qwen3.5:9b") {
    throw new Error(`Paso 12 esperaba qwen3.5:9b y recibió ${config.model}.`);
  }

  const client = new OllamaClient(config);

  const healthStarted = performance.now();
  await client.health();
  const healthDurationMs = Number(
    (performance.now() - healthStarted).toFixed(2),
  );

  const sourceText = [
    "El coordinador de taller registra préstamos temporales de herramientas.",
    "El sistema debe conservar quién entrega, quién recibe y la fecha prevista de devolución.",
    "El préstamo debe quedar asociado al responsable que recibe la herramienta.",
    "Actualmente el control manual dificulta identificar devoluciones tardías.",
    "Pregunta pendiente: ¿qué rol aprueba préstamos superiores a treinta días?",
  ].join("\n");

  const extractStarted = performance.now();

  // El servicio productivo aplica LOCAL_EXTRACT internamente.
  const extracted = await new OllamaSourceAnalyzerService(client).analyze({
    sourceId: SOURCE_ID,
    title: "Préstamo temporal de herramientas",
    classification: "REQUIREMENT",
    text: sourceText,
  });

  const extractDurationMs = Number(
    (performance.now() - extractStarted).toFixed(2),
  );

  if (extracted.sourceId !== SOURCE_ID) {
    throw new Error("LOCAL_EXTRACT real perdió el sourceId principal.");
  }

  const extractReferences = sourceReferences(extracted);
  const unknownExtractSourceIds = [
    ...new Set(extractReferences.filter((sourceId) => sourceId !== SOURCE_ID)),
  ];

  if (unknownExtractSourceIds.length > 0) {
    throw new Error(
      `LOCAL_EXTRACT devolvió sourceIds ajenos: ${unknownExtractSourceIds.join(", ")}`,
    );
  }

  const extractedArrays = Object.values(
    extracted as unknown as Readonly<Record<string, unknown>>,
  ).filter(Array.isArray);
  const extractedFindingCount = extractedArrays.reduce(
    (total, items) => total + items.length,
    0,
  );

  if (extractedFindingCount < 1) {
    throw new Error(
      "LOCAL_EXTRACT real no produjo ningún finding para una fuente explícita.",
    );
  }

  const documentSchema = {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      value: {
        type: "object",
        additionalProperties: false,
        required: ["title", "requirement", "acceptanceCriteria", "sourceIds"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 120 },
          requirement: { type: "string", minLength: 1, maxLength: 500 },
          acceptanceCriteria: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: { type: "string", minLength: 1, maxLength: 300 },
          },
          sourceIds: {
            type: "array",
            minItems: 1,
            maxItems: 1,
            items: {
              type: "string",
              enum: [SOURCE_ID],
            },
          },
        },
      },
    },
  } as const;

  const documentPrompt = [
    "TAREA_DOCUMENTAL_LOCAL_ONLY_RUNTIME",
    "Usa exclusivamente la evidencia suministrada.",
    "No inventes personas, roles, fechas, porcentajes ni reglas.",
    "Devuelve únicamente JSON válido conforme al schema.",
    `sourceId=${SOURCE_ID}`,
    "EVIDENCIA:",
    sourceText,
    "OBJETIVO:",
    "Redacta un requisito funcional breve y criterios de aceptación directamente respaldados por la evidencia.",
  ].join("\n");

  const effectiveLimits = effectiveOllamaLimits(
    `${documentPrompt}\n${JSON.stringify(documentSchema)}`,
    config.contextTokens,
    config.maxOutputTokens,
  );

  if (effectiveLimits.contextTokens > 65_536) {
    throw new Error(
      `Contexto real excede 65536: ${effectiveLimits.contextTokens}.`,
    );
  }
  if (effectiveLimits.outputTokens > 8_192) {
    throw new Error(
      `Salida real excede 8192: ${effectiveLimits.outputTokens}.`,
    );
  }

  let documentTraceId: string | null = null;
  const documentStarted = performance.now();

  const documentRaw = await client.generate(
    documentPrompt,
    documentSchema,
    [],
    {
      sourceId: SOURCE_ID,
      sourceTitle: "Préstamo temporal de herramientas",
      sourceClassification: "REQUIREMENT",
      onTraceId: (traceId) => {
        documentTraceId = traceId;
      },
    },
    undefined,
    { profile: "LOCAL_DOCUMENT" },
  );

  const documentDurationMs = Number(
    (performance.now() - documentStarted).toFixed(2),
  );

  let document: unknown;
  try {
    document = JSON.parse(documentRaw);
  } catch {
    throw new Error("LOCAL_DOCUMENT real no devolvió JSON parseable.");
  }

  const envelope =
    document && typeof document === "object" && !Array.isArray(document)
      ? (document as Record<string, unknown>)
      : null;
  const value =
    envelope?.value &&
    typeof envelope.value === "object" &&
    !Array.isArray(envelope.value)
      ? (envelope.value as Record<string, unknown>)
      : null;

  if (!value) {
    throw new Error("LOCAL_DOCUMENT real no devolvió el objeto value.");
  }

  if (
    typeof value.title !== "string" ||
    !value.title.trim() ||
    typeof value.requirement !== "string" ||
    !value.requirement.trim()
  ) {
    throw new Error(
      "LOCAL_DOCUMENT real devolvió title/requirement vacíos o inválidos.",
    );
  }

  if (
    !Array.isArray(value.acceptanceCriteria) ||
    value.acceptanceCriteria.length < 1 ||
    value.acceptanceCriteria.some(
      (item) => typeof item !== "string" || !item.trim(),
    )
  ) {
    throw new Error(
      "LOCAL_DOCUMENT real no devolvió criterios de aceptación válidos.",
    );
  }

  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length !== 1 ||
    value.sourceIds[0] !== SOURCE_ID
  ) {
    throw new Error(
      "LOCAL_DOCUMENT real no conservó la trazabilidad exacta del sourceId.",
    );
  }

  const extractProfile = resolveLocalAiExecutionProfile("LOCAL_EXTRACT");
  const documentProfile = resolveLocalAiExecutionProfile("LOCAL_DOCUMENT");

  const report = {
    schemaVersion: "LOCAL_ONLY_STEP12_RUNTIME_REAL_V1",
    generatedAt: new Date().toISOString(),
    status: "PASS",
    mode: "REAL_OLLAMA_LOOPBACK",
    provider: "OLLAMA",
    baseUrl: config.baseUrl,
    model: config.model,
    health: {
      pass: true,
      durationMs: healthDurationMs,
    },
    profiles: {
      LOCAL_EXTRACT: extractProfile,
      LOCAL_DOCUMENT: documentProfile,
    },
    extract: {
      pass: true,
      durationMs: extractDurationMs,
      sourceIdPreserved: extracted.sourceId === SOURCE_ID,
      sourceReferenceCount: extractReferences.length,
      unknownSourceIds: unknownExtractSourceIds,
      findingCount: extractedFindingCount,
      resultSha256: sha256(extracted),
    },
    document: {
      pass: true,
      durationMs: documentDurationMs,
      traceId: documentTraceId,
      titlePresent: true,
      requirementPresent: true,
      acceptanceCriteriaCount: value.acceptanceCriteria.length,
      sourceIds: value.sourceIds,
      resultSha256: sha256(document),
    },
    limits: {
      configuredContextTokens: config.contextTokens,
      configuredOutputTokens: config.maxOutputTokens,
      effectiveContextTokens: effectiveLimits.contextTokens,
      effectiveOutputTokens: effectiveLimits.outputTokens,
      estimatedPromptTokens: effectiveLimits.estimatedPromptTokens,
      contextCap: 65_536,
      outputCap: 8_192,
    },
    safety: {
      externalNetworkUsed: false,
      databaseUsed: false,
      servicesStartedOrRestarted: false,
      rawDocumentResponsePersisted: false,
    },
  };

  await mkdir("output/gates", { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("===== PASO 12 · RUNTIME REAL OLLAMA =====");
  console.log(`Estado: ${report.status}`);
  console.log(`Modelo: ${report.model}`);
  console.log(`Health: ${healthDurationMs} ms`);
  console.log(
    `LOCAL_EXTRACT: ${extractDurationMs} ms · findings=${extractedFindingCount} · unknownSourceIds=${unknownExtractSourceIds.length}`,
  );
  console.log(
    `LOCAL_DOCUMENT: ${documentDurationMs} ms · criterios=${value.acceptanceCriteria.length}`,
  );
  console.log(
    `Límites efectivos: context=${effectiveLimits.contextTokens}/65536 · output=${effectiveLimits.outputTokens}/8192`,
  );
  console.log(`Reporte runtime: ${REPORT_PATH}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
