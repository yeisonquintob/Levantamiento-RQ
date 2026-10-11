"use client";

import type { DragEvent, FormEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTokenBreakdownRows } from "./source-token-breakdown";
import {
  BlockDuration,
  StallNotice,
  formatGenerationElapsed,
} from "./live-clock";

export { formatGenerationElapsed };
import { SourcesGenerationPanel } from "./sources-generation-panel";
import {
  describeGenerationOutcome,
  sourceGenerationCell,
  sourcePreparationLabel,
  type GenerationOutcomeAction,
} from "./sources-generation-summary";

import type {
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiAnalysisRequestSummary,
  AiAnalysisTokenEstimateResponse,
  AiEngine,
  CreateTextSourceRequest,
  ProjectListResponse,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
  SourceBatchProcessingResponse,
  SourceClassification,
  SourceDetail,
  SourceListResponse,
  SourceMetrics,
  SourceProcessingStatus,
  SourceStatus,
  SourceSummary,
  SourceType,
  SourceUploadBatchResponse,
  TextSourceType,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

import { authenticatedFetch } from "../../authenticated-fetch";
import { createBrowserUuid } from "../../browser-uuid";
import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { AiProcessingMenu, useAiEngineSelection } from "../ai-engine-selection";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import {
  aiGenerationModeDescription,
  aiGenerationModeExecutedLabel,
  aiGenerationModeLabel,
  generationStageIndex,
  generationStageSequence,
  humanizeTechnicalStagePath,
  localDraftOperationLabel,
  resolveAiGenerationMode,
  resolveTrackedGenerationMode,
} from "../ai-generation-mode";
import {
  appendUniqueSourceFiles,
  parseDiscussionSourceSelectionCounts,
  sourceFileSelectionKey,
} from "./source-capture-helpers";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useConfirm } from "../../confirm-dialog";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const FILE_ACCEPT = ".pdf,.docx,.xlsx,.txt,.vtt,.csv,.png,.jpg,.jpeg,.webp";
const TEXT_SOURCE_CONTENT_LIMIT = 200_000;

function isLocalOnlyConversationSource(source: SourceSummary): boolean {
  return source.sourceType === "CONVERSATION";
}

const EMPTY_PROJECTS: ProjectListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
};

const EMPTY_LIST: SourceListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
};

const EMPTY_METRICS: SourceMetrics = {
  total: 0,
  files: 0,
  notes: 0,
  conversations: 0,
  transcripts: 0,
  ready: 0,
  pending: 0,
  failed: 0,
  archived: 0,
};

const TYPE_OPTIONS: readonly {
  value: TextSourceType;
  label: string;
}[] = [
  { value: "NOTE", label: "Nota" },
  { value: "CONVERSATION", label: "Conversación" },
  { value: "TRANSCRIPT", label: "Transcripción" },
];

const CLASSIFICATION_OPTIONS: readonly {
  value: SourceClassification;
  label: string;
}[] = [
  { value: "REQUIREMENT", label: "Requerimiento" },
  { value: "MEETING", label: "Acta o reunión" },
  { value: "CURRENT_PROCESS", label: "Proceso actual" },
  { value: "BUSINESS_RULE", label: "Regla de negocio" },
  { value: "EVIDENCE", label: "Evidencia" },
  { value: "MANUAL", label: "Manual" },
  { value: "INTEGRATION", label: "Integración" },
  { value: "DATA", label: "Datos" },
  { value: "OTHER", label: "Otro" },
];

interface SourcesWorkspaceProps {
  initialProjects?: ProjectListResponse;
  initialProjectId?: string;
  initialAnalysisRequestId?: string;
  initialError?: string | null;
}

interface SourceFormState {
  sourceType: TextSourceType;
  title: string;
  content: string;
  description: string;
  classification: "" | SourceClassification;
}

interface SelectedSourceFile {
  key: string;
  file: File;
  classification: SourceClassification;
  description: string;
}

interface AlertState {
  tone: "success" | "danger" | "information";
  message: string;
}

type CreationMode = "TEXT" | "FILES";
type ConsumptionTab = "general" | "technical" | "show";
type BatchProcessingMode = "SELECTED";

const EMPTY_FORM: SourceFormState = {
  sourceType: "NOTE",
  title: "",
  content: "",
  description: "",
  classification: "",
};

function sourceTypeLabel(sourceType: SourceType): string {
  if (sourceType === "FILE") return "Archivo";

  return (
    TYPE_OPTIONS.find((option) => option.value === sourceType)?.label ??
    sourceType
  );
}

function classificationLabel(
  classification: SourceClassification | null,
): string {
  if (!classification) return "Sin clasificar";

  return (
    CLASSIFICATION_OPTIONS.find((option) => option.value === classification)
      ?.label ?? classification
  );
}

function sourceStatusLabel(status: SourceStatus): string {
  return status === "ACTIVE" ? "Activa" : "Archivada";
}

function processingLabel(status: SourceProcessingStatus): string {
  if (status === "READY") return "Lista";
  if (status === "PROCESSING") return "Procesando";
  if (status === "FAILED") return "Con error";
  return "Pendiente";
}

export function sourceProcessingPercentage(
  source: Pick<SourceSummary, "processingStatus" | "processingProgress">,
): number {
  if (source.processingStatus === "READY") return 100;
  if (source.processingStatus === "PENDING") return 0;

  const value = Number(source.processingProgress);

  if (!Number.isFinite(value)) {
    return source.processingStatus === "PROCESSING" ? 5 : 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isActiveAnalysisForVersion(
  request: Pick<
    AiAnalysisRequestSummary,
    "documentId" | "documentVersionId" | "status"
  >,
  documentId: string,
  documentVersionId: string,
): boolean {
  return (
    request.documentId.toLowerCase() === documentId.toLowerCase() &&
    request.documentVersionId.toLowerCase() ===
      documentVersionId.toLowerCase() &&
    (request.status === "PENDING" || request.status === "PROCESSING")
  );
}

// PASO_4_INTERFAZ_PROGRESO_BLOQUES_V1
type LocalDraftBlockProgress = NonNullable<
  NonNullable<AiAnalysisRequestDetail["processing"]>["localDraftBlocks"]
>[number];

export function localDraftBlockStatusLabel(
  status: LocalDraftBlockProgress["status"],
): string {
  switch (status) {
    case "PENDING":
      return "Pendiente";
    case "PROCESSING":
      return "Procesando…";
    case "COMPLETED":
      return "Completado";
    case "FAILED":
      return "Error";
    case "CANCELLED":
      return "Cancelado";
  }
}

export function localDraftBlockStatusSymbol(
  status: LocalDraftBlockProgress["status"],
): string {
  switch (status) {
    case "PENDING":
      return "○";
    case "PROCESSING":
      return "●";
    case "COMPLETED":
      return "✓";
    case "FAILED":
      return "×";
    case "CANCELLED":
      return "−";
  }
}

export function localDraftBlockProgressCounter(
  blocks: readonly LocalDraftBlockProgress[],
  current: LocalDraftBlockProgress | null | undefined,
): string | null {
  if (blocks.length === 0) return null;

  if (current) {
    return `${current.blockNumber} / ${current.blockTotal}`;
  }

  const completed = blocks.filter(
    (block) => block.status === "COMPLETED",
  ).length;
  const total = blocks[0]?.blockTotal ?? blocks.length;
  return `${completed} / ${total}`;
}

export function analysisGenerationStage(
  request: Pick<
    AiAnalysisRequestDetail,
    "status" | "result" | "executions" | "processing"
  >,
): string {
  if (request.status === "COMPLETED") {
    return "Borrador generado y aplicado";
  }

  if (request.status === "FAILED") {
    return "Generación fallida";
  }

  if (request.status === "CANCELLED") {
    return "Generación cancelada";
  }

  if (request.processing) {
    if (request.processing.stage === "LOCAL_AI_ANALYSIS") {
      return "Analizando fuentes localmente";
    }
    if (request.processing.stage === "LOCAL_AI_CONSOLIDATION") {
      return "Consolidando conocimiento";
    }
    if (request.processing.stage === "LOCAL_AI_GENERATION") {
      return "Generando borrador con IA local";
    }
    if (request.processing.stage === "CLOUD_AI_GENERATION") {
      return "Generando borrador con IA en nube";
    }
    if (request.processing.stage === "OUTPUT_VALIDATION") {
      return "Validando respuesta";
    }
    if (request.processing.stage === "COMPLETED") {
      return "Borrador generado y aplicado";
    }
  }

  if (request.status === "PENDING") {
    return "Solicitud de IA en cola…";
  }

  if (request.status === "PROCESSING") {
    if (request.result) {
      return "Aplicando resultado al documento…";
    }

    const attempt = request.executions.at(-1)?.attempt;
    return attempt && attempt > 1
      ? `Generando borrador con IA · intento ${attempt}…`
      : "Generando borrador con IA…";
  }

  return "Preparando generación";
}

// PASO_6_UI_PROGRESO_REAL_BACKEND_V1
// processing.progress es la única fuente del porcentaje mientras la solicitud
// está activa. La vista no fabrica avance por tiempo.
export function analysisGenerationPercentage(
  request: Pick<
    AiAnalysisRequestDetail,
    "status" | "result" | "executions" | "processing"
  >,
): number {
  if (request.status === "COMPLETED") return 100;
  if (!request.processing) return 0;

  return Math.max(0, Math.min(99, Math.round(request.processing.progress)));
}

function resolveGenerationPipelineEngines(
  request: Pick<AiAnalysisRequestDetail, "processing">,
  engines?: readonly AiEngine[],
): readonly AiEngine[] {
  const explicit = engines?.length ? engines : request.processing?.engines;
  if (explicit?.length) return explicit;

  // Compatibilidad visual con solicitudes históricas que no persistieron engines.
  return (request.processing?.localTotalSources ?? 0) > 0
    ? ["LOCAL", "CLOUD"]
    : ["CLOUD"];
}

export function generationPipelineSteps(
  request: Pick<AiAnalysisRequestDetail, "processing">,
  engines?: readonly AiEngine[],
): readonly string[] {
  const resolvedEngines = resolveGenerationPipelineEngines(request, engines);
  return generationStageSequence(resolveAiGenerationMode(resolvedEngines));
}

export type GenerationPipelineState =
  "pending" | "active" | "completed" | "failed";

export function generationPipelineState(
  request: Pick<AiAnalysisRequestDetail, "status" | "processing">,
  index: number,
  engines?: readonly AiEngine[],
): GenerationPipelineState {
  const processing = request.processing;
  if (!processing) return "pending";
  if (request.status === "COMPLETED" || processing.stage === "COMPLETED") {
    return "completed";
  }

  const resolvedEngines = resolveGenerationPipelineEngines(request, engines);
  const mode = resolveAiGenerationMode(resolvedEngines);
  const steps = generationStageSequence(mode);
  const current = generationStageIndex(
    mode,
    processing.stage,
    processing.progress,
  );
  if (
    (mode === "LOCAL_ONLY" || mode === "LOCAL_CLOUD") &&
    steps[index] === "Análisis local" &&
    processing.localTotalSources > 0 &&
    processing.localCompletedSources >= processing.localTotalSources
  ) {
    return "completed";
  }
  if (index < current) return "completed";
  if (index > current) return "pending";
  if (request.status === "FAILED" || processing.stage === "FAILED") {
    return "failed";
  }
  return request.status === "PROCESSING" || request.status === "PENDING"
    ? "active"
    : "pending";
}

export function localAnalysisPercentage(
  request: Pick<AiAnalysisRequestDetail, "processing">,
): number | null {
  const processing = request.processing;
  if (!processing || processing.localTotalSources <= 0) return null;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (processing.localCompletedSources / processing.localTotalSources) * 100,
      ),
    ),
  );
}

export function safeGenerationFailureMessage(
  message: string | null | undefined,
  errorCode?: string | null,
  providerCompleted = false,
): string | null {
  if (errorCode === "AI_AUTO_APPLY_UNAVAILABLE") {
    return providerCompleted
      ? "La IA terminó correctamente y el resultado estructurado quedó guardado, pero Documents Service no pudo aplicarlo al borrador. La aplicación puede reintentarse sin volver a consumir OpenAI."
      : "Documents Service no estuvo disponible para aplicar el borrador generado. Verifica el servicio documental y vuelve a intentar.";
  }
  if (!message?.trim()) return null;
  if (/alineaci[oó]n 1:1 HU-P\/HU-F/iu.test(message)) {
    return "La IA no completó la documentación funcional de todas las historias. El resultado fue rechazado para proteger la consistencia del documento.";
  }
  const sanitized =
    message
      .split(/\r?\n/u)[0]
      ?.replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
        "",
      )
      .replace(/\bresponse[_ -]?id\s*[:=]?\s*\S+/giu, "")
      .replace(/\s{2,}/gu, " ")
      .trim() || null;
  if (!sanitized) return null;
  return sanitized.length > 480
    ? `${sanitized.slice(0, 477).trimEnd()}…`
    : sanitized;
}

export function generationProcessingDetail(
  request: Pick<AiAnalysisRequestDetail, "processing" | "executions">,
): string | null {
  const processing = request.processing;
  if (!processing) return null;
  if (processing.stage === "LOCAL_AI_ANALYSIS") {
    const currentTitle = processing.currentLocalSourceTitle?.trim();
    const segment =
      processing.currentLocalSegment && processing.localTotalSegments
        ? ` · segmento ${processing.currentLocalSegment}/${processing.localTotalSegments}`
        : "";
    const completedSegments =
      processing.localCompletedSegments !== null &&
      processing.localCompletedSegments !== undefined &&
      processing.localTotalSegments
        ? ` · ${processing.localCompletedSegments}/${processing.localTotalSegments} segmentos completados`
        : "";
    const current = currentTitle
      ? processing.currentLocalSourceStartedAt
        ? ` · procesando: ${currentTitle}${segment}${completedSegments}`
        : ` · preparando: ${currentTitle}`
      : " · preparando la fuente activa";
    return `${processing.localCompletedSources} de ${processing.localTotalSources} fuentes completadas${current}`;
  }
  if (processing.stage === "LOCAL_AI_CONSOLIDATION") {
    return `${processing.localCompletedSources} de ${processing.localTotalSources} fuentes analizadas · consolidando hallazgos y trazabilidad`;
  }
  if (processing.stage === "LOCAL_AI_GENERATION") {
    // PASO_9_VISTA_COMPACTA_TRES_MODOS_V2
    const blocks = processing.localDraftBlocks ?? [];
    const completed = blocks.filter(
      (block) => block.status === "COMPLETED",
    ).length;
    const current =
      processing.currentLocalDraftBlock ??
      blocks.find((block) => block.status === "PROCESSING") ??
      null;
    const total = current?.blockTotal ?? blocks[0]?.blockTotal ?? blocks.length;
    if (current) {
      const units =
        current.totalUnits && current.totalUnits > 1
          ? ` · subunidad ${Math.min(
              current.totalUnits,
              (current.completedUnits ?? 0) + 1,
            )}/${current.totalUnits}`
          : "";
      return `${completed}/${current.blockTotal} completados · procesando ${current.blockNumber}/${current.blockTotal}: ${current.blockLabel}${units}`;
    }
    return total > 0
      ? `${completed}/${total} bloques completados`
      : "Preparando el primer bloque";
  }
  if (processing.stage === "CLOUD_AI_GENERATION") {
    const execution = request.executions.at(-1);
    const model = execution?.model ? `${execution.model}` : "Modelo en nube";
    const attempt =
      (execution?.attempt ?? 1) > 1 ? ` · intento ${execution?.attempt}` : "";
    return `Generando respuesta · ${model}${attempt}`;
  }
  if (processing.stage === "OUTPUT_VALIDATION") {
    return "Validando el JSON, sus relaciones y la aplicación de la nueva versión";
  }
  if (processing.stage === "QUEUED") {
    const source = processing.currentLocalSourceTitle?.trim();
    const sourceDetail = source ? ` · siguiente fuente: ${source}` : "";
    return processing.localTotalSources > 0
      ? processing.engines?.includes("CLOUD")
        ? `En cola para análisis local, consolidación y generación en nube${sourceDetail}`
        : `En cola para análisis, consolidación y generación local${sourceDetail}`
      : "En cola para generación directa con IA en nube";
  }
  return null;
}

export function sourceProcessingDisplay(
  source: Pick<
    SourceSummary,
    "id" | "processingStatus" | "processingProgress" | "processingMessage"
  >,
  generation: Pick<
    AiAnalysisRequestDetail,
    "status" | "sources" | "errorMessage" | "processing"
  > | null,
  generationProgress: number,
): {
  readonly label: string;
  readonly state: SourceProcessingStatus;
  readonly percentage: number;
  readonly message: string | null;
} {
  const belongsToGeneration = generation?.sources.some(
    (item) => item.sourceId.toLowerCase() === source.id.toLowerCase(),
  );

  if (!generation || !belongsToGeneration) {
    if (source.processingStatus === "READY") {
      return {
        label: "Sin procesar",
        state: "PENDING",
        percentage: 0,
        message:
          "La fuente está lista, pero todavía no se ha incluido en una generación de IA.",
      };
    }
    return {
      label: processingLabel(source.processingStatus),
      state: source.processingStatus,
      percentage: sourceProcessingPercentage(source),
      message: source.processingMessage,
    };
  }

  const normalizedSourceId = source.id.toLowerCase();
  const completedLocally =
    generation.processing?.localCompletedSourceIds?.some(
      (sourceId) => sourceId.toLowerCase() === normalizedSourceId,
    ) ?? false;
  const processingLocally =
    generation.processing?.localProcessingSourceIds?.some(
      (sourceId) => sourceId.toLowerCase() === normalizedSourceId,
    ) ?? false;
  const currentLocalSource =
    generation.processing?.currentLocalSourceId?.toLowerCase() ===
    normalizedSourceId;

  if (completedLocally) {
    return {
      label: "Analizada",
      state: "READY",
      percentage: 100,
      message: "Análisis local completado para esta fuente.",
    };
  }

  if (processingLocally) {
    return {
      label: "IA local",
      state: "PROCESSING",
      percentage: generationProgress,
      message: "Ollama está analizando esta fuente.",
    };
  }

  if (
    currentLocalSource &&
    (generation.processing?.stage === "QUEUED" ||
      generation.processing?.stage === "LOCAL_AI_ANALYSIS")
  ) {
    return {
      label: "Preparando",
      state: "PROCESSING",
      percentage: generationProgress,
      message: "Esta es la fuente que IA local está preparando para analizar.",
    };
  }

  if (
    generation.status === "PROCESSING" &&
    generation.processing?.stage === "LOCAL_AI_ANALYSIS" &&
    generation.processing.localTotalSources > 0
  ) {
    return {
      label: "Pendiente",
      state: "PENDING",
      percentage: 0,
      message: "Esperando turno para análisis local.",
    };
  }

  if (generation.status === "COMPLETED") {
    return {
      label: "Completada",
      state: "READY",
      percentage: 100,
      message: null,
    };
  }

  if (generation.status === "FAILED") {
    return {
      label: "Fallida",
      state: "FAILED",
      percentage: generationProgress,
      message: generation.errorMessage,
    };
  }

  if (generation.status === "CANCELLED") {
    return {
      label: "Cancelada",
      state: "FAILED",
      percentage: generationProgress,
      message: generation.errorMessage,
    };
  }

  const processingLabelByStage =
    generation.processing?.stage === "LOCAL_AI_ANALYSIS"
      ? "IA local"
      : generation.processing?.stage === "LOCAL_AI_CONSOLIDATION"
        ? "Consolidando"
        : generation.processing?.stage === "LOCAL_AI_GENERATION"
          ? "IA local"
          : generation.processing?.stage === "CLOUD_AI_GENERATION"
            ? "IA nube"
            : generation.processing?.stage === "OUTPUT_VALIDATION"
              ? "Validando"
              : generation.status === "PENDING"
                ? "En cola"
                : "Procesando IA";
  return {
    label: processingLabelByStage,
    state: generation.status,
    percentage: generationProgress,
    message: null,
  };
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatBytes(value: string | null): string {
  const bytes = Number(value ?? 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "—";
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function fileDescription(source: SourceSummary): string {
  if (source.sourceType !== "FILE") {
    return source.contentPreview || "Sin vista previa";
  }

  const details = [
    source.originalFileName,
    source.fileExtension?.toUpperCase(),
    formatBytes(source.fileSizeBytes),
  ].filter(Boolean);

  return details.join(" · ") || "Archivo almacenado";
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();

  if (!text) {
    return `La solicitud no pudo completarse (${response.status}).`;
  }

  try {
    const payload = JSON.parse(text) as Readonly<Record<string, unknown>>;

    for (const field of ["detail", "message", "title"]) {
      const value = payload[field];

      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }

      if (Array.isArray(value)) {
        const joined = value
          .filter((item): item is string => typeof item === "string")
          .join(" ");

        if (joined.trim()) {
          return joined.trim();
        }
      }
    }
  } catch {
    return text;
  }

  return `La solicitud no pudo completarse (${response.status}).`;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options?.body instanceof FormData;

  const response = await authenticatedFetch(`${GATEWAY_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(!isFormData && options?.body
        ? { "content-type": "application/json" }
        : {}),
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as T;
}

/** Resumen de solo lectura: cada sección existente cuenta como punto COMPLETED. */
export function localDraftBlocksFromDocumentSections(
  sections: readonly { key: string; title: string; order: number }[],
  updatedAt: string,
): LocalDraftBlockProgress[] {
  const ordered = [...sections].sort((left, right) => left.order - right.order);
  return ordered.map((section, index) => ({
    blockNumber: index + 1,
    blockTotal: ordered.length,
    blockKey: section.key,
    blockLabel: section.title,
    status: "COMPLETED",
    updatedAt,
  }));
}

async function discoverCurrentGeneration(
  projectId: string,
): Promise<AiAnalysisRequestDetail | null> {
  const documents = await requestJson<RequirementDocumentListResponse>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
  );
  const document = documents.items.find((item) => item.status !== "ARCHIVED");

  if (!document) {
    return null;
  }

  const [documentDetail, analyses] = await Promise.all([
    requestJson<RequirementDocumentDetail>(
      `/api/v1/documents/${encodeURIComponent(document.id)}`,
    ),
    requestJson<AiAnalysisRequestListResponse>(
      `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests?page=1&pageSize=100`,
    ),
  ]);
  const currentRequest = analyses.items
    .filter(
      (item) =>
        item.documentId.toLowerCase() === documentDetail.id.toLowerCase() &&
        item.documentVersionId.toLowerCase() ===
          documentDetail.currentVersionDetail.id.toLowerCase(),
    )
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0];

  if (!currentRequest) {
    return null;
  }

  const detail = await requestJson<AiAnalysisRequestDetail>(
    `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(currentRequest.id)}`,
  );
  const fallbackBlocks = localDraftBlocksFromDocumentSections(
    documentDetail.currentVersionDetail.sections,
    documentDetail.currentVersionDetail.updatedAt,
  );

  if (
    detail.status !== "COMPLETED" ||
    (detail.processing?.localDraftBlocks?.length ?? 0) > 0 ||
    fallbackBlocks.length === 0
  ) {
    return detail;
  }

  return {
    ...detail,
    processing: {
      ...(detail.processing ?? {
        stage: "COMPLETED",
        label: "Completado",
        progress: 100,
        localCompletedSources: 0,
        localTotalSources: 0,
        localCacheAvailable: 0,
        localSnapshotReady: false,
      }),
      localDraftBlocks: fallbackBlocks,
    },
  } as AiAnalysisRequestDetail;
}

export function SourcesWorkspace({
  initialProjects = EMPTY_PROJECTS,
  initialProjectId,
  initialAnalysisRequestId,
  initialError = null,
}: SourcesWorkspaceProps) {
  const confirm = useConfirm();
  const generationLockRef = useRef(false);
  const generationDiscoverySequenceRef = useRef(0);
  const progressSyncedProjectIdsRef = useRef(new Set<string>());
  const documentStatusSyncedRequestIdsRef = useRef(new Set<string>());
  const initialAnalysisRequestIdRef = useRef(initialAnalysisRequestId);
  const tokenEstimateSequenceRef = useRef(0);
  const firstProjectId = initialProjects.items[0]?.id ?? "";
  const resolvedInitialProjectId =
    initialProjectId &&
    initialProjects.items.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : firstProjectId;

  const projectId = resolvedInitialProjectId;
  const [sources, setSources] = useState<SourceListResponse>(EMPTY_LIST);
  const [metrics, setMetrics] = useState<SourceMetrics>(EMPTY_METRICS);
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<"" | SourceType>("");
  const [processingStatus, setProcessingStatus] = useState<
    "" | SourceProcessingStatus
  >("");
  const [status, setStatus] = useState<SourceStatus>("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    // Un clic fuera del menú ☰ también lo minimiza.
    const close = (event: PointerEvent) => {
      const menu = moreMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node | null)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const dialogRef = useDialogAccessibility<HTMLElement>(modalOpen, () => {
    if (!saving) closeModal();
  });
  const [editing, setEditing] = useState<SourceDetail | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("TEXT");
  const [form, setForm] = useState<SourceFormState>(EMPTY_FORM);
  const [selectedFiles, setSelectedFiles] = useState<SelectedSourceFile[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchProcessing, setBatchProcessing] =
    useState<BatchProcessingMode | null>(null);
  const [generationStage, setGenerationStage] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [trackedGeneration, setTrackedGeneration] =
    useState<AiAnalysisRequestDetail | null>(null);
  const [cancellingGeneration, setCancellingGeneration] = useState(false);
  const [retryingApplication, setRetryingApplication] = useState(false);
  const [retryingGeneration, setRetryingGeneration] = useState(false);
  const [generatedDocumentId, setGeneratedDocumentId] = useState<string | null>(
    null,
  );
  const [tokenEstimate, setTokenEstimate] =
    useState<AiAnalysisTokenEstimateResponse | null>(null);
  const [tokenEstimateLoading, setTokenEstimateLoading] = useState(false);
  const [tokenEstimateMessage, setTokenEstimateMessage] = useState<
    string | null
  >(null);
  const [dragActive, setDragActive] = useState(false);
  const [includePrototype, setIncludePrototype] = useState(false);
  const [alert, setAlert] = useState<AlertState | null>(
    initialError
      ? {
          tone: "danger",
          message: initialError,
        }
      : null,
  );
  useAutoDismiss(alert, () => setAlert(null));
  const aiEngines = useAiEngineSelection(projectId);

  useEffect(() => {
    if (!projectId) return;

    const explicitOverride = window.localStorage.getItem(
      `rq-prototype-processing-override-v2:${projectId}`,
    );
    if (explicitOverride === "true" || explicitOverride === "false") {
      setIncludePrototype(explicitOverride === "true");
      return;
    }

    let discussionDefault: boolean | null = null;
    try {
      const rawDiscussion = window.localStorage.getItem(
        `rq-requirement-discussion-v1:${projectId}`,
      );
      const discussion = rawDiscussion
        ? (JSON.parse(rawDiscussion) as {
            needsPrototype?: unknown;
            solutionType?: unknown;
          })
        : null;
      if (typeof discussion?.needsPrototype === "boolean") {
        discussionDefault = discussion.needsPrototype;
      } else if (discussion?.solutionType === "PROTOTYPE") {
        discussionDefault = true;
      } else if (
        typeof discussion?.solutionType === "string" &&
        discussion.solutionType
      ) {
        discussionDefault = false;
      }
    } catch {
      discussionDefault = null;
    }

    if (discussionDefault !== null) {
      setIncludePrototype(discussionDefault);
      return;
    }

    const legacyProjectPreference = window.localStorage.getItem(
      `rq-prototype-markdown-v1:${projectId}`,
    );
    const legacySharedPreference = window.localStorage.getItem(
      "rq-prototype-markdown-v1:shared",
    );
    setIncludePrototype(
      (legacyProjectPreference ?? legacySharedPreference) === "true",
    );
  }, [projectId]);

  function togglePrototype(): void {
    const next = !includePrototype;
    setIncludePrototype(next);
    if (!projectId) return;
    window.localStorage.setItem(
      `rq-prototype-processing-override-v2:${projectId}`,
      String(next),
    );
  }

  const selectedProject = useMemo(
    () => initialProjects.items.find((project) => project.id === projectId),
    [initialProjects.items, projectId],
  );

  useEffect(() => {
    if (
      !selectedProject ||
      metrics.total === 0 ||
      progressSyncedProjectIdsRef.current.has(selectedProject.id)
    ) {
      return;
    }

    progressSyncedProjectIdsRef.current.add(selectedProject.id);
    void authenticatedFetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(selectedProject.id)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "SOURCES" }),
      },
    )
      .then((response) => {
        if (!response.ok) {
          progressSyncedProjectIdsRef.current.delete(selectedProject.id);
        }
      })
      .catch(() => {
        progressSyncedProjectIdsRef.current.delete(selectedProject.id);
      });
  }, [metrics.total, selectedProject]);

  useEffect(() => {
    if (
      !trackedGeneration ||
      trackedGeneration.status !== "COMPLETED" ||
      documentStatusSyncedRequestIdsRef.current.has(trackedGeneration.id)
    ) {
      return;
    }

    documentStatusSyncedRequestIdsRef.current.add(trackedGeneration.id);
    void authenticatedFetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(trackedGeneration.projectId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "DOCUMENT_GENERATED" }),
      },
    )
      .then((response) => {
        if (!response.ok) {
          documentStatusSyncedRequestIdsRef.current.delete(
            trackedGeneration.id,
          );
        }
      })
      .catch(() => {
        documentStatusSyncedRequestIdsRef.current.delete(trackedGeneration.id);
      });
  }, [trackedGeneration]);
  const localOnlySelection =
    aiEngines.engines.length === 1 && aiEngines.engines[0] === "LOCAL";
  const eligibleVisibleSourceIds = useMemo(
    () =>
      sources.items
        .filter(
          (source) =>
            source.status === "ACTIVE" &&
            source.processingStatus !== "PROCESSING" &&
            (!localOnlySelection || isLocalOnlyConversationSource(source)),
        )
        .map((source) => source.id),
    [localOnlySelection, sources.items],
  );
  const allEligibleVisibleSelected =
    eligibleVisibleSourceIds.length > 0 &&
    eligibleVisibleSourceIds.every((sourceId) =>
      selectedSourceIds.has(sourceId),
    );
  const trackedGenerationActive =
    trackedGeneration?.status === "PENDING" ||
    trackedGeneration?.status === "PROCESSING";
  // AI_SOURCES_DRAFT_PROGRESS_COLLAPSIBLE_V1
  // La tarjeta lateral de consumo tiene tres pestañas. «Mostrar» revela el
  // detalle de «Borrador por puntos»; General y Detalles técnicos lo ocultan.
  const [consumptionTab, setConsumptionTab] =
    useState<ConsumptionTab>("general");
  // En móvil la tarjeta se puede ocultar y deja solo las pestañas.
  const [consumptionCollapsed, setConsumptionCollapsed] = useState(false);
  const draftProgressExpanded = consumptionTab === "show";
  const displayedEngineSelection =
    trackedGenerationActive && trackedGeneration?.processing?.engines
      ? {
          local: trackedGeneration.processing.engines.includes("LOCAL"),
          cloud: trackedGeneration.processing.engines.includes("CLOUD"),
        }
      : aiEngines.selection;
  const tokenEstimateSourceIdsKey = useMemo(() => {
    const ids =
      selectedSourceIds.size > 0
        ? [...selectedSourceIds]
        : trackedGenerationActive
          ? (trackedGeneration?.sources.map((source) => source.sourceId) ?? [])
          : [];
    return [...new Set(ids.map((sourceId) => sourceId.toLowerCase()))]
      .sort()
      .join("|");
  }, [selectedSourceIds, trackedGeneration, trackedGenerationActive]);
  const hasActiveSourceProcessing = useMemo(
    () =>
      sources.items.some(
        (source) =>
          source.status === "ACTIVE" &&
          source.sourceType === "FILE" &&
          source.processingStatus === "PROCESSING",
      ),
    [sources.items],
  );

  const loadSources = useCallback(
    async (
      nextProjectId: string,
      nextSearch: string,
      nextType: "" | SourceType,
      nextProcessingStatus: "" | SourceProcessingStatus,
      nextStatus: SourceStatus,
      silent = false,
    ): Promise<void> => {
      if (!nextProjectId) {
        setSources(EMPTY_LIST);
        setMetrics(EMPTY_METRICS);
        return;
      }

      if (!silent) {
        setLoading(true);
      }

      try {
        const query = new URLSearchParams({
          page: "1",
          pageSize: "50",
          status: nextStatus,
        });

        if (nextSearch.trim()) {
          query.set("search", nextSearch.trim());
        }

        if (nextType) {
          query.set("sourceType", nextType);
        }

        if (nextProcessingStatus) {
          query.set("processingStatus", nextProcessingStatus);
        }

        const [list, summary] = await Promise.all([
          requestJson<SourceListResponse>(
            `/api/v1/projects/${encodeURIComponent(nextProjectId)}/sources?${query.toString()}`,
          ),
          requestJson<SourceMetrics>(
            `/api/v1/projects/${encodeURIComponent(nextProjectId)}/sources/summary`,
          ),
        ]);

        setSources(list);
        setMetrics(summary);
      } catch (error) {
        if (!silent) {
          setAlert({
            tone: "danger",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible cargar las fuentes.",
          });
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void loadSources(projectId, search, sourceType, "", status);
      },
      search.trim() ? 280 : 0,
    );

    return () => window.clearTimeout(timeout);
  }, [loadSources, projectId, search, sourceType, status]);

  useEffect(() => {
    const sequence = ++generationDiscoverySequenceRef.current;

    setTrackedGeneration(null);
    setGeneratedDocumentId(null);
    setGenerationStage(null);
    setGenerationProgress(0);
    setTokenEstimate(null);
    setTokenEstimateMessage(null);
    setTokenEstimateLoading(false);
    ++tokenEstimateSequenceRef.current;

    if (!projectId) {
      return;
    }

    const requestedAnalysisId = initialAnalysisRequestIdRef.current;
    initialAnalysisRequestIdRef.current = undefined;
    const generationRequest = requestedAnalysisId
      ? requestJson<AiAnalysisRequestDetail>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(requestedAnalysisId)}`,
          { cache: "no-store" },
        )
      : discoverCurrentGeneration(projectId);

    void generationRequest
      .then((generation) => {
        if (sequence !== generationDiscoverySequenceRef.current) {
          return;
        }

        setTrackedGeneration(generation);
        if (generation?.status === "COMPLETED") {
          setGeneratedDocumentId(generation.documentId);
        }
      })
      .catch((error: unknown) => {
        if (sequence !== generationDiscoverySequenceRef.current) {
          return;
        }

        setAlert({
          tone: "danger",
          message:
            error instanceof Error
              ? error.message
              : "No fue posible consultar el estado de la generación de IA.",
        });
      });
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !trackedGenerationActive || !trackedGeneration) {
      return;
    }

    let disposed = false;

    const refresh = (): void => {
      if (disposed || document.visibilityState !== "visible") {
        return;
      }

      void requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(trackedGeneration.id)}`,
        { cache: "no-store" },
      )
        .then((detail) => {
          if (disposed) return;

          setTrackedGeneration(detail);
          if (detail.status === "COMPLETED") {
            setGeneratedDocumentId(detail.documentId);
          }
        })
        .catch((error: unknown) => {
          if (disposed) return;

          setAlert({
            tone: "danger",
            message:
              error instanceof Error
                ? error.message
                : "No fue posible actualizar el estado de la generación de IA.",
          });
        });
    };

    const interval = window.setInterval(refresh, 1500);
    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [projectId, trackedGeneration, trackedGenerationActive]);

  useEffect(() => {
    if (!projectId || !hasActiveSourceProcessing) {
      return;
    }

    let disposed = false;

    const refresh = (): void => {
      if (disposed || document.visibilityState !== "visible") {
        return;
      }

      void loadSources(
        projectId,
        search,
        sourceType,
        processingStatus,
        status,
        true,
      );
    };

    const interval = window.setInterval(refresh, 1200);

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // source-processing-poll
  }, [
    hasActiveSourceProcessing,
    loadSources,
    processingStatus,
    projectId,
    search,
    sourceType,
    status,
  ]);

  useEffect(() => {
    const visibleIds = new Set(sources.items.map((source) => source.id));
    const allowedIds = new Set(
      sources.items
        .filter(
          (source) =>
            !localOnlySelection || isLocalOnlyConversationSource(source),
        )
        .map((source) => source.id),
    );

    setSelectedSourceIds((current) => {
      const next = new Set(
        [...current].filter(
          (sourceId) => visibleIds.has(sourceId) && allowedIds.has(sourceId),
        ),
      );

      return next.size === current.size ? current : next;
    });
  }, [localOnlySelection, sources.items]);

  useEffect(() => {
    const sequence = ++tokenEstimateSequenceRef.current;
    const selectedIds = tokenEstimateSourceIdsKey
      ? tokenEstimateSourceIdsKey.split("|")
      : [];
    const estimatingTrackedGeneration =
      selectedSourceIds.size === 0 && trackedGenerationActive;

    if (!projectId || selectedIds.length === 0) {
      setTokenEstimateLoading(false);
      setTokenEstimateMessage(null);
      return;
    }

    const selectedItems = sources.items.filter((source) =>
      selectedSourceIds.has(source.id),
    );
    if (
      (!estimatingTrackedGeneration &&
        selectedItems.length !== selectedIds.length) ||
      (!estimatingTrackedGeneration &&
        selectedItems.some((source) => source.processingStatus !== "READY"))
    ) {
      setTokenEstimate(null);
      setTokenEstimateLoading(false);
      setTokenEstimateMessage(
        "La estimación estará disponible cuando todas las fuentes seleccionadas estén listas.",
      );
      return;
    }

    setTokenEstimateLoading(true);
    setTokenEstimateMessage(null);

    const timeout = window.setTimeout(() => {
      void (async () => {
        try {
          const documents = await requestJson<RequirementDocumentListResponse>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
            { cache: "no-store" },
          );
          if (sequence !== tokenEstimateSequenceRef.current) return;

          const existingDocument = documents.items.find(
            (document) => document.status !== "ARCHIVED",
          );
          if (!existingDocument) {
            setTokenEstimate(null);
            setTokenEstimateMessage(
              "La estimación del primer borrador estará disponible cuando exista su versión documental base.",
            );
            return;
          }

          const estimate = await requestJson<AiAnalysisTokenEstimateResponse>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/token-estimate`,
            {
              method: "POST",
              body: JSON.stringify({
                documentId: existingDocument.id,
                sourceIds: selectedIds,
                engines: aiEngines.engines,
                providerSelections: estimatingTrackedGeneration
                  ? trackedGeneration?.providerSelections
                  : aiEngines.providerSelections,
                purpose: "AI_VERSION",
              }),
            },
          );
          if (sequence !== tokenEstimateSequenceRef.current) return;

          setTokenEstimate(estimate);
          setTokenEstimateMessage(null);
        } catch (error) {
          if (sequence !== tokenEstimateSequenceRef.current) return;

          setTokenEstimate(null);
          setTokenEstimateMessage(
            error instanceof Error
              ? error.message
              : "No fue posible calcular el consumo estimado de tokens.",
          );
        } finally {
          if (sequence === tokenEstimateSequenceRef.current) {
            setTokenEstimateLoading(false);
          }
        }
      })();
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    projectId,
    aiEngines.engines,
    aiEngines.providerSelections,
    selectedSourceIds,
    sources.items,
    tokenEstimateSourceIdsKey,
    trackedGeneration?.processing?.stage,
    trackedGenerationActive,
  ]);

  useEffect(() => {
    if (!alert) return;

    const timeout = window.setTimeout(() => setAlert(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  useEffect(() => {
    if (!aiEngines.error) return;
    setAlert({ tone: "danger", message: aiEngines.error });
  }, [aiEngines.error]);

  async function stopGeneration(): Promise<boolean> {
    if (!projectId || !trackedGeneration || !trackedGenerationActive)
      return true;
    setCancellingGeneration(true);
    try {
      const cancelled = await requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(trackedGeneration.id)}/cancel`,
        { method: "POST" },
      );
      setTrackedGeneration(cancelled);
      setGenerationStage("Generación cancelada.");
      setAlert({
        tone: "information",
        message: "El procesamiento de IA fue detenido.",
      });
      return true;
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible detener el procesamiento.",
      });
      return false;
    } finally {
      setCancellingGeneration(false);
    }
  }

  function changeProject(nextProjectId: string): void {
    if (nextProjectId === projectId) return;

    const url = new URL(window.location.href);

    if (nextProjectId) {
      url.searchParams.set("projectId", nextProjectId);
    } else {
      url.searchParams.delete("projectId");
    }

    // La generación pertenece al proyecto y continúa en el worker. Navegar a
    // una URL nueva desmonta el seguimiento visual anterior sin cancelar el
    // trabajo ni mezclar su progreso con el proyecto recién seleccionado.
    window.location.assign(url);
  }

  function openCreate(): void {
    if (!projectId) {
      setAlert({
        tone: "information",
        message: "Selecciona un proyecto antes de crear una fuente.",
      });
      return;
    }

    setEditing(null);
    setCreationMode("TEXT");
    setForm(EMPTY_FORM);
    setSelectedFiles([]);
    setModalOpen(true);
  }

  async function openDetail(source: SourceSummary): Promise<void> {
    setLoading(true);

    try {
      const detail = await requestJson<SourceDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(source.id)}`,
      );

      setEditing(detail);
      setCreationMode(detail.sourceType === "FILE" ? "FILES" : "TEXT");
      setForm({
        sourceType: detail.sourceType === "FILE" ? "NOTE" : detail.sourceType,
        title: detail.title,
        content: detail.content ?? "",
        description: detail.description ?? "",
        classification: detail.classification ?? "",
      });
      setSelectedFiles([]);
      setModalOpen(true);
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible cargar la fuente.",
      });
    } finally {
      setLoading(false);
    }
  }

  function closeModal(): void {
    if (saving) return;

    setModalOpen(false);
    setEditing(null);
    setCreationMode("TEXT");
    setForm(EMPTY_FORM);
    setSelectedFiles([]);
    setDragActive(false);
  }

  function selectFiles(files: FileList | readonly File[]): void {
    const currentByKey = new Map(
      selectedFiles.map((item) => [item.key, item] as const),
    );
    const result = appendUniqueSourceFiles(
      selectedFiles.map((item) => item.file),
      Array.from(files),
    );

    setSelectedFiles(
      result.files.map((file) => {
        const key = sourceFileSelectionKey(file);
        return (
          currentByKey.get(key) ?? {
            key,
            file,
            classification: "OTHER" as const,
            description: "",
          }
        );
      }),
    );

    if (result.duplicateCount > 0 || result.overflowCount > 0) {
      const details = [
        result.duplicateCount > 0
          ? `${result.duplicateCount} archivo(s) ya estaban seleccionados.`
          : "",
        result.overflowCount > 0
          ? `${result.overflowCount} archivo(s) no se agregaron porque el máximo es 20.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      setAlert({ tone: "information", message: details });
    }
  }

  function updateSelectedFile(
    key: string,
    changes: Partial<
      Pick<SelectedSourceFile, "classification" | "description">
    >,
  ): void {
    setSelectedFiles((current) =>
      current.map((item) =>
        item.key === key ? { ...item, ...changes } : item,
      ),
    );
  }

  function removeSelectedFile(key: string): void {
    setSelectedFiles((current) => current.filter((item) => item.key !== key));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setDragActive(false);
    selectFiles(event.dataTransfer.files);
  }

  async function saveSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!projectId) return;

    setSaving(true);

    try {
      let message = "La fuente fue creada.";

      if (editing) {
        const body: UpdateSourceRequest = {
          title: form.title,
          description: form.description || null,
          ...(editing.sourceType === "FILE"
            ? { classification: form.classification as SourceClassification }
            : { content: form.content }),
        };

        await requestJson<SourceDetail>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(editing.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
        );

        message = "La fuente fue actualizada.";
      } else if (creationMode === "FILES") {
        const data = new FormData();
        data.append(
          "metadata",
          JSON.stringify(
            selectedFiles.map((item) => ({
              fileName: item.file.name,
              classification: item.classification,
              description: item.description.trim() || null,
            })),
          ),
        );

        for (const item of selectedFiles) {
          data.append("files", item.file, item.file.name);
        }

        const result = await requestJson<SourceUploadBatchResponse>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sources/files`,
          {
            method: "POST",
            body: data,
          },
        );

        if (result.acceptedFiles === 0) {
          throw new Error(
            result.rejected
              .map((item) => `${item.fileName}: ${item.reason}`)
              .join(" "),
          );
        }

        const rejectionSummary = result.rejected
          .slice(0, 3)
          .map((item) => `${item.fileName}: ${item.reason}`)
          .join(" ");

        message =
          `${result.acceptedFiles} archivo(s) almacenado(s) y pendiente(s) de procesamiento.` +
          (result.rejectedFiles > 0
            ? ` ${result.rejectedFiles} rechazado(s). ${rejectionSummary}`
            : "");
      } else {
        const body: CreateTextSourceRequest = {
          sourceType: form.sourceType,
          title: form.title,
          content: form.content,
        };

        await requestJson<SourceDetail>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sources`,
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
      }

      closeModal();
      setAlert({
        tone: "success",
        message,
      });

      await loadSources(
        projectId,
        search,
        sourceType,
        processingStatus,
        status,
      );
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible guardar la fuente.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function downloadSource(source: SourceSummary): Promise<void> {
    setLoading(true);

    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(source.id)}/download`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) {
        throw new Error(await parseError(response));
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = source.originalFileName ?? source.title;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible descargar el archivo.",
      });
    } finally {
      setLoading(false);
    }
  }

  function toggleSourceSelection(sourceId: string): void {
    setSelectedSourceIds((current) => {
      const next = new Set(current);

      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }

      return next;
    });
  }

  function toggleAllEligibleVisible(): void {
    setSelectedSourceIds((current) => {
      const next = new Set(current);

      if (allEligibleVisibleSelected) {
        eligibleVisibleSourceIds.forEach((sourceId) => next.delete(sourceId));
      } else {
        eligibleVisibleSourceIds.forEach((sourceId) => next.add(sourceId));
      }

      return next;
    });
  }

  async function waitUntilReady(
    selectedIds: readonly string[],
  ): Promise<readonly SourceDetail[]> {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const details = await Promise.all(
        selectedIds.map((sourceId) =>
          requestJson<SourceDetail>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(sourceId)}`,
          ),
        ),
      );
      const failed = details.find(
        (source) => source.processingStatus === "FAILED",
      );
      if (failed) {
        throw new Error(
          failed.processingMessage ||
            `La fuente "${failed.title}" no pudo procesarse.`,
        );
      }
      const ready = details.filter(
        (source) => source.processingStatus === "READY",
      ).length;
      if (ready === details.length) {
        setGenerationStage("Fuentes listas.");
        return details;
      }
      setGenerationStage(`Procesando fuentes ${ready}/${details.length}…`);
      await new Promise((resolve) => window.setTimeout(resolve, 800));
    }
    throw new Error(
      "Las fuentes no terminaron de procesarse dentro del tiempo esperado.",
    );
  }

  async function waitForDraft(
    initial: AiAnalysisRequestDetail,
  ): Promise<AiAnalysisRequestDetail | null> {
    setTrackedGeneration(initial);
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      const detail = await requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(initial.id)}`,
        { cache: "no-store" },
      );
      setTrackedGeneration(detail);
      if (detail.status === "COMPLETED") {
        setGenerationStage("Completado.");
        setGeneratedDocumentId(detail.documentId);
        return detail;
      }
      if (detail.status === "FAILED") {
        throw new Error(
          detail.errorMessage ||
            detail.executions.at(-1)?.errorMessage ||
            "La generación del borrador terminó con error.",
        );
      }
      if (detail.status === "CANCELLED") {
        throw new Error("Generación cancelada.");
      }
      setGenerationStage(analysisGenerationStage(detail));
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
    setAlert({
      tone: "information",
      message:
        "La generación continúa en segundo plano. El avance se actualizará automáticamente; puedes cancelar desde esta vista.",
    });
    return null;
  }

  // PASO_6_REANUDAR_REINTENTAR_BLOQUE_V1
  async function retryGenerationFromCheckpoint(): Promise<void> {
    if (
      !projectId ||
      !trackedGeneration ||
      trackedGeneration.status !== "FAILED" ||
      generationFailureCode === "AI_AUTO_APPLY_UNAVAILABLE" ||
      retryingGeneration
    )
      return;

    setRetryingGeneration(true);
    setGenerationStage("Reanudando desde bloques guardados…");
    try {
      const retried = await requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(trackedGeneration.id)}/retry`,
        { method: "POST" },
      );
      setTrackedGeneration(retried);
      setAlert({
        tone: "information",
        message:
          "Reintento iniciado. Los bloques completados se reutilizan y el bloque pendiente se vuelve a procesar.",
      });
      const completed = await waitForDraft(retried);
      if (!completed) return;
      setTrackedGeneration(completed);
      setAlert({
        tone: "success",
        message: "La generación se reanudó desde los checkpoints guardados.",
      });
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible reanudar la generación desde los checkpoints.",
      });
    } finally {
      setRetryingGeneration(false);
    }
  }

  async function retryDocumentApplication(): Promise<void> {
    if (
      !projectId ||
      !trackedGeneration ||
      generationFailureCode !== "AI_AUTO_APPLY_UNAVAILABLE" ||
      retryingApplication
    )
      return;

    setRetryingApplication(true);
    setGenerationStage("Reintentando aplicación del borrador…");
    try {
      const retried = await requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(trackedGeneration.id)}/retry`,
        { method: "POST" },
      );
      const completed = await waitForDraft(retried);
      if (!completed) return;
      setTrackedGeneration(completed);
      setAlert({
        tone: "success",
        message:
          "El resultado guardado se aplicó al documento sin volver a ejecutar OpenAI.",
      });
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible volver a aplicar el borrador guardado.",
      });
    } finally {
      setRetryingApplication(false);
    }
  }

  async function processBatch(): Promise<void> {
    if (
      !projectId ||
      batchProcessing ||
      trackedGenerationActive ||
      generationLockRef.current ||
      aiEngines.engines.length === 0 ||
      selectedSourceIds.size === 0
    )
      return;

    const selectedIds = [...selectedSourceIds];
    const selectedItems = sources.items.filter((source) =>
      selectedSourceIds.has(source.id),
    );
    if (
      localOnlySelection &&
      selectedItems.some((source) => !isLocalOnlyConversationSource(source))
    ) {
      setAlert({
        tone: "danger",
        message:
          "IA local solo admite Preguntas de análisis o fuentes de tipo Conversación.",
      });
      return;
    }
    let documents: RequirementDocumentListResponse;
    try {
      documents = await requestJson<RequirementDocumentListResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
      );
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible consultar el documento del proyecto.",
      });
      return;
    }
    const existingDocument = documents.items.find(
      (document) => document.status !== "ARCHIVED",
    );
    let existingDocumentDetail: RequirementDocumentDetail | null = null;
    if (existingDocument) {
      try {
        const [currentDocument, analyses] = await Promise.all([
          requestJson<RequirementDocumentDetail>(
            `/api/v1/documents/${encodeURIComponent(existingDocument.id)}`,
          ),
          requestJson<AiAnalysisRequestListResponse>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests?page=1&pageSize=100`,
          ),
        ]);
        existingDocumentDetail = currentDocument;
        const activeGeneration = analyses.items.find((item) =>
          isActiveAnalysisForVersion(
            item,
            currentDocument.id,
            currentDocument.currentVersionDetail.id,
          ),
        );
        if (activeGeneration) {
          const activeDetail = await requestJson<AiAnalysisRequestDetail>(
            `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(activeGeneration.id)}`,
            { cache: "no-store" },
          );
          setTrackedGeneration(activeDetail);
          setAlert({
            tone: "information",
            message:
              "Ya existe una generación de IA en curso para este documento. Espera a que termine antes de crear otra versión.",
          });
          return;
        }
      } catch (error) {
        setAlert({
          tone: "danger",
          message:
            error instanceof Error
              ? error.message
              : "No fue posible validar las generaciones activas.",
        });
        return;
      }
    }
    const confirmed = await confirm({
      title: "Procesar fuentes con IA",
      message: existingDocument
        ? `El proyecto ya tiene el documento "${existingDocument.title}". Se procesarán ${selectedIds.length} fuente(s) con ${aiEngines.engines.map((engine) => (engine === "LOCAL" ? "IA local" : "IA nube")).join(" e ")} y se conservará la versión anterior.`
        : `Se procesarán ${selectedIds.length} fuente(s) con ${aiEngines.engines.map((engine) => (engine === "LOCAL" ? "IA local" : "IA nube")).join(" e ")}.`,
      confirmLabel: "Procesar",
    });
    if (!confirmed) return;

    const operationKey = `sources-${createBrowserUuid()}`;
    generationLockRef.current = true;
    setBatchProcessing("SELECTED");
    setTrackedGeneration(null);
    setGeneratedDocumentId(null);
    setGenerationProgress(10);

    try {
      const fileIdsToProcess = selectedItems
        .filter(
          (source) =>
            source.sourceType === "FILE" && source.processingStatus !== "READY",
        )
        .map((source) => source.id);

      if (fileIdsToProcess.length > 0) {
        setGenerationStage(`Procesando fuentes 0/${selectedIds.length}…`);
        const result = await requestJson<SourceBatchProcessingResponse>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sources/process`,
          {
            method: "POST",
            body: JSON.stringify({ sourceIds: fileIdsToProcess }),
          },
        );
        if (result.failed > 0 && result.enqueued === 0) {
          throw new Error(
            "Ninguna fuente pudo entrar a procesamiento. Revisa los errores individuales.",
          );
        }
      }

      await waitUntilReady(selectedIds);
      setGenerationStage("Preparando documento DRAFT…");
      setGenerationProgress(20);

      let document: RequirementDocumentDetail;
      let purpose: "INITIAL_DRAFT" | "AI_VERSION";
      if (existingDocument) {
        const current = existingDocumentDetail;
        if (!current) {
          throw new Error(
            "No fue posible determinar la versión DRAFT actual del documento.",
          );
        }
        document = await requestJson<RequirementDocumentDetail>(
          `/api/v1/documents/${encodeURIComponent(current.id)}/versions`,
          {
            method: "POST",
            body: JSON.stringify({
              expectedRevision: current.revision,
              changeSummary:
                "Nueva versión generada con IA a partir de fuentes procesadas",
              idempotencyKey: operationKey,
            }),
          },
        );
        purpose = "AI_VERSION";
      } else {
        document = await requestJson<RequirementDocumentDetail>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
          {
            method: "POST",
            body: JSON.stringify({
              title: selectedProject?.title,
              changeSummary:
                "Borrador inicial generado a partir de fuentes procesadas",
              idempotencyKey: operationKey,
            }),
          },
        );
        purpose = "INITIAL_DRAFT";
      }

      setGenerationStage("Enviando solicitud a IA…");
      setGenerationProgress(30);
      const analysis = await requestJson<AiAnalysisRequestDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests`,
        {
          method: "POST",
          body: JSON.stringify({
            analysisType: "REQUIREMENT_DOCUMENT",
            documentId: document.id,
            documentVersionId: document.currentVersionDetail.id,
            sourceIds: selectedIds,
            engines: aiEngines.engines,
            providerSelections: aiEngines.providerSelections,
            includePrototype,
            purpose,
            idempotencyKey: operationKey,
          }),
        },
      );
      setTrackedGeneration(analysis);
      setGenerationProgress(analysisGenerationPercentage(analysis));
      const completed = await waitForDraft(analysis);
      if (!completed) return;
      setGenerationProgress(100);

      setSelectedSourceIds(new Set());
      setGeneratedDocumentId(document.id);
      setAlert({
        tone: "success",
        message:
          purpose === "INITIAL_DRAFT"
            ? "Borrador generado y aplicado. Requiere revisión humana."
            : `La versión ${document.currentVersion} fue generada con IA y requiere revisión humana.`,
      });
      await loadSources(
        projectId,
        search,
        sourceType,
        processingStatus,
        status,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No fue posible generar el borrador.";
      setAlert({
        tone: message === "Generación cancelada." ? "information" : "danger",
        message: message,
      });
    } finally {
      setBatchProcessing(null);
      setGenerationStage(null);
      generationLockRef.current = false;
    }
  }

  async function archiveSource(source: SourceSummary): Promise<void> {
    if (
      !(await confirm({
        title: "Archivar fuente",
        message: `¿Archivar la fuente "${source.title}"? No se elimina físicamente: se retira de la vista activa y se conserva para trazabilidad (filtro Archivadas). Por ahora la pantalla no ofrece restaurarla.`,
        confirmLabel: "Archivar",
        destructive: true,
      }))
    ) {
      return;
    }

    setLoading(true);

    try {
      await requestJson<SourceDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(source.id)}`,
        { method: "DELETE" },
      );

      setAlert({
        tone: "success",
        message: "La fuente fue archivada y se conserva para trazabilidad.",
      });

      await loadSources(
        projectId,
        search,
        sourceType,
        processingStatus,
        status,
      );
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible archivar la fuente.",
      });
    } finally {
      setLoading(false);
    }
  }

  const fileDetail = editing?.sourceType === "FILE" ? editing : null;
  const canSubmit =
    Boolean(projectId) &&
    !saving &&
    (editing
      ? form.title.trim().length >= 3 &&
        (editing.sourceType === "FILE"
          ? Boolean(form.classification)
          : form.content.trim().length >= 1)
      : creationMode === "FILES"
        ? selectedFiles.length > 0
        : form.title.trim().length >= 3 &&
          form.content.trim().length >= 1 &&
          form.content.length <= TEXT_SOURCE_CONTENT_LIMIT);
  // SOURCES_SELECTION_PREVIEW_V1
  // «Selección previa»: hay fuentes seleccionadas y ninguna generación activa.
  // Tiene prioridad sobre una solicitud terminal: el panel usa el selector
  // vigente y la estimación, no los resultados reales de una ejecución anterior.
  const selectionPreview =
    selectedSourceIds.size > 0 &&
    !trackedGenerationActive &&
    batchProcessing === null &&
    !retryingApplication &&
    !retryingGeneration;
  const presentedGeneration = selectionPreview ? null : trackedGeneration;
  const displayedGenerationProgress = presentedGeneration
    ? analysisGenerationPercentage(presentedGeneration)
    : generationProgress;
  const displayedGenerationStage =
    generationStage ??
    (presentedGeneration ? analysisGenerationStage(presentedGeneration) : null);
  const processActionTitle =
    aiEngines.engines.length === 1
      ? aiEngines.engines[0] === "LOCAL"
        ? "Procesar con IA local"
        : "Procesar con IA nube"
      : "Procesar con IA local y nube";
  const processActionLabel = "Generar borrador";
  // REQUISITO 1: el modo mostrado para una solicitud ya iniciada (en cola,
  // en proceso, completada, fallida o cancelada) nunca proviene del selector
  // actual; solo una solicitud todavía no iniciada usa el selector.
  const displayedGenerationMode = resolveTrackedGenerationMode(
    presentedGeneration,
    aiEngines.engines,
  );
  const displayedGenerationEngines: readonly AiEngine[] =
    displayedGenerationMode === "LOCAL_CLOUD"
      ? ["LOCAL", "CLOUD"]
      : displayedGenerationMode === "LOCAL_ONLY"
        ? ["LOCAL"]
        : displayedGenerationMode === "CLOUD_ONLY"
          ? ["CLOUD"]
          : [];
  const latestExecution = presentedGeneration?.executions.at(-1) ?? null;
  const generationFailureCode =
    presentedGeneration?.errorCode ?? latestExecution?.errorCode ?? null;
  const localDraftBlocks =
    presentedGeneration?.processing?.localDraftBlocks ?? [];
  const currentLocalDraftBlock =
    presentedGeneration?.processing?.currentLocalDraftBlock ??
    localDraftBlocks.find((block) => block.status === "PROCESSING") ??
    localDraftBlocks.find(
      (block) => block.status === "FAILED" || block.status === "CANCELLED",
    ) ??
    null;
  const completedLocalDraftBlocks = localDraftBlocks.filter(
    (block) => block.status === "COMPLETED",
  ).length;
  const localDraftBlockTotal =
    currentLocalDraftBlock?.blockTotal ??
    localDraftBlocks[0]?.blockTotal ??
    localDraftBlocks.length;
  const generationUsesLocal = displayedGenerationEngines.includes("LOCAL");
  const generationUsesCloud = displayedGenerationEngines.includes("CLOUD");
  const generationModeLabel = aiGenerationModeLabel(displayedGenerationMode);
  const generationKpiLabel =
    displayedGenerationMode === "LOCAL_CLOUD"
      ? "IA híbrida"
      : generationModeLabel;
  const generationModeDescription = aiGenerationModeDescription(
    displayedGenerationMode,
  );
  const currentGenerationStage = presentedGeneration?.processing?.stage ?? null;
  const generationFailureMessage = safeGenerationFailureMessage(
    presentedGeneration?.errorMessage ?? latestExecution?.errorMessage,
    generationFailureCode,
    latestExecution?.status === "COMPLETED",
  );
  const failedPipelineStep = presentedGeneration?.processing
    ? generationPipelineSteps(
        presentedGeneration,
        displayedGenerationEngines,
      ).find(
        (_, index) =>
          generationPipelineState(
            presentedGeneration,
            index,
            displayedGenerationEngines,
          ) === "failed",
      )
    : null;
  const showLocalDraftProgress =
    currentGenerationStage === "LOCAL_AI_GENERATION" ||
    failedPipelineStep === "Borrador local" ||
    localDraftBlocks.length > 0;
  const actualInputTokens = latestExecution?.inputTokens ?? null;
  const actualOutputTokens = latestExecution?.outputTokens ?? null;
  const tokenMeterHasSources = tokenEstimateSourceIdsKey.length > 0;
  const tokenUsageTone = !tokenEstimate
    ? "neutral"
    : !tokenEstimate.canProcess || tokenEstimate.usagePercentage > 100
      ? "danger"
      : tokenEstimate.usagePercentage >= 90
        ? "danger"
        : tokenEstimate.usagePercentage >= 70
          ? "warning"
          : "success";
  const [discussionSelectionCounts, setDiscussionSelectionCounts] = useState({
    manual: 0,
    local: 0,
    cloud: 0,
  });

  useEffect(() => {
    if (!projectId) {
      setDiscussionSelectionCounts({ manual: 0, local: 0, cloud: 0 });
      return;
    }
    try {
      setDiscussionSelectionCounts(
        parseDiscussionSourceSelectionCounts(
          window.localStorage.getItem(
            `rq-requirement-discussion-v1:${projectId}`,
          ),
        ),
      );
    } catch {
      setDiscussionSelectionCounts({ manual: 0, local: 0, cloud: 0 });
    }
  }, [projectId, metrics.total]);

  // Si un intento termina en error, fallo o cancelación no debe quedar una
  // versión: se descarta el borrador que la pantalla creó antes de llamar a la
  // IA. Solo aplica a intentos observados en curso en esta pantalla (no toca
  // generaciones antiguas descubiertas ya terminadas).
  const observedActiveGenerationsRef = useRef(new Set<string>());
  const discardedGenerationsRef = useRef(new Set<string>());
  const [discardedGenerationId, setDiscardedGenerationId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!trackedGeneration) return;
    const generation = trackedGeneration;
    if (generation.status === "PENDING" || generation.status === "PROCESSING") {
      observedActiveGenerationsRef.current.add(generation.id);
      return;
    }
    if (generation.status === "COMPLETED") return;
    if (
      !observedActiveGenerationsRef.current.has(generation.id) ||
      discardedGenerationsRef.current.has(generation.id)
    ) {
      return;
    }
    discardedGenerationsRef.current.add(generation.id);

    void (async () => {
      try {
        const result = await requestJson<{
          deleted: true;
          documentDeleted: boolean;
        }>(
          `/api/v1/documents/${encodeURIComponent(generation.documentId)}/versions/${generation.generatedVersionNumber}`,
          { method: "DELETE" },
        );
        setDiscardedGenerationId(generation.id);
        if (result.documentDeleted) setGeneratedDocumentId(null);
        setAlert({
          tone: "information",
          message: `La generación no se completó: se descartó el borrador ${generation.generatedVersion} y no se creó ninguna versión.`,
        });
      } catch (error) {
        setAlert({
          tone: "danger",
          message: `No se pudo descartar el borrador ${generation.generatedVersion}: ${
            error instanceof Error ? error.message : "error desconocido"
          }`,
        });
      }
    })();
  }, [trackedGeneration]);

  const generationOutcome = describeGenerationOutcome({
    status: presentedGeneration
      ? presentedGeneration.status
      : displayedGenerationStage
        ? "PROCESSING"
        : null,
    errorCode: generationFailureCode,
    errorMessage:
      presentedGeneration?.errorMessage ?? latestExecution?.errorMessage,
    technicalMessage: generationFailureMessage,
    providerCompleted: latestExecution?.status === "COMPLETED",
    stageLabel: failedPipelineStep ?? displayedGenerationStage,
    selectedSourceCount: selectedSourceIds.size,
    context: {
      modeLabel: generationModeLabel,
      sourceCount: selectionPreview
        ? (tokenEstimate?.sourceCount ?? selectedSourceIds.size)
        : (presentedGeneration?.sources.length ?? null),
      estimate:
        selectionPreview && tokenEstimate
          ? {
              method: tokenEstimate.estimateMethod,
              model: tokenEstimate.model,
              promptCharacters: tokenEstimate.promptCharacters,
              estimatedInputTokens: tokenEstimate.estimatedInputTokens,
              maxInputTokens: tokenEstimate.maxInputTokens,
              canProcess: tokenEstimate.canProcess,
              usesCloud: generationUsesCloud,
            }
          : null,
    },
    modeResultLabel: aiGenerationModeExecutedLabel(displayedGenerationMode),
    hasDocument: Boolean(generatedDocumentId),
    hasCheckpoint: localDraftBlocks.length > 0,
    draftDiscarded: presentedGeneration?.id === discardedGenerationId,
    technical: {
      requestId: presentedGeneration?.id,
      versionLabel: presentedGeneration?.generatedVersion,
      model: latestExecution?.model,
      attempt: latestExecution?.attempt,
      inputTokens: actualInputTokens,
      outputTokens: actualOutputTokens,
      providerRequestId: latestExecution?.providerRequestId,
      durationLabel:
        latestExecution?.startedAt && latestExecution.finishedAt
          ? formatGenerationElapsed(
              latestExecution.startedAt,
              Date.parse(latestExecution.finishedAt),
            )
          : null,
      localOnly: generationUsesLocal && !generationUsesCloud,
    },
  });
  const completedStatusDuration =
    latestExecution?.status === "COMPLETED" &&
    latestExecution.startedAt &&
    latestExecution.finishedAt
      ? formatGenerationElapsed(
          latestExecution.startedAt,
          Date.parse(latestExecution.finishedAt),
        )
      : null;
  const completedStatusContent =
    latestExecution?.status === "COMPLETED" ? (
      <>
        {completedStatusDuration !== null && completedStatusDuration !== "—" ? (
          <span className="rq-gen__state-duration">
            Duración: {completedStatusDuration}
          </span>
        ) : null}
        <span>
          Tokens (entrada / salida):{" "}
          {actualInputTokens !== null && actualOutputTokens !== null
            ? `${actualInputTokens.toLocaleString("es-CO")} / ${actualOutputTokens.toLocaleString("es-CO")}`
            : "No disponibles"}
        </span>
      </>
    ) : null;
  const disabledOutcomeActions: readonly GenerationOutcomeAction[] = [
    ...(retryingApplication ? (["retry-application"] as const) : []),
    ...(retryingGeneration ? (["retry-checkpoint"] as const) : []),
  ];

  function handleOutcomeAction(action: GenerationOutcomeAction): void {
    if (action === "retry-application") void retryDocumentApplication();
    else if (action === "retry-checkpoint")
      void retryGenerationFromCheckpoint();
  }

  const generationPipelineNode = presentedGeneration?.processing ? (
    <ol
      aria-label="Etapas de procesamiento de inteligencia artificial"
      className="rq-gen__pipeline"
      data-rq-step-count={
        generationPipelineSteps(presentedGeneration, displayedGenerationEngines)
          .length
      }
    >
      {generationPipelineSteps(
        presentedGeneration,
        displayedGenerationEngines,
      ).map((step, index) => {
        const state = generationPipelineState(
          presentedGeneration,
          index,
          displayedGenerationEngines,
        );
        return (
          <li
            aria-current={state === "active" ? "step" : undefined}
            aria-label={`${step}: ${
              state === "completed"
                ? "completada"
                : state === "active"
                  ? "activa"
                  : state === "failed"
                    ? "fallida"
                    : "pendiente"
            }`}
            data-rq-state={state}
            key={step}
          >
            {/* PASO_12_MONITOR_PROCESAMIENTO_COMPACTO_V2 */}
            <span aria-hidden="true" className="rq-gen__step-number">
              {index + 1}
            </span>
            <strong>{step}</strong>
          </li>
        );
      })}
    </ol>
  ) : null;
  const detailNode = (
    <>
      {presentedGeneration?.processing &&
      (trackedGenerationActive ||
        generationProcessingDetail(presentedGeneration)) ? (
        <div className="rq-gen__detail">
          <span>Detalle de la etapa</span>
          <strong>
            {generationProcessingDetail(presentedGeneration) ??
              "Sin detalle adicional de procesamiento"}
          </strong>
        </div>
      ) : null}
    </>
  );
  const cloudNode = (
    <>
      {currentGenerationStage === "CLOUD_AI_GENERATION" ? (
        // REQUISITO 4: OpenAI no entrega eventos parciales durante su
        // respuesta; se muestra un indicador indeterminado en vez de
        // fabricar un porcentaje temporal.
        <div
          aria-label="El proveedor de nube no reporta avance parcial medible"
          className="rq-source-cloud-indeterminate"
          data-rq-indeterminate="true"
          role="status"
        />
      ) : null}
    </>
  );
  const renderDraftNode = () => (
    <>
      {showLocalDraftProgress ? (
        <section
          aria-label="Progreso de generación del documento por bloques"
          className="rq-local-draft-block-progress"
        >
          <header className="rq-local-draft-block-progress__header">
            <strong>Borrador por puntos</strong>
            <span>
              {localDraftBlockTotal > 0
                ? `${completedLocalDraftBlocks} / ${localDraftBlockTotal} completados`
                : "Inicializando…"}
            </span>
          </header>

          <div
            hidden={!draftProgressExpanded}
            id="rq-local-draft-block-progress-details"
          >
            <div className="rq-local-draft-block-progress__summary">
              <p className="rq-local-draft-block-progress__current">
                {currentLocalDraftBlock
                  ? currentLocalDraftBlock.status === "PROCESSING"
                    ? `Punto ${currentLocalDraftBlock.blockNumber} de ${currentLocalDraftBlock.blockTotal} · ${currentLocalDraftBlock.blockLabel}`
                    : `${localDraftBlockStatusLabel(currentLocalDraftBlock.status)} · Punto ${currentLocalDraftBlock.blockNumber} de ${currentLocalDraftBlock.blockTotal} · ${currentLocalDraftBlock.blockLabel}`
                  : localDraftBlockTotal > 0
                    ? `${completedLocalDraftBlocks}/${localDraftBlockTotal} puntos creados`
                    : "Preparando el primer punto"}
              </p>
              <small>
                {currentLocalDraftBlock?.totalUnits !== undefined &&
                currentLocalDraftBlock.totalUnits > 0
                  ? `Parte ${currentLocalDraftBlock.completedUnits ?? 0} de ${currentLocalDraftBlock.totalUnits}`
                  : ""}
                {currentLocalDraftBlock?.currentStagePath
                  ? ` · ${localDraftOperationLabel(
                      currentLocalDraftBlock.operation,
                    )}${
                      currentLocalDraftBlock.operation === "REPAIRING" &&
                      currentLocalDraftBlock.repairAttempt
                        ? ` #${currentLocalDraftBlock.repairAttempt}`
                        : ""
                    }: ${humanizeTechnicalStagePath(
                      currentLocalDraftBlock.currentStagePath,
                    )}`
                  : ""}
              </small>
            </div>

            {currentLocalDraftBlock?.updatedAt ? (
              <p className="rq-local-draft-block-progress__current">
                Última actualización:{" "}
                {new Date(currentLocalDraftBlock.updatedAt).toLocaleTimeString(
                  "es-CO",
                )}
                {currentLocalDraftBlock.completedUnits !== undefined
                  ? ` · ${currentLocalDraftBlock.completedUnits}${currentLocalDraftBlock.totalUnits ? ` de ${currentLocalDraftBlock.totalUnits}` : ""} partes guardadas`
                  : ""}
                <StallNotice
                  active={trackedGenerationActive}
                  updatedAt={currentLocalDraftBlock.updatedAt}
                />
              </p>
            ) : null}

            {localDraftBlocks.length > 0 ? (
              <ol className="rq-local-draft-block-progress__list">
                {localDraftBlocks.map((block, blockIndex) => {
                  const statusLabel = localDraftBlockStatusLabel(block.status);
                  // Tiempo por punto: desde la última actualización del punto
                  // anterior hasta la del propio punto (en curso: hasta ahora).
                  const previousStamp =
                    blockIndex > 0
                      ? Date.parse(
                          localDraftBlocks[blockIndex - 1]?.updatedAt ?? "",
                        )
                      : Number.NaN;
                  const finishedStamp =
                    block.status === "COMPLETED"
                      ? Date.parse(block.updatedAt ?? "")
                      : Number.NaN;
                  const isCurrent = block.status === "PROCESSING";
                  const blockUnitLabel =
                    isCurrent &&
                    block.totalUnits !== undefined &&
                    block.totalUnits > 0
                      ? `Parte ${block.completedUnits ?? 0} de ${block.totalUnits}`
                      : null;
                  return (
                    <li
                      aria-current={isCurrent ? "step" : undefined}
                      aria-label={`Punto ${block.blockNumber}. ${block.blockLabel}: ${statusLabel}`}
                      data-rq-block-status={block.status}
                      key={block.blockKey}
                    >
                      <span
                        aria-hidden="true"
                        className="rq-local-draft-block-progress__marker"
                      >
                        {localDraftBlockStatusSymbol(block.status)}
                      </span>
                      <span className="rq-local-draft-block-progress__item-number">
                        {block.blockNumber}
                      </span>
                      <span className="rq-local-draft-block-progress__item-body">
                        <strong>{block.blockLabel}</strong>
                        <small>
                          {statusLabel}
                          {blockUnitLabel ? ` · ${blockUnitLabel}` : ""}
                        </small>
                      </span>
                      <BlockDuration
                        endStamp={finishedStamp}
                        live={block.status === "PROCESSING"}
                        previousStamp={previousStamp}
                      />
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
  // Cuadro de tokens: cambia según el modo. IA local → consumo local; Híbrido →
  // mejora de tokens (reducción antes de la nube); IA nube → costo estipulado.
  const tokenCardMode =
    generationUsesLocal && generationUsesCloud
      ? "HYBRID"
      : generationUsesLocal
        ? "LOCAL"
        : generationUsesCloud
          ? "CLOUD"
          : "NONE";
  const tokenCardTitle =
    tokenCardMode === "HYBRID"
      ? "Mejora de tokens"
      : tokenCardMode === "CLOUD"
        ? "Costo estimado"
        : "Consumo local";
  const tokenCardSources = presentedGeneration
    ? presentedGeneration.sources.length
    : (tokenEstimate?.sourceCount ?? 0);
  const tokenCardSourcesLabel = `${tokenCardSources} ${
    tokenCardSources === 1 ? "fuente" : "fuentes"
  }`;
  // Resultado del proceso: cuando la generación terminó (bien, con error o
  // cancelada) la tarjeta cuenta qué se hizo y qué se consiguió, en lugar de una
  // estimación previa que ya no aplica.
  const generationFinished =
    presentedGeneration !== null &&
    presentedGeneration !== undefined &&
    !trackedGenerationActive;
  const generationResultRows: Array<{
    key: string;
    label: string;
    value: string;
  }> = [];
  if (generationFinished && presentedGeneration) {
    const add = (key: string, label: string, value: string | null) => {
      if (value) generationResultRows.push({ key, label, value });
    };
    add(
      "result",
      "Resultado",
      presentedGeneration.status === "COMPLETED"
        ? "Documento validado y aplicado"
        : presentedGeneration.status === "CANCELLED"
          ? "Cancelada · sin versión nueva"
          : `Falló${failedPipelineStep ? ` en ${failedPipelineStep}` : ""}`,
    );
    add(
      "points",
      "Puntos del borrador",
      localDraftBlockTotal > 0
        ? `${completedLocalDraftBlocks} de ${localDraftBlockTotal} creados`
        : null,
    );
    add("sources", "Fuentes analizadas", tokenCardSourcesLabel);
    add("model", "Modelo", latestExecution?.model ?? null);
    add("version", "Versión generada", presentedGeneration.generatedVersion);
  }
  const consumptionTabs: ReadonlyArray<{
    id: ConsumptionTab;
    label: string;
  }> = [
    { id: "general", label: "General" },
    { id: "technical", label: "Detalles técnicos" },
    { id: "show", label: "Mostrar" },
  ];
  function handleConsumptionTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next =
      consumptionTabs[
        (index + step + consumptionTabs.length) % consumptionTabs.length
      ];
    if (!next) return;
    setConsumptionTab(next.id);
    document.getElementById(`rq-consumption-tab-${next.id}`)?.focus();
  }
  // Selección previa: solo datos que la estimación entrega, siempre rotulados
  // como estimados. No se inventa reducción, costo, salida ni duración.
  const previewReferenceMode = resolveTrackedGenerationMode(
    trackedGeneration?.status === "COMPLETED" ? trackedGeneration : null,
    [],
  );
  const previewReferenceExecution =
    trackedGeneration?.status === "COMPLETED"
      ? (trackedGeneration.executions.at(-1) ?? null)
      : null;
  const previewReferenceTime =
    selectionPreview &&
    displayedGenerationMode !== null &&
    previewReferenceMode === displayedGenerationMode &&
    previewReferenceExecution?.startedAt &&
    previewReferenceExecution.finishedAt
      ? formatGenerationElapsed(
          previewReferenceExecution.startedAt,
          Date.parse(previewReferenceExecution.finishedAt),
        )
      : null;
  const previewRows: Array<{ key: string; label: string; value: string }> = [];
  if (selectionPreview && tokenEstimate) {
    const tokensLabel = (value: number) => value.toLocaleString("es-CO");
    previewRows.push({
      key: "sources",
      label: "Fuentes (estimado)",
      value: tokenCardSourcesLabel,
    });
    previewRows.push({
      key: "original",
      label: "Tokens originales (estimado)",
      value: tokensLabel(tokenEstimate.originalTokens),
    });
    if (generationUsesLocal && tokenEstimate.localAnalysisTokens !== null) {
      previewRows.push({
        key: "local",
        label: "Tokens locales (estimado)",
        value: tokensLabel(tokenEstimate.localAnalysisTokens),
      });
    }
    const consolidationKnown =
      generationUsesLocal &&
      generationUsesCloud &&
      tokenEstimate.consolidatedTokens !== null;
    if (consolidationKnown && tokenEstimate.consolidatedTokens !== null) {
      previewRows.push(
        {
          key: "reduction",
          label: "Reducción (estimado)",
          value:
            tokenEstimate.consolidatedTokens > tokenEstimate.originalTokens
              ? "sin reducción"
              : tokenEstimate.reductionPercentage === null
                ? "no informada"
                : `${tokenEstimate.reductionPercentage.toFixed(1)} %`,
        },
        {
          key: "consolidated",
          label: "Contexto consolidado (estimado)",
          value: tokensLabel(tokenEstimate.consolidatedTokens),
        },
      );
    }
    if (generationUsesCloud && (!generationUsesLocal || consolidationKnown)) {
      previewRows.push(
        {
          key: "cloud-input",
          label: "Entrada a la nube (estimado)",
          value: tokensLabel(tokenEstimate.openAiInputTokens),
        },
        {
          key: "cloud-available",
          label: "Disponible en la nube (estimado)",
          value: `${tokensLabel(tokenEstimate.remainingTokens)} de ${tokensLabel(tokenEstimate.maxInputTokens)}`,
        },
      );
    } else if (generationUsesCloud) {
      previewRows.push({
        key: "cloud-limit",
        label: "Límite de entrada en la nube",
        value: tokensLabel(tokenEstimate.maxInputTokens),
      });
    }
  }
  const previewPendingLocal =
    generationUsesLocal &&
    generationUsesCloud &&
    tokenEstimate !== null &&
    tokenEstimate.consolidatedTokens === null;
  const generalConsumptionNode = (
    <div className="rq-source-token-meter" data-rq-token-tone={tokenUsageTone}>
      <div className="rq-source-token-meter__header">
        <h3>{selectionPreview ? "Estimación previa" : tokenCardTitle}</h3>
        <span className="rq-source-token-meter__mode">
          Generación · {generationModeLabel}
          {generationModeDescription ? ` · ${generationModeDescription}` : ""}
        </span>
      </div>

      {selectionPreview && tokenEstimate ? (
        <>
          <dl
            aria-label="Estimación previa a la ejecución"
            className="rq-source-token-summary"
          >
            {previewRows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
            <div>
              <dt>Tiempo de referencia</dt>
              <dd>
                {previewReferenceTime && previewReferenceTime !== "—"
                  ? `${previewReferenceTime} (última ejecución completada en este modo)`
                  : "Sin medición comparable todavía"}
              </dd>
            </div>
          </dl>
          {previewPendingLocal ? (
            <small>
              La reducción, el contexto consolidado y el envío a la nube se
              confirmarán durante el análisis local.
            </small>
          ) : null}
          <small>
            Valores estimados: el costo, los tokens de salida y la duración
            reales se conocen al terminar.
          </small>
        </>
      ) : generationResultRows.length > 0 ? (
        <dl
          aria-label="Resultado del proceso"
          className="rq-source-token-summary"
        >
          {generationResultRows.map((row) => (
            <div key={row.key}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : tokenEstimateLoading ? (
        <small>Calculando consumo…</small>
      ) : !tokenEstimate ? (
        tokenMeterHasSources ? (
          <small>
            {tokenEstimateMessage ?? "Preparando estimación de consumo…"}
          </small>
        ) : (
          <small>Selecciona fuentes para estimar el consumo.</small>
        )
      ) : tokenCardMode === "CLOUD" ? (
        <>
          <div className="rq-source-token-meter__numbers">
            <strong>
              {tokenEstimate.openAiInputTokens.toLocaleString("es-CO")}
            </strong>
            <span> tokens estimados de entrada</span>
          </div>
          <progress
            aria-label="Porcentaje estimado del límite de tokens de entrada en nube"
            max={100}
            value={Math.min(tokenEstimate.usagePercentage, 100)}
          >
            {tokenEstimate.usagePercentage.toFixed(1)}%
          </progress>
          <small>
            Límite {tokenEstimate.maxInputTokens.toLocaleString("es-CO")} ·{" "}
            {tokenEstimate.usagePercentage.toFixed(1)} % usado
          </small>
          <small>
            Costo estimado:{" "}
            {latestExecution?.estimatedCost
              ? latestExecution.estimatedCost
              : "se informa al terminar"}
          </small>
          <small>
            {tokenCardSourcesLabel} ·{" "}
            {latestExecution?.model ?? tokenEstimate.model}
          </small>
        </>
      ) : tokenCardMode === "HYBRID" ? (
        <>
          <div className="rq-source-token-meter__numbers">
            <strong>
              {tokenEstimate.originalTokens.toLocaleString("es-CO")} →{" "}
              {tokenEstimate.consolidatedTokens?.toLocaleString("es-CO") ??
                "pendiente"}
            </strong>
            <span>
              {" "}
              tokens
              {tokenEstimate.consolidatedTokens !== null &&
              tokenEstimate.consolidatedTokens > tokenEstimate.originalTokens
                ? " · sin reducción"
                : tokenEstimate.reductionPercentage === null
                  ? ""
                  : ` · ${tokenEstimate.reductionPercentage.toFixed(1)} % menos`}
            </span>
          </div>
          <dl
            aria-label="Desglose de tokens: local, reducción y nube"
            className="rq-source-token-summary"
          >
            {buildTokenBreakdownRows(tokenEstimate, {
              usesCloud: true,
            }).map((row) => (
              <div data-rq-token-row-tone={row.tone} key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <>
          <div className="rq-source-token-meter__numbers">
            <strong>
              {tokenEstimate.originalTokens.toLocaleString("es-CO")}
            </strong>
            <span> tokens analizados en local</span>
          </div>
          <small>
            {tokenCardSourcesLabel}
            {latestExecution?.model ? ` · ${latestExecution.model}` : ""}
          </small>
        </>
      )}

      {actualInputTokens !== null && generationResultRows.length === 0 ? (
        <small>
          Entrada real: {actualInputTokens.toLocaleString("es-CO")} · Salida:{" "}
          {(actualOutputTokens ?? 0).toLocaleString("es-CO")}
        </small>
      ) : null}
    </div>
  );
  const consumptionNode = (
    <div
      className="rq-source-consumption-tabs"
      data-collapsed={consumptionCollapsed ? "true" : undefined}
    >
      <div
        aria-label="Vistas de la tarjeta de consumo"
        className="rq-source-consumption-tabs__list"
        role="tablist"
      >
        {consumptionTabs.map((tab, index) => (
          <button
            aria-controls={`rq-consumption-panel-${tab.id}`}
            aria-selected={consumptionTab === tab.id}
            className="rq-source-consumption-tabs__tab"
            id={`rq-consumption-tab-${tab.id}`}
            key={tab.id}
            onClick={() => {
              setConsumptionTab(tab.id);
              setConsumptionCollapsed(false);
            }}
            onKeyDown={(event) => handleConsumptionTabKeyDown(event, index)}
            role="tab"
            tabIndex={consumptionTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
        <button
          aria-expanded={!consumptionCollapsed}
          className="rq-source-consumption-tabs__tab rq-source-consumption-tabs__toggle"
          onClick={() => setConsumptionCollapsed((current) => !current)}
          type="button"
        >
          {consumptionCollapsed ? "Ver" : "Ocultar"}
        </button>
      </div>
      <div
        aria-labelledby="rq-consumption-tab-general"
        className="rq-source-consumption-tabs__panel"
        hidden={consumptionCollapsed || consumptionTab !== "general"}
        id="rq-consumption-panel-general"
        role="tabpanel"
      >
        {generalConsumptionNode}
      </div>
      <div
        aria-labelledby="rq-consumption-tab-technical"
        className="rq-source-consumption-tabs__panel"
        hidden={consumptionCollapsed || consumptionTab !== "technical"}
        id="rq-consumption-panel-technical"
        role="tabpanel"
      >
        {generationOutcome.technical.length > 0 ? (
          <dl
            aria-label="Detalles técnicos de la generación"
            className="rq-gen__technical-list"
          >
            {generationOutcome.technical.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <small>Aún no hay detalles técnicos de esta generación.</small>
        )}
      </div>
      <div
        aria-labelledby="rq-consumption-tab-show"
        className="rq-source-consumption-tabs__panel"
        hidden={consumptionCollapsed || consumptionTab !== "show"}
        id="rq-consumption-panel-show"
        role="tabpanel"
      >
        {showLocalDraftProgress ? (
          renderDraftNode()
        ) : (
          <small>Aún no hay borrador por puntos para mostrar.</small>
        )}
      </div>
    </div>
  );

  return (
    <div className="rq-sources-workspace">
      {alert ? (
        <div className="rq-alert" data-rq-tone={alert.tone} role="status">
          <span>{alert.message}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de fuentes">
          <RqKpiCard
            description="Activas / preparadas"
            icon={<WorkspaceKpiIcon name="layers" />}
            title="Fuentes"
            value={`${Math.max(metrics.total - metrics.archived, 0)} / ${metrics.ready}`}
          />
          <RqKpiCard
            description="Manual / local / nube"
            icon={<WorkspaceKpiIcon name="answers" />}
            title="Discusión"
            value={`${discussionSelectionCounts.manual} / ${discussionSelectionCounts.local} / ${discussionSelectionCounts.cloud}`}
          />
          <RqKpiCard
            description={generationModeDescription ?? "Modo de generación"}
            icon={<WorkspaceKpiIcon name="processed" />}
            title="Procesamiento IA"
            value={generationKpiLabel}
          />
        </RqKpiGrid>

        <div
          aria-label="Procesamiento IA"
          className="rq-ai-processing-options"
          role="group"
        >
          <AiProcessingMenu
            label="IA"
            providerSelections={
              trackedGenerationActive
                ? trackedGeneration?.providerSelections
                : aiEngines.providerSelections
            }
            selectProvider={aiEngines.selectProvider}
            capabilities={aiEngines.capabilities}
            includePrototype={includePrototype}
            locked={trackedGenerationActive || batchProcessing !== null}
            loading={aiEngines.loading}
            selection={displayedEngineSelection}
            toggle={aiEngines.toggle}
            togglePrototype={togglePrototype}
          />
        </div>

        <div
          aria-label="Acciones de generación"
          className="rq-module-commandbar__actions rq-source-command-actions"
          role="group"
        >
          <RqActionButton
            className="rq-source-command-action"
            compact
            disabled={
              trackedGenerationActive
                ? cancellingGeneration
                : loading ||
                  batchProcessing !== null ||
                  aiEngines.loading ||
                  aiEngines.engines.length === 0 ||
                  selectedSourceIds.size === 0
            }
            onClick={
              trackedGenerationActive
                ? () => void stopGeneration()
                : () => void processBatch()
            }
            title={trackedGenerationActive ? undefined : processActionTitle}
            tone={trackedGenerationActive ? "danger" : "operation"}
          >
            {trackedGenerationActive
              ? cancellingGeneration
                ? "Cancelando…"
                : "Cancelar procesamiento"
              : (generationStage ?? processActionLabel)}
          </RqActionButton>

          {generatedDocumentId ? (
            <a
              className="rq-source-view-draft rq-source-command-action"
              href={`/workspace/documents/${encodeURIComponent(generatedDocumentId)}`}
            >
              Ver borrador
            </a>
          ) : null}

          <details
            className="rq-source-command-more"
            onBlur={(event) => {
              // Al perder el foco el menú se minimiza.
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                event.currentTarget.open = false;
              }
            }}
            ref={moreMenuRef}
          >
            <summary aria-label="Más acciones" title="Más acciones">
              <span aria-hidden="true" className="rq-source-command-more__icon">
                <i />
                <i />
                <i />
              </span>
            </summary>

            <div className="rq-source-command-more__menu">
              <a
                className="rq-source-command-more__item"
                href={`/workspace/documents?projectId=${encodeURIComponent(
                  projectId,
                )}`}
              >
                Documentos del proyecto
              </a>
            </div>
          </details>
        </div>
      </section>

      {displayedGenerationStage || selectedSourceIds.size > 0 ? (
        <SourcesGenerationPanel
          busyAction={
            retryingApplication
              ? "retry-application"
              : retryingGeneration
                ? "retry-checkpoint"
                : null
          }
          consumption={consumptionNode}
          detail={
            <>
              {detailNode}
              {cloudNode}
            </>
          }
          disabledActions={disabledOutcomeActions}
          elapsedSince={
            trackedGenerationActive
              ? (latestExecution?.startedAt ?? null)
              : null
          }
          generationMode={displayedGenerationMode}
          onAction={handleOutcomeAction}
          outcome={generationOutcome}
          pipeline={generationPipelineNode}
          progress={
            displayedGenerationStage ? displayedGenerationProgress : null
          }
          reviewHref={
            generatedDocumentId
              ? `/workspace/documents/${encodeURIComponent(generatedDocumentId)}`
              : null
          }
          statusContent={completedStatusContent}
          stageLabel={
            presentedGeneration?.status === "FAILED" ? failedPipelineStep : null
          }
          subject={
            presentedGeneration ? null : "Estimación previa a la ejecución"
          }
        />
      ) : null}

      <form
        className="rq-projects-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="rq-projects-filter" htmlFor="source-project">
          <span>Proyecto:</span>
          <select
            aria-label="Proyecto de trabajo"
            id="source-project"
            disabled={cancellingGeneration}
            onChange={(event) => changeProject(event.target.value)}
            value={projectId}
          >
            {initialProjects.items.length === 0 ? (
              <option value="">No hay proyectos disponibles</option>
            ) : null}
            {initialProjects.items.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.title}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-projects-filter rq-projects-filter--search">
          <span>Buscar fuente:</span>
          <svg
            aria-hidden="true"
            fill="none"
            height="17"
            viewBox="0 0 24 24"
            width="17"
          >
            <circle
              cx="10.5"
              cy="10.5"
              r="6.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m15.5 15.5 5 5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>
          <input
            aria-label="Buscar fuente por título, contenido o archivo"
            id="source-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título, contenido o archivo"
            type="search"
            value={search}
          />
        </label>

        <label className="rq-projects-filter">
          <span>Tipo:</span>
          <select
            aria-label="Tipo"
            id="source-type"
            onChange={(event) =>
              setSourceType(event.target.value as "" | SourceType)
            }
            value={sourceType}
          >
            <option value="">Todos</option>
            <option value="FILE">Archivo</option>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado"
            id="source-status"
            onChange={(event) => setStatus(event.target.value as SourceStatus)}
            value={status}
          >
            <option value="ACTIVE">Activas</option>
            <option value="ARCHIVED">Archivadas</option>
          </select>
        </label>

        <RqActionButton
          disabled={loading || !projectId}
          onClick={() => {
            setSearch("");
            setSourceType("");
            setProcessingStatus("");
            setStatus("ACTIVE");
          }}
          tone="secondary"
          type="button"
        >
          Limpiar
        </RqActionButton>

        <RqActionButton
          disabled={loading || batchProcessing !== null || !projectId}
          onClick={openCreate}
          tone="affirmative"
          type="button"
        >
          Nueva fuente
        </RqActionButton>
      </form>

      <RqTableShell title="Fuentes">
        <table className="rq-table rq-source-table">
          <thead>
            <tr>
              <th scope="col">
                <input
                  aria-label="Seleccionar todas las fuentes elegibles visibles"
                  checked={allEligibleVisibleSelected}
                  disabled={
                    loading ||
                    batchProcessing !== null ||
                    eligibleVisibleSourceIds.length === 0
                  }
                  onChange={toggleAllEligibleVisible}
                  type="checkbox"
                />
              </th>
              <th scope="col">Fuente</th>
              <th scope="col">Tipo y clasificación</th>
              <th scope="col">Archivo</th>
              <th scope="col">Preparación del archivo</th>
              <th scope="col">En la generación</th>
              <th scope="col">Estado</th>
              <th scope="col">Actualización</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sources.items.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <RqEmptyState
                    title={
                      projectId
                        ? "Sin fuentes para mostrar"
                        : "Selecciona un proyecto"
                    }
                    description={
                      projectId
                        ? "Registra una fuente textual o carga varios archivos."
                        : "Las fuentes siempre pertenecen a un proyecto accesible."
                    }
                  />
                </td>
              </tr>
            ) : (
              sources.items.map((source) => {
                const displayedProcessing = sourceProcessingDisplay(
                  source,
                  trackedGeneration,
                  displayedGenerationProgress,
                );
                const localOnlyCompatible =
                  !localOnlySelection || isLocalOnlyConversationSource(source);
                const preparation = sourcePreparationLabel(
                  source.processingStatus,
                );
                const generationCell = sourceGenerationCell(
                  Boolean(
                    trackedGeneration?.sources.some(
                      (item) =>
                        item.sourceId.toLowerCase() === source.id.toLowerCase(),
                    ),
                  ),
                  displayedProcessing.label,
                );

                return (
                  <tr key={source.id}>
                    <td>
                      {source.status === "ACTIVE" &&
                      source.processingStatus !== "PROCESSING" ? (
                        <input
                          aria-label={`Seleccionar ${source.title}`}
                          checked={selectedSourceIds.has(source.id)}
                          disabled={
                            loading ||
                            batchProcessing !== null ||
                            !localOnlyCompatible
                          }
                          onChange={() => toggleSourceSelection(source.id)}
                          title={
                            localOnlyCompatible
                              ? undefined
                              : "IA local solo procesa Preguntas de análisis o conversaciones."
                          }
                          type="checkbox"
                        />
                      ) : (
                        <span aria-hidden="true">—</span>
                      )}
                    </td>
                    <td>
                      <div className="rq-source-table__title">
                        <strong>{source.title}</strong>
                        <span
                          title={
                            source.description ||
                            source.contentPreview ||
                            undefined
                          }
                        >
                          {source.description ||
                            source.contentPreview ||
                            source.processingMessage ||
                            "Sin descripción"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="rq-source-table__type">
                        <span>{sourceTypeLabel(source.sourceType)}</span>
                        <small>
                          {classificationLabel(source.classification)}
                        </small>
                      </div>
                    </td>
                    <td className="rq-source-table__file">
                      <span title={fileDescription(source)}>
                        {fileDescription(source)}
                      </span>
                    </td>
                    <td>
                      <div
                        className="rq-source-prep"
                        data-state={source.processingStatus}
                        title={source.processingMessage ?? undefined}
                      >
                        <span>
                          <span aria-hidden="true">{preparation.symbol} </span>
                          {preparation.label}
                        </span>
                        {source.processingStatus === "PROCESSING" ? (
                          <progress
                            aria-label={`Preparación del archivo ${source.title}`}
                            max={100}
                            value={sourceProcessingPercentage(source)}
                          >
                            {sourceProcessingPercentage(source)} %
                          </progress>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span
                        className="rq-source-generation-cell"
                        data-included={generationCell.included}
                        title={displayedProcessing.message ?? undefined}
                      >
                        {generationCell.included ? (
                          generationCell.label
                        ) : (
                          <>
                            <span aria-hidden="true">—</span>
                            <span className="rq-visually-hidden">
                              No incluida en la generación actual
                            </span>
                          </>
                        )}
                      </span>
                    </td>
                    <td>
                      <RqStatusBadge
                        tone={
                          source.status === "ACTIVE" ? "success" : "inactive"
                        }
                      >
                        {sourceStatusLabel(source.status)}
                      </RqStatusBadge>
                    </td>
                    <td>{formatDate(source.updatedAt)}</td>
                    <td>
                      <div className="rq-source-table__actions">
                        <RqActionButton
                          className="rq-source-action rq-source-action--edit"
                          compact
                          disabled={loading}
                          onClick={() => void openDetail(source)}
                          tone="operation"
                        >
                          Editar
                        </RqActionButton>
                        {source.sourceType === "FILE" ? (
                          <>
                            <RqActionButton
                              className="rq-source-action rq-source-action--download"
                              compact
                              disabled={loading}
                              onClick={() => void downloadSource(source)}
                              tone="consult"
                            >
                              Descargar
                            </RqActionButton>
                          </>
                        ) : null}
                        {source.status === "ACTIVE" ? (
                          <RqActionButton
                            className="rq-source-action rq-source-action--delete"
                            compact
                            disabled={loading}
                            onClick={() => void archiveSource(source)}
                            tone="secondary"
                          >
                            Archivar
                          </RqActionButton>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </RqTableShell>

      {modalOpen ? (
        <div className="rq-project-modal-backdrop">
          <section
            aria-labelledby="source-modal-title"
            aria-modal="true"
            className="rq-project-modal rq-source-modal"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>{selectedProject?.code ?? "Fuente del proyecto"}</span>
                <h2 id="source-modal-title">
                  {editing
                    ? editing.sourceType === "FILE"
                      ? "Editar archivo"
                      : "Editar fuente"
                    : "Nueva fuente"}
                </h2>
              </div>
            </header>

            {!editing ? (
              <div className="rq-source-mode-tabs" role="tablist">
                <button
                  aria-controls="source-form"
                  aria-selected={creationMode === "TEXT"}
                  data-active={creationMode === "TEXT"}
                  id="source-mode-tab-TEXT"
                  onClick={() => setCreationMode("TEXT")}
                  role="tab"
                  type="button"
                >
                  Fuente textual
                </button>
                <button
                  aria-controls="source-form"
                  aria-selected={creationMode === "FILES"}
                  data-active={creationMode === "FILES"}
                  id="source-mode-tab-FILES"
                  onClick={() => setCreationMode("FILES")}
                  role="tab"
                  type="button"
                >
                  Subir archivos
                </button>
              </div>
            ) : null}

            <form
              aria-labelledby={
                editing ? undefined : `source-mode-tab-${creationMode}`
              }
              className="rq-project-form"
              id="source-form"
              onSubmit={saveSource}
            >
              {creationMode === "FILES" && !editing ? (
                <>
                  <div
                    className="rq-source-dropzone"
                    data-active={dragActive}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={handleDrop}
                  >
                    <strong>Arrastra los archivos aquí</strong>
                    <span>
                      o selecciónalos desde tu equipo. Puedes volver a
                      seleccionar para agregar más; conservaremos los
                      anteriores. Máximo 20 archivos por operación.
                    </span>
                    <label htmlFor="source-files">Seleccionar archivos</label>
                    <input
                      accept={FILE_ACCEPT}
                      id="source-files"
                      multiple
                      onChange={(event) => {
                        selectFiles(event.target.files ?? []);
                        event.currentTarget.value = "";
                      }}
                      type="file"
                    />
                    <small>
                      PDF, DOCX, XLSX, TXT, VTT, CSV, PNG, JPG, JPEG y WEBP.
                    </small>
                  </div>

                  <div className="rq-source-selected-files">
                    <strong>
                      Archivos seleccionados ({selectedFiles.length})
                    </strong>
                    {selectedFiles.length === 0 ? (
                      <span>No has seleccionado archivos.</span>
                    ) : (
                      <div className="rq-source-file-config-list">
                        {selectedFiles.map((item, index) => (
                          <article
                            className="rq-source-file-config"
                            key={item.key}
                          >
                            <header>
                              <div>
                                <strong>
                                  {index + 1}. {item.file.name}
                                </strong>
                                <small>
                                  {formatBytes(String(item.file.size))}
                                </small>
                              </div>
                              <RqActionButton
                                compact
                                onClick={() => removeSelectedFile(item.key)}
                                tone="danger"
                              >
                                Quitar
                              </RqActionButton>
                            </header>

                            <div className="rq-field">
                              <label htmlFor={`source-classification-${index}`}>
                                Clasificación
                              </label>
                              <select
                                id={`source-classification-${index}`}
                                onChange={(event) =>
                                  updateSelectedFile(item.key, {
                                    classification: event.target
                                      .value as SourceClassification,
                                  })
                                }
                                value={item.classification}
                              >
                                {CLASSIFICATION_OPTIONS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.value === "OTHER"
                                      ? "Otro — clasificación predeterminada"
                                      : option.label}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="rq-field">
                              <label htmlFor={`source-description-${index}`}>
                                Descripción opcional
                              </label>
                              <textarea
                                id={`source-description-${index}`}
                                maxLength={2000}
                                onChange={(event) =>
                                  updateSelectedFile(item.key, {
                                    description: event.target.value,
                                  })
                                }
                                placeholder="Contexto o propósito de este archivo"
                                rows={3}
                                value={item.description}
                              />
                              <small>{item.description.length}/2000</small>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {fileDetail ? (
                    <>
                      <div className="rq-source-file-summary">
                        <div>
                          <span>Archivo</span>
                          <strong>{fileDetail.originalFileName}</strong>
                        </div>
                        <div>
                          <span>Formato y tamaño</span>
                          <strong>
                            {fileDetail.fileExtension?.toUpperCase() ?? "—"} ·{" "}
                            {formatBytes(fileDetail.fileSizeBytes)}
                          </strong>
                        </div>
                        <div>
                          <span>Procesamiento</span>
                          <strong>
                            {processingLabel(fileDetail.processingStatus)}
                          </strong>
                        </div>
                        <div>
                          <span>Páginas / hojas</span>
                          <strong>
                            {fileDetail.pageCount ??
                              fileDetail.sheetCount ??
                              "—"}
                          </strong>
                        </div>
                      </div>

                      <div className="rq-field">
                        <label htmlFor="source-form-title">Título</label>
                        <input
                          autoFocus
                          id="source-form-title"
                          maxLength={240}
                          minLength={3}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          required
                          value={form.title}
                        />
                      </div>

                      <div className="rq-field">
                        <label htmlFor="source-form-classification">
                          Clasificación
                        </label>
                        <select
                          id="source-form-classification"
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              classification: event.target.value as
                                "" | SourceClassification,
                            }))
                          }
                          required
                          value={form.classification}
                        >
                          <option value="">Selecciona una clasificación</option>
                          {CLASSIFICATION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.value === "OTHER"
                                ? "Otro — clasificación predeterminada"
                                : option.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="rq-field rq-source-form__description">
                        <label htmlFor="source-form-description">
                          Descripción opcional
                        </label>
                        <textarea
                          id="source-form-description"
                          maxLength={2000}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              description: event.target.value,
                            }))
                          }
                          placeholder="Contexto o propósito del archivo"
                          rows={4}
                          value={form.description}
                        />
                        <small>{form.description.length}/2000</small>
                      </div>

                      <div className="rq-source-extracted-preview">
                        <span>Contenido extraído</span>
                        <pre>
                          {fileDetail.extractedText ||
                            fileDetail.processingMessage ||
                            "Este archivo no contiene texto extraíble."}
                        </pre>
                      </div>
                    </>
                  ) : editing ? (
                    <>
                      <div className="rq-field">
                        <label htmlFor="source-form-type">Tipo de fuente</label>
                        <select
                          disabled
                          id="source-form-type"
                          value={form.sourceType}
                        >
                          {TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="rq-field">
                        <label htmlFor="source-form-title">Título</label>
                        <input
                          autoFocus
                          id="source-form-title"
                          maxLength={240}
                          minLength={3}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          required
                          value={form.title}
                        />
                      </div>
                      <div className="rq-field rq-source-form__content">
                        <label htmlFor="source-form-content">Contenido</label>
                        <textarea
                          id="source-form-content"
                          maxLength={TEXT_SOURCE_CONTENT_LIMIT}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              content: event.target.value,
                            }))
                          }
                          required
                          rows={14}
                          value={form.content}
                        />
                        <small>
                          {form.content.length}/{TEXT_SOURCE_CONTENT_LIMIT}
                        </small>
                      </div>
                    </>
                  ) : (
                    <div className="rq-source-text-capture">
                      <div className="rq-source-text-editor">
                        <div className="rq-field">
                          <label htmlFor="source-form-type">
                            Tipo de fuente
                          </label>
                          <select
                            id="source-form-type"
                            onChange={(event) => {
                              const nextType = event.target
                                .value as TextSourceType;
                              setForm((current) => ({
                                ...current,
                                sourceType: nextType,
                                title:
                                  nextType === "CONVERSATION"
                                    ? "Conversación"
                                    : current.title,
                              }));
                            }}
                            value={form.sourceType}
                          >
                            {TYPE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div className="rq-field">
                          <label htmlFor="source-form-title">Título</label>
                          <input
                            autoFocus
                            id="source-form-title"
                            maxLength={240}
                            minLength={3}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            required
                            value={form.title}
                          />
                        </div>

                        <div className="rq-field rq-source-form__content">
                          <label htmlFor="source-form-content">Contenido</label>
                          <textarea
                            id="source-form-content"
                            maxLength={TEXT_SOURCE_CONTENT_LIMIT}
                            onChange={(event) =>
                              setForm((current) => ({
                                ...current,
                                content: event.target.value,
                              }))
                            }
                            placeholder="Escribe aquí el contenido de la fuente."
                            rows={18}
                            value={form.content}
                          />
                          <small>
                            {form.content.length.toLocaleString("es-CO")}/
                            {TEXT_SOURCE_CONTENT_LIMIT.toLocaleString("es-CO")}
                          </small>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </form>
            <footer className="rq-project-modal__actions rq-source-modal__actions">
              <RqActionButton
                disabled={saving}
                onClick={closeModal}
                tone="secondary"
              >
                Cancelar
              </RqActionButton>
              <RqActionButton
                disabled={!canSubmit}
                form="source-form"
                tone="affirmative"
                type="submit"
              >
                {saving
                  ? creationMode === "FILES" && !editing
                    ? "Cargando…"
                    : "Guardando…"
                  : "Guardar"}
              </RqActionButton>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
