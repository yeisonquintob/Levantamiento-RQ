// LOCAL_ONLY_V2_03_TOKEN_BUDGET_SEGMENTATION
//
// Segmentación determinística y exclusiva de LOCAL_ONLY_V2.
// No modifica ni reutiliza el chunking histórico por 8.000 caracteres.
//
// Política por defecto:
// - objetivo: 2.048 tokens estimados por fragmento;
// - máximo técnico: 3.072 tokens estimados;
// - el máximo nunca puede superar 1/8 del contexto configurado;
// - preferencia de corte: párrafo -> línea -> oración -> palabra -> corte duro.
//
// La estimación usa el mismo estimador conservado por el proyecto
// (estimateAiPromptTokens) para mantener una sola semántica de presupuesto.

import { estimateAiPromptTokens } from "./ai-prompt-builder";
import type {
  LocalOnlyV2EvidenceSource,
  LocalOnlyV2PreparedEvidenceInput,
} from "./local-only-v2-questionnaire-evidence";

export const LOCAL_ONLY_V2_DEFAULT_TARGET_CHUNK_TOKENS = 2_048;
export const LOCAL_ONLY_V2_DEFAULT_MAX_CHUNK_TOKENS = 3_072;
export const LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION = 1 / 8;

export type LocalOnlyV2SegmentBoundary =
  "PARAGRAPH" | "LINE" | "SENTENCE" | "WORD" | "HARD" | "END";

export interface LocalOnlyV2SegmentationBudget {
  readonly contextTokens: number;
  readonly targetChunkTokens: number;
  readonly maxChunkTokens: number;
  readonly contextFractionCapTokens: number;
  readonly maxContextFraction: number;
}

export interface LocalOnlyV2Segment {
  readonly segmentId: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourcePosition: number;
  readonly segmentIndex: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly text: string;
  readonly estimatedTokens: number;
  readonly contextUsageRatio: number;
  readonly boundary: LocalOnlyV2SegmentBoundary;
  readonly mandatoryQuestionnaireEvidence: boolean;
}

export interface LocalOnlyV2SegmentedEvidenceInput {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly budget: LocalOnlyV2SegmentationBudget;
  readonly segments: readonly LocalOnlyV2Segment[];
  readonly questionnaireSourceId: string;
  readonly questionnaireSegmentCount: number;
}

export interface LocalOnlyV2SegmentationBudgetOptions {
  readonly targetChunkTokens?: number;
  readonly maxChunkTokens?: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return value;
}

export function resolveLocalOnlyV2SegmentationBudget(
  contextTokens: number,
  options: LocalOnlyV2SegmentationBudgetOptions = {},
): LocalOnlyV2SegmentationBudget {
  const context = positiveInteger(contextTokens, "contextTokens");
  if (context < 1_024) {
    throw new Error(
      "LOCAL_ONLY_V2 requiere un contexto de al menos 1.024 tokens.",
    );
  }

  const contextFractionCapTokens = Math.max(
    1,
    Math.floor(context * LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION),
  );
  const requestedMaximum = positiveInteger(
    options.maxChunkTokens ?? LOCAL_ONLY_V2_DEFAULT_MAX_CHUNK_TOKENS,
    "maxChunkTokens",
  );
  const maxChunkTokens = Math.min(requestedMaximum, contextFractionCapTokens);

  const requestedTarget =
    options.targetChunkTokens ??
    Math.min(LOCAL_ONLY_V2_DEFAULT_TARGET_CHUNK_TOKENS, maxChunkTokens);
  const targetChunkTokens = positiveInteger(
    requestedTarget,
    "targetChunkTokens",
  );

  if (targetChunkTokens > maxChunkTokens) {
    throw new Error(
      "targetChunkTokens no puede superar maxChunkTokens en LOCAL_ONLY_V2.",
    );
  }

  return Object.freeze({
    contextTokens: context,
    targetChunkTokens,
    maxChunkTokens,
    contextFractionCapTokens,
    maxContextFraction: LOCAL_ONLY_V2_MAX_CONTEXT_FRACTION,
  });
}

function literalBoundaryCandidates(
  text: string,
  start: number,
  hardEnd: number,
  separator: string,
): number[] {
  const candidates: number[] = [];
  let cursor = text.indexOf(separator, start);

  while (cursor >= 0 && cursor < hardEnd) {
    const end = cursor + separator.length;
    if (end <= hardEnd) candidates.push(end);
    cursor = text.indexOf(separator, cursor + 1);
  }

  return candidates;
}

function regexBoundaryCandidates(
  text: string,
  start: number,
  hardEnd: number,
  expression: RegExp,
): number[] {
  const candidates: number[] = [];
  const slice = text.slice(start, hardEnd);

  for (const match of slice.matchAll(expression)) {
    if (match.index === undefined) continue;
    candidates.push(start + match.index + match[0].length);
  }

  return candidates;
}

function closestBoundary(
  candidates: readonly number[],
  minimumEnd: number,
  desiredEnd: number,
  hardEnd: number,
): number | null {
  let selected: number | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate < minimumEnd || candidate > hardEnd) continue;
    const distance = Math.abs(candidate - desiredEnd);
    if (
      distance < selectedDistance ||
      (distance === selectedDistance &&
        selected !== null &&
        candidate < selected)
    ) {
      selected = candidate;
      selectedDistance = distance;
    }
  }

  return selected;
}

function semanticBoundary(
  text: string,
  start: number,
  desiredEnd: number,
  hardEnd: number,
): { end: number; boundary: LocalOnlyV2SegmentBoundary } {
  const minimumEnd = Math.min(
    hardEnd,
    start + Math.max(1, Math.floor((desiredEnd - start) * 0.5)),
  );

  const paragraphCandidates = [
    ...literalBoundaryCandidates(text, start, hardEnd, "\r\n\r\n"),
    ...literalBoundaryCandidates(text, start, hardEnd, "\n\n"),
  ];
  const paragraph = closestBoundary(
    paragraphCandidates,
    minimumEnd,
    desiredEnd,
    hardEnd,
  );
  if (paragraph !== null) return { end: paragraph, boundary: "PARAGRAPH" };

  const lineCandidates = [
    ...literalBoundaryCandidates(text, start, hardEnd, "\r\n"),
    ...literalBoundaryCandidates(text, start, hardEnd, "\n"),
  ];
  const line = closestBoundary(lineCandidates, minimumEnd, desiredEnd, hardEnd);
  if (line !== null) return { end: line, boundary: "LINE" };

  const sentence = closestBoundary(
    regexBoundaryCandidates(
      text,
      start,
      hardEnd,
      /[.!?](?:["')\]]?)(?:\s+|$)/gu,
    ),
    minimumEnd,
    desiredEnd,
    hardEnd,
  );
  if (sentence !== null) return { end: sentence, boundary: "SENTENCE" };

  const word = closestBoundary(
    regexBoundaryCandidates(text, start, hardEnd, /\s+/gu),
    minimumEnd,
    desiredEnd,
    hardEnd,
  );
  if (word !== null) return { end: word, boundary: "WORD" };

  return { end: desiredEnd, boundary: "HARD" };
}

export function segmentLocalOnlyV2Source(
  source: LocalOnlyV2EvidenceSource,
  budget: LocalOnlyV2SegmentationBudget,
  mandatoryQuestionnaireSourceId?: string,
): readonly LocalOnlyV2Segment[] {
  const text = source.snapshotText ?? "";
  if (!text) return [];

  const targetCharacters = budget.targetChunkTokens * 4;
  const maximumCharacters = budget.maxChunkTokens * 4;
  const sourceTitle = source.sourceTitle?.trim() || "Fuente sin título";
  const mandatoryQuestionnaireEvidence =
    source.sourceId === mandatoryQuestionnaireSourceId;

  const segments: LocalOnlyV2Segment[] = [];
  let start = 0;

  while (start < text.length) {
    const remainingCharacters = text.length - start;
    let end: number;
    let boundary: LocalOnlyV2SegmentBoundary;

    if (remainingCharacters <= maximumCharacters) {
      end = text.length;
      boundary = "END";
    } else {
      const desiredEnd = Math.min(start + targetCharacters, text.length);
      const hardEnd = Math.min(start + maximumCharacters, text.length);
      const resolved = semanticBoundary(text, start, desiredEnd, hardEnd);
      end = resolved.end;
      boundary = resolved.boundary;
    }

    if (end <= start) {
      throw new Error(
        `LOCAL_ONLY_V2 no pudo avanzar al segmentar la fuente ${source.sourceId}.`,
      );
    }

    const segmentText = text.slice(start, end);
    const estimatedTokens = estimateAiPromptTokens(segmentText);
    if (estimatedTokens > budget.maxChunkTokens) {
      throw new Error(
        `LOCAL_ONLY_V2 produjo un fragmento de ${estimatedTokens} tokens y excede el máximo ${budget.maxChunkTokens}.`,
      );
    }

    const segmentIndex = segments.length;
    segments.push(
      Object.freeze({
        segmentId: `${source.sourceId}#${String(segmentIndex + 1).padStart(4, "0")}`,
        sourceId: source.sourceId,
        sourceTitle,
        sourcePosition: source.position,
        segmentIndex,
        startCharacter: start,
        endCharacter: end,
        text: segmentText,
        estimatedTokens,
        contextUsageRatio: estimatedTokens / budget.contextTokens,
        boundary,
        mandatoryQuestionnaireEvidence,
      }),
    );

    start = end;
  }

  return Object.freeze(segments);
}

export function segmentLocalOnlyV2PreparedEvidence(
  prepared: LocalOnlyV2PreparedEvidenceInput,
  budget: LocalOnlyV2SegmentationBudget,
): LocalOnlyV2SegmentedEvidenceInput {
  const segments = prepared.sources.flatMap((source) =>
    segmentLocalOnlyV2Source(
      source,
      budget,
      prepared.selectedQuestionnaire.sourceId,
    ),
  );

  const questionnaireSegmentCount = segments.filter(
    (segment) => segment.mandatoryQuestionnaireEvidence,
  ).length;

  if (questionnaireSegmentCount === 0) {
    throw new Error(
      "LOCAL_ONLY_V2 perdió la evidencia obligatoria del cuestionario durante la segmentación.",
    );
  }

  return Object.freeze({
    pipelineId: prepared.pipeline.pipelineId,
    budget,
    segments: Object.freeze(segments),
    questionnaireSourceId: prepared.selectedQuestionnaire.sourceId,
    questionnaireSegmentCount,
  });
}
