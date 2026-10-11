// LOCAL_ONLY_V2_03_TOKEN_BUDGET_SEGMENTATION
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { estimateAiPromptTokens } from "../../apps/ai-analysis-service/src/execution/ai-prompt-builder.js";
import { prepareLocalOnlyV2EvidenceInput } from "../../apps/ai-analysis-service/src/execution/local-only-v2-questionnaire-evidence.js";
import {
  LOCAL_ONLY_V2_DEFAULT_MAX_CHUNK_TOKENS,
  LOCAL_ONLY_V2_DEFAULT_TARGET_CHUNK_TOKENS,
  LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION,
  resolveLocalOnlyV2SegmentationBudget,
  segmentLocalOnlyV2PreparedEvidence,
  segmentLocalOnlyV2Source,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-segmentation.js";

const questionnaireSource = {
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceTitle: "Preguntas de análisis · RQ-2026-001234",
  snapshotText: [
    "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
    "Proyecto: RQ-2026-001234 · Proyecto genérico",
    "",
    "1. Contexto",
    "Pregunta: ¿Cuál es el problema?",
    "Origen seleccionado: Respuesta original",
    "Valoración: 8/10",
    "Respuesta: El proceso actual genera reprocesos.",
  ].join("\n"),
  position: 2,
};

test("Paso 3 usa presupuesto de tokens y mantiene cada fragmento lejos del contexto completo", () => {
  const budget = resolveLocalOnlyV2SegmentationBudget(131_072);

  assert.equal(
    budget.targetChunkTokens,
    LOCAL_ONLY_V2_DEFAULT_TARGET_CHUNK_TOKENS,
  );
  assert.equal(budget.maxChunkTokens, LOCAL_ONLY_V2_DEFAULT_MAX_CHUNK_TOKENS);
  assert.equal(budget.maxContextFraction, LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION);
  assert.ok(
    budget.maxChunkTokens / budget.contextTokens <=
      LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION,
  );
  assert.ok(budget.maxChunkTokens / budget.contextTokens < 0.03);
});

test("un contexto menor reduce automáticamente el máximo a 1/8 del contexto", () => {
  const budget = resolveLocalOnlyV2SegmentationBudget(8_192);

  assert.equal(budget.contextFractionCapTokens, 1_024);
  assert.equal(budget.maxChunkTokens, 1_024);
  assert.equal(budget.targetChunkTokens, 1_024);
  assert.equal(budget.maxChunkTokens / budget.contextTokens, 1 / 8);
});

test("la segmentación conserva exactamente el texto y prefiere límites semánticos", () => {
  const paragraph = (label: string) =>
    `${label}: ${"contenido funcional verificable. ".repeat(38)}\n\n`;
  const text = [
    paragraph("Párrafo 1"),
    paragraph("Párrafo 2"),
    paragraph("Párrafo 3"),
    paragraph("Párrafo 4"),
    paragraph("Párrafo 5"),
    paragraph("Párrafo 6"),
  ].join("");

  const source = {
    sourceId: "22222222-2222-4222-8222-222222222222",
    sourceTitle: "Fuente funcional",
    snapshotText: text,
    position: 1,
  };
  const budget = resolveLocalOnlyV2SegmentationBudget(8_192);
  const segments = segmentLocalOnlyV2Source(source, budget);

  assert.ok(segments.length > 1);
  assert.equal(segments.map((segment) => segment.text).join(""), text);
  assert.ok(
    segments.slice(0, -1).some((segment) => segment.boundary === "PARAGRAPH"),
  );

  for (const segment of segments) {
    assert.equal(segment.estimatedTokens, estimateAiPromptTokens(segment.text));
    assert.ok(segment.estimatedTokens <= budget.maxChunkTokens);
    assert.ok(segment.contextUsageRatio <= LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION);
  }
});

test("si no existe ningún límite semántico útil aplica corte duro sin superar el presupuesto", () => {
  const source = {
    sourceId: "33333333-3333-4333-8333-333333333333",
    sourceTitle: "Cadena continua",
    snapshotText: "x".repeat(20_000),
    position: 1,
  };
  const budget = resolveLocalOnlyV2SegmentationBudget(8_192, {
    targetChunkTokens: 600,
    maxChunkTokens: 900,
  });
  const segments = segmentLocalOnlyV2Source(source, budget);

  assert.ok(segments.length > 1);
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    source.snapshotText,
  );
  assert.ok(
    segments.slice(0, -1).every((segment) => segment.boundary === "HARD"),
  );
  assert.ok(
    segments.every(
      (segment) => segment.estimatedTokens <= budget.maxChunkTokens,
    ),
  );
});

test("el cuestionario obligatorio del Paso 2 llega segmentado y trazable al Paso 3", () => {
  const ordinarySource = {
    sourceId: "44444444-4444-4444-8444-444444444444",
    sourceTitle: "Documento de negocio",
    snapshotText: `${"Regla de negocio confirmada. ".repeat(500)}\n`,
    position: 1,
  };
  const prepared = prepareLocalOnlyV2EvidenceInput("LOCAL_ONLY", [
    ordinarySource,
    questionnaireSource,
  ]);
  const budget = resolveLocalOnlyV2SegmentationBudget(16_384, {
    targetChunkTokens: 700,
    maxChunkTokens: 1_000,
  });
  const segmented = segmentLocalOnlyV2PreparedEvidence(prepared, budget);

  assert.equal(segmented.pipelineId, "LOCAL_ONLY_V2");
  assert.equal(segmented.questionnaireSourceId, questionnaireSource.sourceId);
  assert.ok(segmented.questionnaireSegmentCount >= 1);
  assert.ok(
    segmented.segments
      .filter((segment) => segment.mandatoryQuestionnaireEvidence)
      .every((segment) => segment.sourceId === questionnaireSource.sourceId),
  );

  for (const source of [ordinarySource, questionnaireSource]) {
    const reconstructed = segmented.segments
      .filter((segment) => segment.sourceId === source.sourceId)
      .map((segment) => segment.text)
      .join("");
    assert.equal(reconstructed, source.snapshotText);
  }
});

test("Paso 3 es genérico y no se acopla al chunking histórico por caracteres", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-segmentation.ts",
    "utf8",
  );

  assert.doesNotMatch(production, /SOAT/iu);
  assert.doesNotMatch(production, /LOCAL_SOURCE_CHUNK_CHARACTERS/u);
  assert.doesNotMatch(production, /splitLocalSourceTextAdaptively/u);
  assert.match(production, /estimateAiPromptTokens/u);
  assert.match(production, /PARAGRAPH/u);
  assert.match(production, /SENTENCE/u);
  assert.match(production, /LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION/u);
});

test("presupuestos inválidos fallan antes de segmentar", () => {
  assert.throws(
    () => resolveLocalOnlyV2SegmentationBudget(1_023),
    /al menos 1\.024 tokens/u,
  );
  assert.throws(
    () =>
      resolveLocalOnlyV2SegmentationBudget(8_192, {
        targetChunkTokens: 1_100,
        maxChunkTokens: 900,
      }),
    /no puede superar maxChunkTokens/u,
  );
});
