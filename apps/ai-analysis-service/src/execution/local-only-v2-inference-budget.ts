// LOCAL_ONLY_V2_16_INFERENCE_BUDGET
//
// Guardas preventivas por inferencia:
// - nunca depender del contexto completo;
// - micro-borrador <= 1.200 tokens y extracción atómica <= 1.600 tokens;
// - num_ctx y timeout se reducen por llamada;
// - si el prompt se acerca al límite, se subdivide ANTES de invocar Ollama;
// - con telemetría de throughput, también puede dividir por tiempo estimado;
// - máximo 4 partes por microbloque; si no cabe, falla cerrado.
//
// El transporte Ollama mantiene compatibilidad: runtimeLimits es opt-in.
// Otros flujos no cambian si no envían ese campo.

import { createHash } from "node:crypto";

import {
  effectiveOllamaLimits,
  OLLAMA_RUNTIME_CONTEXT_CAP,
  type OllamaClient,
  type OllamaRuntimeLimitsOverride,
} from "../local-ai/ollama.client";
import type {
  LocalOnlyV2BlockEvidencePacket,
  LocalOnlyV2SelectedFinding,
} from "./local-only-v2-evidence-selector";
import { LOCAL_ONLY_V2_ATOMIC_OUTPUT_MAX_TOKENS } from "./local-only-v2-atomic-extraction";
import {
  buildLocalOnlyV2MicroDraftTask,
  LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS,
  LOCAL_ONLY_V2_MICRO_DRAFT_MAX_OUTPUT_TOKENS,
  LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
  LOCAL_ONLY_V2_MICRO_DRAFT_TARGET_OUTPUT_TOKENS,
  parseLocalOnlyV2MicroDraftModelOutput,
  type LocalOnlyV2MicroDraft,
  type LocalOnlyV2MicroDraftTask,
} from "./local-only-v2-micro-draft";
import type { LocalOnlyV2TemplateGenerationPlan } from "./local-only-v2-template-planner";

export const LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION = "1.0.0" as const;
export const LOCAL_ONLY_V2_MAX_PROMPT_CONTEXT_RATIO = 0.5;
export const LOCAL_ONLY_V2_MAX_TIMEOUT_FRACTION = 0.5;
export const LOCAL_ONLY_V2_MIN_CALL_TIMEOUT_MS = 30_000;
export const LOCAL_ONLY_V2_MAX_MICRO_DRAFT_SPLIT_PARTS = 4;
export const LOCAL_ONLY_V2_CONTEXT_RESERVE_TOKENS = 1_024;

export type LocalOnlyV2InferenceBudgetReason =
  "PROMPT_CONTEXT_RATIO" | "CONTEXT_HEADROOM" | "PREDICTED_TIME";

export interface LocalOnlyV2RuntimeObservation {
  readonly promptTokensPerSecond?: number;
  readonly outputTokensPerSecond?: number;
}

export interface LocalOnlyV2InferenceRuntimeConfig {
  readonly configuredContextTokens: number;
  readonly configuredMaxOutputTokens: number;
  readonly configuredTimeoutMs: number;
  readonly observation?: LocalOnlyV2RuntimeObservation;
}

export interface LocalOnlyV2InferenceBudgetPolicy {
  readonly maxPromptContextRatio?: number;
  readonly maxTimeoutFraction?: number;
  readonly maxSplitParts?: number;
}

export interface LocalOnlyV2InferenceBudget {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION;
  readonly runtimeContextCapTokens: number;
  readonly configuredMaxOutputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxAtomicOutputTokens: number;
  readonly targetOutputTokens: number;
  readonly maxCallDurationMs: number;
  readonly maxPromptContextRatio: number;
  readonly maxSplitParts: number;
  readonly observation: LocalOnlyV2RuntimeObservation | null;
}

export interface LocalOnlyV2InferenceAssessment {
  readonly allowed: boolean;
  readonly reasons: readonly LocalOnlyV2InferenceBudgetReason[];
  readonly estimatedRequestTokens: number;
  readonly effectiveContextTokens: number;
  readonly effectiveOutputTokens: number;
  readonly promptContextRatio: number;
  readonly contextHeadroomTokens: number;
  readonly predictedDurationMs: number | null;
  readonly runtimeLimits: OllamaRuntimeLimitsOverride;
}

export interface LocalOnlyV2BudgetedMicroDraftPart {
  readonly partId: string;
  readonly partNumber: number;
  readonly partTotal: number;
  readonly packet: LocalOnlyV2BlockEvidencePacket;
  readonly task: LocalOnlyV2MicroDraftTask;
  readonly assessment: LocalOnlyV2InferenceAssessment;
}

export interface LocalOnlyV2BudgetedMicroDraftPlan {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: typeof LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION;
  readonly blockId: string;
  readonly originalEvidenceFingerprint: string;
  readonly splitRequired: boolean;
  readonly originalAssessment: LocalOnlyV2InferenceAssessment;
  readonly parts: readonly LocalOnlyV2BudgetedMicroDraftPart[];
  readonly fingerprint: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function positiveInteger(value: number, name: string, minimum = 1): number {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} debe ser un entero >= ${minimum}.`);
  }
  return value;
}

function ratioBetweenZeroAndOne(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`${name} debe ser > 0 y <= 1.`);
  }
  return value;
}

function optionalRate(
  value: number | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} debe ser > 0 cuando se informa.`);
  }
  return value;
}

export function resolveLocalOnlyV2InferenceBudget(
  runtime: LocalOnlyV2InferenceRuntimeConfig,
  policy: LocalOnlyV2InferenceBudgetPolicy = {},
): LocalOnlyV2InferenceBudget {
  const configuredContextTokens = positiveInteger(
    runtime.configuredContextTokens,
    "configuredContextTokens",
    1_024,
  );
  const configuredMaxOutputTokens = positiveInteger(
    runtime.configuredMaxOutputTokens,
    "configuredMaxOutputTokens",
    256,
  );
  const configuredTimeoutMs = positiveInteger(
    runtime.configuredTimeoutMs,
    "configuredTimeoutMs",
    1_000,
  );

  const maxPromptContextRatio = ratioBetweenZeroAndOne(
    policy.maxPromptContextRatio ?? LOCAL_ONLY_V2_MAX_PROMPT_CONTEXT_RATIO,
    "maxPromptContextRatio",
  );
  const maxTimeoutFraction = ratioBetweenZeroAndOne(
    policy.maxTimeoutFraction ?? LOCAL_ONLY_V2_MAX_TIMEOUT_FRACTION,
    "maxTimeoutFraction",
  );
  const maxSplitParts = positiveInteger(
    policy.maxSplitParts ?? LOCAL_ONLY_V2_MAX_MICRO_DRAFT_SPLIT_PARTS,
    "maxSplitParts",
  );
  if (maxSplitParts > LOCAL_ONLY_V2_MAX_MICRO_DRAFT_SPLIT_PARTS) {
    throw new Error(
      `LOCAL_ONLY_V2 no permite más de ${LOCAL_ONLY_V2_MAX_MICRO_DRAFT_SPLIT_PARTS} partes por microbloque.`,
    );
  }

  const promptTokensPerSecond = optionalRate(
    runtime.observation?.promptTokensPerSecond,
    "promptTokensPerSecond",
  );
  const outputTokensPerSecond = optionalRate(
    runtime.observation?.outputTokensPerSecond,
    "outputTokensPerSecond",
  );

  const runtimeContextCapTokens = Math.min(
    configuredContextTokens,
    OLLAMA_RUNTIME_CONTEXT_CAP,
  );
  const maxOutputTokens = Math.min(
    configuredMaxOutputTokens,
    LOCAL_ONLY_V2_MICRO_DRAFT_MAX_OUTPUT_TOKENS,
  );
  const maxAtomicOutputTokens = Math.min(
    configuredMaxOutputTokens,
    LOCAL_ONLY_V2_ATOMIC_OUTPUT_MAX_TOKENS,
  );

  const fractionalTimeout = Math.floor(
    configuredTimeoutMs * maxTimeoutFraction,
  );
  const maxCallDurationMs = Math.min(
    configuredTimeoutMs,
    Math.max(
      Math.min(configuredTimeoutMs, LOCAL_ONLY_V2_MIN_CALL_TIMEOUT_MS),
      fractionalTimeout,
    ),
  );

  return Object.freeze({
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION,
    runtimeContextCapTokens,
    configuredMaxOutputTokens,
    maxOutputTokens,
    maxAtomicOutputTokens,
    targetOutputTokens: Math.min(
      maxOutputTokens,
      LOCAL_ONLY_V2_MICRO_DRAFT_TARGET_OUTPUT_TOKENS,
    ),
    maxCallDurationMs,
    maxPromptContextRatio,
    maxSplitParts,
    observation:
      promptTokensPerSecond !== undefined || outputTokensPerSecond !== undefined
        ? Object.freeze({
            ...(promptTokensPerSecond !== undefined
              ? { promptTokensPerSecond }
              : {}),
            ...(outputTokensPerSecond !== undefined
              ? { outputTokensPerSecond }
              : {}),
          })
        : null,
  });
}

// AI_ANALYSIS_LOCAL_ONLY_V2_MILESTONES_OUTPUT_BUDGET_V1
//
// El presupuesto genérico recorta maxOutputTokens al límite compartido de
// micro-borrador (1.200) para no alterar el comportamiento de las demás
// secciones. Requerimientos necesita hasta 2.400 tokens de salida para no
// truncarse con subunidades de varios hallazgos funcionales extensos. Esta
// función deriva, únicamente para la planificación de esa sección, un
// presupuesto con un tope de salida mayor, sin superar nunca el máximo
// configurado realmente por el proveedor.
export function deriveLocalOnlyV2InferenceBudgetForOutputCap(
  budget: LocalOnlyV2InferenceBudget,
  candidateMaxOutputTokens: number,
): LocalOnlyV2InferenceBudget {
  const cappedMaxOutputTokens = Math.min(
    budget.configuredMaxOutputTokens,
    positiveInteger(candidateMaxOutputTokens, "candidateMaxOutputTokens"),
  );
  if (cappedMaxOutputTokens <= budget.maxOutputTokens) return budget;

  return Object.freeze({
    ...budget,
    maxOutputTokens: cappedMaxOutputTokens,
  });
}

function estimateRequestTokens(task: LocalOnlyV2MicroDraftTask): number {
  return Math.max(
    1,
    Math.ceil(`${task.prompt}\n${JSON.stringify(task.schema)}`.length / 4),
  );
}

function predictedDurationMs(
  inputTokens: number,
  outputTokens: number,
  observation: LocalOnlyV2RuntimeObservation | null,
): number | null {
  if (
    !observation?.promptTokensPerSecond ||
    !observation?.outputTokensPerSecond
  ) {
    return null;
  }

  return Math.ceil(
    (inputTokens / observation.promptTokensPerSecond +
      outputTokens / observation.outputTokensPerSecond) *
      1_000,
  );
}

export function assessLocalOnlyV2MicroDraftInference(
  task: LocalOnlyV2MicroDraftTask,
  budget: LocalOnlyV2InferenceBudget,
  requestedMaxOutputTokens = budget.maxOutputTokens,
): LocalOnlyV2InferenceAssessment {
  const outputCap = Math.max(
    256,
    Math.min(requestedMaxOutputTokens, budget.maxOutputTokens),
  );
  const requestText = `${task.prompt}\n${JSON.stringify(task.schema)}`;
  const effective = effectiveOllamaLimits(
    requestText,
    budget.runtimeContextCapTokens,
    outputCap,
  );
  const estimatedRequestTokens = estimateRequestTokens(task);
  const promptContextRatio = estimatedRequestTokens / effective.contextTokens;
  const contextHeadroomTokens =
    effective.contextTokens -
    estimatedRequestTokens -
    effective.outputTokens -
    LOCAL_ONLY_V2_CONTEXT_RESERVE_TOKENS;
  const estimatedDuration = predictedDurationMs(
    estimatedRequestTokens,
    effective.outputTokens,
    budget.observation,
  );

  const reasons: LocalOnlyV2InferenceBudgetReason[] = [];
  if (promptContextRatio > budget.maxPromptContextRatio) {
    reasons.push("PROMPT_CONTEXT_RATIO");
  }
  if (contextHeadroomTokens < 0) {
    reasons.push("CONTEXT_HEADROOM");
  }
  if (
    estimatedDuration !== null &&
    estimatedDuration > budget.maxCallDurationMs
  ) {
    reasons.push("PREDICTED_TIME");
  }

  return Object.freeze({
    allowed: reasons.length === 0,
    reasons: Object.freeze(reasons),
    estimatedRequestTokens,
    effectiveContextTokens: effective.contextTokens,
    effectiveOutputTokens: effective.outputTokens,
    promptContextRatio,
    contextHeadroomTokens,
    predictedDurationMs: estimatedDuration,
    runtimeLimits: Object.freeze({
      contextTokens: effective.contextTokens,
      maxOutputTokens: effective.outputTokens,
      timeoutMs: budget.maxCallDurationMs,
    }),
  });
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

function evidenceCharacters(
  findings: readonly LocalOnlyV2SelectedFinding[],
): number {
  return findings.reduce(
    (total, finding) =>
      total +
      finding.description.length +
      finding.occurrences.reduce(
        (occurrenceTotal, occurrence) =>
          occurrenceTotal +
          occurrence.sourceTitle.length +
          occurrence.evidenceText.length,
        0,
      ),
    0,
  );
}

function slicedPacket(
  original: LocalOnlyV2BlockEvidencePacket,
  relevantFindings: readonly LocalOnlyV2SelectedFinding[],
  partNumber: number,
  partTotal: number,
): LocalOnlyV2BlockEvidencePacket {
  if (
    partTotal === 1 &&
    relevantFindings.length === original.relevantFindings.length &&
    relevantFindings.every(
      (finding, index) =>
        finding.canonicalId === original.relevantFindings[index]?.canonicalId,
    )
  ) {
    return original;
  }

  const guardFindings = original.guardFindings;
  const allFindings = [...relevantFindings, ...guardFindings];
  const selectedFindingIds = uniqueInOrder(
    allFindings.map((finding) => finding.canonicalId),
  );
  const sourceIds = uniqueInOrder(
    allFindings.flatMap((finding) => finding.sourceIds),
  );
  const segmentIds = uniqueInOrder(
    allFindings.flatMap((finding) => finding.segmentIds),
  );
  const questionnaireFindingCount = new Set(
    allFindings
      .filter((finding) => finding.mandatoryQuestionnaireEvidence)
      .map((finding) => finding.canonicalId),
  ).size;
  const chars = evidenceCharacters(allFindings);

  // Spread `original` first so any extra field a specialized selector added
  // (e.g. LOCAL_ONLY_V2's diagramArtifact tag for processFlow subunits)
  // survives a re-slice; the explicit fields below still take precedence.
  const withoutFingerprint = {
    ...original,
    pipelineId: original.pipelineId,
    schemaVersion: original.schemaVersion,
    projectId: original.projectId,
    knowledgeFingerprint: original.knowledgeFingerprint,
    templatePlanFingerprint: original.templatePlanFingerprint,
    blockId: original.blockId,
    blockNumber: original.blockNumber,
    blockTotal: original.blockTotal,
    sectionKey: original.sectionKey,
    title: original.title,
    required: original.required,
    guidance: original.guidance,
    relevantFindings: Object.freeze([...relevantFindings]),
    guardFindings: original.guardFindings,
    selectedFindingIds,
    sourceIds,
    segmentIds,
    metrics: Object.freeze({
      relevantFindingCount: relevantFindings.length,
      guardFindingCount: guardFindings.length,
      totalFindingCount: selectedFindingIds.length,
      questionnaireFindingCount,
      sourceCount: sourceIds.length,
      segmentCount: segmentIds.length,
      evidenceCharacterCount: chars,
      estimatedEvidenceTokens: Math.max(1, Math.ceil(chars / 4)),
    }),
  };

  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(
      JSON.stringify({
        originalFingerprint: original.fingerprint,
        partNumber,
        partTotal,
        selectedFindingIds,
        sourceIds,
        segmentIds,
      }),
    ),
  });
}

function partitionRelevantFindings(
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  budget: LocalOnlyV2InferenceBudget,
  requestedMaxOutputTokens: number,
  maximumParts: number,
): readonly (readonly LocalOnlyV2SelectedFinding[])[] | null {
  if (packet.relevantFindings.length === 0) {
    const task = buildLocalOnlyV2MicroDraftTask(plan, packet);
    return assessLocalOnlyV2MicroDraftInference(
      task,
      budget,
      requestedMaxOutputTokens,
    ).allowed
      ? Object.freeze([Object.freeze([])])
      : null;
  }

  const groups: LocalOnlyV2SelectedFinding[][] = [];
  let current: LocalOnlyV2SelectedFinding[] = [];

  for (const finding of packet.relevantFindings) {
    const tentative = [...current, finding];
    const tentativePacket = slicedPacket(packet, tentative, 1, 1);
    const tentativeTask = buildLocalOnlyV2MicroDraftTask(plan, tentativePacket);
    const assessment = assessLocalOnlyV2MicroDraftInference(
      tentativeTask,
      budget,
      requestedMaxOutputTokens,
    );

    if (assessment.allowed) {
      current = tentative;
      continue;
    }

    if (current.length === 0) {
      return null;
    }

    groups.push(current);
    if (groups.length >= maximumParts) return null;
    current = [finding];

    const singlePacket = slicedPacket(packet, current, 1, 1);
    const singleTask = buildLocalOnlyV2MicroDraftTask(plan, singlePacket);
    if (
      !assessLocalOnlyV2MicroDraftInference(
        singleTask,
        budget,
        requestedMaxOutputTokens,
      ).allowed
    ) {
      return null;
    }
  }

  if (current.length > 0) groups.push(current);
  if (groups.length > maximumParts) return null;

  return Object.freeze(groups.map((group) => Object.freeze([...group])));
}

export function buildLocalOnlyV2BudgetedMicroDraftPlan(
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  budget: LocalOnlyV2InferenceBudget,
): LocalOnlyV2BudgetedMicroDraftPlan {
  const originalTask = buildLocalOnlyV2MicroDraftTask(plan, packet);
  const originalAssessment = assessLocalOnlyV2MicroDraftInference(
    originalTask,
    budget,
  );

  if (originalAssessment.allowed) {
    const part = Object.freeze({
      partId: `${originalTask.taskId}:part:001`,
      partNumber: 1,
      partTotal: 1,
      packet,
      task: originalTask,
      assessment: originalAssessment,
    });
    const withoutFingerprint = {
      pipelineId: "LOCAL_ONLY_V2" as const,
      schemaVersion: LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION,
      blockId: packet.blockId,
      originalEvidenceFingerprint: packet.fingerprint,
      splitRequired: false,
      originalAssessment,
      parts: Object.freeze([part]),
    };
    return Object.freeze({
      ...withoutFingerprint,
      fingerprint: sha256(
        JSON.stringify({
          blockId: packet.blockId,
          originalEvidenceFingerprint: packet.fingerprint,
          partFingerprints: [packet.fingerprint],
          runtimeLimits: [part.assessment.runtimeLimits],
        }),
      ),
    });
  }

  for (let divisor = 2; divisor <= budget.maxSplitParts; divisor += 1) {
    const requestedMaxOutputTokens = Math.max(
      256,
      Math.floor(budget.maxOutputTokens / divisor),
    );
    const groups = partitionRelevantFindings(
      plan,
      packet,
      budget,
      requestedMaxOutputTokens,
      divisor,
    );
    if (!groups) continue;

    const partTotal = groups.length;
    const parts: LocalOnlyV2BudgetedMicroDraftPart[] = [];
    let valid = true;

    for (let index = 0; index < groups.length; index += 1) {
      const partPacket = slicedPacket(
        packet,
        groups[index]!,
        index + 1,
        partTotal,
      );
      const task = buildLocalOnlyV2MicroDraftTask(plan, partPacket);
      const assessment = assessLocalOnlyV2MicroDraftInference(
        task,
        budget,
        requestedMaxOutputTokens,
      );
      if (!assessment.allowed) {
        valid = false;
        break;
      }
      parts.push(
        Object.freeze({
          partId: `${task.taskId}:part:${String(index + 1).padStart(3, "0")}`,
          partNumber: index + 1,
          partTotal,
          packet: partPacket,
          task,
          assessment,
        }),
      );
    }

    if (!valid || parts.length === 0) continue;

    const withoutFingerprint = {
      pipelineId: "LOCAL_ONLY_V2" as const,
      schemaVersion: LOCAL_ONLY_V2_INFERENCE_BUDGET_SCHEMA_VERSION,
      blockId: packet.blockId,
      originalEvidenceFingerprint: packet.fingerprint,
      splitRequired: parts.length > 1,
      originalAssessment,
      parts: Object.freeze(parts),
    };

    return Object.freeze({
      ...withoutFingerprint,
      fingerprint: sha256(
        JSON.stringify({
          blockId: packet.blockId,
          originalEvidenceFingerprint: packet.fingerprint,
          partFingerprints: parts.map((part) => part.packet.fingerprint),
          runtimeLimits: parts.map((part) => part.assessment.runtimeLimits),
        }),
      ),
    });
  }

  throw new Error(
    `LOCAL_ONLY_V2 no puede ejecutar ${packet.blockId} dentro del presupuesto aun después de ${budget.maxSplitParts} partes.`,
  );
}

function materializePartDraft(
  task: LocalOnlyV2MicroDraftTask,
  packet: LocalOnlyV2BlockEvidencePacket,
  content: string,
): LocalOnlyV2MicroDraft {
  const contentCharacters = content.length;
  const estimatedContentTokens = Math.max(1, Math.ceil(contentCharacters / 4));
  const withoutFingerprint = {
    pipelineId: "LOCAL_ONLY_V2" as const,
    schemaVersion: LOCAL_ONLY_V2_MICRO_DRAFT_SCHEMA_VERSION,
    taskId: task.taskId,
    blockId: task.blockId,
    sectionKey: task.sectionKey,
    blockNumber: task.blockNumber,
    blockTotal: task.blockTotal,
    required: task.required,
    content,
    contentCharacters,
    estimatedContentTokens,
    evidenceFingerprint: packet.fingerprint,
    templatePlanFingerprint: task.templatePlanFingerprint,
    selectedFindingIds: packet.selectedFindingIds,
    sourceIds: packet.sourceIds,
    segmentIds: packet.segmentIds,
    questionnaireFindingCount: packet.metrics.questionnaireFindingCount,
  };
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: sha256(JSON.stringify(withoutFingerprint)),
  });
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

function combinePartDrafts(
  originalPacket: LocalOnlyV2BlockEvidencePacket,
  partPlan: LocalOnlyV2BudgetedMicroDraftPlan,
  drafts: readonly LocalOnlyV2MicroDraft[],
): LocalOnlyV2MicroDraft {
  if (drafts.length !== partPlan.parts.length || drafts.length === 0) {
    throw new Error(
      "LOCAL_ONLY_V2 no puede combinar un número incompleto de partes.",
    );
  }

  if (drafts.length === 1 && partPlan.parts[0]!.packet === originalPacket) {
    return drafts[0]!;
  }

  const coveredFindingIds = uniqueInOrder(
    partPlan.parts.flatMap((part) => part.packet.selectedFindingIds),
  );
  if (!sameSet(coveredFindingIds, originalPacket.selectedFindingIds)) {
    throw new Error(
      "LOCAL_ONLY_V2 detectó pérdida de evidencia durante el auto-split.",
    );
  }

  const content = drafts
    .map((draft) => draft.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  if (!content) {
    throw new Error("LOCAL_ONLY_V2 no puede combinar partes vacías.");
  }
  if (content.length > LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS) {
    throw new Error(
      `LOCAL_ONLY_V2 combinó ${content.length} caracteres y excede el máximo ${LOCAL_ONLY_V2_MICRO_DRAFT_MAX_CONTENT_CHARACTERS}.`,
    );
  }

  const firstTask = partPlan.parts[0]!.task;
  return materializePartDraft(
    Object.freeze({
      ...firstTask,
      taskId: `micro-draft:${originalPacket.blockId}`,
      evidenceFingerprint: originalPacket.fingerprint,
    }),
    originalPacket,
    content,
  );
}

export async function generateLocalOnlyV2BudgetedMicroDraftWithOllama(
  client: Pick<OllamaClient, "generate">,
  plan: LocalOnlyV2TemplateGenerationPlan,
  packet: LocalOnlyV2BlockEvidencePacket,
  budget: LocalOnlyV2InferenceBudget,
  cancellationSignal?: AbortSignal,
): Promise<LocalOnlyV2MicroDraft> {
  const budgetedPlan = buildLocalOnlyV2BudgetedMicroDraftPlan(
    plan,
    packet,
    budget,
  );
  const drafts: LocalOnlyV2MicroDraft[] = [];

  for (const part of budgetedPlan.parts) {
    const raw = await client.generate(
      part.task.prompt,
      part.task.schema,
      undefined,
      {
        sourceId: part.partId,
        sourceTitle: packet.title,
        sourceClassification: "LOCAL_ONLY_V2_MICRO_DRAFT_BUDGETED",
      },
      cancellationSignal,
      {
        profile: "LOCAL_DOCUMENT",
        runtimeLimits: part.assessment.runtimeLimits,
      },
    );
    const output = parseLocalOnlyV2MicroDraftModelOutput(raw);
    drafts.push(materializePartDraft(part.task, part.packet, output.content));
  }

  return combinePartDrafts(packet, budgetedPlan, drafts);
}
