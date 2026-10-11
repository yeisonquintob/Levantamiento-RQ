import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LocalDraftBlockProgressStore,
  buildLocalDraftLogicalBlocks,
  type LocalDraftBlockCheckpointEvent,
} from "../../apps/ai-analysis-service/src/execution/local-draft-block-map.js";
import {
  LocalDraftStages,
  localDraftStages,
  type LocalDraftStage,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import {
  buildAiAnalysisOutputSchemaV41,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { localDraftFixture } from "./local-draft.fixture.js";

const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

function responseFor(
  raw: Record<string, any>,
  stage: LocalDraftStage,
): unknown {
  const plan = stage.path.endsWith(".__plan");
  const path = stage.path.replace(/\.__plan$/u, "");
  const parts = path.replace(/\[(\d+)\]/gu, ".$1").split(".");
  let value: any = raw;

  if (parts[0] === "sections") {
    value = raw.sections.find((section: any) => section.key === parts[1]);
    parts.splice(0, 2);
  }

  for (const part of parts) value = value[part];

  if (plan) {
    const keys = Object.keys((stage.schema.items as any).properties);
    return value.map((item: any) =>
      Object.fromEntries(
        keys.map((key) => [key, item[key] ?? "Elemento de diagnóstico"]),
      ),
    );
  }

  return structuredClone(value);
}

test("Paso 10: store conserva diagnóstico efímero del stage actual", () => {
  const store = new LocalDraftBlockProgressStore();
  const blocks = [
    {
      blockNumber: 1,
      blockTotal: 2,
      blockKey: "scope",
      blockLabel: "Alcance",
      required: true,
      guidance: "",
      stageRoots: ["sections.scope"],
      presentationSource: "AI_STAGE" as const,
    },
    {
      blockNumber: 2,
      blockTotal: 2,
      blockKey: "tests",
      blockLabel: "Pruebas",
      required: true,
      guidance: "",
      stageRoots: ["sections.tests"],
      presentationSource: "AI_STAGE" as const,
    },
  ];

  store.initialize("request-1", blocks);
  store.update("request-1", {
    blockNumber: 1,
    blockTotal: 2,
    blockKey: "scope",
    blockLabel: "Alcance",
    status: "PROCESSING",
    currentStagePath: "sections.scope",
    operation: "GENERATING",
    repairAttempt: null,
  });

  const active = store.get("request-1")[0];
  assert.equal(active?.currentStagePath, "sections.scope");
  assert.equal(active?.operation, "GENERATING");
  assert.equal(active?.repairAttempt, null);

  store.update("request-1", {
    blockNumber: 1,
    blockTotal: 2,
    blockKey: "scope",
    blockLabel: "Alcance",
    status: "PROCESSING",
    currentStagePath: "sections.scope",
    operation: "REPAIRING",
    repairAttempt: 1,
  });

  const repairing = store.get("request-1")[0];
  assert.equal(repairing?.operation, "REPAIRING");
  assert.equal(repairing?.repairAttempt, 1);

  store.update("request-1", {
    blockNumber: 1,
    blockTotal: 2,
    blockKey: "scope",
    blockLabel: "Alcance",
    status: "COMPLETED",
  });

  const completed = store.get("request-1")[0];
  assert.equal(completed?.currentStagePath, null);
  assert.equal(completed?.operation, null);
  assert.equal(completed?.repairAttempt, null);
});

test("Paso 10: generación inicial reporta stage técnico sin contenido documental", async () => {
  const raw = await localDraftFixture();
  const schema = buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
    SOURCE_ID,
  ]);
  const stages = localDraftStages(schema);
  const blocks = buildLocalDraftLogicalBlocks(
    raw.sections.map((section: any, index: number) => ({
      key: section.key,
      title: section.title,
      order: index + 1,
      required: true,
      guidance: "",
    })),
    stages,
  );
  const events: LocalDraftBlockCheckpointEvent[] = [];

  const result = await new LocalDraftStages(
    schema,
    async (stage) => responseFor(raw, stage),
    undefined,
    blocks,
    async (progress) => {
      events.push(structuredClone(progress));
    },
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));

  const processingWithStage = events.filter(
    (event) =>
      event.status === "PROCESSING" &&
      typeof event.currentStagePath === "string",
  );
  assert.ok(processingWithStage.length > 0);
  assert.ok(
    processingWithStage.every((event) => event.operation === "GENERATING"),
  );
  assert.ok(processingWithStage.every((event) => event.repairAttempt === null));

  const serialized = JSON.stringify(processingWithStage);
  assert.doesNotMatch(serialized, /CORRECCION_REQUERIDA/u);
  assert.doesNotMatch(serialized, /PROJECT_KNOWLEDGE_SNAPSHOT/u);
  assert.doesNotMatch(serialized, /CONTEXTO_COMPARTIDO/u);
});

test("Paso 10: reparación Paso 8 reporta REPAIRING y repairAttempt=1", async () => {
  const raw = await localDraftFixture();
  const schema = buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
    SOURCE_ID,
  ]);
  const stages = localDraftStages(schema);
  const blocks = buildLocalDraftLogicalBlocks(
    raw.sections.map((section: any, index: number) => ({
      key: section.key,
      title: section.title,
      order: index + 1,
      required: true,
      guidance: "",
    })),
    stages,
  );
  const events: LocalDraftBlockCheckpointEvent[] = [];
  let validations = 0;

  const result = await new LocalDraftStages(
    schema,
    async (stage) => responseFor(raw, stage),
    () => {
      validations += 1;
      return validations === 1
        ? ["structuredAnalysis.backlogStructure: reparación diagnóstica"]
        : [];
    },
    blocks,
    async (progress) => {
      events.push(structuredClone(progress));
    },
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));

  const repair = events.find(
    (event) =>
      event.status === "PROCESSING" &&
      event.currentStagePath === "structuredAnalysis.backlogStructure" &&
      event.operation === "REPAIRING",
  );

  assert.ok(repair);
  assert.equal(repair.repairAttempt, 1);
});

test("Paso 10: campos diagnósticos no se agregan a la persistencia del checkpoint", async () => {
  const execution = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  assert.match(execution, /checkpoint\.status = progress\.status/u);
  assert.match(
    execution,
    /checkpoint\.stageValuesJson = JSON\.stringify\(progress\.stageValues \?\? \{\}\)/u,
  );
  assert.doesNotMatch(execution, /checkpoint\.currentStagePath/u);
  assert.doesNotMatch(execution, /checkpoint\.operation/u);
  assert.doesNotMatch(execution, /checkpoint\.repairAttempt/u);
});

test("Paso 10: conserva Pasos 6-9, perfiles, aislamiento y límites", async () => {
  const [stages, provider, pipeline, client, discussion, benchmark] =
    await Promise.all([
      readFile(
        "apps/ai-analysis-service/src/execution/local-draft-stages.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/local-ai/ollama.client.ts",
        "utf8",
      ),
      readFile(
        "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
        "utf8",
      ),
      readFile("scripts/local-only-step9-benchmark.ts", "utf8"),
    ]);

  assert.match(stages, /PASO_8_REPARACION_LOCALIZADA_V2/u);
  assert.doesNotMatch(stages, /regenerateDependents/u);
  assert.match(provider, /PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2/u);
  assert.match(provider, /profile:\s*"LOCAL_DOCUMENT"/u);
  assert.match(pipeline, /PASO_6_SNAPSHOT_LOCAL_COMPACTO_VERIFICABLE_V1/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(provider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
  assert.match(benchmark, /PASO_9_BENCHMARK_LOCAL_ONLY_V1/u);
});
