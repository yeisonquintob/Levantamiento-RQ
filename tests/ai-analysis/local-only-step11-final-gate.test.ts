import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertAiDocumentGenerationBoundary,
  resolveAiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";
import { localDraftEvidenceCategories } from "../../apps/ai-analysis-service/src/execution/ollama-draft.provider.js";
import {
  localDraftRepairTarget,
  localDraftStages,
} from "../../apps/ai-analysis-service/src/execution/local-draft-stages.js";
import { buildAiAnalysisOutputSchemaV41 } from "../../apps/ai-analysis-service/src/execution/ai-analysis-draft.js";
import { LocalDraftBlockProgressStore } from "../../apps/ai-analysis-service/src/execution/local-draft-block-map.js";
import {
  effectiveOllamaLimits,
  OLLAMA_RUNTIME_CONTEXT_CAP,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { runLocalOnlyStep9Benchmark } from "../../scripts/local-only-step9-benchmark.js";

const SOURCE_ID = "22222222-2222-4222-8222-222222222222";

test("Paso 11: certifica la matriz final de los tres modos", () => {
  assert.equal(resolveAiDocumentGenerationMode(true, false), "LOCAL_ONLY");
  assert.equal(resolveAiDocumentGenerationMode(true, true), "LOCAL_CLOUD");
  assert.equal(resolveAiDocumentGenerationMode(false, true), "CLOUD_ONLY");

  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "LOCAL_ONLY",
      provider: "OLLAMA",
      hasKnowledgeSnapshot: true,
      snapshotPromptReady: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "LOCAL_CLOUD",
      provider: "OPENAI",
      hasKnowledgeSnapshot: true,
      snapshotPromptReady: true,
    }),
  );
  assert.doesNotThrow(() =>
    assertAiDocumentGenerationBoundary({
      mode: "CLOUD_ONLY",
      provider: "OPENAI",
      hasKnowledgeSnapshot: false,
      snapshotPromptReady: false,
    }),
  );
});

test("Paso 11: certifica perfiles, aislamiento, snapshot y límites", async () => {
  const [execution, provider, pipeline, client, discussion] = await Promise.all(
    [
      readFile(
        "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
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
    ],
  );

  assert.match(pipeline, /PASO_3_LOCAL_ONLY_PREANALISIS_THINK_FALSE_V1/u);
  assert.match(
    pipeline,
    /local-only-extract-think-false-v1\+compact-prompt-v1/u,
  );
  assert.match(
    client,
    /LocalAiExecutionProfile = "LOCAL_EXTRACT" \| "LOCAL_DOCUMENT"/u,
  );
  assert.match(pipeline, /PASO_6_SNAPSHOT_LOCAL_COMPACTO_VERIFICABLE_V1/u);
  assert.match(provider, /PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2/u);
  assert.match(provider, /profile:\s*"LOCAL_DOCUMENT"/u);
  assert.match(provider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(client, /configuredOutputTokens = 8192/u);

  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY" \|\| generationMode === "LOCAL_CLOUD"\s*\?\s*"LOCAL_EXTRACT"\s*:\s*"DEFAULT"/u,
  );
  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY"[\s\S]*?\? buildLocalDocumentPromptFromKnowledgeSnapshot\([\s\S]*?: buildHybridCloudPromptFromKnowledgeSnapshot\(/u,
  );
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});

test("Paso 11: contexto especializado conserva guardas y fail-safe", () => {
  const functional = localDraftEvidenceCategories(
    "structuredAnalysis.functionalUserStories[0]",
  );

  for (const category of [
    "actors",
    "needs",
    "facts",
    "functionalRequirements",
    "businessRules",
    "integrations",
    "risks",
    "decisions",
    "contradictions",
    "pendingQuestions",
    "warnings",
  ]) {
    assert.ok(functional.includes(category as never), category);
  }

  assert.equal(localDraftEvidenceCategories("futureStage.unknown").length, 16);
});

test("Paso 11: reparación final sigue localizada y sin cascada preventiva", async () => {
  const schema = buildAiAnalysisOutputSchemaV41(false, "MEDIUM_REQUIREMENT", [
    SOURCE_ID,
  ]);
  const stages = localDraftStages(schema);

  assert.equal(
    localDraftRepairTarget(
      "scope.kpis[0].relatedObjective no referencia un objetivo.",
      stages,
    )?.path,
    "sections.scope",
  );

  assert.equal(
    localDraftRepairTarget(
      "structuredAnalysis.backlogStructure: corrección localizada",
      stages,
    )?.path,
    "structuredAnalysis.backlogStructure",
  );

  const source = await readFile(
    "apps/ai-analysis-service/src/execution/local-draft-stages.ts",
    "utf8",
  );
  assert.match(source, /PASO_8_REPARACION_LOCALIZADA_V2/u);
  assert.match(
    source,
    /generateTrackedStage\(target, message, true, attempt \+ 1\)/u,
  );
  assert.doesNotMatch(source, /regenerateDependents/u);
});

test("Paso 11: diagnóstico de progreso es efímero y seguro", async () => {
  const store = new LocalDraftBlockProgressStore();
  store.initialize("gate-request", [
    {
      blockNumber: 1,
      blockTotal: 1,
      blockKey: "scope",
      blockLabel: "Alcance",
      required: true,
      guidance: "",
      stageRoots: ["sections.scope"],
      presentationSource: "AI_STAGE",
    },
  ]);

  store.update("gate-request", {
    blockNumber: 1,
    blockTotal: 1,
    blockKey: "scope",
    blockLabel: "Alcance",
    status: "PROCESSING",
    currentStagePath: "sections.scope",
    operation: "REPAIRING",
    repairAttempt: 1,
  });

  const active = store.get("gate-request")[0];
  assert.equal(active?.currentStagePath, "sections.scope");
  assert.equal(active?.operation, "REPAIRING");
  assert.equal(active?.repairAttempt, 1);

  const [execution, contract] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile("libs/shared/contracts/src/lib/ai-analysis.ts", "utf8"),
  ]);

  assert.match(contract, /currentStagePath\?: string \| null/u);
  assert.match(contract, /repairAttempt\?: number \| null/u);
  assert.doesNotMatch(execution, /checkpoint\.currentStagePath/u);
  assert.doesNotMatch(execution, /checkpoint\.operation/u);
  assert.doesNotMatch(execution, /checkpoint\.repairAttempt/u);
});

test("Paso 11: límites reales siguen dentro de 65536 / 8192", () => {
  const limits = effectiveOllamaLimits("x".repeat(100_000), 300_000, 20_000);

  assert.equal(OLLAMA_RUNTIME_CONTEXT_CAP, 65_536);
  assert.ok(limits.contextTokens <= 65_536);
  assert.ok(limits.outputTokens <= 8_192);
});

test("Paso 11: benchmark determinístico final aprueba todos los gates", async () => {
  const report = await runLocalOnlyStep9Benchmark({
    writeReports: false,
  });

  assert.equal(report.status, "PASS");
  assert.equal(report.mode, "DETERMINISTIC_NO_NETWORK");
  assert.equal(report.gates.filter((gate) => !gate.pass).length, 0);
  assert.equal(report.deltas.backlogRepairExtraCalls, 1);
  assert.equal(report.deltas.scopeKpiRepairExtraCalls, 1);
  assert.equal(report.scenarios.baseline.traceabilityPercent, 100);
  assert.deepEqual(report.scenarios.baseline.unknownSourceIds, []);
  assert.equal(report.scenarios.baseline.functionalPlanningAligned, true);
  assert.ok(
    report.scenarios.baseline.maxContextFootprintTokens <=
      report.codeState.contextCap,
  );
});
