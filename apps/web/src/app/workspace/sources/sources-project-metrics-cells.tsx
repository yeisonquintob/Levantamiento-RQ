"use client";

import { useEffect, useState } from "react";

import type {
  AiAnalysisRequestListResponse,
  AiAnalysisRequestSummary,
  AiAnalysisStatus,
  SourceListResponse,
  SourceMetrics,
} from "@levantamiento-rq/shared-contracts";
import { RqStatusBadge } from "@levantamiento-rq/shared-ui";

import { authenticatedFetch } from "../../authenticated-fetch";
import { aiGenerationLabel } from "../ai-generation-label";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface ProjectSourceMetrics {
  textual: number;
  total: number;
  hasDiscussion: boolean;
  processed: boolean;
  processedAt: string | null;
  aiUsed: string | null;
  generationStatus: AiAnalysisStatus | "NONE" | "UNAVAILABLE" | "LOADING";
}

const EMPTY_METRICS: ProjectSourceMetrics = {
  textual: 0,
  total: 0,
  hasDiscussion: false,
  processed: false,
  processedAt: null,
  aiUsed: null,
  generationStatus: "LOADING",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function isDiscussionSource(
  source: SourceListResponse["items"][number],
): boolean {
  return (
    source.sourceType === "CONVERSATION" &&
    source.title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/gu, "")
      .toUpperCase()
      .startsWith("PREGUNTAS DE ANALISIS")
  );
}

export function latestSourceGeneration(
  items: readonly AiAnalysisRequestSummary[],
) {
  return items
    .filter((item) => item.analysisType === "REQUIREMENT_DOCUMENT")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

const PROCESSING_LABELS = {
  PENDING: "En cola",
  PROCESSING: "Procesando",
  COMPLETED: "Completado",
  FAILED: "Fallido",
  CANCELLED: "Cancelado",
  NONE: "Sin iniciar",
  UNAVAILABLE: "No disponible",
  LOADING: "Cargando…",
};

export function SourcesProjectMetricsCells({
  projectId,
  onMetricsResolved,
}: {
  projectId: string;
  onMetricsResolved?: (
    projectId: string,
    metrics: ProjectSourceMetrics,
  ) => void;
}) {
  const [metrics, setMetrics] = useState<ProjectSourceMetrics>(EMPTY_METRICS);

  useEffect(() => {
    let active = true;
    const encodedProjectId = encodeURIComponent(projectId);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () =>
      Promise.all([
        authenticatedFetch(
          `${GATEWAY_URL}/api/v1/projects/${encodedProjectId}/sources/summary`,
          {
            credentials: "include",
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        ),
        authenticatedFetch(
          `${GATEWAY_URL}/api/v1/projects/${encodedProjectId}/sources?page=1&pageSize=50&status=ACTIVE`,
          {
            credentials: "include",
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        ),
        authenticatedFetch(
          `${GATEWAY_URL}/api/v1/projects/${encodedProjectId}/analysis-requests?page=1&pageSize=100`,
          {
            credentials: "include",
            signal: controller.signal,
            headers: { accept: "application/json" },
          },
        ),
      ])
        .then(async ([summaryResponse, listResponse, analysesResponse]) => {
          if (!summaryResponse.ok || !listResponse.ok || !analysesResponse.ok)
            throw new Error();
          const summary = (await summaryResponse.json()) as SourceMetrics;
          const list = (await listResponse.json()) as SourceListResponse;
          const analyses =
            (await analysesResponse.json()) as AiAnalysisRequestListResponse;
          const activeSources = list.items.filter(
            (source) => source.status === "ACTIVE",
          );
          const completedGenerations = analyses.items
            .filter(
              (analysis) =>
                analysis.analysisType === "REQUIREMENT_DOCUMENT" &&
                analysis.status === "COMPLETED" &&
                analysis.sourceCount > 0,
            )
            .sort(
              (left, right) =>
                Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
            );
          const latestGeneration = completedGenerations[0];
          const processed = Boolean(latestGeneration);
          if (!active) return;
          const nextMetrics = {
            textual:
              summary.notes + summary.conversations + summary.transcripts,
            total: summary.total,
            hasDiscussion: activeSources.some(isDiscussionSource),
            processed,
            processedAt: latestGeneration?.updatedAt ?? null,
            aiUsed: latestGeneration
              ? aiGenerationLabel(latestGeneration)
              : null,
            generationStatus:
              latestSourceGeneration(analyses.items)?.status ??
              ("NONE" as const),
          };
          setMetrics(nextMetrics);
          onMetricsResolved?.(projectId, nextMetrics);
        })
        .catch(() => {
          if (active)
            setMetrics((previous) => ({
              ...previous,
              generationStatus: "UNAVAILABLE",
            }));
        })
        .finally(() => {
          if (active) timer = setTimeout(() => void refresh(), 10000);
        });
    void refresh();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [onMetricsResolved, projectId]);

  return (
    <>
      <td className="rq-sources-index__number">{metrics.textual}</td>
      <td className="rq-sources-index__number">{metrics.total}</td>
      <td>
        <RqStatusBadge tone={metrics.hasDiscussion ? "success" : "neutral"}>
          {metrics.hasDiscussion ? "Sí" : "No"}
        </RqStatusBadge>
      </td>
      <td>
        <RqStatusBadge tone={metrics.processed ? "success" : "pending"}>
          {metrics.processed ? "Sí" : "No"}
        </RqStatusBadge>
      </td>
      <td>
        <RqStatusBadge
          tone={
            metrics.generationStatus === "COMPLETED"
              ? "success"
              : metrics.generationStatus === "FAILED"
                ? "danger"
                : metrics.generationStatus === "PROCESSING" ||
                    metrics.generationStatus === "PENDING"
                  ? "process"
                  : "inactive"
          }
        >
          {PROCESSING_LABELS[metrics.generationStatus]}
        </RqStatusBadge>
      </td>
      <td>
        {metrics.processedAt ? formatDate(metrics.processedAt) : "Sin procesar"}
      </td>
      <td>{metrics.aiUsed ?? "Sin generación"}</td>
    </>
  );
}
