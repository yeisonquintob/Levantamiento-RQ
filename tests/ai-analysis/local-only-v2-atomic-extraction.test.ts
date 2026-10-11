// LOCAL_ONLY_V2_04_ATOMIC_EXTRACTION
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LOCAL_AI_CATEGORIES } from "../../apps/ai-analysis-service/src/local-ai/local-ai-output.js";
import { prepareLocalOnlyV2EvidenceInput } from "../../apps/ai-analysis-service/src/execution/local-only-v2-questionnaire-evidence.js";
import {
  resolveLocalOnlyV2SegmentationBudget,
  segmentLocalOnlyV2PreparedEvidence,
  type LocalOnlyV2Segment,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-segmentation.js";
import {
  buildLocalOnlyV2AtomicExtractionPrompt,
  buildLocalOnlyV2AtomicExtractionSchema,
  createLocalOnlyV2AtomicExtractionTasks,
  LOCAL_ONLY_V2_ATOMIC_CATEGORIES,
  LOCAL_ONLY_V2_ATOMIC_DESCRIPTION_MAX_CHARACTERS,
  LOCAL_ONLY_V2_ATOMIC_EVIDENCE_MAX_CHARACTERS,
  LOCAL_ONLY_V2_ATOMIC_MAX_FINDINGS_PER_SEGMENT,
  LOCAL_ONLY_V2_ATOMIC_OUTPUT_MAX_TOKENS,
  LOCAL_ONLY_V2_ATOMIC_OUTPUT_TARGET_TOKENS,
  parseLocalOnlyV2AtomicExtraction,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-atomic-extraction.js";

const segment: LocalOnlyV2Segment = {
  segmentId: "22222222-2222-4222-8222-222222222222#0001",
  sourceId: "22222222-2222-4222-8222-222222222222",
  sourceTitle: "Documento funcional",
  sourcePosition: 1,
  segmentIndex: 0,
  startCharacter: 100,
  endCharacter: 280,
  text: [
    "El analista registra una solicitud con fecha y solicitante.",
    "La solicitud debe ser aprobada por el coordinador.",
    "Pregunta pendiente: ¿quién puede aprobar una excepción?",
  ].join("\n"),
  estimatedTokens: 45,
  contextUsageRatio: 45 / 8_192,
  boundary: "END",
  mandatoryQuestionnaireEvidence: false,
};

test("Paso 4 adapta la extracción atómica a las 16 categorías reales actuales", () => {
  assert.deepEqual(
    [...LOCAL_ONLY_V2_ATOMIC_CATEGORIES],
    [...LOCAL_AI_CATEGORIES],
  );
  assert.equal(LOCAL_ONLY_V2_ATOMIC_CATEGORIES.length, 16);
});

test("el schema atómico es compacto y no pide summary, sourceIds ni arreglos por categoría", () => {
  const schema = buildLocalOnlyV2AtomicExtractionSchema();
  const serialized = JSON.stringify(schema);

  assert.match(serialized, /"findings"/u);
  assert.match(
    serialized,
    new RegExp(
      `"maxItems":${LOCAL_ONLY_V2_ATOMIC_MAX_FINDINGS_PER_SEGMENT}`,
      "u",
    ),
  );
  assert.doesNotMatch(serialized, /"summary"/u);
  assert.doesNotMatch(serialized, /"sourceIds"/u);
  assert.doesNotMatch(serialized, /"schemaVersion"/u);
});

test("el prompt procesa un solo fragmento y exige evidencia literal sin hardcodear SOAT", () => {
  const prompt = buildLocalOnlyV2AtomicExtractionPrompt(segment);

  assert.match(prompt, /EVIDENCIA ATÓMICA/u);
  assert.match(prompt, /UNA sola afirmación/u);
  assert.match(prompt, /evidenceText debe copiar literalmente/u);
  assert.match(
    prompt,
    new RegExp(
      `description debe tener máximo ${LOCAL_ONLY_V2_ATOMIC_DESCRIPTION_MAX_CHARACTERS} caracteres`,
      "u",
    ),
  );
  assert.match(
    prompt,
    new RegExp(
      `evidenceText máximo ${LOCAL_ONLY_V2_ATOMIC_EVIDENCE_MAX_CHARACTERS} caracteres`,
      "u",
    ),
  );
  assert.match(prompt, /FRAGMENTO_NO_CONFIABLE/u);
  assert.match(prompt, /functionalRequirements/u);
  assert.match(prompt, /pendingQuestions/u);
  assert.doesNotMatch(prompt, /SOAT/iu);
  assert.doesNotMatch(prompt, /8192/u);
});

test("el parser agrega trazabilidad determinística y offsets a evidencia válida", () => {
  const evidenceText = "La solicitud debe ser aprobada por el coordinador.";
  const result = parseLocalOnlyV2AtomicExtraction(
    {
      findings: [
        {
          category: "businessRules",
          description: "La solicitud requiere aprobación del coordinador.",
          evidenceText,
        },
      ],
    },
    segment,
  );

  assert.equal(result.length, 1);
  const finding = result[0]!;
  assert.equal(
    finding.findingId,
    "22222222-2222-4222-8222-222222222222#0001@001",
  );
  assert.equal(finding.sourceId, segment.sourceId);
  assert.equal(finding.segmentId, segment.segmentId);
  assert.equal(finding.category, "businessRules");
  assert.equal(finding.evidenceText, evidenceText);

  const relativeStart = segment.text.indexOf(evidenceText);
  assert.equal(
    finding.evidenceStartCharacter,
    segment.startCharacter + relativeStart,
  );
  assert.equal(
    finding.evidenceEndCharacter,
    finding.evidenceStartCharacter + evidenceText.length,
  );
  assert.equal(Object.isFrozen(finding), true);
  assert.equal(Object.isFrozen(result), true);
});

test("el parser reconcilia solo espacios contra una cita literal del fragmento", () => {
  const literal = "El proceso actual\nrequiere validación manual.";
  const customSegment = {
    ...segment,
    text: literal,
    endCharacter: segment.startCharacter + literal.length,
  };

  const [finding] = parseLocalOnlyV2AtomicExtraction(
    {
      findings: [
        {
          category: "facts",
          description: "El proceso requiere validación manual.",
          evidenceText: "El proceso actual requiere validación manual.",
        },
      ],
    },
    customSegment,
  );

  assert.equal(finding?.evidenceText, literal);
  assert.equal(finding?.evidenceStartCharacter, customSegment.startCharacter);
  assert.equal(
    finding?.evidenceEndCharacter,
    customSegment.startCharacter + literal.length,
  );
});

test("el parser recupera la cita literal cuando el modelo cambia mayúsculas o puntuación", () => {
  const literal = "Regla confirmada: La aprobación requiere un coordinador.";
  const customSegment = {
    ...segment,
    text: literal,
    endCharacter: segment.startCharacter + literal.length,
  };

  const [finding] = parseLocalOnlyV2AtomicExtraction(
    {
      findings: [
        {
          category: "businessRules",
          description: "La aprobación requiere un coordinador.",
          evidenceText:
            "regla confirmada - la aprobación requiere un coordinador",
        },
      ],
    },
    customSegment,
  );

  assert.equal(finding?.evidenceText, literal.slice(0, -1));
});

test("hallazgos sin evidencia literal son rechazados en vez de aceptarse como hechos", () => {
  assert.throws(
    () =>
      parseLocalOnlyV2AtomicExtraction(
        {
          findings: [
            {
              category: "functionalRequirements",
              description:
                "El sistema debe enviar notificación automática al gerente.",
              evidenceText:
                "El sistema enviará un correo automático al gerente.",
            },
          ],
        },
        segment,
      ),
    /no existe literalmente en el fragmento/u,
  );
});

test("la salida rechaza categorías ajenas, propiedades extra y descripciones no atómicas multilínea", () => {
  assert.throws(
    () =>
      parseLocalOnlyV2AtomicExtraction(
        {
          findings: [
            {
              category: "categoriaInventada",
              description: "Dato inventado.",
              evidenceText: "El analista registra",
            },
          ],
        },
        segment,
      ),
    /no corresponde al contrato local actual/u,
  );

  assert.throws(
    () =>
      parseLocalOnlyV2AtomicExtraction(
        {
          findings: [
            {
              category: "facts",
              description: "Hallazgo.",
              evidenceText: "El analista registra",
              sourceId: segment.sourceId,
            },
          ],
        },
        segment,
      ),
    /propiedades no permitidas o faltantes/u,
  );

  assert.throws(
    () =>
      parseLocalOnlyV2AtomicExtraction(
        {
          findings: [
            {
              category: "facts",
              description: "Primera afirmación.\nSegunda afirmación.",
              evidenceText: "El analista registra",
            },
          ],
        },
        segment,
      ),
    /una sola afirmación en una línea/u,
  );
});

test("las tareas V2 heredan los segmentos presupuestados y mantienen pequeño el output", () => {
  const questionnaireSource = {
    sourceId: "11111111-1111-4111-8111-111111111111",
    sourceTitle: "Preguntas de análisis · RQ-2026-004321",
    snapshotText: [
      "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
      "Proyecto: RQ-2026-004321 · Proyecto genérico",
      "",
      "Pregunta: ¿Cuál es el problema?",
      "Origen seleccionado: Respuesta original",
      "Valoración: 8/10",
      "Respuesta: Existen reprocesos manuales.",
    ].join("\n"),
    position: 2,
  };
  const ordinarySource = {
    sourceId: "33333333-3333-4333-8333-333333333333",
    sourceTitle: "Fuente general",
    snapshotText: `${"El proceso requiere trazabilidad documental. ".repeat(500)}\n`,
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
  const tasks = createLocalOnlyV2AtomicExtractionTasks(segmented);

  assert.equal(tasks.length, segmented.segments.length);
  assert.ok(tasks.length > 0);
  assert.ok(tasks.some((task) => task.segment.mandatoryQuestionnaireEvidence));

  for (const task of tasks) {
    assert.equal(task.pipelineId, "LOCAL_ONLY_V2");
    assert.equal(
      task.outputTargetTokens,
      LOCAL_ONLY_V2_ATOMIC_OUTPUT_TARGET_TOKENS,
    );
    assert.equal(task.maxOutputTokens, LOCAL_ONLY_V2_ATOMIC_OUTPUT_MAX_TOKENS);
    assert.ok(task.maxOutputTokens < 8_192);
    assert.ok(task.segment.estimatedTokens <= budget.maxChunkTokens);
  }
});

test("Paso 4 no modifica ni reutiliza el extractor histórico para implementar V2", async () => {
  const production = await readFile(
    "apps/ai-analysis-service/src/execution/local-only-v2-atomic-extraction.ts",
    "utf8",
  );

  assert.doesNotMatch(production, /OllamaSourceAnalyzerService/u);
  assert.doesNotMatch(production, /buildLocalOnlySourcePrompt/u);
  assert.doesNotMatch(production, /splitLocalSourceTextAdaptively/u);
  assert.doesNotMatch(production, /LOCAL_SOURCE_CHUNK_CHARACTERS/u);
  assert.doesNotMatch(production, /SOAT/iu);
  assert.match(production, /LOCAL_ONLY_V2_04_ATOMIC_EXTRACTION/u);
});
