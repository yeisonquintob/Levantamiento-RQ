import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  LocalDraftStages,
  localDraftRepairTarget,
  localDraftStages,
  type LocalDraftStage,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import {
  buildAiAnalysisOutputSchemaV41,
  parseAiAnalysisDraft,
} from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { localDraftFixture } from "./local-draft.fixture.js";

const sourceId = "22222222-2222-4222-8222-222222222222";
const schema = buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
  sourceId,
]);

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
        keys.map((key) => [key, item[key] ?? "Elemento de prueba"]),
      ),
    );
  }

  return structuredClone(value);
}

function countCalls(calls: Map<string, number>, stagePath: string): number {
  return calls.get(stagePath) ?? 0;
}

test("Paso 8 V2: reconoce el alias real scope.* como sections.scope", () => {
  const stages = localDraftStages(schema);
  const target = localDraftRepairTarget(
    "scope.kpis[0].relatedObjective no referencia de forma inequívoca un objetivo.",
    stages,
  );

  assert.equal(target?.path, "sections.scope");
});

test("Paso 8 V2: reconoce un path sections.* explícito", () => {
  const stages = localDraftStages(schema);
  const target = localDraftRepairTarget(
    "sections.scope: corrección localizada",
    stages,
  );

  assert.equal(target?.path, "sections.scope");
});

test("Paso 8 V2: el resolver elige el primer path explícito del mensaje", () => {
  const stages = localDraftStages(schema);
  const target = localDraftRepairTarget(
    [
      "structuredAnalysis.backlogStructure: falta una relación",
      "structuredAnalysis.functionalUserStories: falta cobertura",
    ].join("; "),
    stages,
  );

  assert.equal(target?.path, "structuredAnalysis.backlogStructure");
});

test("Paso 8 V2: una palabra suelta no dispara una reparación ambigua", () => {
  const stages = localDraftStages(schema);

  assert.equal(
    localDraftRepairTarget(
      "El documento menciona tests como texto explicativo, sin path de validación.",
      stages,
    ),
    undefined,
  );
});

test("Paso 8 V2: reparar backlogStructure no regenera dependientes preventivamente", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();
  let validationPass = 0;

  const result = await new LocalDraftStages(
    schema,
    async (stage) => {
      calls.set(stage.path, countCalls(calls, stage.path) + 1);
      return responseFor(raw, stage);
    },
    () => {
      validationPass += 1;
      return validationPass === 1
        ? ["structuredAnalysis.backlogStructure: corrección localizada"]
        : [];
    },
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(countCalls(calls, "structuredAnalysis.backlogStructure"), 2);

  assert.equal(
    countCalls(calls, "structuredAnalysis.functionalUserStories[0]"),
    1,
  );
  assert.equal(countCalls(calls, "structuredAnalysis.tests[0]"), 1);
  assert.equal(countCalls(calls, "sections.milestones"), 1);
  assert.equal(countCalls(calls, "sections.tests"), 1);
});

test("Paso 8 V2: un dependiente se regenera solo cuando la validación siguiente lo nombra", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();
  let validationPass = 0;

  const result = await new LocalDraftStages(
    schema,
    async (stage) => {
      calls.set(stage.path, countCalls(calls, stage.path) + 1);
      return responseFor(raw, stage);
    },
    () => {
      validationPass += 1;
      if (validationPass === 1) {
        return ["structuredAnalysis.backlogStructure: corregir planificación"];
      }
      if (validationPass === 2) {
        return [
          "structuredAnalysis.functionalUserStories: realinear historias después de planificación",
        ];
      }
      return [];
    },
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(countCalls(calls, "structuredAnalysis.backlogStructure"), 2);
  assert.equal(
    countCalls(calls, "structuredAnalysis.functionalUserStories[0]"),
    2,
  );
  assert.equal(countCalls(calls, "structuredAnalysis.tests[0]"), 1);
  assert.equal(countCalls(calls, "sections.tests"), 1);
});

test("Paso 8 V2: conserva reparación localizada de sections[index]", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();
  let validationPass = 0;

  const result = await new LocalDraftStages(
    schema,
    async (stage) => {
      calls.set(stage.path, countCalls(calls, stage.path) + 1);
      return responseFor(raw, stage);
    },
    () => {
      validationPass += 1;
      return validationPass === 1
        ? ["sections[3].content.kpis[0]: relación inválida"]
        : [];
    },
  ).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(countCalls(calls, "sections.scope"), 2);
  assert.equal(countCalls(calls, "sections.objectives"), 1);
  assert.equal(countCalls(calls, "structuredAnalysis.backlogStructure"), 1);
});

test("Paso 8 V2: el error KPI real repara scope sin repetir objectives ni backlog", async () => {
  const raw = await localDraftFixture();
  const calls = new Map<string, number>();

  const result = await new LocalDraftStages(schema, async (stage) => {
    const count = countCalls(calls, stage.path) + 1;
    calls.set(stage.path, count);

    const value: any = responseFor(raw, stage);
    if (stage.path === "sections.scope" && count === 1) {
      value.content.kpis[0].relatedObjective = "Objetivo completamente ajeno";
    }
    return value;
  }).run();

  assert.deepEqual(result, parseAiAnalysisDraft(raw));
  assert.equal(countCalls(calls, "sections.scope"), 2);
  assert.equal(countCalls(calls, "sections.objectives"), 1);
  assert.equal(countCalls(calls, "structuredAnalysis.backlogStructure"), 1);
});

test("Paso 8 V2: conserva fail-closed si la validación no identifica un stage", async () => {
  const raw = await localDraftFixture();

  await assert.rejects(
    new LocalDraftStages(
      schema,
      async (stage) => responseFor(raw, stage),
      () => ["Error semántico sin ruta reparable"],
    ).run(),
    /OLLAMA_DRAFT_INVALID|no superó la validación/u,
  );
});

test("Paso 8 V2: no altera perfiles, Paso 7, snapshot ni límites", async () => {
  const [stagesSource, provider, pipeline, execution, client, discussion] =
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
        "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
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
    ]);

  assert.match(stagesSource, /PASO_8_REPARACION_LOCALIZADA_V2/u);
  assert.doesNotMatch(stagesSource, /regenerateDependents/u);

  assert.match(provider, /PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2/u);
  assert.match(provider, /profile:\s*"LOCAL_DOCUMENT"/u);
  assert.match(provider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);

  assert.match(pipeline, /PASO_6_SNAPSHOT_LOCAL_COMPACTO_VERIFICABLE_V1/u);
  assert.match(
    pipeline,
    /analysisProfile === "LOCAL_EXTRACT"[\s\S]*?local-only-extract-think-false-v1\+compact-prompt-v1/u,
  );

  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY"[\s\S]*?\? buildLocalDocumentPromptFromKnowledgeSnapshot\([\s\S]*?: buildHybridCloudPromptFromKnowledgeSnapshot\(/u,
  );

  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(client, /configuredOutputTokens = 8192/u);
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});
