import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildLocalAiOutputSchema,
  buildLocalExtractCompactOutputSchema,
  LOCAL_AI_CATEGORIES,
  LOCAL_AI_SCHEMA_VERSION,
  parseLocalExtractAnalysis,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import {
  buildLocalOnlySourcePrompt,
  OllamaSourceAnalyzerService,
} from "../../apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.js";
import type { OllamaClient } from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";

const sourceId = "11111111-1111-4111-8111-111111111111";

const source = {
  sourceId,
  title: "Proceso SOAT",
  classification: "REQUIREMENT",
  text: [
    "El sistema debe validar campos obligatorios antes del envío.",
    "D365 contiene los datos del vehículo.",
    "Pregunta pendiente: ¿quién aprueba excepciones?",
  ].join("\n"),
};

test("Paso 14: schema LOCAL_EXTRACT es compacto y no repite sourceIds ni 16 arrays", () => {
  const compact = buildLocalExtractCompactOutputSchema();
  const legacy = buildLocalAiOutputSchema();

  const compactJson = JSON.stringify(compact);
  const legacyJson = JSON.stringify(legacy);

  assert.ok(
    compactJson.length < legacyJson.length * 0.5,
    `compact=${compactJson.length}; legacy=${legacyJson.length}`,
  );

  assert.match(compactJson, /"findings"/u);
  assert.match(compactJson, /"category"/u);
  assert.match(compactJson, /"description"/u);
  assert.doesNotMatch(compactJson, /"sourceIds"/u);
  assert.doesNotMatch(compactJson, /"schemaVersion"/u);

  for (const category of LOCAL_AI_CATEGORIES) {
    assert.match(compactJson, new RegExp(`"${category}"`, "u"));
  }
});

test("Paso 14: reconstruye determinísticamente el contrato LocalSourceAnalysis", () => {
  const parsed = parseLocalExtractAnalysis(
    {
      summary: "Solicitud de SOAT con validación.",
      findings: [
        {
          category: "functionalRequirements",
          description: "Validar campos obligatorios antes del envío.",
        },
        {
          category: "integrations",
          description: "Consultar datos del vehículo en D365.",
        },
        {
          category: "pendingQuestions",
          description: "¿Quién aprueba excepciones?",
        },
      ],
    },
    sourceId,
  );

  assert.equal(parsed.schemaVersion, LOCAL_AI_SCHEMA_VERSION);
  assert.equal(parsed.sourceId, sourceId);
  assert.equal(parsed.summary, "Solicitud de SOAT con validación.");
  assert.deepEqual(parsed.functionalRequirements, [
    {
      description: "Validar campos obligatorios antes del envío.",
      sourceIds: [sourceId],
    },
  ]);
  assert.deepEqual(parsed.integrations, [
    {
      description: "Consultar datos del vehículo en D365.",
      sourceIds: [sourceId],
    },
  ]);
  assert.deepEqual(parsed.pendingQuestions, [
    {
      description: "¿Quién aprueba excepciones?",
      sourceIds: [sourceId],
    },
  ]);

  for (const category of LOCAL_AI_CATEGORIES) {
    assert.ok(Array.isArray(parsed[category]), category);
  }
});

test("Paso 14: falla cerrado con categoría desconocida o descripción vacía", () => {
  assert.throws(
    () =>
      parseLocalExtractAnalysis(
        {
          summary: "x",
          findings: [{ category: "inventedCategory", description: "x" }],
        },
        sourceId,
      ),
    /category/u,
  );

  assert.throws(
    () =>
      parseLocalExtractAnalysis(
        {
          summary: "x",
          findings: [{ category: "facts", description: "   " }],
        },
        sourceId,
      ),
    /description/u,
  );
});

test("Paso 14: LOCAL_EXTRACT entrega schema compacto al cliente y conserva contrato final", async () => {
  let capturedSchema: Readonly<Record<string, unknown>> | undefined;
  let capturedOptions: Record<string, unknown> | undefined;

  const client = {
    generate: async (
      _prompt: string,
      schema: Readonly<Record<string, unknown>>,
      _images?: readonly string[],
      _traceContext?: unknown,
      _signal?: AbortSignal,
      options?: Record<string, unknown>,
    ) => {
      capturedSchema = schema;
      capturedOptions = options;
      return JSON.stringify({
        summary: "Resumen.",
        findings: [
          {
            category: "facts",
            description: "D365 contiene los datos del vehículo.",
          },
        ],
      });
    },
  } as unknown as OllamaClient;

  const result = await new OllamaSourceAnalyzerService(client).analyze(
    source,
    undefined,
    "",
    "LOCAL_EXTRACT",
  );

  assert.deepEqual(capturedSchema, buildLocalExtractCompactOutputSchema());
  assert.deepEqual(capturedOptions, { profile: "LOCAL_EXTRACT" });
  assert.deepEqual(result.facts, [
    {
      description: "D365 contiene los datos del vehículo.",
      sourceIds: [sourceId],
    },
  ]);
});

test("Paso 14: DEFAULT conserva literalmente el schema legacy", async () => {
  let capturedSchema: Readonly<Record<string, unknown>> | undefined;

  const empty = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [category, []]),
  );

  const client = {
    generate: async (
      _prompt: string,
      schema: Readonly<Record<string, unknown>>,
    ) => {
      capturedSchema = schema;
      return JSON.stringify({
        schemaVersion: LOCAL_AI_SCHEMA_VERSION,
        sourceId,
        summary: "Resumen legacy.",
        ...empty,
      });
    },
  } as unknown as OllamaClient;

  await new OllamaSourceAnalyzerService(client).analyze(
    source,
    undefined,
    "",
    "DEFAULT",
  );

  assert.deepEqual(capturedSchema, buildLocalAiOutputSchema());
});

test("Paso 14: prompt compacto ya no solicita 16 arrays ni sourceIds al modelo", () => {
  const prompt = buildLocalOnlySourcePrompt(source);

  assert.match(prompt, /SALIDA_COMPACTA_LOCAL_EXTRACT_V1/u);
  assert.match(prompt, /\{category, description\}/u);
  assert.match(prompt, /No devuelvas sourceIds/u);
  assert.match(prompt, /No devuelvas schemaVersion, sourceId, sourceIds/u);
  assert.match(prompt, /compact-output-v1/u);
});

test("Paso 14: cache version cambia solo en LOCAL_EXTRACT y fronteras siguen intactas", async () => {
  const [pipeline, analyzer, client, discussion] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/local-ai/ollama-source-analyzer.service.ts",
      "utf8",
    ),
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
      "utf8",
    ),
  ]);

  assert.match(
    pipeline,
    /LOCAL_EXTRACT"[\s\S]*?compact-prompt-v1\+compact-output-v1/u,
  );
  assert.match(analyzer, /LOCAL_SOURCE_CHUNK_CHARACTERS = 8_000/u);
  assert.match(analyzer, /LOCAL_ADAPTIVE_SPLIT_MIN_CHARACTERS = 2_000/u);
  assert.match(analyzer, /LOCAL_ADAPTIVE_SPLIT_MAX_DEPTH = 3/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(client, /PASO_13_TELEMETRIA_RENDIMIENTO_OLLAMA_V1/u);
  assert.match(
    client,
    /profile === "LOCAL_EXTRACT"[\s\S]*?structuredThinking: "DISABLED"/u,
  );
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});
