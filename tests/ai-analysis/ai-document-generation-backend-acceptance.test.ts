// PASO_5_GATE_ACEPTACION_BACKEND_TRES_MODOS_V1

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertAiDocumentGenerationBoundary,
  resolveAiDocumentGenerationMode,
} from "../../apps/ai-analysis-service/src/execution/ai-document-generation-mode.js";
import {
  effectiveOllamaLimits,
  OLLAMA_RUNTIME_CONTEXT_CAP,
  resolveLocalAiExecutionProfile,
  useChatForStructuredOllama,
} from "../../apps/ai-analysis-service/src/local-ai/ollama.client.js";
import { buildAiAnalysisPromptFromKnowledgeSnapshot } from "../../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.js";

test("Punto 5 certifica la matriz final de los tres modos", () => {
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

test("Punto 5 certifica que LOCAL_CLOUD no entrega la fuente cruda a OpenAI", () => {
  const rawSecret = "RAW_SECRET_CONTENT_SHOULD_NOT_REACH_CLOUD";
  const basePrompt = [
    "INSTRUCCIONES_CONFIABLES",
    "FUENTES_NO_CONFIABLES",
    rawSecret,
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    '{"epics":[]}',
  ].join("\n");

  const snapshot = {
    schemaVersion: "1.1.0",
    projectId: "33333333-3333-4333-8333-333333333333",
    sourceIds: ["11111111-1111-4111-8111-111111111111"],
    originalCharacters: 100,
    estimatedOriginalTokens: 25,
    analysisCharacters: 80,
    estimatedAnalysisTokens: 20,
    snapshotCharacters: 60,
    estimatedSnapshotTokens: 15,
    reductionPercentage: 40,
    metrics: {
      originalTokens: 25,
      localAnalysisTokens: 20,
      snapshotTokens: 15,
      targetSnapshotTokens: 100,
      reductionPercentage: 40,
      findingsBeforeDedup: 1,
      findingsAfterExactDedup: 1,
      findingsAfterSemanticDedup: 1,
      criticalFindingsPreserved: 1,
      sourceCoverage: 1,
    },
    findings: {
      businessContext: [],
      objectives: [],
      currentProcess: [],
      problems: [],
      functionalRequirements: [],
      nonFunctionalRequirements: [],
      businessRules: [],
      dataEntities: [],
      integrations: [],
      assumptions: [],
      constraints: [],
      contradictions: [],
      pendingQuestions: [],
      warnings: [],
    },
  } as any;

  const hybridPrompt = buildAiAnalysisPromptFromKnowledgeSnapshot(
    basePrompt,
    snapshot,
  );

  assert.doesNotMatch(hybridPrompt, new RegExp(rawSecret, "u"));
  assert.match(hybridPrompt, /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL/u);
  assert.match(hybridPrompt, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
});

test("Punto 5 certifica transporte documental, Discusión y límites de Ollama", async () => {
  assert.equal(useChatForStructuredOllama("qwen3.5:9b"), true);
  assert.equal(useChatForStructuredOllama("qwen3.5:27b"), true);
  assert.equal(useChatForStructuredOllama("mistral-nemo"), false);

  const limits = effectiveOllamaLimits("x".repeat(100_000), 300_000, 20_000);
  assert.equal(OLLAMA_RUNTIME_CONTEXT_CAP, 65_536);
  assert.ok(limits.contextTokens <= 65_536);
  assert.ok(limits.outputTokens <= 8_192);

  const [ollamaSource, discussionSource] = await Promise.all([
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
      "utf8",
    ),
  ]);

  // PASO_11_GATE_FINAL_LOCAL_ONLY_V2
  // Desde Paso 5 el nivel documental ya no vive como literal `think: "low"`;
  // el contrato estable es LOCAL_DOCUMENT -> AUTO + LOW y el cliente traduce
  // LOW a `chatThink = "low"` antes de asignarlo al payload.
  assert.deepEqual(resolveLocalAiExecutionProfile("LOCAL_DOCUMENT"), {
    structuredTransport: "AUTO",
    structuredThinking: "LOW",
  });
  assert.match(ollamaSource, /const chatThink =/u);
  assert.match(ollamaSource, /think:\s*chatThink/u);
  assert.match(ollamaSource, /\/api\/chat/u);
  assert.match(discussionSource, /structuredTransport:\s*"GENERATE"/u);
  assert.match(
    discussionSource,
    /PASO_11_DISCUSSION_LOCAL_GENERATE_COMPAT_V1/u,
  );
});

test("Punto 5 certifica guard, checkpoints y reanudación antes del proveedor final", async () => {
  const [executionSource, resumeTestSource] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
      "utf8",
    ),
    readFile("tests/ai-analysis/local-draft-resume.test.ts", "utf8"),
  ]);

  const guardIndex = executionSource.indexOf(
    "assertAiDocumentGenerationBoundary({",
  );
  const providerIndex = executionSource.indexOf(
    "const generated = await provider.generate({",
  );

  assert.ok(guardIndex >= 0);
  assert.ok(providerIndex > guardIndex);
  assert.match(executionSource, /prepareLocalDraftBlockResume/u);
  assert.match(executionSource, /resumeStageValues/u);
  assert.match(executionSource, /persistLocalDraftBlockCheckpoint/u);

  assert.match(
    resumeTestSource,
    /reanudar omite llamadas de los stage paths de un bloque COMPLETED/u,
  );
  assert.match(
    resumeTestSource,
    /un valor de checkpoint inválido se ignora y se regenera/u,
  );
});
