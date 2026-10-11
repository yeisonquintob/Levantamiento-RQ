import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAiAnalysisPromptFromKnowledgeSnapshot,
  buildHybridCloudPromptFromKnowledgeSnapshot,
  buildLocalDocumentKnowledgeSnapshot,
  buildLocalDocumentPromptFromKnowledgeSnapshot,
  consolidateLocalAnalyses,
  verifyLocalDocumentKnowledgeSnapshot,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service";
import {
  LOCAL_AI_CATEGORIES,
  LOCAL_AI_SCHEMA_VERSION,
  type LocalAiCategory,
  type LocalAiFinding,
  type LocalSourceAnalysis,
} from "../../apps/ai-analysis-service/src/local-ai/local-ai-output";
import { LocalAiError } from "../../apps/ai-analysis-service/src/local-ai/ollama.client";

const projectId = "33333333-3333-4333-8333-333333333333";
const sourceA = "11111111-1111-4111-8111-111111111111";
const sourceB = "22222222-2222-4222-8222-222222222222";

function finding(description: string, sourceId: string): LocalAiFinding {
  return { description, sourceIds: [sourceId] };
}

function analysis(
  sourceId: string,
  overrides: Partial<Record<LocalAiCategory, readonly LocalAiFinding[]>> = {},
): LocalSourceAnalysis {
  const categories = Object.fromEntries(
    LOCAL_AI_CATEGORIES.map((category) => [
      category,
      overrides[category] ?? [],
    ]),
  ) as Record<LocalAiCategory, readonly LocalAiFinding[]>;

  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    sourceId,
    summary: "Resumen",
    ...categories,
  };
}

function snapshot() {
  return consolidateLocalAnalyses(
    projectId,
    [
      analysis(sourceA, {
        actors: [finding("Coordinador de taller", sourceA)],
        facts: [
          finding("OBJETIVO_GENERAL: Reducir el tiempo de respuesta", sourceA),
        ],
        functionalRequirements: [
          finding("Registrar solicitud de SOAT", sourceA),
        ],
        contradictions: [
          finding("El coordinador aprueba la excepción", sourceA),
        ],
      }),
      analysis(sourceB, {
        functionalRequirements: [finding("Validar vigencia del SOAT", sourceB)],
        contradictions: [
          finding("El jefe de taller aprueba la excepción", sourceB),
        ],
        pendingQuestions: [
          finding("¿Quién autoriza una excepción definitiva?", sourceB),
        ],
      }),
    ],
    20_000,
  );
}

test("Paso 6: la vista documental elimina métricas pero conserva evidencia completa", () => {
  const full = snapshot();
  const compact = buildLocalDocumentKnowledgeSnapshot(full);
  const verification = verifyLocalDocumentKnowledgeSnapshot(full, compact);

  assert.equal(verification.version, "LOCAL_DOCUMENT_SNAPSHOT_VERIFY_V1");
  assert.equal(verification.sourceCoverage, 100);
  assert.equal(
    verification.findingCount,
    LOCAL_AI_CATEGORIES.reduce(
      (total, category) => total + full.findings[category].length,
      0,
    ),
  );
  assert.match(verification.evidenceFingerprint, /^[a-f0-9]{64}$/u);

  assert.deepEqual(compact.sourceIds, full.sourceIds);
  assert.deepEqual(
    compact.findings.functionalRequirements,
    full.findings.functionalRequirements,
  );
  assert.deepEqual(
    compact.findings.contradictions,
    full.findings.contradictions,
  );

  const json = JSON.stringify(compact);
  assert.doesNotMatch(json, /"metrics":/u);
  assert.doesNotMatch(json, /"originalCharacters":/u);
  assert.doesNotMatch(json, /"estimatedOriginalTokens":/u);
  assert.doesNotMatch(json, /"analysisCharacters":/u);
  assert.doesNotMatch(json, /"estimatedAnalysisTokens":/u);
  assert.doesNotMatch(json, /"snapshotCharacters":/u);
  assert.doesNotMatch(json, /"estimatedSnapshotTokens":/u);
  assert.doesNotMatch(json, /"reductionPercentage":/u);
  assert.ok(json.length < JSON.stringify(full).length);
});

test("Paso 6: una pérdida de evidencia falla cerrado antes de generación", () => {
  const full = snapshot();
  const compact = buildLocalDocumentKnowledgeSnapshot(full);
  const corrupted = {
    ...compact,
    findings: {
      ...compact.findings,
      functionalRequirements: [],
    },
  };

  assert.throws(
    () => verifyLocalDocumentKnowledgeSnapshot(full, corrupted),
    (error: unknown) =>
      error instanceof LocalAiError &&
      error.code === "LOCAL_DOCUMENT_SNAPSHOT_VERIFY_FAILED",
  );
});

test("Paso 6: el prompt LOCAL_ONLY es menor y mantiene manifests y sourceIds", () => {
  const full = snapshot();
  const basePrompt = [
    "SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO",
    "Generar documento.",
    "FUENTES_NO_CONFIABLES",
    "CONTENIDO ORIGINAL QUE NO DEBE LLEGAR",
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    JSON.stringify([{ kind: "EPIC", code: "EP-001", title: "SOAT" }]),
  ].join("\n");

  const previous = buildAiAnalysisPromptFromKnowledgeSnapshot(basePrompt, full);
  const localOnly = buildLocalDocumentPromptFromKnowledgeSnapshot(
    basePrompt,
    full,
  );

  assert.ok(localOnly.length < previous.length);
  assert.match(localOnly, /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL/u);
  assert.match(localOnly, /FUNCTIONAL_COVERAGE_MANIFEST_V1/u);
  assert.match(localOnly, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
  assert.match(localOnly, /Registrar solicitud de SOAT/u);
  assert.match(localOnly, /Validar vigencia del SOAT/u);
  assert.match(localOnly, /El coordinador aprueba la excepción/u);
  assert.match(localOnly, /El jefe de taller aprueba la excepción/u);
  assert.match(localOnly, new RegExp(sourceA, "u"));
  assert.match(localOnly, new RegExp(sourceB, "u"));
  assert.doesNotMatch(localOnly, /CONTENIDO ORIGINAL QUE NO DEBE LLEGAR/u);
  assert.doesNotMatch(
    localOnly.match(
      /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL[\s\S]*?FUNCTIONAL_COVERAGE_MANIFEST_V1/u,
    )?.[0] ?? "",
    /"metrics":/u,
  );

  // El builder histórico sigue completo para LOCAL_CLOUD.
  assert.match(
    previous.match(
      /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL[\s\S]*?FUNCTIONAL_COVERAGE_MANIFEST_V1/u,
    )?.[0] ?? "",
    /"metrics":/u,
  );
});

test("LOCAL_CLOUD envía un handoff compacto sin duplicar requisitos funcionales", () => {
  const full = snapshot();
  const basePrompt = [
    "INSTRUCCIONES_CONFIABLES",
    "FUENTES_NO_CONFIABLES",
    "CONTENIDO ORIGINAL QUE NO DEBE LLEGAR ".repeat(100),
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    "EP-001 | SOAT",
  ].join("\n");
  const fullPrompt = buildAiAnalysisPromptFromKnowledgeSnapshot(
    basePrompt,
    full,
  );
  const hybridPrompt = buildHybridCloudPromptFromKnowledgeSnapshot(
    basePrompt,
    full,
  );

  assert.ok(hybridPrompt.length < fullPrompt.length);
  assert.doesNotMatch(hybridPrompt, /CONTENIDO ORIGINAL QUE NO DEBE LLEGAR/u);
  assert.doesNotMatch(hybridPrompt, /"metrics":/u);
  assert.doesNotMatch(hybridPrompt, /"estimatedOriginalTokens":/u);
  assert.match(hybridPrompt, /FUNCTIONAL_COVERAGE_MANIFEST_V1/u);
  assert.match(hybridPrompt, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
  assert.equal(hybridPrompt.match(/Registrar solicitud de SOAT/gu)?.length, 1);
  assert.equal(hybridPrompt.match(/Validar vigencia del SOAT/gu)?.length, 1);
  assert.match(hybridPrompt, /El coordinador aprueba la excepción/u);
  assert.match(hybridPrompt, new RegExp(sourceA, "u"));
  assert.match(hybridPrompt, new RegExp(sourceB, "u"));
});

test("Paso 6: execution selecciona el compacto correspondiente a cada modo local", async () => {
  const execution = await readFile(
    "apps/ai-analysis-service/src/execution/ai-analysis-execution.service.ts",
    "utf8",
  );

  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY"[\s\S]*?\? buildLocalDocumentPromptFromKnowledgeSnapshot\([\s\S]*?: buildHybridCloudPromptFromKnowledgeSnapshot\(/u,
  );
  assert.match(
    execution,
    /generationMode === "LOCAL_ONLY" \|\| generationMode === "LOCAL_CLOUD"\s*\?\s*"LOCAL_EXTRACT"\s*:\s*"DEFAULT"/u,
  );
});

test("Paso 6: LOCAL_CLOUD, CLOUD_ONLY, perfiles y límites permanecen aislados", async () => {
  const [pipeline, client, draft, discussion] = await Promise.all([
    readFile(
      "apps/ai-analysis-service/src/local-ai/local-ai-pipeline.service.ts",
      "utf8",
    ),
    readFile("apps/ai-analysis-service/src/local-ai/ollama.client.ts", "utf8"),
    readFile(
      "apps/ai-analysis-service/src/execution/ollama-draft.provider.ts",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/discussion/requirement-discussion.service.ts",
      "utf8",
    ),
  ]);

  assert.match(
    pipeline,
    /analysisProfile === "LOCAL_EXTRACT"[\s\S]*?local-only-extract-think-false-v1\+compact-prompt-v1/u,
  );
  assert.match(
    pipeline,
    /export function buildAiAnalysisPromptFromKnowledgeSnapshot\([\s\S]*?JSON\.stringify\(snapshot\)/u,
  );
  assert.match(
    client,
    /LocalAiExecutionProfile = "LOCAL_EXTRACT" \| "LOCAL_DOCUMENT"/u,
  );
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(client, /configuredOutputTokens = 8192/u);
  assert.match(draft, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
  assert.match(discussion, /structuredTransport:\s*"GENERATE"/u);
});
