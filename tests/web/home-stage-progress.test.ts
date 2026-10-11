import assert from "node:assert/strict";
import test from "node:test";

import type {
  RequirementDocumentDetail,
  SourceSummary,
} from "@levantamiento-rq/shared-contracts";

import {
  calculateAnswerDefinitionLevel,
  calculateDocumentStageProgress,
  calculateCreationStageProgress,
  calculateAzureExecutionProgress,
  calculateExecutionStageProgress,
  calculateSourceStageProgress,
  calculateValidationStageProgress,
  parseDiscussionStageSnapshot,
  evaluateProjectProgress,
} from "../../apps/web/src/app/workspace/home-stage-progress";
import { REQUIREMENTS_QUESTION_IDS } from "../../apps/web/src/app/workspace/sources/source-capture-helpers";

function source(
  id: string,
  title: string,
  processingStatus: SourceSummary["processingStatus"] = "READY",
): SourceSummary {
  return { id, title, status: "ACTIVE", processingStatus } as SourceSummary;
}

function documentWith(
  status: RequirementDocumentDetail["status"],
  content: RequirementDocumentDetail["currentVersionDetail"]["sections"][number]["content"],
): RequirementDocumentDetail {
  return {
    status,
    currentVersionDetail: {
      sections: [{ key: "header", content }],
    },
  } as unknown as RequirementDocumentDetail;
}

test("discusión sin respuestas manuales pondera conversación e IA", () => {
  const answered = REQUIREMENTS_QUESTION_IDS.slice(0, 5);
  const partial = parseDiscussionStageSnapshot(
    JSON.stringify({
      answers: Object.fromEntries(
        answered.map((id) => [
          id,
          { answer: "Respuesta manual suficientemente detallada", score: 10 },
        ]),
      ),
    }),
  );
  assert.equal(partial.percentage, 10);
  assert.equal(partial.sourceId, null);

  const answers = Object.fromEntries(
    REQUIREMENTS_QUESTION_IDS.map((id, index) => [
      id,
      index < 6
        ? "No hay información suficiente"
        : "Respuesta útil y suficientemente específica para el requerimiento",
    ]),
  );
  const cloudAnswers = Object.fromEntries(
    REQUIREMENTS_QUESTION_IDS.map((id) => [
      id,
      "Respuesta útil de nube con evidencia suficiente para decidir",
    ]),
  );
  const generated = parseDiscussionStageSnapshot(
    JSON.stringify({
      conversation: "x".repeat(500),
      localResult: { answers },
      cloudResult: { answers: cloudAnswers },
    }),
  );
  assert.equal(generated.percentage, 90);
  assert.equal(generated.details.localNeedsReview, 6);
});

test("discusión limita conversación y ambas IA a 90 % hasta agregar fuentes", () => {
  const usefulAnswers = Object.fromEntries(
    REQUIREMENTS_QUESTION_IDS.map((id) => [
      id,
      "Respuesta suficientemente definida con proceso, responsable y plazo.",
    ]),
  );
  const state = {
    conversation: "x".repeat(500),
    localResult: { answers: usefulAnswers },
    cloudResult: { answers: usefulAnswers },
  };
  assert.equal(
    parseDiscussionStageSnapshot(JSON.stringify(state)).percentage,
    90,
  );
  assert.equal(
    parseDiscussionStageSnapshot(
      JSON.stringify({ ...state, sourceId: "source-1" }),
    ).percentage,
    100,
  );
});

test("discusión manual aplica 1,95 por respuesta y ponderaciones reducidas", () => {
  const usefulAnswers = Object.fromEntries(
    REQUIREMENTS_QUESTION_IDS.map((id) => [
      id,
      "Respuesta manual suficientemente detallada para el requerimiento.",
    ]),
  );
  const manualAnswers = Object.fromEntries(
    REQUIREMENTS_QUESTION_IDS.map((id) => [id, { answer: usefulAnswers[id] }]),
  );
  const snapshot = parseDiscussionStageSnapshot(
    JSON.stringify({
      answers: manualAnswers,
      conversation: "Conversación completa",
      localResult: { answers: usefulAnswers },
      cloudResult: { answers: usefulAnswers },
    }),
  );
  assert.equal(snapshot.percentage, 90);
  assert.equal(snapshot.details.manualContribution, 60.45);
  assert.equal(snapshot.details.conversationContribution, 10.45);
  assert.equal(snapshot.details.localContribution, 9.55);
  assert.equal(snapshot.details.cloudContribution, 9.55);
});

test("cada respuesta IA recibe un nivel de definición determinístico", () => {
  assert.equal(
    calculateAnswerDefinitionLevel("No hay información suficiente"),
    0,
  );
  const level = calculateAnswerDefinitionLevel(
    "El responsable del proceso será el área de cartera. El plazo acordado es de 15 días y el sistema ERP registrará cada aprobación.",
  );
  assert.ok(level >= 70 && level <= 100);
});

test("fuentes pondera discusión y fuentes adicionales", () => {
  const discussion = source("discussion", "Preguntas de análisis · RQ-001");
  const attachment = source("attachment", "Entrevista.docx");
  assert.equal(calculateSourceStageProgress([], null), 0);
  assert.equal(calculateSourceStageProgress([discussion], null), 65);
  assert.equal(calculateSourceStageProgress([attachment], null), 60);
  assert.equal(
    calculateSourceStageProgress(
      [
        discussion,
        attachment,
        source("p2", "Nota", "READY"),
        source("p3", "Proceso", "PROCESSING"),
      ],
      null,
    ),
    100,
  );
});

test("creación vale 85 % sin descripción y 100 % con descripción", () => {
  assert.equal(calculateCreationStageProgress(null), 85);
  assert.equal(calculateCreationStageProgress("   "), 85);
  assert.equal(calculateCreationStageProgress("Objetivo del proyecto"), 100);
});

test("documento descuenta campos vacíos y pendientes", () => {
  assert.equal(
    calculateDocumentStageProgress(
      documentWith("DRAFT", {
        title: "Documento completo",
        description: "Contenido definido",
      }),
    ),
    100,
  );
  assert.equal(
    calculateDocumentStageProgress(
      documentWith("IN_REVIEW", {
        title: "Documento parcial",
        description: "",
      }),
    ),
    50,
  );
});

test("validación usa 40 %, 75 % y 100 % según el estado", () => {
  assert.equal(calculateValidationStageProgress("DRAFT"), 0);
  assert.equal(calculateValidationStageProgress("IN_REVIEW"), 40);
  assert.equal(calculateValidationStageProgress("CHANGES_REQUESTED"), 75);
  assert.equal(calculateValidationStageProgress("APPROVED"), 100);
});

test("ejecución depende de las tareas cumplidas", () => {
  const progress = calculateExecutionStageProgress(
    documentWith("APPROVED", {
      sprints: [
        {
          tasks: [
            { code: "T-001", status: "DONE" },
            { code: "T-002", status: "PENDING" },
          ],
        },
      ],
    }),
  );
  assert.deepEqual(progress, {
    percentage: 50,
    completedTasks: 1,
    totalTasks: 2,
  });
});

test("Azure penaliza tareas del plan sin correspondencia", () => {
  const plan = Array.from({ length: 100 }, (_, index) => `T-${index + 1}`);
  const eightyDone = plan
    .slice(0, 80)
    .map((code) => ({ code, completed: true }));
  assert.equal(
    calculateAzureExecutionProgress(plan, eightyDone).percentage,
    80,
  );
  const halfDone = plan.map((code, index) => ({ code, completed: index < 50 }));
  assert.equal(calculateAzureExecutionProgress(plan, halfDone).percentage, 50);
  assert.equal(
    calculateAzureExecutionProgress(
      plan,
      plan.map((code) => ({ code, completed: true })),
    ).percentage,
    100,
  );
});

test("avance general suma pesos explícitos", () => {
  const evaluation = evaluateProjectProgress("DRAFT", [
    { key: "CREATION", progress: 100 },
    { key: "DISCUSSION", progress: 80 },
    { key: "SOURCES", progress: 50 },
  ]);
  assert.equal(evaluation.overallProgress, 27);
});
