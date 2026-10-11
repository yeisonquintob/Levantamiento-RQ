import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  compactLocalDraftUserPrompt,
  localDraftEvidenceCategories,
} from "../../apps/ai-analysis-service/src/execution/ollama-draft.provider";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";
const E = "55555555-5555-4555-8555-555555555555";

function finding(description: string, sourceId: string) {
  return { description, sourceIds: [sourceId] };
}

function prompt(): string {
  const snapshot = {
    schemaVersion: "1.1.0",
    projectId: "99999999-9999-4999-8999-999999999999",
    sourceIds: [A, B, C, D, E],
    findings: {
      actors: [finding("ACTOR_A", A)],
      problems: [finding("PROBLEM_A", A)],
      needs: [finding("NEED_B", B)],
      facts: [finding("FACT_A", A)],
      currentProcesses: [finding("CURRENT_D", D)],
      expectedProcesses: [finding("EXPECTED_D", D)],
      functionalRequirements: [finding("FUNCTIONAL_B", B)],
      nonFunctionalRequirements: [finding("NON_FUNCTIONAL_C", C)],
      businessRules: [finding("RULE_B", B)],
      entities: [finding("ENTITY_C", C)],
      integrations: [finding("INTEGRATION_C", C)],
      risks: [finding("RISK_B", B)],
      decisions: [finding("DECISION_A", A)],
      contradictions: [finding("CONTRADICTION_E", E)],
      pendingQuestions: [finding("PENDING_E", E)],
      warnings: [finding("WARNING_E", E)],
    },
  };

  return [
    "SOLICITUD DE CAMBIO CONFIABLE DEL USUARIO",
    "Generar documento.",
    "DOCUMENTO_Y_PLANTILLA",
    "PLANTILLA_CONTROLADA",
    "VERSION_ACTUAL",
    JSON.stringify({ sections: [] }),
    "PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL",
    "Este snapshot es evidencia consolidada.",
    JSON.stringify(snapshot),
    "FUNCTIONAL_COVERAGE_MANIFEST_V1",
    JSON.stringify([
      { code: "FN-001", description: "FUNCTIONAL_B", sourceIds: [B] },
    ]),
    "MANIFIESTO_ESTRUCTURA_EXPLICITA",
    JSON.stringify([{ kind: "EPIC", title: "EPIC_A" }]),
    "MANIFIESTO_ALINEACION_HUP_HUF",
    JSON.stringify([{ title: "HU_A" }]),
    "Devuelve ahora únicamente el JSON solicitado, sin Markdown ni explicación externa.",
  ].join("\n");
}

function stageSnapshot(compact: string): Record<string, any> {
  const match =
    /PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL_RELEVANTE\n(\{[^\n]+\})/u.exec(compact);
  assert.ok(match, "Debe existir el snapshot relevante del stage.");
  return JSON.parse(match[1]) as Record<string, any>;
}

test("Paso 7 V2: functionalUserStories usa categorías propias y guardas transversales", () => {
  const categories = localDraftEvidenceCategories(
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
    assert.ok(categories.includes(category as never), category);
  }

  assert.equal(categories.includes("currentProcesses"), false);
  assert.equal(categories.includes("entities"), false);
  assert.equal(categories.includes("nonFunctionalRequirements"), false);
});

test("Paso 7 V2: entityRelationship conserva toda fuente realmente usada por su evidencia", () => {
  const compact = compactLocalDraftUserPrompt(
    prompt(),
    "structuredAnalysis.entityRelationship",
  );
  const snapshot = stageSnapshot(compact);

  // facts -> A
  assert.match(compact, /FACT_A/u);
  // businessRules -> B
  assert.match(compact, /RULE_B/u);
  // entities + integrations -> C
  assert.match(compact, /ENTITY_C/u);
  assert.match(compact, /INTEGRATION_C/u);
  // guardas transversales -> E
  assert.match(compact, /CONTRADICTION_E/u);
  assert.match(compact, /PENDING_E/u);
  assert.match(compact, /WARNING_E/u);

  // Categorías no seleccionadas no llegan.
  assert.doesNotMatch(compact, /CURRENT_D/u);
  assert.doesNotMatch(compact, /EXPECTED_D/u);
  assert.doesNotMatch(compact, /FUNCTIONAL_B/u);
  assert.doesNotMatch(compact, /NON_FUNCTIONAL_C/u);

  // CORRECCIÓN V2:
  // A sí debe conservarse porque FACT_A pertenece a A.
  assert.deepEqual(snapshot.sourceIds, [A, B, C, E]);
});

test("Paso 7 V2: pendingQuestions raíz deja de recibir todas las categorías", () => {
  const compact = compactLocalDraftUserPrompt(prompt(), "pendingQuestions");
  const snapshot = stageSnapshot(compact);

  assert.match(compact, /PENDING_E/u);
  assert.match(compact, /CONTRADICTION_E/u);
  assert.match(compact, /WARNING_E/u);
  assert.match(compact, /FACT_A/u);
  assert.match(compact, /RISK_B/u);
  assert.match(compact, /DECISION_A/u);

  assert.doesNotMatch(compact, /FUNCTIONAL_B/u);
  assert.doesNotMatch(compact, /NON_FUNCTIONAL_C/u);
  assert.doesNotMatch(compact, /ENTITY_C/u);
  assert.doesNotMatch(compact, /CURRENT_D/u);

  assert.deepEqual(snapshot.sourceIds, [A, B, E]);
});

test("Paso 7 V2: functionalUserStories conserva manifiestos estructurales completos", () => {
  const compact = compactLocalDraftUserPrompt(
    prompt(),
    "structuredAnalysis.functionalUserStories[0]",
  );

  assert.match(compact, /FUNCTIONAL_COVERAGE_MANIFEST_V1/u);
  assert.match(compact, /MANIFIESTO_ESTRUCTURA_EXPLICITA/u);
  assert.match(compact, /MANIFIESTO_ALINEACION_HUP_HUF/u);
  assert.match(compact, /FN-001/u);
  assert.match(compact, /EPIC_A/u);
  assert.match(compact, /HU_A/u);
});

test("Paso 7 V2: un stage desconocido conserva fail-safe con todas las categorías", () => {
  const categories = localDraftEvidenceCategories("futureStage.unknown");
  assert.equal(categories.length, 16);

  const compact = compactLocalDraftUserPrompt(prompt(), "futureStage.unknown");
  assert.match(compact, /ACTOR_A/u);
  assert.match(compact, /CURRENT_D/u);
  assert.match(compact, /FUNCTIONAL_B/u);
  assert.match(compact, /NON_FUNCTIONAL_C/u);
  assert.match(compact, /ENTITY_C/u);
  assert.match(compact, /CONTRADICTION_E/u);
});

test("Paso 7 V2: sourceIds son exactamente la unión de fuentes citadas por findings incluidos", () => {
  const compact = compactLocalDraftUserPrompt(
    prompt(),
    "structuredAnalysis.entityRelationship",
  );
  const snapshot = stageSnapshot(compact);

  const used = new Set<string>();
  for (const findings of Object.values(snapshot.findings ?? {})) {
    if (!Array.isArray(findings)) continue;
    for (const candidate of findings) {
      if (!candidate || typeof candidate !== "object") continue;
      const ids = (candidate as { sourceIds?: unknown }).sourceIds;
      if (!Array.isArray(ids)) continue;
      for (const sourceId of ids) {
        if (typeof sourceId === "string") used.add(sourceId);
      }
    }
  }

  assert.deepEqual(snapshot.sourceIds, [A, B, C, E]);
  assert.deepEqual([...used], [A, B, C, E]);
});

test("Paso 7 V2: perfiles, límites y aislamiento de otros modos permanecen intactos", async () => {
  const [provider, pipeline, execution, client, discussion] = await Promise.all(
    [
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
    ],
  );

  assert.match(provider, /PASO_7_CONTEXTO_ESPECIALIZADO_POR_PUNTO_V2/u);
  assert.match(provider, /profile:\s*"LOCAL_DOCUMENT"/u);
  assert.match(provider, /LOCAL_DRAFT_OUTPUT_CAP = 8192/u);
  assert.match(client, /OLLAMA_RUNTIME_CONTEXT_CAP = 65_536/u);
  assert.match(client, /configuredOutputTokens = 8192/u);

  assert.match(
    pipeline,
    /analysisProfile === "LOCAL_EXTRACT"[\s\S]*?local-only-extract-think-false-v1\+compact-prompt-v1/u,
  );
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
