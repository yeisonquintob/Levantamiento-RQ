// LOCAL_ONLY_V2_02_MANDATORY_QUESTIONNAIRE_EVIDENCE
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isLocalOnlyV2QuestionnaireEvidence,
  LOCAL_ONLY_V2_QUESTIONNAIRE_HEADER,
  LOCAL_ONLY_V2_QUESTIONNAIRE_TITLE_PREFIX,
  prepareLocalOnlyV2EvidenceInput,
  requireLocalOnlyV2QuestionnaireEvidence,
} from "../../apps/ai-analysis-service/src/execution/local-only-v2-questionnaire-evidence.js";

const questionnaireSource = {
  sourceId: "11111111-1111-4111-8111-111111111111",
  sourceTitle: "Preguntas de análisis · RQ-2026-000309",
  snapshotText: [
    "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
    "Proyecto: RQ-2026-000309 · Proyecto genérico",
    "",
    "1. Contexto",
    "Objetivo de la sección",
    "Pregunta: ¿Cuál es el problema principal?",
    "Origen seleccionado: Respuesta original",
    "Valoración: 8/10",
    "Respuesta: El proceso manual genera reprocesos.",
    "Pregunta: ¿Qué resultado se espera?",
    "Origen seleccionado: IA local",
    "Valoración: 9/10",
    "Respuesta: Reducir reprocesos y mejorar la trazabilidad.",
  ].join("\n"),
  position: 2,
};

const conversationSource = {
  sourceId: "22222222-2222-4222-8222-222222222222",
  sourceTitle: "Conversación con el área operativa",
  snapshotText: "El registro actual es manual y requiere trazabilidad.",
  position: 1,
};

test("Paso 2 reconoce la fuente real de respuestas seleccionadas sin depender de SOAT", () => {
  assert.equal(
    LOCAL_ONLY_V2_QUESTIONNAIRE_TITLE_PREFIX,
    "Preguntas de análisis ·",
  );
  assert.equal(
    LOCAL_ONLY_V2_QUESTIONNAIRE_HEADER,
    "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
  );
  assert.equal(isLocalOnlyV2QuestionnaireEvidence(questionnaireSource), true);
  assert.equal(isLocalOnlyV2QuestionnaireEvidence(conversationSource), false);
});

test("LOCAL_ONLY_V2 admite una conversación textual cuando no hay cuestionario", () => {
  const prepared = prepareLocalOnlyV2EvidenceInput("LOCAL_ONLY", [
    conversationSource,
  ]);

  assert.equal(
    prepared.selectedQuestionnaire.sourceId,
    conversationSource.sourceId,
  );
  assert.equal(prepared.selectedQuestionnaire.questionCount, 0);
  assert.equal(prepared.selectedQuestionnaire.answerCount, 0);
});

test("LOCAL_ONLY_V2 falla cerrado si no recibe texto seleccionado", () => {
  assert.throws(
    () => prepareLocalOnlyV2EvidenceInput("LOCAL_ONLY", []),
    /requiere preguntas de análisis o una conversación textual/u,
  );
});

test("LOCAL_ONLY_V2 rechaza una fuente de preguntas vacía o sin parejas Pregunta/Respuesta", () => {
  const malformed = {
    ...questionnaireSource,
    snapshotText: [
      "RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO",
      "Proyecto: RQ-2026-000999 · Otro proyecto",
      "Pregunta: ¿Qué se necesita?",
    ].join("\n"),
  };

  assert.equal(isLocalOnlyV2QuestionnaireEvidence(malformed), false);
  assert.throws(
    () => prepareLocalOnlyV2EvidenceInput("LOCAL_ONLY", [malformed]),
    /requiere preguntas de análisis o una conversación textual/u,
  );
});

test("la preparación LOCAL_ONLY_V2 conserva toda la evidencia seleccionada y su trazabilidad", () => {
  const prepared = prepareLocalOnlyV2EvidenceInput("LOCAL_ONLY", [
    conversationSource,
    questionnaireSource,
  ]);

  assert.equal(prepared.pipeline.pipelineId, "LOCAL_ONLY_V2");
  assert.equal(prepared.pipeline.generationMode, "LOCAL_ONLY");
  assert.equal(
    prepared.selectedQuestionnaire.sourceId,
    questionnaireSource.sourceId,
  );
  assert.equal(prepared.selectedQuestionnaire.questionCount, 2);
  assert.equal(prepared.selectedQuestionnaire.answerCount, 2);
  assert.equal(
    prepared.selectedQuestionnaire.snapshotText,
    questionnaireSource.snapshotText,
  );
  assert.equal(prepared.sources.length, 2);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.sources), true);
  assert.equal(Object.isFrozen(prepared.selectedQuestionnaire), true);
});

test("LOCAL_CLOUD y CLOUD_ONLY no adquieren la nueva obligación de LOCAL_ONLY_V2", () => {
  assert.equal(
    requireLocalOnlyV2QuestionnaireEvidence("LOCAL_CLOUD", []),
    null,
  );
  assert.equal(requireLocalOnlyV2QuestionnaireEvidence("CLOUD_ONLY", []), null);
  assert.throws(
    () => prepareLocalOnlyV2EvidenceInput("LOCAL_CLOUD", [questionnaireSource]),
    /admite únicamente LOCAL_ONLY/u,
  );
  assert.throws(
    () => prepareLocalOnlyV2EvidenceInput("CLOUD_ONLY", [questionnaireSource]),
    /admite únicamente LOCAL_ONLY/u,
  );
});

test("Paso 2 consume el formato existente de Discusión sin modificar ese módulo", async () => {
  const [discussion, sourcesClient] = await Promise.all([
    readFile(
      "apps/web/src/app/workspace/projects/[projectId]/discussion/requirement-discussion-workspace.tsx",
      "utf8",
    ),
    readFile(
      "apps/ai-analysis-service/src/analysis/sources-access.client.ts",
      "utf8",
    ),
  ]);

  assert.match(discussion, /RESPUESTAS SELECCIONADAS PARA EL LEVANTAMIENTO/u);
  assert.match(discussion, /Preguntas de análisis · \$\{project\.code\}/u);
  assert.match(discussion, /sourceType: "CONVERSATION"/u);
  assert.match(sourcesClient, /startsWith\("preguntas de análisis ·"\)/u);
});
