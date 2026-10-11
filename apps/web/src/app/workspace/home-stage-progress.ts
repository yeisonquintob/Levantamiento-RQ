import type {
  DocumentJsonValue,
  DocumentStatus,
  ProjectStatus,
  RequirementDocumentDetail,
  SourceSummary,
} from "@levantamiento-rq/shared-contracts";

import { REQUIREMENTS_QUESTION_IDS } from "./sources/source-capture-helpers";

const PENDING_MARKER = "[PENDIENTE POR DEFINIR]";
const TECHNICAL_CONTENT_KEYS = new Set([
  "sourceIds",
  "sourceIdsA",
  "sourceIdsB",
  "clientId",
  "structuredAnalysis",
  "id",
  "from",
  "to",
  "kind",
  "scheduleBasis",
  "startDay",
  "endDay",
  "startDate",
  "endDate",
  "period",
]);
const NULLABLE_CONTENT_KEYS = new Set([
  "label",
  "laneId",
  "confirmedStartDate",
  "startDate",
  "endDate",
]);
const FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS = new Set([
  "category",
  "measure",
  "target",
]);
const NON_FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS = new Set([
  "milestone",
  "functionality",
]);
const REQUIRED_COLLECTION_KEYS = new Set(["nodes", "acceptanceCriteria"]);
const COMPLETED_TASK_STATUSES = new Set([
  "100",
  "100%",
  "CERRADA",
  "CERRADO",
  "CLOSED",
  "COMPLETADA",
  "COMPLETADO",
  "COMPLETED",
  "CUMPLIDA",
  "CUMPLIDO",
  "DONE",
  "FINALIZADA",
  "FINALIZADO",
  "FINISHED",
  "HECHA",
  "HECHO",
]);

interface CompletionCount {
  completed: number;
  total: number;
}

export interface DiscussionStageSnapshot {
  percentage: number;
  sourceId: string | null;
  details: Readonly<Record<string, number>>;
  gaps: readonly string[];
}

export interface ExecutionStageProgress {
  percentage: number;
  completedTasks: number;
  totalTasks: number;
}

function clampPercentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundPercentage(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .trim()
    .toUpperCase();
}

export const PROJECT_STAGE_WEIGHTS = {
  CREATION: 10,
  DISCUSSION: 15,
  SOURCES: 10,
  DOCUMENT: 20,
  VALIDATION: 15,
  EXECUTION: 30,
} as const;

export type ProjectStageKey = keyof typeof PROJECT_STAGE_WEIGHTS;
export type StageState = "completed" | "in_progress" | "pending" | "with_gaps";

export interface StageEvaluation {
  key: ProjectStageKey;
  label: string;
  weight: number;
  progress: number;
  contribution: number;
  state: StageState;
  gaps: readonly string[];
  details: Readonly<Record<string, string | number | boolean>>;
}

export interface ProjectProgressEvaluation {
  currentStatus: ProjectStatus;
  overallProgress: number;
  stages: readonly StageEvaluation[];
  totalGaps: number;
  topGaps: readonly string[];
}

export interface StageProgressInput {
  key: ProjectStageKey;
  progress: number;
  gaps?: readonly string[];
  details?: Readonly<Record<string, string | number | boolean>>;
}

const STAGE_LABELS: Readonly<Record<ProjectStageKey, string>> = {
  CREATION: "Creación",
  DISCUSSION: "Discusión",
  SOURCES: "Fuentes",
  DOCUMENT: "Documento",
  VALIDATION: "Validación",
  EXECUTION: "Ejecución",
};

export function evaluateProjectProgress(
  currentStatus: ProjectStatus,
  inputs: readonly StageProgressInput[],
): ProjectProgressEvaluation {
  const stages = (Object.keys(PROJECT_STAGE_WEIGHTS) as ProjectStageKey[]).map(
    (key, index) => {
      const input = inputs.find((candidate) => candidate.key === key);
      const progress = clampPercentage(input?.progress ?? 0);
      const gaps = input?.gaps ?? [];
      const laterStarted = inputs
        .slice(index + 1)
        .some((item) => item.progress > 0);
      const state: StageState =
        progress === 100
          ? "completed"
          : progress === 0
            ? laterStarted
              ? "with_gaps"
              : "pending"
            : laterStarted && gaps.length > 0
              ? "with_gaps"
              : "in_progress";
      const weight = PROJECT_STAGE_WEIGHTS[key];
      return {
        key,
        label: STAGE_LABELS[key],
        weight,
        progress,
        contribution: (progress * weight) / 100,
        state,
        gaps,
        details: input?.details ?? {},
      } satisfies StageEvaluation;
    },
  );
  const allGaps = stages.flatMap((stage) =>
    stage.gaps.map((gap) => `${stage.label}: ${gap}`),
  );
  return {
    currentStatus,
    overallProgress: Math.round(
      stages.reduce((total, stage) => total + stage.contribution, 0),
    ),
    stages,
    totalGaps: allGaps.length,
    topGaps: allGaps.slice(0, 5),
  };
}

const UNUSABLE_ANSWER_PATTERNS = [
  /NO (?:SE )?ENCUENTRA (?:INFORMACION|EVIDENCIA)/u,
  /NO HAY INFORMACION SUFICIENTE/u,
  /INFORMACION INSUFICIENTE/u,
  /NO FUE POSIBLE DETERMINAR/u,
  /NO SE PUEDE DETERMINAR/u,
  /NO SE ENCONTRO EVIDENCIA/u,
];

export function isUsableDiscussionAnswer(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length < 20) return false;
  const normalized = normalizeText(value);
  return !UNUSABLE_ANSWER_PATTERNS.some((pattern) => pattern.test(normalized));
}

/** Estimación local de definición; no representa confianza ni veracidad. */
export function calculateAnswerDefinitionLevel(value: unknown): number {
  if (!isUsableDiscussionAnswer(value)) return 0;
  const answer = String(value).trim();
  const words = answer.split(/\s+/u).filter(Boolean);
  const sentences = answer.split(/[.!?]+/u).filter((item) => item.trim());
  const hasConcreteEvidence =
    /\b(?:\d+(?:[.,]\d+)?|API|ERP|SLA|USUARIO|AREA|PROCESO|SISTEMA|FECHA|PLAZO|RESPONSABLE|RIESGO)\b/iu.test(
      answer,
    );
  return Math.min(
    100,
    25 +
      Math.min(45, Math.round(words.length * 1.5)) +
      Math.min(20, sentences.length * 5) +
      (hasConcreteEvidence ? 10 : 0),
  );
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export function parseDiscussionStageSnapshot(
  raw: string | null,
): DiscussionStageSnapshot {
  if (!raw) return { percentage: 0, sourceId: null, details: {}, gaps: [] };
  try {
    const state = JSON.parse(raw) as Readonly<Record<string, unknown>>;
    const sourceId =
      typeof state.sourceId === "string" && state.sourceId.trim()
        ? state.sourceId
        : null;
    const answers = objectValue(state.answers) ?? {};
    const legacyAnswers = objectValue(state.processedAnswers) ?? {};
    const localAnswers =
      objectValue(objectValue(state.localResult)?.answers) ?? legacyAnswers;
    const cloudAnswers =
      objectValue(objectValue(state.cloudResult)?.answers) ?? {};
    const manuallyAnswered = REQUIREMENTS_QUESTION_IDS.filter((questionId) => {
      const answer = objectValue(answers[questionId]);
      return (
        typeof answer?.answer === "string" && answer.answer.trim().length > 0
      );
    }).length;
    const countGenerated = (answers: Readonly<Record<string, unknown>>) =>
      REQUIREMENTS_QUESTION_IDS.filter(
        (id) => typeof answers[id] === "string" && String(answers[id]).trim(),
      ).length;
    const countUsable = (answers: Readonly<Record<string, unknown>>) =>
      REQUIREMENTS_QUESTION_IDS.filter((id) =>
        isUsableDiscussionAnswer(answers[id]),
      ).length;
    const localGenerated = countGenerated(localAnswers);
    const localUsable = countUsable(localAnswers);
    const cloudGenerated = countGenerated(cloudAnswers);
    const cloudUsable = countUsable(cloudAnswers);
    const questionsWithUsableAnswer = REQUIREMENTS_QUESTION_IDS.filter((id) => {
      const manual = objectValue(answers[id])?.answer;
      return (
        isUsableDiscussionAnswer(manual) ||
        isUsableDiscussionAnswer(localAnswers[id]) ||
        isUsableDiscussionAnswer(cloudAnswers[id])
      );
    }).length;
    const missing =
      REQUIREMENTS_QUESTION_IDS.length - questionsWithUsableAnswer;
    const conversationChars =
      typeof state.conversation === "string"
        ? state.conversation.trim().length
        : 0;
    const totalQuestions = REQUIREMENTS_QUESTION_IDS.length;
    const manualUsable = REQUIREMENTS_QUESTION_IDS.filter((id) =>
      isUsableDiscussionAnswer(objectValue(answers[id])?.answer),
    ).length;
    const hasConversation = conversationChars > 0;
    const hasLocalAnswers = localGenerated > 0;
    const hasCloudAnswers = cloudGenerated > 0;
    const hasManualAnswers = manuallyAnswered > 0;
    const manualContribution = hasManualAnswers
      ? roundPercentage(manuallyAnswered * 1.95)
      : 0;
    const conversationContribution = hasConversation
      ? hasManualAnswers
        ? 10.45
        : 30
      : 0;
    const localContribution =
      hasConversation && hasLocalAnswers ? (hasManualAnswers ? 9.55 : 30) : 0;
    const cloudContribution =
      hasConversation && hasCloudAnswers ? (hasManualAnswers ? 9.55 : 30) : 0;
    const discussionContribution = Math.min(
      90,
      manualContribution +
        conversationContribution +
        localContribution +
        cloudContribution,
    );
    const sourceContribution = sourceId ? 10 : 0;
    const percentage = clampPercentage(
      discussionContribution + sourceContribution,
    );
    const gaps = [
      ...(missing > 0 ? [`${missing} preguntas sin respuesta utilizable`] : []),
      ...(localGenerated - localUsable > 0
        ? [
            `IA local: ${localGenerated - localUsable} respuestas requieren revisión`,
          ]
        : []),
      ...(cloudGenerated - cloudUsable > 0
        ? [
            `IA nube: ${cloudGenerated - cloudUsable} respuestas requieren revisión`,
          ]
        : []),
    ];

    return {
      percentage,
      sourceId,
      details: {
        totalQuestions,
        manualAnswered: manuallyAnswered,
        manualUsable,
        localGenerated,
        localUsable,
        localNeedsReview: localGenerated - localUsable,
        cloudGenerated,
        cloudUsable,
        cloudNeedsReview: cloudGenerated - cloudUsable,
        questionsWithUsableAnswer,
        questionsMissingUsableAnswer: missing,
        conversationChars,
        manualContribution,
        conversationContribution,
        localContribution,
        cloudContribution,
        sourceContribution,
      },
      gaps,
    };
  } catch {
    return { percentage: 0, sourceId: null, details: {}, gaps: [] };
  }
}

export function calculateSourceStageProgress(
  sources: readonly SourceSummary[],
  discussionSourceId: string | null,
): number {
  const activeSources = sources.filter((source) => source.status === "ACTIVE");
  if (activeSources.length === 0) return 0;
  const hasDiscussionSource = activeSources.some(
    (source) =>
      source.id === discussionSourceId ||
      normalizeText(source.title).startsWith("PREGUNTAS DE ANALISIS"),
  );
  const hasAdditionalSources = activeSources.some(
    (source) =>
      source.id !== discussionSourceId &&
      !normalizeText(source.title).startsWith("PREGUNTAS DE ANALISIS"),
  );
  if (hasDiscussionSource && hasAdditionalSources) return 100;
  if (hasDiscussionSource) return 65;
  return hasAdditionalSources ? 60 : 0;
}

export function calculateCreationStageProgress(
  description: string | null | undefined,
): number {
  return description?.trim() ? 100 : 85;
}

function countDocumentContent(
  value: DocumentJsonValue,
  path: readonly string[] = [],
): CompletionCount {
  if (typeof value === "string") {
    const complete = value.trim().length > 0 && !value.includes(PENDING_MARKER);
    return { total: 1, completed: complete ? 1 : 0 };
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return { total: 1, completed: 1 };
  }
  if (value === null) {
    const key = path.at(-1) ?? "";
    const optionalForFunctionalRequirement =
      path.includes("functionalRequirements") &&
      FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS.has(key);
    const optionalForNonFunctionalRequirement =
      path.includes("nonFunctionalRequirements") &&
      NON_FUNCTIONAL_REQUIREMENT_NULLABLE_KEYS.has(key);
    return NULLABLE_CONTENT_KEYS.has(key) ||
      TECHNICAL_CONTENT_KEYS.has(key) ||
      optionalForFunctionalRequirement ||
      optionalForNonFunctionalRequirement
      ? { total: 0, completed: 0 }
      : { total: 1, completed: 0 };
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      const required = REQUIRED_COLLECTION_KEYS.has(path.at(-1) ?? "");
      return { total: 1, completed: required ? 0 : 1 };
    }
    return value.reduce<CompletionCount>(
      (result, item, index) => {
        const next = countDocumentContent(item, [...path, String(index + 1)]);
        return {
          total: result.total + next.total,
          completed: result.completed + next.completed,
        };
      },
      { total: 0, completed: 0 },
    );
  }
  return Object.entries(value).reduce<CompletionCount>(
    (result, [key, item]) => {
      if (TECHNICAL_CONTENT_KEYS.has(key)) return result;
      const next = countDocumentContent(item, [...path, key]);
      return {
        total: result.total + next.total,
        completed: result.completed + next.completed,
      };
    },
    { total: 0, completed: 0 },
  );
}

function presentDocumentContent(value: DocumentJsonValue): DocumentJsonValue {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as DocumentJsonValue;
  } catch {
    return value;
  }
}

/** Calcula el porcentaje con los mismos campos que ve el editor documental. */
export function calculateDocumentStageProgress(
  document: RequirementDocumentDetail | null,
): number {
  if (!document) return 0;
  const stats = document.currentVersionDetail.sections.reduce<CompletionCount>(
    (result, section) => {
      const next = countDocumentContent(
        presentDocumentContent(section.content),
        [section.title],
      );
      return {
        total: result.total + next.total,
        completed: result.completed + next.completed,
      };
    },
    { total: 0, completed: 0 },
  );
  return stats.total === 0
    ? 0
    : clampPercentage((stats.completed / stats.total) * 100);
}

/** Revisión 40 %, corrección 75 % y aprobación 100 %. */
export function calculateValidationStageProgress(
  status: DocumentStatus | null,
  projectStatus?: ProjectStatus,
): number {
  // Una nueva versión no revoca la aprobación ya alcanzada por el proyecto.
  if (
    projectStatus &&
    ["APPROVED", "EXECUTION", "COMPLETED"].includes(projectStatus)
  )
    return 100;
  if (projectStatus === "VALIDATION" && (status === "DRAFT" || status === null))
    return 40;
  if (status === "IN_REVIEW") return 40;
  if (status === "CHANGES_REQUESTED" || status === "REJECTED") return 75;
  if (status === "APPROVED" || status === "ARCHIVED") return 100;
  return 0;
}

function completedTask(task: Readonly<Record<string, unknown>>): boolean {
  for (const key of ["completed", "done", "isCompleted"]) {
    if (task[key] === true) return true;
  }
  for (const key of ["progress", "completion", "percentage"]) {
    if (typeof task[key] === "number" && task[key] >= 100) return true;
  }
  for (const key of ["status", "state", "executionStatus"]) {
    const value = task[key];
    if (
      typeof value === "string" &&
      COMPLETED_TASK_STATUSES.has(normalizeText(value))
    ) {
      return true;
    }
  }
  return false;
}

function collectTasks(
  value: DocumentJsonValue,
  tasks: Map<string, boolean>,
  path = "document",
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectTasks(item, tasks, `${path}.${index}`),
    );
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === "tasks" && Array.isArray(item)) {
      item.forEach((candidate, index) => {
        const task = objectValue(candidate);
        if (!task) return;
        const code =
          typeof task.code === "string" && task.code.trim()
            ? normalizeText(task.code)
            : `${path}.tasks.${index}`;
        tasks.set(code, (tasks.get(code) ?? false) || completedTask(task));
      });
    }
    collectTasks(item, tasks, `${path}.${key}`);
  }
}

/** La ejecución avanza únicamente con la proporción de tareas terminadas. */
export function calculateExecutionStageProgress(
  document: RequirementDocumentDetail | null,
): ExecutionStageProgress {
  const tasks = new Map<string, boolean>();
  if (document) {
    for (const section of document.currentVersionDetail.sections) {
      collectTasks(section.content, tasks, section.key);
    }
  }
  const totalTasks = tasks.size;
  const completedTasks = [...tasks.values()].filter(Boolean).length;
  return {
    totalTasks,
    completedTasks,
    percentage:
      totalTasks === 0
        ? 0
        : clampPercentage((completedTasks / totalTasks) * 100),
  };
}

export interface AzureTaskProgressInput {
  code: string;
  completed: boolean;
  active?: boolean;
  completedWork?: number | null;
  remainingWork?: number | null;
}

export interface AzureExecutionProgress {
  percentage: number;
  planTasks: number;
  azureTasks: number;
  matchedTasks: number;
  unmatchedPlanTasks: number;
  completedMatchedTasks: number;
  activeMatchedTasks: number;
  pendingMatchedTasks: number;
  matchRatio: number;
  gaps: readonly string[];
}

/** Azure is execution truth; missing plan matches proportionally reduce progress. */
export function calculateAzureExecutionProgress(
  planTaskCodes: readonly string[],
  azureTasks: readonly AzureTaskProgressInput[],
): AzureExecutionProgress {
  const azureByCode = new Map(
    azureTasks.map((task) => [normalizeText(task.code), task]),
  );
  const matched = planTaskCodes
    .map((code) => azureByCode.get(normalizeText(code)))
    .filter((task): task is AzureTaskProgressInput => Boolean(task));
  const planTasks = planTaskCodes.length;
  const matchedTasks = matched.length;
  const unmatchedPlanTasks = Math.max(0, planTasks - matchedTasks);
  const completedMatchedTasks = matched.filter((task) => task.completed).length;
  const activeMatchedTasks = matched.filter(
    (task) => !task.completed && task.active,
  ).length;
  const pendingMatchedTasks =
    matchedTasks - completedMatchedTasks - activeMatchedTasks;
  const matchRatio = planTasks > 0 ? matchedTasks / planTasks : 0;
  const effortTasks = matched.filter(
    (task) =>
      typeof task.completedWork === "number" &&
      typeof task.remainingWork === "number" &&
      task.completedWork + task.remainingWork > 0,
  );
  const completionAmongMatched =
    effortTasks.length === matchedTasks && matchedTasks > 0
      ? effortTasks.reduce((sum, task) => sum + (task.completedWork ?? 0), 0) /
        effortTasks.reduce(
          (sum, task) =>
            sum + (task.completedWork ?? 0) + (task.remainingWork ?? 0),
          0,
        )
      : matchedTasks > 0
        ? completedMatchedTasks / matchedTasks
        : 0;
  const percentage = clampPercentage(completionAmongMatched * matchRatio * 100);
  return {
    percentage,
    planTasks,
    azureTasks: azureTasks.length,
    matchedTasks,
    unmatchedPlanTasks,
    completedMatchedTasks,
    activeMatchedTasks,
    pendingMatchedTasks,
    matchRatio,
    gaps: [
      ...(planTasks === 0 && azureTasks.length > 0
        ? ["No existe plan documental para validar correspondencia"]
        : []),
      ...(unmatchedPlanTasks > 0
        ? [`${unmatchedPlanTasks} tareas del plan no se encontraron en Azure`]
        : []),
      ...(activeMatchedTasks > 0
        ? [`${activeMatchedTasks} tareas permanecen activas`]
        : []),
      ...(pendingMatchedTasks > 0
        ? [`${pendingMatchedTasks} tareas pendientes`]
        : []),
    ],
  };
}
