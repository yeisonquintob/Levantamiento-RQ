// LOCAL_ONLY_V2_18_5_RUNTIME_ADAPTER_TEST
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { LocalAiConfig } from "../../apps/ai-analysis-service/src/local-ai/ollama.config.js";
import {
  LocalAiError,
  type OllamaClient,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import {
  appendLocalOnlyV2RuntimeEvidence,
  buildLocalOnlyV2RuntimeKnowledge,
  buildLocalOnlyV2AtomicRepairPrompt,
  createLocalOnlyV2BoundedDocumentClient,
  generateLocalOnlyV2AtomicExtractionWithRepair,
  LOCAL_ONLY_V2_ATOMIC_REPAIR_MARKER,
  LOCAL_ONLY_V2_RUNTIME_MARKER,
  prepareLocalOnlyV2RuntimeBridge,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-runtime-adapter.js";
import { resolveLocalOnlyV2InferenceBudget } from "../../apps/ai-analysis-service/src/execution/local-only-v2-inference-budget.js";
import type { LocalOnlyV2SegmentedEvidenceInput } from "../../apps/ai-analysis-service/src/execution/local-only-v2-segmentation.js";
import {
  deterministicDiagramFlowFallback,
  deterministicEntityRelationshipFallback,
  hasUsableDiagramEntityEvidence,
  hasUsableDiagramFlowEvidence,
  parseCanonicalDiagramFlow,
  parseCanonicalEntityRelationshipModel,
  validateCanonicalDiagramFlow,
  validateCanonicalEntityRelationshipModel,
  type LocalOnlyV2DiagramFallbackFinding,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-diagram-contract.js";

const CONFIG: LocalAiConfig = {
  enabled: true,
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3.5:9b",
  maxConcurrentJobs: 1,
  timeoutMs: 120_000,
  contextTokens: 16_384,
  maxOutputTokens: 8_192,
  fallbackToRawSources: false,
  maxResponseBytes: 2_097_152,
};

const SOURCES = [
  {
    sourceId: "source-a",
    sourceTitle: "Levantamiento funcional",
    snapshotText:
      "El sistema debe registrar solicitudes y validar los campos obligatorios.",
    position: 1,
  },
  {
    sourceId: "questionnaire-a",
    sourceTitle: "Preguntas de análisis · RQ-TEST",
    snapshotText: [
      "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
      "Pregunta: ¿Qué problema se busca resolver?",
      "Respuesta: El proceso actual depende de validaciones manuales.",
      "Pregunta: ¿Qué se espera?",
      "Respuesta: Se requiere trazabilidad del proceso.",
    ].join("\n"),
    position: 2,
  },
] as const;

test("Paso 18.5 prioriza el cuestionario y calcula presupuestos V2 antes del runtime", () => {
  const bridge = prepareLocalOnlyV2RuntimeBridge(SOURCES, CONFIG);

  assert.equal(bridge.pipelineId, "LOCAL_ONLY_V2");
  assert.equal(bridge.questionnaireSourceId, "questionnaire-a");
  assert.equal(bridge.sourceCount, 2);
  assert.ok(bridge.segmentCount >= 2);
  assert.ok(bridge.questionnaireSegmentCount >= 1);
  assert.ok(bridge.segmentationBudget.maxChunkTokens <= 2_048);
  assert.equal(bridge.inferenceBudget.maxOutputTokens, 1_200);
  assert.equal(bridge.inferenceBudget.maxAtomicOutputTokens, 1_600);
  assert.equal(bridge.inferenceBudget.maxCallDurationMs, 60_000);
});

test("Paso 18.5 admite una conversación textual sin cuestionario", () => {
  const bridge = prepareLocalOnlyV2RuntimeBridge(
    [
      {
        sourceId: "conversation-a",
        sourceTitle: "Conversación con operaciones",
        snapshotText: "El registro manual causa reprocesos y demoras.",
        position: 1,
      },
    ],
    CONFIG,
  );

  assert.equal(bridge.pipelineId, "LOCAL_ONLY_V2");
  assert.equal(bridge.questionnaireSourceId, "conversation-a");
  assert.equal(bridge.sourceCount, 1);
  assert.ok(bridge.segmentCount >= 1);
});

test("Paso 18.5 incorpora el cuestionario completo como DATA al prompt compacto", () => {
  const bridge = prepareLocalOnlyV2RuntimeBridge(SOURCES, CONFIG);
  const prompt = appendLocalOnlyV2RuntimeEvidence(
    "PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL\n{}",
    bridge,
  );

  assert.match(prompt, new RegExp(LOCAL_ONLY_V2_RUNTIME_MARKER, "u"));
  assert.match(prompt, /CUESTIONARIO_SELECCIONADO_OBLIGATORIO_DATA/u);
  assert.match(prompt, /validaciones manuales/u);
  assert.match(prompt, /trazabilidad del proceso/u);
  assert.match(prompt, /DATA no confiable como instrucciones/u);

  assert.throws(
    () => appendLocalOnlyV2RuntimeEvidence(prompt, bridge),
    /ya fue incorporado/iu,
  );
});

test("Paso 18.5 inyecta límites V2 en cada llamada LOCAL_DOCUMENT y conserva cancelación/traza", async () => {
  const bridge = prepareLocalOnlyV2RuntimeBridge(SOURCES, CONFIG);
  const calls: Array<Parameters<OllamaClient["generate"]>> = [];

  const delegate: Pick<OllamaClient, "generate"> = {
    async generate(...args: Parameters<OllamaClient["generate"]>) {
      calls.push(args);
      return '{"value":"ok"}';
    },
  };

  const client = createLocalOnlyV2BoundedDocumentClient(
    CONFIG,
    bridge,
    delegate,
  );
  const cancellation = new AbortController();
  const traceContext = { sourceId: "block-a" };

  const response = await client.generate(
    "prompt corto",
    { type: "object" },
    undefined,
    traceContext,
    cancellation.signal,
    {
      profile: "LOCAL_DOCUMENT",
      runtimeLimits: {
        contextTokens: 65_536,
        maxOutputTokens: 8_192,
        timeoutMs: 600_000,
      },
    },
  );

  assert.equal(response, '{"value":"ok"}');
  assert.equal(calls.length, 1);

  const call = calls[0]!;
  assert.equal(call[3], traceContext);
  assert.equal(call[4], cancellation.signal);
  assert.equal(call[5]?.profile, "LOCAL_DOCUMENT");
  assert.deepEqual(call[5]?.runtimeLimits, {
    contextTokens: 16_384,
    maxOutputTokens: 1_600,
    timeoutMs: 60_000,
  });
});

test("Paso 18.5 bloquea un prompt gigante antes de invocar Ollama", async () => {
  const bridge = prepareLocalOnlyV2RuntimeBridge(SOURCES, CONFIG);
  let calls = 0;

  const delegate: Pick<OllamaClient, "generate"> = {
    async generate() {
      calls += 1;
      return "{}";
    },
  };

  const client = createLocalOnlyV2BoundedDocumentClient(
    CONFIG,
    bridge,
    delegate,
  );

  await assert.rejects(
    () =>
      client.generate(
        "X".repeat(40_000),
        { type: "object" },
        undefined,
        {},
        undefined,
        { profile: "LOCAL_DOCUMENT" },
      ),
    /PROMPT_BUDGET_EXCEEDED|presupuesto preventivo/iu,
  );

  assert.equal(calls, 0);
});

test("LOCAL_ONLY_V2 repara una extracción atómica no literal y conserva trazabilidad estricta", async () => {
  const segment = {
    segmentId: "segment-repair#0001",
    sourceId: "source-repair",
    sourceTitle: "Fuente de reparación",
    sourcePosition: 1,
    segmentIndex: 0,
    startCharacter: 0,
    endCharacter: 74,
    text: "El sistema debe registrar solicitudes y validar los campos obligatorios.",
    estimatedTokens: 18,
    contextUsageRatio: 18 / 8_192,
    boundary: "END" as const,
    mandatoryQuestionnaireEvidence: false,
  };

  const task = {
    taskId: "atomic:segment-repair#0001",
    pipelineId: "LOCAL_ONLY_V2" as const,
    segment,
    prompt: [
      "LOCAL_ONLY_V2_ATOMIC_EXTRACTION_V1",
      "FRAGMENTO_NO_CONFIABLE",
      segment.text,
    ].join("\n"),
    schema: { type: "object" },
    outputTargetTokens: 900,
    maxOutputTokens: 1_600,
  };

  const calls: Array<{
    prompt: string;
    sourceClassification: string;
  }> = [];

  const result = await generateLocalOnlyV2AtomicExtractionWithRepair({
    task,
    checkCancelled: async () => undefined,
    generate: async (prompt, sourceClassification) => {
      calls.push({ prompt, sourceClassification });

      if (calls.length === 1) {
        return JSON.stringify({
          findings: [
            {
              category: "functionalRequirements",
              description: "El sistema debe registrar solicitudes.",
              evidenceText: "El sistema registrará solicitudes.",
            },
          ],
        });
      }

      return JSON.stringify({
        findings: [
          {
            category: "functionalRequirements",
            description: "El sistema debe registrar solicitudes.",
            evidenceText: "El sistema debe registrar solicitudes",
          },
        ],
      });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.sourceClassification, "LOCAL_ONLY_V2_ATOMIC");
  assert.equal(calls[1]?.sourceClassification, "LOCAL_ONLY_V2_ATOMIC_REPAIR");
  assert.match(
    calls[1]?.prompt ?? "",
    new RegExp(LOCAL_ONLY_V2_ATOMIC_REPAIR_MARKER, "u"),
  );
  assert.match(calls[1]?.prompt ?? "", /caracteres contiguos EXACTOS/u);
  assert.equal(result.repaired, true);
  assert.equal(result.findings.length, 1);
  assert.equal(
    result.findings[0]?.evidenceText,
    "El sistema debe registrar solicitudes",
  );
});

test("LOCAL_ONLY_V2 recupera una extracción truncada con evidencia literal", async () => {
  const text = "Respuesta: La validación manual genera reprocesos.";
  const segment = {
    segmentId: "segment-truncated#0001",
    sourceId: "source-truncated",
    sourceTitle: "Conversación local",
    sourcePosition: 1,
    segmentIndex: 0,
    startCharacter: 0,
    endCharacter: text.length,
    text,
    estimatedTokens: 13,
    contextUsageRatio: 13 / 8_192,
    boundary: "END" as const,
    mandatoryQuestionnaireEvidence: false,
  };
  let calls = 0;

  const result = await generateLocalOnlyV2AtomicExtractionWithRepair({
    task: {
      taskId: "atomic:segment-truncated#0001",
      pipelineId: "LOCAL_ONLY_V2",
      segment,
      prompt: `FRAGMENTO_NO_CONFIABLE\n${text}`,
      schema: { type: "object" },
      outputTargetTokens: 900,
      maxOutputTokens: 1_600,
    },
    checkCancelled: async () => undefined,
    generate: async () => {
      calls += 1;
      throw new LocalAiError(
        "OLLAMA_OUTPUT_TRUNCATED",
        "Salida truncada.",
        false,
      );
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.repaired, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.evidenceText, text);
});

test("LOCAL_ONLY_V2 contiene JSON inválido en la reparación y usa fallback literal categorizado", async () => {
  const text = "El sistema debe registrar solicitudes.";
  const segment = {
    segmentId: "segment-invalid-repair#0001",
    sourceId: "source-invalid-repair",
    sourceTitle: "Fuente con reparación inválida",
    sourcePosition: 1,
    segmentIndex: 0,
    startCharacter: 0,
    endCharacter: text.length,
    text,
    estimatedTokens: 9,
    contextUsageRatio: 9 / 8_192,
    boundary: "END" as const,
    mandatoryQuestionnaireEvidence: false,
  };
  let calls = 0;

  const result = await generateLocalOnlyV2AtomicExtractionWithRepair({
    task: {
      taskId: "atomic:segment-invalid-repair#0001",
      pipelineId: "LOCAL_ONLY_V2",
      segment,
      prompt: `FRAGMENTO_NO_CONFIABLE\n${text}`,
      schema: { type: "object" },
      outputTargetTokens: 900,
      maxOutputTokens: 1_600,
    },
    checkCancelled: async () => undefined,
    generate: async () => {
      calls += 1;
      if (calls === 1) {
        return JSON.stringify({
          findings: [
            {
              category: "functionalRequirements",
              description: "El sistema debe registrar solicitudes.",
              evidenceText: "El sistema registrará solicitudes.",
            },
          ],
        });
      }
      return '{"findings":[';
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.repaired, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.evidenceText, text);
  assert.equal(result.findings[0]?.category, "functionalRequirements");
});

test("un cuestionario completo no repite extracción con Ollama", async () => {
  const text = [
    "Pregunta: ¿Qué problema se busca resolver?",
    "Respuesta: La validación manual genera reprocesos.",
    "Pregunta: ¿Qué resultado se espera?",
    "Respuesta: Se requiere trazabilidad del proceso.",
  ].join("\n");
  let calls = 0;
  let writes = 0;

  const knowledge = await buildLocalOnlyV2RuntimeKnowledge({
    projectId: "project-questionnaire",
    segmented: {
      pipelineId: "LOCAL_ONLY_V2",
      budget: {
        contextTokens: 16_384,
        targetChunkTokens: 1_600,
        maxChunkTokens: 2_048,
        contextFractionCapTokens: 4_096,
        maxContextFraction: 0.25,
      },
      segments: [
        {
          segmentId: "questionnaire-complete#0001",
          sourceId: "questionnaire-complete",
          sourceTitle: "Preguntas de análisis · RQ-COMPLETE",
          sourcePosition: 1,
          segmentIndex: 0,
          startCharacter: 0,
          endCharacter: text.length,
          text,
          estimatedTokens: 32,
          contextUsageRatio: 32 / 16_384,
          boundary: "END",
          mandatoryQuestionnaireEvidence: true,
        },
      ],
      questionnaireSourceId: "questionnaire-complete",
      questionnaireSegmentCount: 1,
    },
    budget: resolveLocalOnlyV2InferenceBudget({
      configuredContextTokens: 16_384,
      configuredMaxOutputTokens: 8_192,
      configuredTimeoutMs: 120_000,
    }),
    client: {
      async generate() {
        calls += 1;
        return '{"findings":[]}';
      },
    },
    store: {
      async read() {
        return null;
      },
      async write() {
        writes += 1;
      },
    },
    checkCancelled: async () => undefined,
  });

  assert.equal(calls, 0);
  assert.equal(writes, 0);
  assert.equal(knowledge.metrics.questionnaireFindingCount, 2);
  assert.equal(knowledge.metrics.canonicalFindingCount, 2);
});

test("el caller E2E de conocimiento repara solo el fragmento inválido y cachea únicamente salidas validadas", async () => {
  const sourceText =
    "El sistema debe registrar solicitudes y validar los campos obligatorios.";
  const questionnaireText = "Respuesta: Se requiere trazabilidad del proceso.";
  const segmented: LocalOnlyV2SegmentedEvidenceInput = {
    pipelineId: "LOCAL_ONLY_V2",
    budget: {
      contextTokens: 16_384,
      targetChunkTokens: 1_600,
      maxChunkTokens: 2_048,
      contextFractionCapTokens: 4_096,
      maxContextFraction: 0.25,
    },
    segments: [
      {
        segmentId: "source-e2e#0001",
        sourceId: "source-e2e",
        sourceTitle: "Fuente E2E",
        sourcePosition: 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: sourceText.length,
        text: sourceText,
        estimatedTokens: 18,
        contextUsageRatio: 18 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: false,
      },
      {
        segmentId: "questionnaire-e2e#0001",
        sourceId: "questionnaire-e2e",
        sourceTitle: "Preguntas de análisis · RQ-E2E",
        sourcePosition: 2,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: questionnaireText.length,
        text: questionnaireText,
        estimatedTokens: 12,
        contextUsageRatio: 12 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: true,
      },
    ],
    questionnaireSourceId: "questionnaire-e2e",
    questionnaireSegmentCount: 1,
  };
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 120_000,
  });
  const calls: Array<{
    sourceId: string | undefined;
    sourceClassification: string | undefined;
    prompt: string;
  }> = [];
  const writes: Array<{ key: string; value: unknown }> = [];
  const client: Pick<OllamaClient, "generate"> = {
    async generate(prompt, _schema, _images, traceContext) {
      calls.push({
        sourceId: traceContext?.sourceId,
        sourceClassification: traceContext?.sourceClassification,
        prompt,
      });

      if (traceContext?.sourceId === "source-e2e") {
        return JSON.stringify({
          findings: [
            {
              category: "functionalRequirements",
              description: "El sistema debe registrar solicitudes.",
              evidenceText:
                traceContext.sourceClassification ===
                "LOCAL_ONLY_V2_ATOMIC_REPAIR"
                  ? "El sistema debe registrar solicitudes"
                  : "El sistema registrará todas las solicitudes.",
            },
          ],
        });
      }

      return JSON.stringify({
        findings: [
          {
            category: "needs",
            description: "Se requiere trazabilidad del proceso.",
            evidenceText: "Se requiere trazabilidad del proceso.",
          },
        ],
      });
    },
  };
  const store = {
    async read() {
      return null;
    },
    async write(key: string, value: unknown) {
      writes.push({ key, value });
    },
  };

  const knowledge = await buildLocalOnlyV2RuntimeKnowledge({
    projectId: "project-e2e",
    segmented,
    budget,
    client,
    store,
    checkCancelled: async () => undefined,
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(
    calls.map((call) => [call.sourceId, call.sourceClassification]),
    [
      ["source-e2e", "LOCAL_ONLY_V2_ATOMIC"],
      ["source-e2e", "LOCAL_ONLY_V2_ATOMIC_REPAIR"],
      ["questionnaire-e2e", "LOCAL_ONLY_V2_ATOMIC"],
    ],
  );
  assert.match(calls[1]?.prompt ?? "", /LOCAL_ONLY_V2_ATOMIC_REPAIR_V1/u);
  assert.equal(writes.length, 2);
  assert.ok(writes.every((write) => write.key.startsWith("extract:")));
  assert.equal(knowledge.metrics.rawFindingCount, 2);
  assert.equal(knowledge.metrics.canonicalFindingCount, 2);
  assert.equal(knowledge.metrics.questionnaireFindingCount, 1);
  assert.ok(
    knowledge.findings.some((finding) =>
      finding.occurrences.some(
        (occurrence) =>
          occurrence.evidenceText === "El sistema debe registrar solicitudes",
      ),
    ),
  );
});

test("el caller E2E usa evidencia literal determinística si la reparación vuelve a parafrasear", async () => {
  const text = "Respuesta: Evidencia literal disponible.";
  const segmented: LocalOnlyV2SegmentedEvidenceInput = {
    pipelineId: "LOCAL_ONLY_V2",
    budget: {
      contextTokens: 16_384,
      targetChunkTokens: 1_600,
      maxChunkTokens: 2_048,
      contextFractionCapTokens: 4_096,
      maxContextFraction: 0.25,
    },
    segments: [
      {
        segmentId: "questionnaire-fail#0001",
        sourceId: "questionnaire-fail",
        sourceTitle: "Preguntas de análisis · RQ-FAIL",
        sourcePosition: 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: text.length,
        text,
        estimatedTokens: 10,
        contextUsageRatio: 10 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: true,
      },
    ],
    questionnaireSourceId: "questionnaire-fail",
    questionnaireSegmentCount: 1,
  };
  let calls = 0;
  let writes = 0;

  const knowledge = await buildLocalOnlyV2RuntimeKnowledge({
    projectId: "project-fail",
    segmented,
    budget: resolveLocalOnlyV2InferenceBudget({
      configuredContextTokens: 16_384,
      configuredMaxOutputTokens: 8_192,
      configuredTimeoutMs: 120_000,
    }),
    client: {
      async generate() {
        calls += 1;
        return JSON.stringify({
          findings: [
            {
              category: "facts",
              description: "Hallazgo no sustentado.",
              evidenceText: "Texto que no existe en el fragmento.",
            },
          ],
        });
      },
    },
    store: {
      async read() {
        return null;
      },
      async write() {
        writes += 1;
      },
    },
    checkCancelled: async () => undefined,
  });

  assert.equal(calls, 2);
  assert.equal(writes, 1);
  assert.ok(knowledge.findings.length > 0);
  assert.ok(
    knowledge.findings.every((finding) =>
      finding.occurrences.every((occurrence) =>
        text.includes(occurrence.evidenceText),
      ),
    ),
  );
});

test("el prompt de reparación atómica no altera el fragmento original", () => {
  const segmentText =
    "Regla confirmada: la aprobación requiere un coordinador.";
  const task = {
    taskId: "atomic:repair-prompt",
    pipelineId: "LOCAL_ONLY_V2" as const,
    segment: {
      segmentId: "repair-prompt#0001",
      sourceId: "source",
      sourceTitle: "Fuente",
      sourcePosition: 1,
      segmentIndex: 0,
      startCharacter: 0,
      endCharacter: segmentText.length,
      text: segmentText,
      estimatedTokens: 15,
      contextUsageRatio: 15 / 8_192,
      boundary: "END" as const,
      mandatoryQuestionnaireEvidence: false,
    },
    prompt: `FRAGMENTO_NO_CONFIABLE\n${segmentText}`,
    schema: { type: "object" },
    outputTargetTokens: 900,
    maxOutputTokens: 1_600,
  };

  const repaired = buildLocalOnlyV2AtomicRepairPrompt(
    task,
    new Error("evidenceText no existe literalmente en el fragmento."),
  );

  assert.match(repaired, /evidenceText no existe literalmente/u);
  assert.match(repaired, new RegExp(segmentText, "u"));
  assert.match(repaired, /omítelo/u);
});

test("Paso 18.5 conecta el bridge solo al LOCAL_ONLY real y conserva otras fronteras", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  assert.match(source, /from "\.\/local-only-v2-runtime-adapter"/u);
  assert.match(
    source,
    /this\.runtime\.executionMode === "OPENAI"\s*&&\s*generationMode === "LOCAL_ONLY"/u,
  );
  assert.match(source, /prepareLocalOnlyV2RuntimeBridge\(/u);
  assert.match(source, /appendLocalOnlyV2RuntimeEvidence\(/u);
  assert.match(source, /createLocalOnlyV2BoundedDocumentClient\(/u);

  assert.match(
    source,
    /generationMode === "LOCAL_ONLY" \|\| generationMode === "LOCAL_CLOUD"\s*\?\s*"LOCAL_EXTRACT"\s*:\s*"DEFAULT"/u,
  );
  assert.match(
    source,
    /provider = createCloudTextProvider\(resolvedOpenAi\)/u,
  );
  assert.match(source, /provider = new OllamaDraftProvider\(/u);

  const bridgeIndex = source.indexOf("prepareLocalOnlyV2RuntimeBridge(");
  const snapshotIndex = source.indexOf(
    "knowledgeSnapshot = await this.localAi.buildSnapshot(",
  );
  const appendIndex = source.indexOf("appendLocalOnlyV2RuntimeEvidence(");

  assert.ok(bridgeIndex >= 0);
  assert.ok(snapshotIndex > bridgeIndex);
  assert.ok(appendIndex > snapshotIndex);
});

test("runLocalOnlyV2DocumentRuntime respeta el modelo resuelto en vez de forzar qwen3.5:9b", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-runtime-adapter.ts",
    "utf8",
  );

  assert.doesNotMatch(source, /new OllamaClient\(\{[^}]*qwen3\.5:9b/u);
  assert.match(source, /const client = new OllamaClient\(config\);/u);
  assert.match(source, /model: config\.model,/u);
});

test("el modelo configurado forma parte de la clave de caché de extracción atómica", async () => {
  const segmentText =
    "El sistema debe registrar solicitudes y validar los campos obligatorios.";
  const segmented: LocalOnlyV2SegmentedEvidenceInput = {
    pipelineId: "LOCAL_ONLY_V2",
    budget: {
      contextTokens: 16_384,
      targetChunkTokens: 1_600,
      maxChunkTokens: 2_048,
      contextFractionCapTokens: 4_096,
      maxContextFraction: 0.25,
    },
    segments: [
      {
        segmentId: "source-model#0001",
        sourceId: "source-model",
        sourceTitle: "Fuente modelo",
        sourcePosition: 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: segmentText.length,
        text: segmentText,
        estimatedTokens: 18,
        contextUsageRatio: 18 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: true,
      },
    ],
    questionnaireSourceId: "source-model",
    questionnaireSegmentCount: 1,
  };
  const budget = resolveLocalOnlyV2InferenceBudget({
    configuredContextTokens: 16_384,
    configuredMaxOutputTokens: 8_192,
    configuredTimeoutMs: 120_000,
  });
  const client: Pick<OllamaClient, "generate"> = {
    async generate() {
      return JSON.stringify({
        findings: [
          {
            category: "functionalRequirements",
            description: "El sistema debe registrar solicitudes.",
            evidenceText: "El sistema debe registrar solicitudes.",
          },
        ],
      });
    },
  };

  async function writtenCacheKeys(model: string): Promise<readonly string[]> {
    const writes: string[] = [];
    const store = {
      async read() {
        return null;
      },
      async write(key: string) {
        writes.push(key);
      },
    };
    await buildLocalOnlyV2RuntimeKnowledge({
      projectId: "project-model",
      segmented,
      budget,
      client,
      store,
      checkCancelled: async () => undefined,
      model,
    });
    return writes;
  }

  const keysForQwen = await writtenCacheKeys("qwen3.5:9b");
  const keysForLlama = await writtenCacheKeys("llama3.1:8b");

  assert.equal(keysForQwen.length, 1);
  assert.equal(keysForLlama.length, 1);
  assert.notEqual(
    keysForQwen[0],
    keysForLlama[0],
    "un cambio de modelo debe invalidar la caché de extracción atómica",
  );
});

// LOCAL_ONLY_V2_PROCESS_FLOW_DIAGRAM_CONTRACT_V4_QUESTIONNAIRE_REGRESSION
//
// Reproduce, con un cuestionario amplio tipo SOAT compuesto únicamente por
// respuestas explícitas, el defecto reportado: `description` dejaba de ser
// usable para el punto 6 porque conservaba las etiquetas "Pregunta:"/
// "Respuesta:", y el contrato de diagramas rechaza cualquier descripción
// que empiece así. Este cuestionario no depende de ningún resultado de
// Ollama: las 7 respuestas están cubiertas de forma determinística.
const SOAT_LIKE_QUESTIONNAIRE = [
  "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
  "Pregunta: ¿Quién participa en el proceso?",
  "Respuesta: El área de cartera aprueba las solicitudes de crédito antes de enviarlas al proveedor.",
  "Pregunta: ¿Cómo se realiza actualmente el proceso?",
  "Respuesta: El área de cartera revisa manualmente cada solicitud en una hoja de cálculo antes de aprobarla.",
  "Pregunta: ¿Cómo debería funcionar el proceso ideal para capturar la solicitud?",
  "Respuesta: El sistema captura la solicitud desde un formulario web y valida los campos obligatorios.",
  "Pregunta: ¿Cuál sería la etapa de aprobación esperada?",
  "Respuesta: El sistema enruta la solicitud al aprobador y registra la decisión con trazabilidad.",
  "Pregunta: ¿Cómo debería funcionar el proceso ideal para enviar la solicitud?",
  "Respuesta: El sistema genera el archivo plano y lo envía automáticamente al proveedor.",
  "Pregunta: ¿Qué datos o entidades principales deben registrarse?",
  "Respuesta: La Solicitud almacena el vehículo, el solicitante y el estado del trámite.",
  "Pregunta: ¿Qué otro dato debe quedar registrado?",
  "Respuesta: El Comprobante representa la respuesta del proveedor asociada a la Solicitud.",
].join("\n");

function soatLikeSegmented(): LocalOnlyV2SegmentedEvidenceInput {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    budget: {
      contextTokens: 16_384,
      targetChunkTokens: 1_600,
      maxChunkTokens: 2_048,
      contextFractionCapTokens: 4_096,
      maxContextFraction: 0.25,
    },
    segments: [
      {
        segmentId: "questionnaire-soat-like#0001",
        sourceId: "questionnaire-soat-like",
        sourceTitle: "Preguntas de análisis · RQ-SOAT-LIKE",
        sourcePosition: 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: SOAT_LIKE_QUESTIONNAIRE.length,
        text: SOAT_LIKE_QUESTIONNAIRE,
        estimatedTokens: 220,
        contextUsageRatio: 220 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: true,
      },
    ],
    questionnaireSourceId: "questionnaire-soat-like",
    questionnaireSegmentCount: 1,
  };
}

test("LOCAL_ONLY_V2 punto 6: un cuestionario tipo SOAT completamente determinístico produce categorías sin prefijos, con cita literal, y evidencia utilizable para AS-IS/TO-BE/ER", async () => {
  let calls = 0;

  const knowledge = await buildLocalOnlyV2RuntimeKnowledge({
    projectId: "project-soat-like",
    segmented: soatLikeSegmented(),
    budget: resolveLocalOnlyV2InferenceBudget({
      configuredContextTokens: 16_384,
      configuredMaxOutputTokens: 8_192,
      configuredTimeoutMs: 120_000,
    }),
    client: {
      async generate() {
        calls += 1;
        return '{"findings":[]}';
      },
    },
    store: {
      async read() {
        return null;
      },
      async write() {
        /* no-op */
      },
    },
    checkCancelled: async () => undefined,
  });

  // Las 7 respuestas quedan cubiertas de forma determinística: nunca se
  // invoca al modelo local para el cuestionario.
  assert.equal(calls, 0);
  assert.equal(knowledge.metrics.questionnaireFindingCount, 7);
  assert.ok(knowledge.metrics.canonicalFindingCount > 0);

  assert.ok(knowledge.findingIdsByCategory.actors.length >= 1);
  assert.ok(knowledge.findingIdsByCategory.currentProcesses.length >= 1);
  assert.equal(knowledge.findingIdsByCategory.expectedProcesses.length, 3);
  assert.equal(knowledge.findingIdsByCategory.entities.length, 2);

  const prefixPattern = /^\s*(?:Pregunta|Respuesta)\s*:/iu;
  for (const finding of knowledge.findings) {
    assert.doesNotMatch(
      finding.description,
      prefixPattern,
      `la descripción "${finding.description}" no debe conservar las etiquetas de pregunta/respuesta`,
    );
    for (const occurrence of finding.occurrences) {
      assert.match(occurrence.evidenceText, /^Respuesta:\s*.+/u);
      assert.ok(
        SOAT_LIKE_QUESTIONNAIRE.includes(occurrence.evidenceText),
        "evidenceText debe ser una cita literal exacta de la fuente",
      );
      assert.equal(
        SOAT_LIKE_QUESTIONNAIRE.slice(
          occurrence.evidenceStartCharacter,
          occurrence.evidenceEndCharacter,
        ),
        occurrence.evidenceText,
        "los offsets deben apuntar exactamente a la cita literal",
      );
    }
  }

  const diagramFindings: LocalOnlyV2DiagramFallbackFinding[] =
    knowledge.findings.map((finding) => ({
      canonicalId: finding.canonicalId,
      category: finding.category,
      description: finding.description,
    }));

  assert.equal(
    hasUsableDiagramFlowEvidence(diagramFindings, "FLUJO AS-IS"),
    true,
  );
  assert.equal(
    hasUsableDiagramFlowEvidence(diagramFindings, "FLUJO TO-BE"),
    true,
  );
  assert.equal(hasUsableDiagramEntityEvidence(diagramFindings), true);

  const asIsContent = deterministicDiagramFlowFallback(
    diagramFindings,
    "FLUJO AS-IS",
    "ASIS",
    4_500,
  );
  const toBeContent = deterministicDiagramFlowFallback(
    diagramFindings,
    "FLUJO TO-BE",
    "TOBE",
    4_500,
  );
  const erContent = deterministicEntityRelationshipFallback(
    diagramFindings,
    "ER",
    3_000,
  );

  const asIsParsed = parseCanonicalDiagramFlow(asIsContent);
  const toBeParsed = parseCanonicalDiagramFlow(toBeContent);
  const erParsed = parseCanonicalEntityRelationshipModel(erContent);

  assert.ok(asIsParsed, "AS-IS no debe quedar vacío para este cuestionario");
  assert.ok(toBeParsed, "TO-BE no debe quedar vacío para este cuestionario");
  assert.ok(erParsed, "el modelo entidad-relación no debe quedar vacío");
  assert.equal(validateCanonicalDiagramFlow(asIsParsed!).valid, true);
  assert.equal(validateCanonicalDiagramFlow(toBeParsed!).valid, true);
  assert.equal(
    validateCanonicalEntityRelationshipModel(erParsed!).valid,
    true,
  );
  assert.ok(asIsParsed!.lanes.length >= 1);
  assert.ok(toBeParsed!.lanes.length >= 1);
  assert.ok(erParsed!.entities.length >= 1);

  for (const node of [...asIsParsed!.nodes, ...toBeParsed!.nodes]) {
    assert.doesNotMatch(node.label, /^(?:pregunta|respuesta)\s*:/iu);
  }
  for (const entity of erParsed!.entities) {
    assert.doesNotMatch(entity.name, /^(?:pregunta|respuesta)\s*:/iu);
  }
});

// LOCAL_ONLY_V2_QUESTIONNAIRE_STEP_ORDINAL_AND_ACTOR_LIST_REGRESSION
//
// Un cuestionario tipo SOAT donde una respuesta enumera 8 pasos literales
// (numeración en línea) y otra trae una lista explícita de roles separada
// por comas/conjunción. El orden alfabético que aplica el normalizador debe
// coincidir con el orden temporal declarado (Paso 01..08), y la lista de
// roles debe producir varios hallazgos `actors` utilizables en vez de un
// único hallazgo largo.
const SOAT_STEPS_AND_ROLES_QUESTIONNAIRE = [
  "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
  "Pregunta: ¿Cómo se realiza actualmente el proceso de atención de siniestros SOAT?",
  "Respuesta: 1. El asegurado reporta el siniestro en la línea de atención. 2. El agente registra el caso en el sistema. 3. El área de siniestros verifica la póliza vigente. 4. El perito programa la inspección del vehículo. 5. El taller autorizado presenta el presupuesto de reparación. 6. El auditor de siniestros aprueba el presupuesto. 7. El área de tesorería programa el pago al taller. 8. El asegurado retira el vehículo reparado.",
  "Pregunta: ¿Qué roles participan en el proceso?",
  "Respuesta: Roles involucrados en el proceso: Analista de siniestros, Perito automotor, Auditor de cumplimiento y Asesor comercial (canal telefónico).",
].join("\n");

function soatStepsAndRolesSegmented(): LocalOnlyV2SegmentedEvidenceInput {
  return {
    pipelineId: "LOCAL_ONLY_V2",
    budget: {
      contextTokens: 16_384,
      targetChunkTokens: 1_600,
      maxChunkTokens: 2_048,
      contextFractionCapTokens: 4_096,
      maxContextFraction: 0.25,
    },
    segments: [
      {
        segmentId: "questionnaire-soat-steps-roles#0001",
        sourceId: "questionnaire-soat-steps-roles",
        sourceTitle: "Preguntas de análisis · RQ-SOAT-STEPS-ROLES",
        sourcePosition: 1,
        segmentIndex: 0,
        startCharacter: 0,
        endCharacter: SOAT_STEPS_AND_ROLES_QUESTIONNAIRE.length,
        text: SOAT_STEPS_AND_ROLES_QUESTIONNAIRE,
        estimatedTokens: 220,
        contextUsageRatio: 220 / 16_384,
        boundary: "END",
        mandatoryQuestionnaireEvidence: true,
      },
    ],
    questionnaireSourceId: "questionnaire-soat-steps-roles",
    questionnaireSegmentCount: 1,
  };
}

test("LOCAL_ONLY_V2 punto 6: pasos numerados conservan orden 01..08 y una lista explícita de roles produce varios actores utilizables", async () => {
  const knowledge = await buildLocalOnlyV2RuntimeKnowledge({
    projectId: "project-soat-steps-roles",
    segmented: soatStepsAndRolesSegmented(),
    budget: resolveLocalOnlyV2InferenceBudget({
      configuredContextTokens: 16_384,
      configuredMaxOutputTokens: 8_192,
      configuredTimeoutMs: 120_000,
    }),
    client: {
      async generate() {
        return '{"findings":[]}';
      },
    },
    store: {
      async read() {
        return null;
      },
      async write() {
        /* no-op */
      },
    },
    checkCancelled: async () => undefined,
  });

  const stepFindings = knowledge.findings.filter(
    (finding) => finding.category === "currentProcesses",
  );
  assert.equal(stepFindings.length, 8);

  const expectedStepTexts = [
    "El asegurado reporta el siniestro en la línea de atención.",
    "El agente registra el caso en el sistema.",
    "El área de siniestros verifica la póliza vigente.",
    "El perito programa la inspección del vehículo.",
    "El taller autorizado presenta el presupuesto de reparación.",
    "El auditor de siniestros aprueba el presupuesto.",
    "El área de tesorería programa el pago al taller.",
    "El asegurado retira el vehículo reparado.",
  ];

  stepFindings.forEach((finding, index) => {
    const ordinal = String(index + 1).padStart(2, "0");
    assert.equal(
      finding.description,
      `Paso ${ordinal}: ${expectedStepTexts[index]}`,
      "el orden alfabético de las descripciones debe coincidir con el orden temporal declarado",
    );
  });

  const actorFindings = knowledge.findings.filter(
    (finding) => finding.category === "actors",
  );
  const actorDescriptions = actorFindings.map((finding) => finding.description);
  assert.ok(
    actorDescriptions.length > 1,
    "una lista explícita de roles debe producir varios hallazgos actors",
  );
  assert.deepEqual(
    [...actorDescriptions].sort(),
    [
      "Analista de siniestros",
      "Asesor comercial (canal telefónico)",
      "Auditor de cumplimiento",
      "Perito automotor",
    ].sort(),
  );
  for (const description of actorDescriptions) {
    assert.doesNotMatch(description, /^Roles\b/iu);
  }

  for (const finding of [...stepFindings, ...actorFindings]) {
    for (const occurrence of finding.occurrences) {
      assert.match(occurrence.evidenceText, /^Respuesta:\s*.+/u);
      assert.ok(
        SOAT_STEPS_AND_ROLES_QUESTIONNAIRE.includes(occurrence.evidenceText),
        "evidenceText debe ser una cita literal exacta de la fuente",
      );
      assert.equal(
        SOAT_STEPS_AND_ROLES_QUESTIONNAIRE.slice(
          occurrence.evidenceStartCharacter,
          occurrence.evidenceEndCharacter,
        ),
        occurrence.evidenceText,
        "los offsets deben apuntar exactamente a la cita literal",
      );
    }
  }
});

test("LOCAL_ONLY_V2 punto 6: la reparación del cuestionario no toca CLOUD_ONLY ni el modo híbrido", async () => {
  const promptBuilderSource = await readFile(
    "apps/ai-analysis-service/src/execution/ai-prompt-builder.ts",
    "utf8",
  );

  assert.doesNotMatch(
    promptBuilderSource,
    /local-only-v2-diagram-contract/u,
  );
  assert.doesNotMatch(
    promptBuilderSource,
    /local-only-v2-runtime-adapter/u,
  );
  assert.doesNotMatch(promptBuilderSource, /deterministicQuestionnaireFindings/u);
});
