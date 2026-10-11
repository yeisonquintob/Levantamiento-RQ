// LOCAL_ONLY_V2_05_DETERMINISTIC_NORMALIZER
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { LocalOnlyV2AtomicFinding } from "../../apps/ai-analysis-service/src/execution/local-only-v2-atomic-extraction.js";
import {
  localOnlyV2ExactDedupKey,
  normalizeLocalOnlyV2AtomicFindings,
  normalizeLocalOnlyV2DisplayText,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-normalizer.js";

function finding(
  overrides: Partial<LocalOnlyV2AtomicFinding> = {},
): LocalOnlyV2AtomicFinding {
  return {
    findingId: "source-a#0001@001",
    category: "businessRules",
    description: "La solicitud requiere aprobación del coordinador.",
    evidenceText: "La solicitud debe ser aprobada por el coordinador.",
    sourceId: "source-a",
    sourceTitle: "Documento A",
    sourcePosition: 1,
    segmentId: "source-a#0001",
    segmentIndex: 0,
    evidenceStartCharacter: 10,
    evidenceEndCharacter: 60,
    mandatoryQuestionnaireEvidence: false,
    ...overrides,
  };
}

test("Paso 5 normaliza Unicode y espacios sin reescribir semánticamente el texto", () => {
  assert.equal(
    normalizeLocalOnlyV2DisplayText("  Área\u00a0de   Servicio \n  Técnico  "),
    "Área de Servicio Técnico",
  );

  assert.equal(
    localOnlyV2ExactDedupKey(
      "businessRules",
      "  LA   SOLICITUD requiere aprobación. ",
    ),
    localOnlyV2ExactDedupKey(
      "businessRules",
      "la solicitud requiere aprobación.",
    ),
  );
});

test("duplicados exactos normalizados se fusionan y agregan trazabilidad", () => {
  const first = finding();
  const second = finding({
    findingId: "source-b#0003@002",
    description: "  LA SOLICITUD requiere aprobación del coordinador.  ",
    sourceId: "source-b",
    sourceTitle: "Documento B",
    sourcePosition: 2,
    segmentId: "source-b#0003",
    segmentIndex: 2,
    evidenceText: "Se requiere aprobación del coordinador.",
    evidenceStartCharacter: 200,
    evidenceEndCharacter: 241,
    mandatoryQuestionnaireEvidence: true,
  });

  const normalized = normalizeLocalOnlyV2AtomicFindings([second, first]);

  assert.equal(normalized.rawFindingCount, 2);
  assert.equal(normalized.canonicalFindingCount, 1);
  assert.equal(normalized.exactDuplicateCount, 1);
  assert.deepEqual(normalized.nonEmptyCategories, ["businessRules"]);

  const canonical = normalized.findings[0]!;
  assert.equal(canonical.sequence, 1);
  assert.equal(canonical.categorySequence, 1);
  assert.equal(canonical.category, "businessRules");
  assert.equal(canonical.occurrenceCount, 2);
  assert.deepEqual(canonical.sourceIds, ["source-a", "source-b"]);
  assert.deepEqual(canonical.segmentIds, ["source-a#0001", "source-b#0003"]);
  assert.equal(canonical.mandatoryQuestionnaireEvidence, true);
  assert.equal(canonical.occurrences.length, 2);
  assert.equal(canonical.occurrences[0]!.sourceId, "source-a");
  assert.equal(canonical.occurrences[1]!.sourceId, "source-b");
});

test("hallazgos parecidos pero no exactos NO se deduplican semánticamente", () => {
  const normalized = normalizeLocalOnlyV2AtomicFindings([
    finding({
      findingId: "a#0001@001",
      description: "La solicitud requiere aprobación del coordinador.",
    }),
    finding({
      findingId: "a#0001@002",
      description: "El coordinador debe autorizar cada solicitud.",
      evidenceStartCharacter: 70,
      evidenceEndCharacter: 120,
    }),
  ]);

  assert.equal(normalized.canonicalFindingCount, 2);
  assert.equal(normalized.exactDuplicateCount, 0);
});

test("el mismo texto en categorías distintas permanece separado", () => {
  const normalized = normalizeLocalOnlyV2AtomicFindings([
    finding({
      findingId: "a#0001@001",
      category: "risks",
      description: "Puede existir reproceso manual.",
    }),
    finding({
      findingId: "a#0001@002",
      category: "warnings",
      description: "Puede existir reproceso manual.",
      evidenceStartCharacter: 70,
      evidenceEndCharacter: 120,
    }),
  ]);

  assert.equal(normalized.canonicalFindingCount, 2);
  assert.deepEqual(normalized.nonEmptyCategories, ["risks", "warnings"]);
  assert.equal(normalized.findingsByCategory.risks.length, 1);
  assert.equal(normalized.findingsByCategory.warnings.length, 1);
});

test("el resultado es idéntico aunque cambie el orden de llegada", () => {
  const input = [
    finding({
      findingId: "z#0002@001",
      category: "pendingQuestions",
      description: "¿Quién aprueba una excepción?",
      sourceId: "z",
      sourceTitle: "Fuente Z",
      sourcePosition: 3,
      segmentId: "z#0002",
      segmentIndex: 1,
      evidenceText: "¿Quién aprueba una excepción?",
      evidenceStartCharacter: 300,
      evidenceEndCharacter: 331,
    }),
    finding({
      findingId: "a#0001@001",
      category: "actors",
      description: "Coordinador",
      sourceId: "a",
      sourceTitle: "Fuente A",
      sourcePosition: 1,
      segmentId: "a#0001",
      segmentIndex: 0,
      evidenceText: "coordinador",
      evidenceStartCharacter: 20,
      evidenceEndCharacter: 31,
    }),
    finding({
      findingId: "b#0001@001",
      category: "businessRules",
      description: "La solicitud requiere aprobación.",
      sourceId: "b",
      sourceTitle: "Fuente B",
      sourcePosition: 2,
      segmentId: "b#0001",
      segmentIndex: 0,
      evidenceText: "requiere aprobación",
      evidenceStartCharacter: 90,
      evidenceEndCharacter: 109,
      mandatoryQuestionnaireEvidence: true,
    }),
  ];

  const forward = normalizeLocalOnlyV2AtomicFindings(input);
  const reverse = normalizeLocalOnlyV2AtomicFindings([...input].reverse());

  assert.deepEqual(reverse, forward);
  assert.deepEqual(
    forward.findings.map((item) => item.sequence),
    [1, 2, 3],
  );
  assert.deepEqual(forward.nonEmptyCategories, [
    "actors",
    "businessRules",
    "pendingQuestions",
  ]);
});

test("IDs canónicos son determinísticos y no dependen del findingId temporal", () => {
  const left = normalizeLocalOnlyV2AtomicFindings([
    finding({ findingId: "temp-a#0001@001" }),
  ]);
  const right = normalizeLocalOnlyV2AtomicFindings([
    finding({ findingId: "temp-b#0009@008" }),
  ]);

  assert.equal(left.findings[0]!.canonicalId, right.findings[0]!.canonicalId);
  assert.match(left.findings[0]!.canonicalId, /^v2f_[0-9a-f]{20}$/u);
});

test("contradicciones y evidencia obligatoria del cuestionario se conservan", () => {
  const normalized = normalizeLocalOnlyV2AtomicFindings([
    finding({
      findingId: "discussion#0001@001",
      category: "contradictions",
      description:
        "Una respuesta indica aprobación manual y otra aprobación automática.",
      sourceId: "discussion",
      sourceTitle: "Preguntas de análisis · RQ-2026-000777",
      sourcePosition: 2,
      segmentId: "discussion#0001",
      evidenceText: "aprobación manual",
      evidenceStartCharacter: 150,
      evidenceEndCharacter: 167,
      mandatoryQuestionnaireEvidence: true,
    }),
  ]);

  assert.equal(normalized.findingsByCategory.contradictions.length, 1);
  assert.equal(
    normalized.findingsByCategory.contradictions[0]!
      .mandatoryQuestionnaireEvidence,
    true,
  );
  assert.equal(
    normalized.findingsByCategory.contradictions[0]!.sourceIds[0],
    "discussion",
  );
});

test("findingId duplicado se rechaza para no ocultar una colisión de trazabilidad", () => {
  assert.throws(
    () =>
      normalizeLocalOnlyV2AtomicFindings([
        finding({ findingId: "duplicate#0001@001" }),
        finding({
          findingId: "duplicate#0001@001",
          evidenceStartCharacter: 90,
          evidenceEndCharacter: 140,
        }),
      ]),
    /findingId duplicado/u,
  );
});

test("Paso 5 es puramente determinístico y no incorpora proveedores ni prompts de IA", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-normalizer.ts",
    "utf8",
  );

  assert.doesNotMatch(production, /Ollama/u);
  assert.doesNotMatch(production, /OpenAi/u);
  assert.doesNotMatch(production, /\.generate\(/u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /createHash/u);
  assert.match(production, /exactDuplicateCount/u);
  assert.match(production, /findingsByCategory/u);
});
