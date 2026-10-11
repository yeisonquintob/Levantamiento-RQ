// PASO_4_BLINDAJE_FRONTERAS_TRES_MODOS_V2

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertAiDocumentGenerationBoundary,
  type AiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";
import { buildHybridCloudPromptFromKnowledgeSnapshot } from "../../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.js";
import { LOCAL_AI_CATEGORIES } from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";

function boundary(
  mode: AiDocumentGenerationMode,
  provider: string,
  hasKnowledgeSnapshot: boolean,
  snapshotPromptReady: boolean,
) {
  return () =>
    assertAiDocumentGenerationBoundary({
      mode,
      provider,
      hasKnowledgeSnapshot,
      snapshotPromptReady,
    });
}

test("Punto 4 acepta únicamente la frontera válida de cada modo", () => {
  assert.doesNotThrow(boundary("LOCAL_ONLY", "OLLAMA", true, true));
  assert.doesNotThrow(boundary("LOCAL_CLOUD", "OPENAI", true, true));
  assert.doesNotThrow(boundary("CLOUD_ONLY", "OPENAI", false, false));
});

test("Punto 4 rechaza cruces de proveedor o snapshot entre modos", () => {
  assert.throws(
    boundary("LOCAL_ONLY", "OPENAI", true, true),
    /LOCAL_ONLY requiere proveedor final OLLAMA/u,
  );
  assert.throws(
    boundary("LOCAL_CLOUD", "OPENAI", false, true),
    /LOCAL_CLOUD requiere snapshot local/u,
  );
  assert.throws(
    boundary("LOCAL_CLOUD", "OPENAI", true, false),
    /LOCAL_CLOUD debe generar el documento desde el snapshot local/u,
  );
  assert.throws(
    boundary("CLOUD_ONLY", "OPENAI", true, false),
    /CLOUD_ONLY no debe construir ni consumir snapshot local/u,
  );
  assert.throws(
    boundary("CLOUD_ONLY", "OLLAMA", false, false),
    /CLOUD_ONLY requiere proveedor final OPENAI/u,
  );
});

test("LOCAL_CLOUD sustituye fuentes crudas por snapshot y conserva el manifiesto", () => {
  const basePrompt = [
    "INSTRUCCIONES_CONFIABLES",
    "FUENTES_NO_CONFIABLES",
    "SOURCE_ID=11111111-1111-4111-8111-111111111111",
    "RAW_SECRET_CONTENT_ABC123",
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    "EP-001 | Feature confirmada",
  ].join("\n");

  const snapshot = {
    schemaVersion: "test",
    projectId: "22222222-2222-4222-8222-222222222222",
    sourceIds: ["11111111-1111-4111-8111-111111111111"],
    originalCharacters: 100,
    estimatedOriginalTokens: 25,
    analysisCharacters: 50,
    estimatedAnalysisTokens: 13,
    snapshotCharacters: 40,
    estimatedSnapshotTokens: 10,
    reductionPercentage: 60,
    metrics: {
      originalTokens: 25,
      localAnalysisTokens: 13,
      snapshotTokens: 10,
      targetSnapshotTokens: 100,
      reductionPercentage: 60,
      findingsBeforeDedup: 0,
      findingsAfterExactDedup: 0,
      findingsAfterSemanticDedup: 0,
      criticalFindingsPreserved: 0,
      sourceCoverage: 100,
    },
    findings: Object.fromEntries(
      LOCAL_AI_CATEGORIES.map((category) => [category, []]),
    ),
  } as any;

  const prompt = buildHybridCloudPromptFromKnowledgeSnapshot(
    basePrompt,
    snapshot,
  );

  assert.match(prompt, /INSTRUCCIONES_CONFIABLES/u);
  assert.match(prompt, /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL/u);
  assert.doesNotMatch(prompt, /RAW_SECRET_CONTENT_ABC123/u);
  assert.doesNotMatch(prompt, /FUENTES_NO_CONFIABLES/u);
  assert.match(prompt, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
  assert.match(prompt, /EP-001 \| Feature confirmada/u);
  assert.doesNotMatch(prompt, /"metrics":/u);
  assert.doesNotMatch(prompt, /"estimatedOriginalTokens":/u);
});

test("el guard de fronteras se ejecuta antes de llamar al proveedor final", async () => {
  const source = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  const guardIndex = source.indexOf("assertAiDocumentGenerationBoundary({");
  const providerIndex = source.indexOf(
    "const generated = await provider.generate({",
  );

  assert.ok(guardIndex >= 0, "Debe existir el guard de fronteras.");
  assert.ok(
    providerIndex > guardIndex,
    "El guard debe ejecutarse antes del proveedor final.",
  );
  assert.match(source, /hasKnowledgeSnapshot: Boolean\(knowledgeSnapshot\)/u);
  assert.match(source, /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL/u);
});
