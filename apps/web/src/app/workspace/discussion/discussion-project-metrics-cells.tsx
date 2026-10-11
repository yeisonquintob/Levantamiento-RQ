"use client";

import type { ViabilityConfiguration } from "@levantamiento-rq/shared-contracts";
import { evaluateDiscussionViability } from "@levantamiento-rq/shared-contracts";
import { RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { REQUIREMENTS_QUESTION_IDS } from "../sources/source-capture-helpers";
import { calculateAnswerDefinitionLevel } from "../home-stage-progress";

export interface DiscussionMetrics {
  answered: number;
  total: number;
  localGenerated: number;
  cloudGenerated: number;
  localProcessedAt: string | null;
  cloudProcessedAt: string | null;
  viabilityState: unknown;
}

export const EMPTY_METRICS: DiscussionMetrics = {
  answered: 0,
  total: REQUIREMENTS_QUESTION_IDS.length,
  localGenerated: 0,
  cloudGenerated: 0,
  localProcessedAt: null,
  cloudProcessedAt: null,
  viabilityState: null,
};

function objectRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function countGeneratedAnswers(value: unknown): number {
  const result = objectRecord(value);
  const answers = objectRecord(result?.answers);
  if (!answers) return 0;

  return REQUIREMENTS_QUESTION_IDS.filter((questionId) => {
    const answer = answers[questionId];
    return typeof answer === "string" && answer.trim().length > 0;
  }).length;
}

function readProcessedAt(value: unknown): string | null {
  const result = objectRecord(value);
  if (typeof result?.processedAt !== "string") return null;
  const timestamp = Date.parse(result.processedAt);
  return Number.isFinite(timestamp) && timestamp > 0
    ? result.processedAt
    : null;
}

function formatProcessedAt(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function readDiscussionMetrics(projectId: string): DiscussionMetrics {
  const total = REQUIREMENTS_QUESTION_IDS.length;

  try {
    const raw = window.localStorage.getItem(
      `rq-requirement-discussion-v1:${projectId}`,
    );
    if (!raw) return { ...EMPTY_METRICS, total };

    const state = objectRecord(JSON.parse(raw));
    const answers = objectRecord(state?.answers) ?? {};

    const answered = REQUIREMENTS_QUESTION_IDS.filter((questionId) => {
      const answer = objectRecord(answers[questionId]);
      return (
        typeof answer?.answer === "string" && answer.answer.trim().length > 0
      );
    }).length;

    let localGenerated = countGeneratedAnswers(state?.localResult);
    let cloudGenerated = countGeneratedAnswers(state?.cloudResult);

    // Compatibilidad con el formato anterior de Discusión.
    if (localGenerated === 0 && cloudGenerated === 0) {
      const legacyAnswers = objectRecord(state?.processedAnswers) ?? {};
      const legacyGenerated = REQUIREMENTS_QUESTION_IDS.filter((questionId) => {
        const answer = legacyAnswers[questionId];
        return typeof answer === "string" && answer.trim().length > 0;
      }).length;

      if (legacyGenerated > 0) {
        if (state?.provider === "CLOUD") cloudGenerated = legacyGenerated;
        else localGenerated = legacyGenerated;
      }
    }

    return {
      answered,
      total,
      localGenerated,
      cloudGenerated,
      localProcessedAt: readProcessedAt(state?.localResult),
      cloudProcessedAt: readProcessedAt(state?.cloudResult),
      viabilityState: state,
    };
  } catch {
    return { ...EMPTY_METRICS, total };
  }
}

export type DiscussionViabilitySummary = ReturnType<
  typeof evaluateDiscussionViability
>;

/** Evalúa la viabilidad de un proyecto con lo guardado en este navegador. */
export function evaluateRowViability(
  metrics: DiscussionMetrics,
  viability?: ViabilityConfiguration,
): DiscussionViabilitySummary | null {
  const state = objectRecord(metrics.viabilityState);
  if (!viability || !state) return null;
  const asEvidence = (value: unknown, manual = false) => {
    const result: Record<
      string,
      { answer: string; definitionPercentage: number }
    > = {};
    const source = manual
      ? objectRecord(value)
      : objectRecord(objectRecord(value)?.answers);
    for (const id of REQUIREMENTS_QUESTION_IDS) {
      const raw = source?.[id];
      const answer = manual ? objectRecord(raw)?.answer : raw;
      if (typeof answer === "string") {
        result[id] = {
          answer,
          definitionPercentage: manual
            ? Number(objectRecord(raw)?.score ?? 0) * 10
            : calculateAnswerDefinitionLevel(answer),
        };
      }
    }
    return result;
  };
  return evaluateDiscussionViability({
    questionIds: REQUIREMENTS_QUESTION_IDS,
    manual: asEvidence(state.answers, true),
    local: asEvidence(state.localResult),
    cloud: asEvidence(state.cloudResult),
    criteria: viability.criteria,
    discrepancyThreshold: viability.discrepancyThreshold,
  });
}

export function DiscussionProjectMetricsCells({
  metrics,
  summary,
}: {
  metrics: DiscussionMetrics;
  summary: DiscussionViabilitySummary | null;
}) {
  const hasLocal = metrics.localGenerated > 0;
  const hasCloud = metrics.cloudGenerated > 0;

  return (
    <>
      <td className="rq-discussion-index__answers">
        <strong>
          {metrics.answered}/{metrics.total}
        </strong>
      </td>

      <td className="rq-discussion-index__generated">
        {hasLocal && hasCloud ? (
          <>
            <strong>IA local + nube</strong>
            <span>
              Local {metrics.localGenerated}/{metrics.total} · Nube{" "}
              {metrics.cloudGenerated}/{metrics.total}
            </span>
          </>
        ) : hasLocal ? (
          <>
            <strong>IA local</strong>
            <span>
              {metrics.localGenerated}/{metrics.total}
            </span>
          </>
        ) : hasCloud ? (
          <>
            <strong>IA nube</strong>
            <span>
              {metrics.cloudGenerated}/{metrics.total}
            </span>
          </>
        ) : (
          <>
            <strong>No</strong>
            <span>
              {metrics.answered > 0 ? "Solo escritas" : "Sin generar"}
            </span>
          </>
        )}
      </td>

      <td className="rq-discussion-index__viability">
        {summary ? (
          <RqStatusBadge
            tone={
              summary.consolidated.evaluation.viable ? "success" : "pending"
            }
          >
            {summary.consolidated.definitionPercentage}% ·{" "}
            {summary.consolidated.evaluation.name}
          </RqStatusBadge>
        ) : (
          <span>Sin evaluación</span>
        )}
      </td>

      <td className="rq-discussion-index__useful">
        {summary ? (
          <span>
            {summary.consolidated.usable} útiles ·{" "}
            {summary.local.requiresReview + summary.cloud.requiresReview} por
            revisar
          </span>
        ) : (
          <span>—</span>
        )}
      </td>

      <td className="rq-discussion-index__dates">
        {metrics.localProcessedAt ? (
          <span>
            <strong>Local</strong> {formatProcessedAt(metrics.localProcessedAt)}
          </span>
        ) : null}
        {metrics.cloudProcessedAt ? (
          <span>
            <strong>Nube</strong> {formatProcessedAt(metrics.cloudProcessedAt)}
          </span>
        ) : null}
        {!metrics.localProcessedAt && !metrics.cloudProcessedAt ? (
          <span>Sin fecha</span>
        ) : null}
      </td>
    </>
  );
}
