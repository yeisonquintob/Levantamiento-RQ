// LOCAL_ONLY_V2_07_CANONICAL_KNOWLEDGE_INDEX
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { LocalOnlyV2AtomicFinding } from "../../apps/ai-analysis-service/src/execution/local-only-v2-atomic-extraction.js";
import {
  buildLocalOnlyV2KnowledgeIndex,
  LOCAL_ONLY_V2_KNOWLEDGE_INDEX_SCHEMA_VERSION,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-knowledge-index.js";
import { normalizeLocalOnlyV2AtomicFindings } from "../../apps/ai-analysis-service/src/execution/local-only-v2-normalizer.js";
import type {
  LocalOnlyV2Segment,
  LocalOnlyV2SegmentedEvidenceInput,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-segmentation.js";

function segment(
  sourceId: string,
  sourceTitle: string,
  sourcePosition: number,
  segmentIndex: number,
  text: string,
  questionnaire = false,
): LocalOnlyV2Segment {
  const startCharacter = segmentIndex * 1_000;
  return {
    segmentId: `${sourceId}#${String(segmentIndex + 1).padStart(4, "0")}`,
    sourceId,
    sourceTitle,
    sourcePosition,
    segmentIndex,
    startCharacter,
    endCharacter: startCharacter + text.length,
    text,
    estimatedTokens: Math.ceil(text.length / 4),
    contextUsageRatio: Math.ceil(text.length / 4) / 16_384,
    boundary: "END",
    mandatoryQuestionnaireEvidence: questionnaire,
  };
}

function atomicFinding(
  currentSegment: LocalOnlyV2Segment,
  index: number,
  category: LocalOnlyV2AtomicFinding["category"],
  description: string,
  evidenceText: string,
): LocalOnlyV2AtomicFinding {
  const relativeStart = currentSegment.text.indexOf(evidenceText);
  assert.ok(relativeStart >= 0, "fixture debe contener evidenceText");

  return {
    findingId: `${currentSegment.segmentId}@${String(index + 1).padStart(3, "0")}`,
    category,
    description,
    evidenceText,
    sourceId: currentSegment.sourceId,
    sourceTitle: currentSegment.sourceTitle,
    sourcePosition: currentSegment.sourcePosition,
    segmentId: currentSegment.segmentId,
    segmentIndex: currentSegment.segmentIndex,
    evidenceStartCharacter: currentSegment.startCharacter + relativeStart,
    evidenceEndCharacter:
      currentSegment.startCharacter + relativeStart + evidenceText.length,
    mandatoryQuestionnaireEvidence:
      currentSegment.mandatoryQuestionnaireEvidence,
  };
}

function fixture(): {
  segmented: LocalOnlyV2SegmentedEvidenceInput;
  findings: readonly LocalOnlyV2AtomicFinding[];
} {
  const sourceA1 = segment(
    "source-a",
    "Documento funcional",
    1,
    0,
    "El analista registra la solicitud. La solicitud requiere aprobación.",
  );
  const sourceA2 = segment(
    "source-a",
    "Documento funcional",
    1,
    1,
    "El sistema conserva trazabilidad del cambio.",
  );
  const questionnaire = segment(
    "discussion",
    "Preguntas de análisis · RQ-2026-000888",
    2,
    0,
    "Respuesta: El proceso manual genera reprocesos.",
    true,
  );
  const sourceWithoutFindings = segment(
    "source-c",
    "Anexo sin hallazgos",
    3,
    0,
    "Contenido informativo sin hallazgo atómico en esta prueba.",
  );

  return {
    segmented: {
      pipelineId: "LOCAL_ONLY_V2",
      budget: {
        contextTokens: 16_384,
        targetChunkTokens: 700,
        maxChunkTokens: 1_000,
        contextFractionCapTokens: 2_048,
        maxContextFraction: 1 / 8,
      },
      segments: [sourceA1, sourceA2, questionnaire, sourceWithoutFindings],
      questionnaireSourceId: "discussion",
      questionnaireSegmentCount: 1,
    },
    findings: [
      atomicFinding(sourceA1, 0, "actors", "Analista", "analista"),
      atomicFinding(
        sourceA1,
        1,
        "businessRules",
        "La solicitud requiere aprobación.",
        "La solicitud requiere aprobación.",
      ),
      atomicFinding(
        sourceA2,
        0,
        "facts",
        "El sistema conserva trazabilidad del cambio.",
        "El sistema conserva trazabilidad del cambio.",
      ),
      atomicFinding(
        questionnaire,
        0,
        "problems",
        "El proceso manual genera reprocesos.",
        "El proceso manual genera reprocesos.",
      ),
    ],
  };
}

test("Paso 7 crea un índice canónico reutilizable sin copiar textos completos de segmentos", () => {
  const { segmented, findings } = fixture();
  const normalized = normalizeLocalOnlyV2AtomicFindings(findings);
  const index = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalized,
  );

  assert.equal(index.pipelineId, "LOCAL_ONLY_V2");
  assert.equal(
    index.schemaVersion,
    LOCAL_ONLY_V2_KNOWLEDGE_INDEX_SCHEMA_VERSION,
  );
  assert.equal(index.projectId, "project-123");
  assert.match(index.fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(index.sources.length, 3);
  assert.equal(index.segments.length, 4);
  assert.equal(index.findings.length, 4);

  const serialized = JSON.stringify(index);
  assert.doesNotMatch(
    serialized,
    /Contenido informativo sin hallazgo atómico en esta prueba\./u,
  );
});

test("el índice conserva fuentes y segmentos aunque no tengan hallazgos", () => {
  const { segmented, findings } = fixture();
  const index = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizeLocalOnlyV2AtomicFindings(findings),
  );

  const sourceC = index.sources.find(
    (source) => source.sourceId === "source-c",
  );
  assert.ok(sourceC);
  assert.deepEqual(sourceC.findingIds, []);
  assert.equal(index.findingIdsBySource["source-c"]?.length, 0);

  const sourceCSegment = index.segments.find(
    (item) => item.sourceId === "source-c",
  );
  assert.ok(sourceCSegment);
  assert.deepEqual(sourceCSegment.findingIds, []);
});

test("los índices invertidos recuperan hallazgos por categoría, fuente y segmento", () => {
  const { segmented, findings } = fixture();
  const index = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizeLocalOnlyV2AtomicFindings(findings),
  );

  assert.equal(index.findingIdsByCategory.actors.length, 1);
  assert.equal(index.findingIdsByCategory.businessRules.length, 1);
  assert.equal(index.findingIdsByCategory.problems.length, 1);
  assert.equal(index.findingIdsBySource["source-a"]?.length, 3);
  assert.equal(index.findingIdsBySource.discussion?.length, 1);

  const firstSegmentId = segmented.segments[0]!.segmentId;
  assert.equal(index.findingIdsBySegment[firstSegmentId]?.length, 2);
});

test("la evidencia obligatoria del cuestionario queda identificada de extremo a extremo", () => {
  const { segmented, findings } = fixture();
  const index = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizeLocalOnlyV2AtomicFindings(findings),
  );

  const discussion = index.sources.find(
    (source) => source.sourceId === "discussion",
  );
  assert.ok(discussion?.mandatoryQuestionnaireEvidence);
  assert.equal(index.questionnaireSourceId, "discussion");
  assert.equal(index.metrics.questionnaireSegmentCount, 1);
  assert.equal(index.metrics.questionnaireFindingCount, 1);
  assert.equal(index.questionnaireFindingIds.length, 1);
});

test("las métricas distinguen cobertura de fuentes y segmentos", () => {
  const { segmented, findings } = fixture();
  const index = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizeLocalOnlyV2AtomicFindings(findings),
  );

  assert.equal(index.metrics.sourceCount, 3);
  assert.equal(index.metrics.segmentCount, 4);
  assert.equal(index.metrics.sourcesWithFindings, 2);
  assert.equal(index.metrics.sourceCoverageRatio, 2 / 3);
  assert.equal(index.metrics.segmentsWithFindings, 3);
  assert.equal(index.metrics.segmentCoverageRatio, 3 / 4);
  assert.equal(index.metrics.canonicalFindingCount, 4);
  assert.equal(index.metrics.occurrenceCount, 4);
});

test("el fingerprint es determinístico para el mismo conocimiento", () => {
  const { segmented, findings } = fixture();
  const normalizedForward = normalizeLocalOnlyV2AtomicFindings(findings);
  const normalizedReverse = normalizeLocalOnlyV2AtomicFindings(
    [...findings].reverse(),
  );

  const forward = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizedForward,
  );
  const reverse = buildLocalOnlyV2KnowledgeIndex(
    "project-123",
    segmented,
    normalizedReverse,
  );

  assert.equal(reverse.fingerprint, forward.fingerprint);
  assert.deepEqual(reverse, forward);
});

test("una referencia a segmento inexistente se rechaza como trazabilidad huérfana", () => {
  const { segmented, findings } = fixture();
  const badFinding = {
    ...findings[0]!,
    segmentId: "source-a#9999",
  };
  const normalized = normalizeLocalOnlyV2AtomicFindings([
    badFinding,
    ...findings.slice(1),
  ]);

  assert.throws(
    () => buildLocalOnlyV2KnowledgeIndex("project-123", segmented, normalized),
    /segmentId huérfano/u,
  );
});

test("offsets que no corresponden a evidenceText se rechazan", () => {
  const { segmented, findings } = fixture();
  const badFinding = {
    ...findings[0]!,
    evidenceStartCharacter: findings[0]!.evidenceStartCharacter + 1,
    evidenceEndCharacter: findings[0]!.evidenceEndCharacter + 1,
  };
  const normalized = normalizeLocalOnlyV2AtomicFindings([
    badFinding,
    ...findings.slice(1),
  ]);

  assert.throws(
    () => buildLocalOnlyV2KnowledgeIndex("project-123", segmented, normalized),
    /evidencia que no coincide con el segmento/u,
  );
});

test("una marca de cuestionario aplicada a otra fuente se rechaza", () => {
  const { segmented, findings } = fixture();
  // Corrompe de forma coherente TODA una fuente que no es el cuestionario.
  // Así este test alcanza exactamente la frontera que pretende verificar:
  // una fuente equivocada marcada como cuestionario, sin disparar antes la
  // validación distinta de "marcación inconsistente dentro de una fuente".
  const corruptedSegments = segmented.segments.map((item) =>
    item.sourceId === "source-a"
      ? { ...item, mandatoryQuestionnaireEvidence: true }
      : item,
  );

  assert.throws(
    () =>
      buildLocalOnlyV2KnowledgeIndex(
        "project-123",
        {
          ...segmented,
          segments: corruptedSegments,
        },
        normalizeLocalOnlyV2AtomicFindings(findings),
      ),
    /marca de cuestionario inválida/u,
  );
});

test("Paso 7 es determinístico y no depende de IA, TypeORM ni SOAT", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-knowledge-index.ts",
    "utf8",
  );

  assert.doesNotMatch(production, /Ollama/u);
  assert.doesNotMatch(production, /OpenAi/u);
  assert.doesNotMatch(production, /typeorm/iu);
  assert.doesNotMatch(production, /Repository</u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /createHash/u);
  assert.match(production, /findingIdsByCategory/u);
  assert.match(production, /findingIdsBySource/u);
  assert.match(production, /findingIdsBySegment/u);
});
