"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import type {
  ExecutionTaskStatusDetail,
  NotificationDetail,
  NotificationListResponse,
  ProjectListResponse,
  ProjectMetrics,
  ProjectStatus,
  ProjectSummary,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
  SourceListResponse,
} from "@levantamiento-rq/shared-contracts";
import { RqKpiCard, RqKpiGrid } from "@levantamiento-rq/shared-ui";

import {
  calculateDocumentStageProgress,
  calculateCreationStageProgress,
  calculateAzureExecutionProgress,
  calculateSourceStageProgress,
  calculateValidationStageProgress,
  parseDiscussionStageSnapshot,
} from "./home-stage-progress";
import {
  buildExecutionPlan,
  executionStorageKey,
  type AzureExecutionImport,
} from "./execution/azure-devops-csv";
import { runWithConcurrency } from "./concurrency";
import {
  browserProgressStorage,
  readCachedProgress,
  writeCachedProgress,
} from "./home-progress-cache";
import { fetchExecutionStatuses } from "./execution/execution-tracking";
import { useAutoDismissedProp } from "../use-auto-dismiss";
import { NOTIFICATIONS_CHANGED_EVENT } from "../notification-events";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const EMPTY_METRICS: ProjectMetrics = {
  total: 0,
  draft: 0,
  inProgress: 0,
  validation: 0,
  approved: 0,
  completed: 0,
  archived: 0,
  active: 0,
  paused: 0,
  deleted: 0,
};

const DOCUMENT_FLOW_BASE = [
  {
    number: "1",
    icon: "create",
    title: "Crear proyecto y encabezado",
    description: "Crear el proyecto y definir la información principal.",
  },
  {
    number: "2",
    icon: "discussion",
    title: "Discusión",
    description: "Responder el cuestionario y consolidar la conversación.",
  },
  {
    number: "3",
    icon: "sources",
    title: "Cargar datos y fuentes",
    description: "Registrar notas, conversaciones, transcripciones y archivos.",
  },
  {
    number: "4",
    icon: "document",
    title: "Generar documento",
    description: "Crear y versionar el documento de requerimientos.",
  },
  {
    number: "5",
    icon: "validation",
    title: "Validación, corrección y aprobación",
    description: "Revisar, corregir y aprobar el contenido generado.",
  },
  {
    number: "6",
    icon: "execution",
    title: "Ejecución",
    description: "Ejecutar el requerimiento desde el contenido aprobado.",
  },
] as const;

type FlowState = "current" | "completed" | "pending" | "locked";

interface ProjectProgress {
  stageIndex: number;
  stageLabel: string;
  badgeLabel: string;
  badgeTone: "success" | "process" | "pending" | "inactive" | "neutral";
  continueHref: string;
  stageProgress: number;
  stagePercentages: readonly number[];
  gaps?: readonly string[];
  stats?: ProjectStats;
}

interface ProjectStats {
  firstSourceAt: string | null;
  /** Fecha de la fuente que consolidó la discusión: marca el fin de «Discusión». */
  discussionSourceAt: string | null;
  documentCreatedAt: string | null;
  /** Última actualización del documento una vez salió de borrador (aproxima el inicio de la validación). */
  validationStartedAt: string | null;
}

const DAY_MS = 86_400_000;
/** Los proyectos deben quedar estructurados en máximo 15 días. */
export const PROJECT_DAY_LIMIT = 15;
/** Escala base del gráfico de días. */
export const PROJECT_DAY_SCALE = 30;
/** Pasos de la escala en días. */
export const PROJECT_DAY_STEP = 5;

/** Etapas de estructuración: la ejecución ocurre después y no cuenta en el límite. */
export const STRUCTURING_STAGES = [
  { key: "creation", label: "Creación" },
  { key: "discussion", label: "Discusión" },
  { key: "sources", label: "Fuentes" },
  { key: "document", label: "Documento" },
  { key: "validation", label: "Validación" },
] as const;

export interface ProjectStageDay {
  key: (typeof STRUCTURING_STAGES)[number]["key"];
  label: string;
  days: number;
  /** La etapa ya se alcanzó (es la actual o una anterior). */
  reached: boolean;
  current: boolean;
}

/**
 * Días que tardó cada etapa de estructuración, con las fechas ya registradas: creación del
 * proyecto, fuente de la discusión (o primera fuente), creación del documento y última
 * actualización del documento fuera de borrador. Solo cuenta hasta la etapa actual; las etapas
 * siguientes quedan sin alcanzar. Los días suman exactamente los transcurridos desde la creación.
 */
export function projectStageDays(
  createdAt: string,
  stats: ProjectStats | undefined,
  stageIndex: number,
  now: number,
): { totalDays: number; stages: readonly ProjectStageDay[] } {
  const currentIndex = Math.min(
    Math.max(stageIndex, 0),
    STRUCTURING_STAGES.length - 1,
  );
  const empty = STRUCTURING_STAGES.map((stage, index) => ({
    ...stage,
    days: 0,
    reached: index === 0,
    current: index === 0,
  }));
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start) || now < start) {
    return { totalDays: 0, stages: empty };
  }

  const milestone = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed)
      ? Math.min(now, Math.max(start, parsed))
      : null;
  };
  const milestones: readonly (number | null)[] = [
    start,
    start,
    milestone(stats?.discussionSourceAt) ?? milestone(stats?.firstSourceAt),
    milestone(stats?.documentCreatedAt),
    milestone(stats?.validationStartedAt),
  ];
  const starts: number[] = [];
  milestones.forEach((value, index) => {
    starts.push(
      index === 0 ? start : Math.max(starts[index - 1] ?? start, value ?? start),
    );
  });

  const totalDays = Math.floor((now - start) / DAY_MS);
  let assigned = 0;
  const stages = STRUCTURING_STAGES.map((stage, index) => {
    if (index > currentIndex) {
      return { ...stage, days: 0, reached: false, current: false };
    }
    const end = index === currentIndex ? now : (starts[index + 1] ?? now);
    const days =
      index === currentIndex
        ? Math.max(0, totalDays - assigned)
        : Math.min(
            Math.max(0, totalDays - assigned),
            Math.round(((end as number) - (starts[index] as number)) / DAY_MS),
          );
    assigned += days;
    return { ...stage, days, reached: true, current: index === currentIndex };
  });

  return { totalDays, stages };
}

function formatDays(days: number): string {
  return days === 1 ? "1 día" : `${days} días`;
}

interface HomeWorkspaceProps {
  initialList?: ProjectListResponse;
  initialMetrics?: ProjectMetrics;
  initialError?: string | null;
}

type ProjectListSort =
  | "DATE_DESC"
  | "DATE_ASC"
  | "PROGRESS_DESC"
  | "PROGRESS_ASC"
  | "TITLE_ASC"
  | "TITLE_DESC";

/** Iconos lineales de Inicio (indicadores y etapas del levantamiento). */
type HomeIconName =
  | "projects"
  | "drafts"
  | "progress"
  | "create"
  | "discussion"
  | "sources"
  | "document"
  | "validation"
  | "execution";

function HomeIcon({ name }: { name: HomeIconName }) {
  const paths: Record<HomeIconName, ReactNode> = {
    projects: (
      <>
        <path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h4" />
      </>
    ),
    drafts: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 13h6M9 16h4" />
      </>
    ),
    progress: <path d="M5 20V12M12 20V5M19 20v-9M3 20h18" />,
    create: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M12 11v6M9 14h6" />
      </>
    ),
    discussion: (
      <>
        <path d="M4 5.5h12a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H10l-4.5 3v-3H4a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3Z" />
        <path d="M7 9.5h7M7 12.5h5" />
      </>
    ),
    sources: (
      <>
        <ellipse cx="12" cy="5" rx="7.5" ry="3" />
        <path d="M4.5 5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5" />
        <path d="M4.5 11v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" />
      </>
    ),
    document: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 12h6M9 15h6M9 18h4" />
      </>
    ),
    validation: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m8 12.5 2.5 2.5 5.5-6" />
      </>
    ),
    execution: <path d="M7 4.5v15l12-7.5-12-7.5Z" />,
  };
  return (
    <svg
      aria-hidden="true"
      className={`rq-home-icon rq-home-icon--${name}`}
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="18"
    >
      {paths[name]}
    </svg>
  );
}

const PROJECT_STAGE_WEIGHTS = [10, 15, 10, 20, 15, 30] as const;
const NOTIFICATION_DATE_FORMAT = new Intl.DateTimeFormat("es-CO", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function projectOverallProgress(progress: ProjectProgress): number {
  return Math.round(
    progress.stagePercentages.reduce(
      (total, percentage, index) =>
        total +
        (Math.max(0, Math.min(100, percentage)) *
          (PROJECT_STAGE_WEIGHTS[index] ?? 0)) /
          100,
      0,
    ),
  );
}

function statusLabel(status: ProjectStatus): string {
  if (status === "DISCUSSION") return "Discusión";
  if (status === "SOURCES") return "Fuentes";
  if (status === "DOCUMENT_GENERATED") return "Documento generado";
  if (status === "VALIDATION") return "En validación";
  if (status === "APPROVED") return "Validación aprobada";
  if (status === "EXECUTION") return "En ejecución";
  if (status === "COMPLETED") return "Completado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function statusTone(
  status: ProjectStatus,
): "success" | "process" | "pending" | "inactive" | "neutral" {
  if (status === "APPROVED" || status === "COMPLETED") return "success";
  if (
    ["DISCUSSION", "SOURCES", "DOCUMENT_GENERATED", "EXECUTION"].includes(
      status,
    )
  )
    return "process";
  if (status === "VALIDATION") return "pending";
  if (status === "ARCHIVED") return "inactive";
  return "neutral";
}

function projectStageLabel(status: ProjectStatus): string {
  if (status === "DISCUSSION") return "Discusión";
  if (status === "SOURCES") return "Cargar datos y fuentes";
  if (status === "DOCUMENT_GENERATED") return "Generar documento";
  if (status === "VALIDATION") return "Validación, corrección y aprobación";
  if (status === "APPROVED") return "Validación aprobada";
  if (status === "EXECUTION") return "Ejecución";
  if (status === "COMPLETED") return "Ejecución";
  if (status === "ARCHIVED") return "Archivado";
  return "Discusión";
}

function fallbackProgress(project: ProjectSummary): ProjectProgress {
  const projectId = encodeURIComponent(project.id);
  const creationProgress = calculateCreationStageProgress(project.description);
  if (
    ["APPROVED", "EXECUTION", "COMPLETED", "ARCHIVED"].includes(project.status)
  ) {
    return {
      stageIndex: 5,
      stageLabel: projectStageLabel(project.status),
      badgeLabel: statusLabel(project.status),
      badgeTone: statusTone(project.status),
      continueHref: `/workspace/execution?projectId=${projectId}`,
      stageProgress: 0,
      // Mientras se calcula el avance real, ejecución no cuenta como completada.
      stagePercentages: [
        creationProgress,
        0,
        0,
        0,
        project.status === "VALIDATION" ? 0 : 100,
        0,
      ],
    };
  }
  if (project.status === "VALIDATION") {
    return {
      stageIndex: 4,
      stageLabel: projectStageLabel(project.status),
      badgeLabel: statusLabel(project.status),
      badgeTone: statusTone(project.status),
      continueHref: `/workspace/validation?projectId=${projectId}`,
      stageProgress: 65,
      stagePercentages: [creationProgress, 100, 100, 100, 65, 0],
    };
  }
  if (
    ["DISCUSSION", "SOURCES", "DOCUMENT_GENERATED"].includes(project.status)
  ) {
    return {
      stageIndex:
        project.status === "DISCUSSION"
          ? 1
          : project.status === "SOURCES"
            ? 2
            : 3,
      stageLabel: projectStageLabel(project.status),
      badgeLabel: statusLabel(project.status),
      badgeTone: statusTone(project.status),
      continueHref: `/workspace/sources?projectId=${projectId}`,
      stageProgress: 25,
      stagePercentages: [creationProgress, 0, 0, 0, 0, 0],
    };
  }
  return {
    stageIndex: 0,
    stageLabel: "Crear proyecto y encabezado",
    badgeLabel: `${creationProgress}% creado`,
    badgeTone: statusTone(project.status),
    continueHref: `/workspace/projects/${projectId}/discussion`,
    stageProgress: creationProgress,
    stagePercentages: [creationProgress, 0, 0, 0, 0, 0],
  };
}

function computeProjectProgress(
  project: ProjectSummary,
  sources: SourceListResponse,
  document: RequirementDocumentDetail | null,
  executionStatuses?: readonly ExecutionTaskStatusDetail[],
): ProjectProgress {
  const lifecycleStatus =
    document?.status === "DRAFT" && project.status !== "ARCHIVED"
      ? "DOCUMENT_GENERATED"
      : project.status;
  const projectId = encodeURIComponent(project.id);
  let storedDiscussion: string | null = null;
  try {
    storedDiscussion = window.localStorage.getItem(
      `rq-requirement-discussion-v1:${project.id}`,
    );
  } catch {
    // El avance remoto continúa disponible si el navegador bloquea localStorage.
  }
  const discussion = parseDiscussionStageSnapshot(storedDiscussion);
  const creationPercentage = calculateCreationStageProgress(
    project.description,
  );
  const discussionPercentage = discussion.percentage;
  const sourcesPercentage = calculateSourceStageProgress(
    sources.items,
    discussion.sourceId,
  );
  const completedDocument = calculateDocumentStageProgress(document);
  const validationPercentage = calculateValidationStageProgress(
    document?.status ?? null,
    lifecycleStatus,
  );
  // El estado de cada tarea viene del servidor; solo si aún no hay se usa la importación de Azure
  // que quedó guardada en este navegador (versión anterior).
  let executionImport: AzureExecutionImport | null = null;
  if (!executionStatuses) {
    try {
      const stored = window.localStorage.getItem(executionStorageKey(project.id));
      executionImport = stored
        ? (JSON.parse(stored) as AzureExecutionImport)
        : null;
    } catch {
      // Sin importación local válida, ejecución permanece en cero.
    }
  }
  const plan = document ? buildExecutionPlan(document) : null;
  const execution = calculateAzureExecutionProgress(
    plan?.tasks.map((task) => task.code) ?? [],
    executionStatuses
      ? executionStatuses.map((item) => ({
          code: item.taskCode,
          completed: item.state === "DONE",
          active: item.state === "IN_PROGRESS",
        }))
      : (executionImport?.items
          .filter((item) => item.type.trim().toUpperCase() === "TASK")
          .map((item) => ({
            code: item.code,
            completed: item.completed,
            active: !item.completed,
          })) ?? []),
  );
  // Cada etapa muestra su avance real. Ejecución solo se completa con el 100 % de las tareas,
  // sin importar el estado guardado del proyecto.
  const stagePercentages = [
    creationPercentage,
    discussionPercentage,
    sourcesPercentage,
    validationPercentage >= 100 ? 100 : completedDocument,
    validationPercentage,
    document?.status === "DRAFT" ? 0 : execution.percentage,
  ];
  const documentHref = document
    ? `/workspace/documents/${encodeURIComponent(document.id)}`
    : null;

  if (
    ["APPROVED", "EXECUTION", "COMPLETED", "ARCHIVED"].includes(
      lifecycleStatus,
    ) ||
    (document?.status !== "DRAFT" && execution.percentage > 0) ||
    document?.status === "APPROVED" ||
    document?.status === "ARCHIVED"
  ) {
    return {
      stageIndex: 5,
      stageLabel:
        lifecycleStatus === "ARCHIVED"
          ? "Archivado"
          : execution.percentage === 100
            ? "Ejecución finalizada"
            : lifecycleStatus === "APPROVED" && execution.percentage === 0
              ? "Validación aprobada"
              : "Ejecución",
      badgeLabel:
        execution.matchedTasks > 0
          ? `${execution.completedMatchedTasks}/${execution.planTasks} tareas`
          : "Sin tareas registradas",
      badgeTone: execution.percentage === 100 ? "success" : "process",
      continueHref: `/workspace/execution?projectId=${projectId}`,
      stageProgress: execution.percentage,
      stagePercentages,
      gaps: [...discussion.gaps, ...execution.gaps],
    };
  }

  if (validationPercentage > 0 || completedDocument >= 100) {
    const correctionRequested =
      document?.status === "CHANGES_REQUESTED" ||
      document?.status === "REJECTED";
    return {
      stageIndex: 4,
      stageLabel: "Validación, corrección y aprobación",
      badgeLabel:
        document?.status === "IN_REVIEW"
          ? "40% revisado"
          : correctionRequested
            ? "75% en corrección"
            : "Pendiente de revisión",
      badgeTone: correctionRequested ? "pending" : "process",
      continueHref:
        document?.status === "DRAFT" && documentHref
          ? documentHref
          : `/workspace/validation?projectId=${projectId}`,
      stageProgress: validationPercentage,
      stagePercentages,
      gaps: discussion.gaps,
    };
  }

  if (document || sourcesPercentage >= 100) {
    return {
      stageIndex: 3,
      stageLabel: "Generar documento",
      badgeLabel: document
        ? `${completedDocument}% completo`
        : "Listo para generar",
      badgeTone: "process",
      continueHref: documentHref ?? `/workspace/sources?projectId=${projectId}`,
      stageProgress: completedDocument,
      stagePercentages,
      gaps: discussion.gaps,
    };
  }

  if (sourcesPercentage > 0 || discussionPercentage >= 100) {
    return {
      stageIndex: 2,
      stageLabel: "Cargar datos y fuentes",
      badgeLabel: `${sourcesPercentage}% cargado`,
      badgeTone: sourcesPercentage > 0 ? "process" : "pending",
      continueHref: `/workspace/sources?projectId=${projectId}`,
      stageProgress: sourcesPercentage,
      stagePercentages,
      gaps: discussion.gaps,
    };
  }

  if (discussionPercentage === 0 && lifecycleStatus === "DRAFT") {
    return {
      stageIndex: 0,
      stageLabel: "Crear proyecto y encabezado",
      badgeLabel: `${creationPercentage}% creado`,
      badgeTone: creationPercentage === 100 ? "success" : "pending",
      continueHref: `/workspace/projects/${projectId}/discussion`,
      stageProgress: creationPercentage,
      stagePercentages,
      gaps: project.description?.trim()
        ? []
        : ["Creación: falta agregar la descripción"],
    };
  }

  return {
    stageIndex: 1,
    stageLabel: "Discusión",
    badgeLabel:
      discussionPercentage > 0
        ? `${discussionPercentage}% respondido`
        : "Pendiente",
    badgeTone: discussionPercentage > 0 ? "process" : "pending",
    continueHref: `/workspace/projects/${projectId}/discussion`,
    stageProgress: discussionPercentage,
    stagePercentages,
    gaps: discussion.gaps,
  };
}

export function projectProgress(
  project: ProjectSummary,
  sources: SourceListResponse,
  document: RequirementDocumentDetail | null,
  executionStatuses?: readonly ExecutionTaskStatusDetail[],
): ProjectProgress {
  let discussionSourceId: string | null = null;
  try {
    discussionSourceId = parseDiscussionStageSnapshot(
      window.localStorage.getItem(`rq-requirement-discussion-v1:${project.id}`),
    ).sourceId;
  } catch {
    // Sin almacenamiento local, «Discusión» termina con la primera fuente.
  }

  return {
    ...computeProjectProgress(project, sources, document, executionStatuses),
    stats: {
      firstSourceAt:
        sources.items
          .map((source) => source.createdAt)
          .filter(Boolean)
          .sort()[0] ?? null,
      discussionSourceAt:
        sources.items.find((source) => source.id === discussionSourceId)
          ?.createdAt ?? null,
      documentCreatedAt: document?.createdAt ?? null,
      validationStartedAt:
        document && document.status !== "DRAFT" ? document.updatedAt : null,
    },
  };
}

async function loadProjectProgress(
  project: ProjectSummary,
): Promise<ProjectProgress> {
  const projectId = encodeURIComponent(project.id);
  // Los estados de ejecución no dependen del documento: se piden a la vez, no después.
  const statusesRequest = fetchExecutionStatuses(project.id)
    .then((items) => (items.length > 0 ? items : undefined))
    .catch(() => undefined);
  const [sourcesResponse, documentsResponse] = await Promise.all([
    fetch(
      `${GATEWAY_URL}/api/v1/projects/${projectId}/sources?page=1&pageSize=50&status=ACTIVE`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
      },
    ),
    fetch(`${GATEWAY_URL}/api/v1/projects/${projectId}/documents`, {
      credentials: "include",
      headers: { accept: "application/json" },
    }),
  ]);

  if (sourcesResponse.status === 401 || documentsResponse.status === 401) {
    window.location.assign("/sign-in");
    throw new Error("Sesión vencida.");
  }
  if (!sourcesResponse.ok || !documentsResponse.ok) {
    throw new Error("No fue posible consultar el avance del proyecto.");
  }

  const sources = (await sourcesResponse.json()) as SourceListResponse;
  const documents =
    (await documentsResponse.json()) as RequirementDocumentListResponse;
  const documentSummary = documents.items[0];
  let document: RequirementDocumentDetail | null = null;
  if (documentSummary) {
    const documentResponse = await fetch(
      `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentSummary.id)}`,
      {
        credentials: "include",
        headers: { accept: "application/json" },
      },
    );
    if (documentResponse.status === 401) {
      window.location.assign("/sign-in");
      throw new Error("Sesión vencida.");
    }
    if (!documentResponse.ok) {
      throw new Error("No fue posible calcular el avance del documento.");
    }
    document = (await documentResponse.json()) as RequirementDocumentDetail;
  }

  const executionStatuses = await statusesRequest;

  return projectProgress(project, sources, document, executionStatuses);
}

export function HomeWorkspace({
  initialList,
  initialMetrics,
  initialError,
}: HomeWorkspaceProps) {
  const metrics: ProjectMetrics = {
    ...EMPTY_METRICS,
    ...initialMetrics,
    completed: initialMetrics?.completed ?? 0,
  };
  const recentProjects = initialList?.items ?? [];
  const activeProjects = metrics.inProgress ?? 0;
  const hasProject = recentProjects.length > 0;
  const [selectedProjectId, setSelectedProjectId] = useState(
    recentProjects[0]?.id ?? "",
  );
  const visibleInitialError = useAutoDismissedProp(initialError);
  const selectedProject =
    recentProjects.find((project) => project.id === selectedProjectId) ??
    recentProjects[0];
  const [progress, setProgress] = useState<ProjectProgress | null>(
    selectedProject ? fallbackProgress(selectedProject) : null,
  );
  const [progressLoading, setProgressLoading] = useState(false);
  const [projectProgressById, setProjectProgressById] = useState<
    Record<string, ProjectProgress>
  >({});
  const [projectListExpanded, setProjectListExpanded] = useState(true);
  const [projectListSearchOpen, setProjectListSearchOpen] = useState(false);
  const [projectListSearch, setProjectListSearch] = useState("");
  // La hora actual solo existe en el navegador: evita diferencias de hidratación con el servidor.
  const [dayNow, setDayNow] = useState<number | null>(null);
  const [notifications, setNotifications] = useState<{
    items: readonly NotificationDetail[];
    unread: number;
  } | null>(null);

  useEffect(() => {
    setDayNow(Date.now());
  }, []);

  useEffect(() => {
    let active = true;
    async function loadNotifications() {
      try {
        const response = await fetch(
          `${GATEWAY_URL}/api/v1/notifications?state=ALL&page=1&pageSize=4`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok || !active) return;
        const payload = (await response.json()) as NotificationListResponse;
        setNotifications({ items: payload.items, unread: payload.unreadItems });
      } catch {
        // Inicio sigue disponible aunque Operations no responda.
      }
    }
    const refresh = () => void loadNotifications();
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, []);

  const [projectListSort, setProjectListSort] =
    useState<ProjectListSort>("DATE_DESC");

  useEffect(() => {
    if (!selectedProject) {
      setProgress(null);
      return;
    }

    let active = true;
    setProgress(fallbackProgress(selectedProject));
    setProgressLoading(true);
    void loadProjectProgress(selectedProject)
      .then((nextProgress) => {
        if (active) setProgress(nextProgress);
      })
      .catch(() => {
        // El estado persistido del proyecto queda como respaldo visible.
      })
      .finally(() => {
        if (active) setProgressLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedProject]);

  useEffect(() => {
    const projects = initialList?.items ?? [];
    if (projects.length === 0) {
      setProjectProgressById({});
      return;
    }

    let active = true;
    const storage = browserProgressStorage();
    // Primero lo último que se sabe (si es reciente y el proyecto no cambió de estado); luego se
    // recalcula todo y cada fila se actualiza cuando su avance real está listo.
    const cached: Record<string, ProjectProgress> = {};
    for (const project of projects) {
      const hit = readCachedProgress<ProjectProgress>(storage, project);
      if (hit) cached[project.id] = hit;
    }
    setProjectProgressById(cached);
    // Máximo 4 proyectos a la vez, para no lanzar decenas de solicitudes de golpe.
    void runWithConcurrency(
      projects,
      4,
      async (project) => {
        let entry: ProjectProgress;
        try {
          entry = await loadProjectProgress(project);
          writeCachedProgress(storage, project, entry);
        } catch {
          // Un fallo no se guarda: se mantiene lo que había (caché o avance provisional).
          if (active && !cached[project.id]) {
            setProjectProgressById((current) => ({
              ...current,
              [project.id]: fallbackProgress(project),
            }));
          }
          return;
        }
        if (active) {
          setProjectProgressById((current) => ({
            ...current,
            [project.id]: entry,
          }));
        }
      },
      () => !active,
    );

    return () => {
      active = false;
    };
  }, [initialList?.items]);

  const projectListItems = useMemo(() => {
    const query = projectListSearch.trim().toLocaleLowerCase("es");

    const entries = recentProjects
      .filter((project) => {
        if (!query) return true;

        return [project.title, project.code, project.requestingArea]
          .filter(Boolean)
          .some((value) => value.toLocaleLowerCase("es").includes(query));
      })
      .map((project) => {
        const isSelected = project.id === selectedProject?.id;
        const visibleProgress =
          projectProgressById[project.id] ??
          (isSelected ? progress : null) ??
          fallbackProgress(project);

        return {
          project,
          visibleProgress,
          overallProgress: projectOverallProgress(visibleProgress),
        };
      });

    entries.sort((left, right) => {
      const titleOrder = left.project.title.localeCompare(
        right.project.title,
        "es",
        { sensitivity: "base" },
      );
      const stableTitleOrder =
        titleOrder !== 0
          ? titleOrder
          : left.project.code.localeCompare(right.project.code, "es");

      if (projectListSort === "TITLE_ASC") return stableTitleOrder;
      if (projectListSort === "TITLE_DESC") return -stableTitleOrder;

      if (projectListSort === "PROGRESS_ASC") {
        return left.overallProgress - right.overallProgress || stableTitleOrder;
      }

      if (projectListSort === "PROGRESS_DESC") {
        return right.overallProgress - left.overallProgress || stableTitleOrder;
      }

      const leftDate = Date.parse(left.project.createdAt) || 0;
      const rightDate = Date.parse(right.project.createdAt) || 0;

      if (projectListSort === "DATE_ASC") {
        return leftDate - rightDate || stableTitleOrder;
      }

      return rightDate - leftDate || stableTitleOrder;
    });

    return entries;
  }, [
    progress,
    projectListSearch,
    projectListSort,
    projectProgressById,
    recentProjects,
    selectedProject?.id,
  ]);

  const currentStageIndex = progress?.stageIndex ?? 0;
  const stagePercentages = hasProject
    ? (progress?.stagePercentages ?? [100, 0, 0, 0, 0, 0])
    : [0, 0, 0, 0, 0, 0];
  const currentStageLabel = selectedProject
    ? `${selectedProject.code}: ${progressLoading ? "consultando etapa…" : (progress?.stageLabel ?? "Etapa no disponible")}`
    : "Etapa actual: crear proyecto y encabezado";
  const documentFlow = DOCUMENT_FLOW_BASE.map((step, index) => {
    const percentage = stagePercentages[index] ?? 0;
    const state: FlowState = !hasProject
      ? index === 0
        ? "current"
        : "locked"
      : index === currentStageIndex
        ? "current"
        : percentage >= 100
          ? "completed"
          : "pending";

    return { ...step, state, percentage };
  });

  const daySummary =
    selectedProject && dayNow !== null
      ? projectStageDays(
          selectedProject.createdAt,
          progress?.stats,
          progress?.stageIndex ?? 0,
          dayNow,
        )
      : {
          totalDays: 0,
          stages: STRUCTURING_STAGES.map((stage) => ({
            ...stage,
            days: 0,
            reached: false,
            current: false,
          })) as readonly ProjectStageDay[],
        };
  // Escala fija de 30 días en pasos de 5; crece solo si el proyecto la supera.
  const dayMax = Math.max(
    PROJECT_DAY_SCALE,
    Math.ceil(daySummary.totalDays / PROJECT_DAY_STEP) * PROJECT_DAY_STEP,
  );
  const dayTicks = Array.from(
    { length: dayMax / PROJECT_DAY_STEP + 1 },
    (_, index) => index * PROJECT_DAY_STEP,
  );
  const limitTop = 100 - (PROJECT_DAY_LIMIT / dayMax) * 100;
  let dayCumulative = 0;
  const dayBars = daySummary.stages.map((stage, index) => {
    if (stage.reached) dayCumulative += stage.days;
    return {
      ...stage,
      cumulative: dayCumulative,
      left: ((index + 0.5) / daySummary.stages.length) * 100,
      top: 100 - (dayCumulative / dayMax) * 100,
    };
  });
  const reachedBars = dayBars.filter((bar) => bar.reached);

  // Destino de cada etapa: el círculo numerado actúa como botón de continuar.
  function stageHref(index: number): string | null {
    if (!selectedProject) return index === 0 ? "/workspace/projects" : null;
    const id = encodeURIComponent(selectedProject.id);
    switch (index) {
      case 0:
        return "/workspace/projects";
      case 1:
        return `/workspace/projects/${id}/discussion`;
      case 2:
        return `/workspace/sources?projectId=${id}`;
      case 3:
        return currentStageIndex === 3 && progress?.continueHref
          ? progress.continueHref
          : `/workspace/documents?projectId=${id}`;
      case 4:
        return `/workspace/validation?projectId=${id}`;
      default:
        return `/workspace/execution?projectId=${id}`;
    }
  }

  return (
    <section className="rq-home-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen general">
          <RqKpiCard
            description="Registrados y accesibles"
            icon={<HomeIcon name="projects" />}
            title="Proyectos"
            value={String(metrics.total ?? 0)}
          />
          <RqKpiCard
            description="Pendientes de elaboración"
            icon={<HomeIcon name="drafts" />}
            title="Borradores"
            value={String(metrics.draft ?? 0)}
          />
          <RqKpiCard
            description="En curso / completados"
            icon={<HomeIcon name="progress" />}
            title="Avance"
            value={`${activeProjects} / ${metrics.completed ?? 0}`}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions">
          <Link
            className="rq-action"
            data-rq-tone="affirmative"
            href="/workspace/projects"
          >
            Gestionar proyectos
          </Link>
        </div>
      </section>

      <div className="rq-home-layout">
        <div className="rq-home-primary-column">
          <section
            className="rq-home-flow"
            aria-labelledby="rq-home-flow-title"
          >
            <header className="rq-home-section-header">
              <div>
                <span>Proceso documental</span>
                <h2 id="rq-home-flow-title">Etapas del levantamiento</h2>
                <p>
                  El documento avanza por etapas controladas y conserva cada
                  borrador antes de la aprobación.
                </p>
              </div>
              <strong className="rq-home-current-stage">
                {currentStageLabel}
              </strong>
            </header>

            <ol className="rq-home-flow-list">
              {documentFlow.map((step, index) => (
                <li data-state={step.state} key={step.number}>
                  {index <= currentStageIndex && stageHref(index) ? (
                    <Link
                      aria-label={`Ir a ${step.title}`}
                      className="rq-home-flow-number rq-home-flow-number--link"
                      href={stageHref(index) as string}
                      title={`Ir a ${step.title}`}
                    >
                      {step.number}
                    </Link>
                  ) : (
                    <span className="rq-home-flow-number">{step.number}</span>
                  )}
                  <HomeIcon name={step.icon} />
                  <span className="rq-home-flow-copy">
                    <strong>{step.title}</strong>
                    <span>{step.description}</span>
                  </span>
                  {step.state === "pending" && step.percentage > 0 ? (
                    <span className="rq-home-flow-progress">
                      <small>{step.percentage}% registrado</small>
                    </span>
                  ) : (
                    <span
                      className="rq-home-flow-state"
                      data-state={step.state}
                    >
                      {step.state === "current"
                        ? "En desarrollo"
                        : step.state === "completed"
                          ? "Completada"
                          : step.state === "locked"
                            ? "Bloqueado"
                            : "Pendiente"}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <div className="rq-home-insights">
          <section
            aria-labelledby="rq-home-stage-chart-title"
            className="rq-home-stage-chart"
          >
            <header className="rq-home-section-header">
              <div>
                <span>Proyecto seleccionado</span>
                <h2 id="rq-home-stage-chart-title">Avance por etapa</h2>
              </div>
              {selectedProject ? (
                <strong className="rq-home-stage-chart__project">
                  {selectedProject.code} · {selectedProject.title}
                </strong>
              ) : null}
            </header>

            {selectedProject ? (
              <div className="rq-home-stage-chart__viewport">
                <div
                  aria-label={`Avance de ${selectedProject.code}. ${documentFlow
                    .map((step) => `${step.title}: ${step.percentage}%`)
                    .join(". ")}`}
                  className="rq-home-stage-chart__plot"
                  role="img"
                >
                  <div
                    className="rq-home-stage-chart__scale"
                    aria-hidden="true"
                  >
                    <span>100%</span>
                    <span>75%</span>
                    <span>50%</span>
                    <span>25%</span>
                    <span>0%</span>
                  </div>
                  <div className="rq-home-stage-chart__bars">
                    {documentFlow.map((step) => (
                      <article data-state={step.state} key={step.number}>
                        <output>{step.percentage}%</output>
                        <div className="rq-home-stage-chart__track">
                          <span
                            style={
                              {
                                "--rq-stage-progress": `${step.percentage}%`,
                              } as CSSProperties
                            }
                          />
                        </div>
                        <footer>
                          <span>{step.number}</span>
                          <strong>{step.title}</strong>
                        </footer>
                      </article>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rq-home-project-state__empty">
                <strong>Todavía no hay proyectos</strong>
                <span>Crea el primer proyecto para iniciar el flujo.</span>
              </div>
            )}
          </section>

          <div className="rq-home-side-cards">
          <section
            aria-labelledby="rq-home-stats-flow-title"
            className="rq-home-stats-flow"
          >
            <header className="rq-home-section-header">
              <div>
                <span>Estadística del proyecto</span>
                <h2 id="rq-home-stats-flow-title">Proceso por días</h2>
              </div>
            </header>

            {selectedProject ? (
              <div
                aria-label={`${formatDays(daySummary.totalDays)} de ${PROJECT_DAY_LIMIT} permitidos. ${dayBars
                  .map((bar) => `${bar.label}: ${formatDays(bar.days)}`)
                  .join(". ")}`}
                className="rq-home-days-chart"
                data-ready={dayNow !== null}
                role="img"
              >
                <div aria-hidden="true" className="rq-home-days-chart__axis">
                  {[...dayTicks].reverse().map((tick) => (
                    <span key={tick}>{tick}</span>
                  ))}
                </div>

                <div className="rq-home-days-chart__plot">
                  <div aria-hidden="true" className="rq-home-days-chart__grid">
                    {dayTicks.map((tick) => (
                      <i
                        key={tick}
                        style={{ bottom: `${(tick / dayMax) * 100}%` }}
                      />
                    ))}
                  </div>

                  <div className="rq-home-days-chart__bars">
                    {dayBars.map((bar) => (
                      <div
                        data-state={
                          bar.current
                            ? "current"
                            : bar.reached
                              ? "done"
                              : "pending"
                        }
                        key={bar.key}
                        style={{ height: `${(bar.days / dayMax) * 100}%` }}
                      />
                    ))}
                  </div>

                  <svg
                    aria-hidden="true"
                    className="rq-home-days-chart__line"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 100"
                  >
                    <line
                      className="rq-home-days-chart__limit"
                      x1="0"
                      x2="100"
                      y1={limitTop}
                      y2={limitTop}
                    />
                    {reachedBars.length > 1 ? (
                      <polyline
                        points={reachedBars
                          .map((bar) => `${bar.left},${bar.top}`)
                          .join(" ")}
                      />
                    ) : null}
                  </svg>

                  {reachedBars.map((bar) => (
                    <span
                      aria-hidden="true"
                      className="rq-home-days-chart__dot"
                      key={bar.key}
                      style={{ left: `${bar.left}%`, top: `${bar.top}%` }}
                    >
                      {bar.cumulative} d
                    </span>
                  ))}
                  <small
                    aria-hidden="true"
                    className="rq-home-days-chart__limit-label"
                    style={{ top: `${limitTop}%` }}
                  >
                    Límite {PROJECT_DAY_LIMIT} días
                  </small>
                </div>

                <div aria-hidden="true" className="rq-home-days-chart__labels">
                  {dayBars.map((bar) => (
                    <span
                      data-state={
                        bar.current ? "current" : bar.reached ? "done" : "pending"
                      }
                      key={bar.key}
                    >
                      <strong>{bar.label}</strong>
                      <small>{bar.reached ? `${bar.days} d` : "—"}</small>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rq-home-project-state__empty">
                <strong>Sin proyecto seleccionado</strong>
              </div>
            )}
          </section>

          <section
            aria-labelledby="rq-home-notifications-title"
            className="rq-home-notifications"
          >
            <header className="rq-home-section-header">
              <div>
                <span>Operación</span>
                <h2 id="rq-home-notifications-title">Últimas notificaciones</h2>
              </div>
              {notifications && notifications.unread > 0 ? (
                <strong className="rq-home-notifications__unread">
                  {notifications.unread} sin leer
                </strong>
              ) : null}
            </header>

            {notifications && notifications.items.length > 0 ? (
              <ul className="rq-home-notifications__list">
                {notifications.items.map((item) => (
                  <li data-unread={item.status !== "READ"} key={item.id}>
                    <Link href="/workspace/notifications">
                      <span
                        aria-hidden="true"
                        className="rq-home-notifications__dot"
                      />
                      <strong>{item.subject}</strong>
                      <time dateTime={item.createdAt}>
                        {NOTIFICATION_DATE_FORMAT.format(
                          new Date(item.createdAt),
                        )}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rq-home-project-state__empty">
                <strong>
                  {notifications ? "Sin notificaciones" : "Cargando…"}
                </strong>
              </div>
            )}
          </section>
          </div>
          </div>
        </div>

        <aside
          className="rq-home-project-state"
          data-expanded={projectListExpanded}
          aria-labelledby="rq-home-project-state-title"
        >
          <header className="rq-home-project-list__header">
            <h2 id="rq-home-project-state-title">Listado de proyecto</h2>
            <button
              aria-controls="rq-home-project-list-controls rq-home-project-list-content"
              aria-expanded={projectListExpanded}
              className="rq-home-project-list__collapse"
              onClick={() => setProjectListExpanded((current) => !current)}
              type="button"
            >
              {projectListExpanded ? "Ocultar" : "Mostrar"}
              <span aria-hidden="true">{projectListExpanded ? "⌃" : "⌄"}</span>
            </button>

            <div
              className="rq-home-project-list__controls"
              id="rq-home-project-list-controls"
            >
              <button
                aria-label={
                  projectListSearchOpen
                    ? "Ocultar filtro de proyectos"
                    : "Filtrar proyectos"
                }
                aria-pressed={projectListSearchOpen}
                className="rq-home-project-list__search-toggle"
                onClick={() => setProjectListSearchOpen((current) => !current)}
                title="Filtrar proyectos"
                type="button"
              >
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
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
              </button>

              <select
                aria-label="Ordenar proyectos"
                className="rq-home-project-list__sort"
                onChange={(event) =>
                  setProjectListSort(event.target.value as ProjectListSort)
                }
                title="Ordenar proyectos"
                value={projectListSort}
              >
                <option value="DATE_DESC">Fecha: más recientes</option>
                <option value="DATE_ASC">Fecha: más antiguos</option>
                <option value="PROGRESS_DESC">Avance: mayor a menor</option>
                <option value="PROGRESS_ASC">Avance: menor a mayor</option>
                <option value="TITLE_ASC">Nombre: A-Z</option>
                <option value="TITLE_DESC">Nombre: Z-A</option>
              </select>
            </div>
          </header>

          <div
            className="rq-home-project-list__content"
            id="rq-home-project-list-content"
          >
            {projectListSearchOpen ? (
              <div className="rq-home-project-list__search">
                <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
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
                  aria-label="Filtrar listado de proyectos"
                  autoFocus
                  onChange={(event) => setProjectListSearch(event.target.value)}
                  placeholder="Nombre, código RQ o área"
                  type="search"
                  value={projectListSearch}
                />
              </div>
            ) : null}

            {recentProjects.length === 0 ? (
              <div className="rq-home-project-state__empty">
                <strong>Sin proyectos disponibles</strong>
                <span>Crea un proyecto para iniciar el flujo documental.</span>
              </div>
            ) : projectListItems.length === 0 ? (
              <div className="rq-home-project-state__empty">
                <strong>Sin coincidencias</strong>
                <span>Prueba otro nombre, código RQ o área.</span>
              </div>
            ) : (
              <nav
                aria-label="Listado de proyectos"
                className="rq-home-project-state__list"
              >
                {projectListItems.map(
                  ({ project, visibleProgress, overallProgress }) => {
                    const isSelected = project.id === selectedProject?.id;
                    const isComplete = visibleProgress.stageIndex === 5;

                    return (
                      <button
                        aria-current={isSelected ? "true" : undefined}
                        data-selected={isSelected ? "true" : "false"}
                        key={project.id}
                        onClick={() => setSelectedProjectId(project.id)}
                        type="button"
                      >
                        <span className="rq-home-project-state__identity">
                          <strong>{project.title}</strong>
                          <small>{project.code}</small>
                        </span>

                        <span className="rq-home-project-state__stage">
                          <strong>
                            {overallProgress}%{" "}
                            <small className="rq-home-project-state__figure-label">
                              {isComplete ? "completo" : "avance"}
                            </small>
                          </strong>
                          <span
                            aria-label={`Avance general ${overallProgress}%${
                              isComplete ? ", completo" : ""
                            }`}
                            className="rq-home-project-state__progress"
                            data-complete={isComplete ? "true" : "false"}
                          >
                            <span
                              aria-hidden="true"
                              className="rq-home-project-state__progress-track"
                            >
                              <span
                                style={
                                  {
                                    "--rq-project-list-progress": `${overallProgress}%`,
                                  } as CSSProperties
                                }
                              />
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  },
                )}
              </nav>
            )}
          </div>
        </aside>
      </div>

      {visibleInitialError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{visibleInitialError}</span>
        </div>
      ) : null}
    </section>
  );
}
