// LOCAL_ONLY_V2_06_INCREMENTAL_CACHE
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalOnlyV2AtomicExtractionPrompt,
  buildLocalOnlyV2AtomicExtractionSchema,
  type LocalOnlyV2AtomicExtractionTask,
  type LocalOnlyV2AtomicModelOutput,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-atomic-extraction.js";
import {
  buildLocalOnlyV2CacheDescriptor,
  createLocalOnlyV2AtomicCacheEntry,
  hashLocalOnlyV2RelevantConfiguration,
  LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION,
  LOCAL_ONLY_V2_DEFAULT_EXTRACTOR_VERSION,
  planLocalOnlyV2IncrementalCache,
  type LocalOnlyV2CachePolicy,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-cache.js";
import type { LocalOnlyV2Segment } from "../../apps/ai-analysis-service/src/execution/local-only-v2-segmentation.js";

function segment(
  index: number,
  text: string,
  overrides: Partial<LocalOnlyV2Segment> = {},
): LocalOnlyV2Segment {
  const sourceId = "source-a";
  return {
    segmentId: `${sourceId}#${String(index + 1).padStart(4, "0")}`,
    sourceId,
    sourceTitle: "Fuente A",
    sourcePosition: 1,
    segmentIndex: index,
    startCharacter: index * 1_000,
    endCharacter: index * 1_000 + text.length,
    text,
    estimatedTokens: Math.ceil(text.length / 4),
    contextUsageRatio: Math.ceil(text.length / 4) / 16_384,
    boundary: "END",
    mandatoryQuestionnaireEvidence: false,
    ...overrides,
  };
}

function task(
  index: number,
  text: string,
  overrides: Partial<LocalOnlyV2Segment> = {},
): LocalOnlyV2AtomicExtractionTask {
  const current = segment(index, text, overrides);
  return {
    taskId: `atomic:${current.segmentId}`,
    pipelineId: "LOCAL_ONLY_V2",
    segment: current,
    prompt: buildLocalOnlyV2AtomicExtractionPrompt(current),
    schema: buildLocalOnlyV2AtomicExtractionSchema(),
    outputTargetTokens: 900,
    maxOutputTokens: 1_600,
  };
}

function rawOutput(evidenceText: string): LocalOnlyV2AtomicModelOutput {
  return {
    findings: [
      {
        category: "facts",
        description: evidenceText,
        evidenceText,
      },
    ],
  };
}

const policy: LocalOnlyV2CachePolicy = {
  model: "qwen3.5:9b",
  relevantConfiguration: {
    contextTokens: 131_072,
    targetChunkTokens: 2_048,
    maxChunkTokens: 3_072,
    outputMaxTokens: 1_600,
    structuredThinking: false,
  },
};

test("Paso 6 construye una clave con fuente, fragment SHA, modelo, extractor y configuración", () => {
  const currentTask = task(0, "La solicitud requiere trazabilidad.");
  const descriptor = buildLocalOnlyV2CacheDescriptor(currentTask, policy);

  assert.match(descriptor.cacheKey, /^v2c_[0-9a-f]{64}$/u);
  assert.match(descriptor.fragmentSha256, /^[0-9a-f]{64}$/u);
  assert.match(descriptor.configurationSha256, /^[0-9a-f]{64}$/u);
  assert.equal(descriptor.sourceId, "source-a");
  assert.equal(descriptor.model, "qwen3.5:9b");
  assert.equal(
    descriptor.extractorVersion,
    LOCAL_ONLY_V2_DEFAULT_EXTRACTOR_VERSION,
  );
});

test("el hash de configuración no depende del orden de las propiedades", () => {
  const left = hashLocalOnlyV2RelevantConfiguration({
    modelContext: 131_072,
    segmentation: { max: 3_072, target: 2_048 },
    flags: ["a", "b"],
  });
  const right = hashLocalOnlyV2RelevantConfiguration({
    flags: ["a", "b"],
    segmentation: { target: 2_048, max: 3_072 },
    modelContext: 131_072,
  });

  assert.equal(left, right);
});

test("si nada cambia todos los fragmentos son HIT y no se reprocesan", () => {
  const tasks = [
    task(0, "Actor: Analista."),
    task(1, "Regla: Requiere aprobación."),
    task(2, "Riesgo: Puede existir reproceso."),
  ];
  const entries = tasks.map((item) =>
    createLocalOnlyV2AtomicCacheEntry(
      item,
      policy,
      rawOutput(item.segment.text),
    ),
  );

  const plan = planLocalOnlyV2IncrementalCache(tasks, entries, policy);

  assert.equal(plan.hitCount, 3);
  assert.equal(plan.missCount, 0);
  assert.equal(plan.hits.length, 3);
  assert.equal(plan.misses.length, 0);
});

test("si cambia solo un fragmento se reprocesa únicamente ese fragmento", () => {
  const originalTasks = [
    task(0, "Actor: Analista."),
    task(1, "Regla: Requiere aprobación."),
    task(2, "Riesgo: Puede existir reproceso."),
  ];
  const entries = originalTasks.map((item) =>
    createLocalOnlyV2AtomicCacheEntry(
      item,
      policy,
      rawOutput(item.segment.text),
    ),
  );

  const changedTasks = [
    originalTasks[0]!,
    task(1, "Regla: Requiere aprobación del coordinador."),
    originalTasks[2]!,
  ];

  const plan = planLocalOnlyV2IncrementalCache(changedTasks, entries, policy);

  assert.equal(plan.hitCount, 2);
  assert.equal(plan.missCount, 1);
  assert.equal(plan.misses[0]!.task.segment.segmentIndex, 1);
  assert.equal(plan.misses[0]!.reason, "NOT_FOUND");
});

test("un fragmento idéntico puede moverse de posición y conserva HIT recalculando offsets", () => {
  const text = "Regla: La solicitud requiere aprobación.";
  const oldTask = task(1, text, {
    startCharacter: 1_000,
    endCharacter: 1_000 + text.length,
  });
  const entry = createLocalOnlyV2AtomicCacheEntry(
    oldTask,
    policy,
    rawOutput(text),
  );

  const movedTask = task(4, text, {
    segmentId: "source-a#0005",
    segmentIndex: 4,
    startCharacter: 5_000,
    endCharacter: 5_000 + text.length,
  });
  const plan = planLocalOnlyV2IncrementalCache([movedTask], [entry], policy);

  assert.equal(plan.hitCount, 1);
  assert.equal(plan.missCount, 0);
  const finding = plan.hits[0]!.findings[0]!;
  assert.equal(finding.segmentId, "source-a#0005");
  assert.equal(finding.segmentIndex, 4);
  assert.equal(finding.evidenceStartCharacter, 5_000);
  assert.equal(finding.evidenceEndCharacter, 5_000 + text.length);
});

test("cambiar modelo, versión del extractor o configuración invalida la caché", () => {
  const currentTask = task(0, "Actor: Coordinador.");
  const entry = createLocalOnlyV2AtomicCacheEntry(
    currentTask,
    policy,
    rawOutput(currentTask.segment.text),
  );

  const modelChanged = planLocalOnlyV2IncrementalCache([currentTask], [entry], {
    ...policy,
    model: "gemma4:12b",
  });
  const extractorChanged = planLocalOnlyV2IncrementalCache(
    [currentTask],
    [entry],
    { ...policy, extractorVersion: "atomic-2.0.0" },
  );
  const configChanged = planLocalOnlyV2IncrementalCache(
    [currentTask],
    [entry],
    {
      ...policy,
      relevantConfiguration: {
        ...policy.relevantConfiguration,
        maxChunkTokens: 2_500,
      },
    },
  );

  assert.equal(modelChanged.missCount, 1);
  assert.equal(extractorChanged.missCount, 1);
  assert.equal(configChanged.missCount, 1);
});

test("cambiar sourceId invalida aunque el texto del fragmento sea idéntico", () => {
  const text = "Dato: se requiere trazabilidad.";
  const first = task(0, text);
  const entry = createLocalOnlyV2AtomicCacheEntry(
    first,
    policy,
    rawOutput(text),
  );
  const anotherSource = task(0, text, {
    sourceId: "source-b",
    segmentId: "source-b#0001",
    sourceTitle: "Fuente B",
  });

  const plan = planLocalOnlyV2IncrementalCache(
    [anotherSource],
    [entry],
    policy,
  );

  assert.equal(plan.hitCount, 0);
  assert.equal(plan.missCount, 1);
});

test("una entrada cacheada corrupta se degrada a MISS y no se acepta como evidencia", () => {
  const currentTask = task(0, "Actor: Analista.");
  const valid = createLocalOnlyV2AtomicCacheEntry(
    currentTask,
    policy,
    rawOutput("Actor: Analista."),
  );

  const corrupt = {
    ...valid,
    cacheSchemaVersion: LOCAL_ONLY_V2_CACHE_SCHEMA_VERSION,
    rawOutput: {
      findings: [
        {
          category: "facts",
          description: "Dato inventado.",
          evidenceText: "Texto que no está en el fragmento.",
        },
      ],
    },
  };

  const plan = planLocalOnlyV2IncrementalCache(
    [currentTask],
    [corrupt],
    policy,
  );

  assert.equal(plan.hitCount, 0);
  assert.equal(plan.missCount, 1);
  assert.equal(plan.misses[0]!.reason, "INVALID_CACHED_OUTPUT");
});

test("las claves duplicadas se rechazan para no ocultar corrupción de persistencia", () => {
  const currentTask = task(0, "Actor: Analista.");
  const entry = createLocalOnlyV2AtomicCacheEntry(
    currentTask,
    policy,
    rawOutput("Actor: Analista."),
  );

  assert.throws(
    () =>
      planLocalOnlyV2IncrementalCache([currentTask], [entry, entry], policy),
    /clave de caché duplicada/u,
  );
});

test("Paso 6 no depende de TypeORM ni modifica la caché histórica", async () => {
  const { readFile } = await import("node:fs/promises");
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-cache.ts",
    "utf8",
  );

  assert.doesNotMatch(production, /typeorm/iu);
  assert.doesNotMatch(production, /Repository</u);
  assert.doesNotMatch(production, /SourceLocalAnalysisEntity/u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /fragmentSha256/u);
  assert.match(production, /configurationSha256/u);
  assert.match(production, /extractorVersion/u);
});
