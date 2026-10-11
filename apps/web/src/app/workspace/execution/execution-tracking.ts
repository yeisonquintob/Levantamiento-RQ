import type {
  ExecutionTaskStatusDetail,
  ExecutionTaskStatusListResponse,
  ExecutionTaskStatusUpdate,
  ProjectStatus,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  buildExecutionPlan,
  type AzureExecutionImport,
  type AzureExecutionItem,
  type ExecutionPlan,
} from "./azure-devops-csv";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

/** Código de tarea comparable: sin espacios sobrantes y en mayúsculas. */
export function normalizeTaskCode(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toUpperCase();
}

export type ExecutionStatusMap = ReadonlyMap<string, ExecutionTaskStatusDetail>;

export function statusMapOf(
  items: readonly ExecutionTaskStatusDetail[],
): Map<string, ExecutionTaskStatusDetail> {
  return new Map(items.map((item) => [normalizeTaskCode(item.taskCode), item]));
}

/** Códigos de las tareas marcadas como hechas. */
export function doneCodesOf(statuses: ExecutionStatusMap): Set<string> {
  return new Set(
    [...statuses.values()]
      .filter((item) => item.state === "DONE")
      .map((item) => normalizeTaskCode(item.taskCode)),
  );
}

/** Tareas del plan agrupadas por hito (épica) → historia. Las tareas sin historia van sueltas. */
export interface KpiEpicGroup {
  stories: readonly (readonly string[])[];
  loose: readonly string[];
}

export interface ExecutionKpis {
  totalTasks: number;
  doneTasks: number;
  /** Avance general: tareas hechas / tareas planeadas. */
  progress: number;
  totalStories: number;
  doneStories: number;
  /** Cumplimiento de objetivos: historias con todas sus tareas hechas / historias con tareas. */
  objectiveCompliance: number;
  totalEpics: number;
  doneEpics: number;
  /** Cumplimiento de entregables: hitos con todas sus tareas hechas / hitos. */
  deliverableCompliance: number;
}

const percent = (value: number, total: number) =>
  total > 0 ? Math.round((value / total) * 100) : 0;

/**
 * Única fórmula de los tres KPI de ejecución. La usan la pestaña de seguimiento, el resumen de
 * Ejecución, la sección «Indicadores» del documento y el avance de Inicio.
 */
export function computeExecutionKpis(
  epics: readonly KpiEpicGroup[],
  done: ReadonlySet<string>,
): ExecutionKpis {
  const isDone = (code: string) => done.has(normalizeTaskCode(code));
  let totalTasks = 0;
  let doneTasks = 0;
  let totalStories = 0;
  let doneStories = 0;
  let doneEpics = 0;
  for (const epic of epics) {
    const codes = [...epic.stories.flat(), ...epic.loose];
    totalTasks += codes.length;
    const epicDone = codes.filter(isDone).length;
    doneTasks += epicDone;
    if (codes.length > 0 && epicDone === codes.length) doneEpics += 1;
    for (const story of epic.stories) {
      if (story.length === 0) continue;
      totalStories += 1;
      if (story.every(isDone)) doneStories += 1;
    }
  }
  return {
    totalTasks,
    doneTasks,
    progress: percent(doneTasks, totalTasks),
    totalStories,
    doneStories,
    objectiveCompliance: percent(doneStories, totalStories),
    totalEpics: epics.length,
    doneEpics,
    deliverableCompliance: percent(doneEpics, epics.length),
  };
}

/** Agrupa un plan de ejecución por hito → historia para calcular los KPI. */
export function planKpiGroups(plan: ExecutionPlan): KpiEpicGroup[] {
  return plan.epics.map((epic) => {
    const tasks = plan.tasks.filter((task) => task.epicCode === epic.code);
    const stories = new Map<string, string[]>();
    const loose: string[] = [];
    for (const task of tasks) {
      const key = normalizeTaskCode(task.storyCode);
      if (!key) {
        loose.push(task.code);
        continue;
      }
      stories.set(key, [...(stories.get(key) ?? []), task.code]);
    }
    return { stories: [...stories.values()], loose };
  });
}

export function planKpis(
  plan: ExecutionPlan,
  done: ReadonlySet<string>,
): ExecutionKpis {
  return computeExecutionKpis(planKpiGroups(plan), done);
}

function comparableTitle(value: string): string {
  return normalizeTaskCode(value)
    .replace(/^[A-ZÁÉÍÓÚÑ]{1,8}(?:-[A-Z0-9ÁÉÍÓÚÑ]+)+\s*[·-]\s*/u, "")
    .replace(/\s+/gu, " ");
}

/** Elemento de Azure DevOps que corresponde a una tarea del plan (por código o por título). */
export function importedTaskFor(
  task: { code: string; title: string },
  items: readonly AzureExecutionItem[],
): AzureExecutionItem | undefined {
  const code = normalizeTaskCode(task.code);
  const title = comparableTitle(task.title);
  return items.find((item) => {
    if (normalizeTaskCode(item.type) !== "TASK") return false;
    return (
      normalizeTaskCode(item.code) === code ||
      comparableTitle(item.title) === title
    );
  });
}

const ACTIVE_STATE = /activ|in progress|doing|en curso/iu;

/**
 * Estados que produce una importación de Azure DevOps. Una tarea completada en Azure queda
 * hecha; si no, no se pisa lo que alguien marcó a mano.
 */
export function azureStatusUpdates(
  plan: ExecutionPlan,
  imported: AzureExecutionImport,
  current: ExecutionStatusMap,
): ExecutionTaskStatusUpdate[] {
  const updates: ExecutionTaskStatusUpdate[] = [];
  for (const task of plan.tasks) {
    const item = importedTaskFor(task, imported.items);
    if (!item) continue;
    const code = normalizeTaskCode(task.code);
    const existing = current.get(code);
    if (item.completed) {
      updates.push({
        taskCode: code,
        state: "DONE",
        source: "AZURE_CSV",
        completedAt: item.completedAt ?? imported.importedAt,
      });
      continue;
    }
    if (existing && existing.source === "MANUAL" && existing.state !== "PENDING") {
      continue;
    }
    updates.push({
      taskCode: code,
      state: ACTIVE_STATE.test(item.state) ? "IN_PROGRESS" : "PENDING",
      source: "AZURE_CSV",
    });
  }
  return updates;
}

export class ExecutionTrackingError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as {
      message?: unknown;
      detail?: unknown;
    };
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.detail === "string") return payload.detail;
  } catch {
    // Sin cuerpo JSON: se usa el mensaje genérico.
  }
  return "No fue posible actualizar la ejecución.";
}

export async function fetchExecutionStatuses(
  projectId: string,
): Promise<ExecutionTaskStatusDetail[]> {
  const response = await fetch(
    `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/execution/tasks`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) {
    throw new ExecutionTrackingError(await readError(response), response.status);
  }
  return [...((await response.json()) as ExecutionTaskStatusListResponse).items];
}

export async function saveExecutionStatuses(
  projectId: string,
  items: readonly ExecutionTaskStatusUpdate[],
): Promise<ExecutionTaskStatusDetail[]> {
  const saved: ExecutionTaskStatusDetail[] = [];
  // El servicio acepta hasta 500 tareas por solicitud.
  for (let start = 0; start < items.length; start += 500) {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/execution/tasks`,
      {
        method: "PUT",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ items: items.slice(start, start + 500) }),
      },
    );
    if (!response.ok) {
      throw new ExecutionTrackingError(await readError(response), response.status);
    }
    saved.push(
      ...((await response.json()) as ExecutionTaskStatusListResponse).items,
    );
  }
  return saved;
}

/** Importación de Azure que quedó guardada solo en este navegador (versión anterior). */
export function readLegacyAzureImport(
  projectId: string,
): AzureExecutionImport | null {
  try {
    const stored = window.localStorage.getItem(`rq-azure-execution-v1:${projectId}`);
    return stored ? (JSON.parse(stored) as AzureExecutionImport) : null;
  } catch {
    return null;
  }
}

export function clearLegacyAzureImport(projectId: string): void {
  try {
    window.localStorage.removeItem(`rq-azure-execution-v1:${projectId}`);
  } catch {
    // Sin acceso al almacenamiento local no hay nada que limpiar.
  }
}

/** Estado de ejecución de un proyecto: el del servidor o, si aún no hay, la importación local. */
export async function loadExecutionDoneCodes(
  projectId: string,
  tasks: readonly { code: string; title: string }[],
): Promise<{ done: Set<string>; active: Set<string>; legacy: boolean }> {
  try {
    const statuses = await fetchExecutionStatuses(projectId);
    if (statuses.length > 0) {
      const map = statusMapOf(statuses);
      return {
        done: doneCodesOf(map),
        active: new Set(
          statuses
            .filter((item) => item.state === "IN_PROGRESS")
            .map((item) => normalizeTaskCode(item.taskCode)),
        ),
        legacy: false,
      };
    }
  } catch {
    // Si el servicio no responde se intenta con lo que haya en el navegador.
  }
  const legacy = readLegacyAzureImport(projectId);
  if (!legacy) return { done: new Set(), active: new Set(), legacy: false };
  const done = new Set<string>();
  const active = new Set<string>();
  for (const task of tasks) {
    const item = importedTaskFor(task, legacy.items);
    if (!item) continue;
    if (item.completed) done.add(normalizeTaskCode(task.code));
    else if (ACTIVE_STATE.test(item.state)) active.add(normalizeTaskCode(task.code));
  }
  return { done, active, legacy: true };
}

/** Avance real de la ejecución de un proyecto: sale de las tareas hechas, no del estado guardado. */
export interface ExecutionSummary {
  /** Avance general (0–100): tareas hechas / tareas del plan. */
  percentage: number;
  /** Alguna tarea ya se marcó como hecha o en curso. */
  started: boolean;
}

/**
 * Estado que se muestra en Ejecución. El estado guardado del proyecto solo avanza, así que mientras
 * la ejecución no llegue al 100 % de las tareas no puede verse «Completado».
 */
export function effectiveExecutionStatus(
  status: ProjectStatus,
  summary: ExecutionSummary | undefined,
): ProjectStatus {
  const open =
    status === "APPROVED" || status === "EXECUTION" || status === "COMPLETED";
  if (!open) return status;
  // Un proyecto aprobado ya está en la etapa de ejecución; solo termina con todas las tareas.
  return summary && summary.percentage >= 100 ? "COMPLETED" : "EXECUTION";
}

export async function loadExecutionSummary(
  projectId: string,
): Promise<ExecutionSummary | null> {
  const encoded = encodeURIComponent(projectId);
  const documents = await fetch(`${GATEWAY_URL}/api/v1/projects/${encoded}/documents`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!documents.ok) return null;
  const list = (await documents.json()) as RequirementDocumentListResponse;
  const summary =
    list.items.find((item) => item.status === "APPROVED") ?? list.items[0];
  if (!summary) return null;
  const detail = await fetch(
    `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(summary.id)}`,
    { credentials: "include", cache: "no-store" },
  );
  if (!detail.ok) return null;
  const plan = buildExecutionPlan((await detail.json()) as RequirementDocumentDetail);
  if (plan.tasks.length === 0) return { percentage: 0, started: false };
  const statuses = await fetchExecutionStatuses(projectId);
  const done = doneCodesOf(statusMapOf(statuses));
  const doneTasks = plan.tasks.filter((task) =>
    done.has(normalizeTaskCode(task.code)),
  ).length;
  return {
    percentage: Math.round((doneTasks / plan.tasks.length) * 100),
    started: statuses.some((item) => item.state !== "PENDING"),
  };
}
