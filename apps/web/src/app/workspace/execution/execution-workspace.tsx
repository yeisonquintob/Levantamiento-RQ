"use client";

import type { ChangeEvent, CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectAreaListResponse,
  ProjectListResponse,
  ProjectStatus,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
} from "@levantamiento-rq/shared-ui";

import type {
  ExecutionTaskStatusDetail,
  ExecutionTaskStatusUpdate,
} from "@levantamiento-rq/shared-contracts";

import {
  type ExecutionPlan,
  buildAzureDevOpsCsv,
  buildExecutionPlan,
  downloadTextFile,
  parseAzureDevOpsCsv,
} from "./azure-devops-csv";
import { ExecutionChecklist, ExecutionKpiStrip } from "./execution-checklist";
import {
  type ExecutionStatusMap,
  azureStatusUpdates,
  clearLegacyAzureImport,
  type ExecutionSummary,
  doneCodesOf,
  effectiveExecutionStatus,
  fetchExecutionStatuses,
  loadExecutionSummary,
  importedTaskFor,
  normalizeTaskCode,
  planKpis,
  readLegacyAzureImport,
  saveExecutionStatuses,
  statusMapOf,
} from "./execution-tracking";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import {
  ProjectStatusBadge,
  executionStatusPresentation,
} from "../project-status-badge";
import {
  browserProgressStorage,
  clearCachedProgress,
} from "../home-progress-cache";
import { workPlanAxisLabels } from "../work-plan-timeline";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface Props {
  projects: ProjectListResponse["items"];
  initialError?: string;
}

type ExecutionProjectSort =
  "UPDATED_DESC" | "UPDATED_ASC" | "TITLE_ASC" | "TITLE_DESC" | "CODE_ASC";

const PROJECT_STATUS_OPTIONS: ReadonlyArray<{
  value: ProjectStatus;
  label: string;
}> = [
  { value: "DRAFT", label: "Borrador" },
  { value: "DISCUSSION", label: "Discusión" },
  { value: "SOURCES", label: "Fuentes" },
  { value: "DOCUMENT_GENERATED", label: "Documento generado" },
  { value: "VALIDATION", label: "En validación" },
  { value: "EXECUTION", label: "En ejecución" },
  { value: "COMPLETED", label: "Completado" },
  { value: "ARCHIVED", label: "Archivado" },
];

function projectStatusLabel(status: ProjectStatus): string {
  return (
    PROJECT_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    status
  );
}

export function executionAvailability(status: ProjectStatus): string {
  if (status === "EXECUTION") return "Ejecución habilitada";
  if (status === "APPROVED") return "Ejecución habilitada · validado";
  if (status === "COMPLETED") return "Ejecución finalizada";
  return "Pendiente de aprobación";
}

/** La ejecución solo se trabaja con el proyecto aprobado; completado se puede abrir siempre. */
export function canAccessExecution(status: ProjectStatus): boolean {
  return (
    status === "APPROVED" || status === "EXECUTION" || status === "COMPLETED"
  );
}

function formatProjectDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatAxis(value: number, usesDates: boolean): string {
  return usesDates
    ? new Intl.DateTimeFormat("es-CO", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(value))
    : `Día ${Math.round(value)}`;
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

const AZURE_REQUIRED_FIELDS_TXT = `CAMPOS REQUERIDOS PARA EL SEGUIMIENTO DE EJECUCIÓN
================================================================

Agrega estas columnas a la consulta de Azure DevOps desde “Column options”
y luego utiliza “Export to CSV”. Conserva los nombres tal como aparecen aquí.

CAMPOS DE IDENTIFICACIÓN Y JERARQUÍA
1. ID
   Identificador único asignado por Azure DevOps.

2. Work Item Type
   Permite distinguir Epic, Feature, Product Backlog Item, Task y Bug.

3. Title 1, Title 2, Title 3, Title 4... Title N
   Conservan la jerarquía padre-hijo de los elementos exportados.

CAMPOS DE ESTADO Y SPRINT
4. State
   Identifica elementos New, Committed, To Do, In Progress, Done o Removed.

5. Iteration Path
   Indica el sprint, iteración o periodo al que pertenece cada elemento.

CAMPOS DE FECHAS
6. Start Date
   Fecha en la que estaba previsto iniciar el trabajo.

7. Target Date
   Fecha objetivo o fecha prevista de finalización.

8. Closed Date
   Fecha real en la que Azure DevOps cerró el elemento.

9. Changed Date
   Última fecha de actualización. Se usa como respaldo cuando no existe Closed Date.

CAMPOS DE ESFUERZO
10. Original Estimate
    Esfuerzo inicialmente estimado para la tarea.

11. Completed Work
    Trabajo que ya fue ejecutado.

12. Remaining Work
    Trabajo que todavía está pendiente.

CAMPOS RECOMENDADOS
13. Effort
14. Business Value
15. Value Area
16. Tags

Con estos campos se pueden calcular:
- avance general;
- tareas completadas, activas y pendientes;
- cumplimiento frente a las fechas planeadas;
- avance y cumplimiento por sprint;
- trabajo finalizado dentro o fuera del sprint;
- tareas trasladadas entre iteraciones;
- esfuerzo completado y esfuerzo restante;
- roadmap planeado frente a ejecución real.
`;

export function ExecutionWorkspace({ projects, initialError }: Props) {
  const urlProjectId = useSearchParams().get("projectId");
  const inputRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState("");
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [document, setDocument] = useState<RequirementDocumentDetail | null>(
    null,
  );
  const [statuses, setStatuses] = useState<ExecutionStatusMap>(new Map());
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"summary" | "tasks">("summary");
  const syncedStatus = useRef<ProjectStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useQueryState<string>("q", "");
  const [statusFilter, setStatusFilter] = useQueryState<"" | ProjectStatus>(
    "estado",
    "",
  );
  // Avance real de cada proyecto abierto a ejecución; el estado guardado solo avanza.
  const [summaries, setSummaries] = useState<Record<string, ExecutionSummary>>({});
  const [sort, setSort] = useQueryState<ExecutionProjectSort>(
    "orden",
    "UPDATED_DESC",
  );
  const [areaFilter, setAreaFilter] = useQueryState<string>("area", "");
  const [catalogAreas, setCatalogAreas] = useState<readonly string[]>([]);
  const [notice, setNotice] = useState<{
    tone: "danger" | "success";
    text: string;
  } | null>(initialError ? { tone: "danger", text: initialError } : null);
  useAutoDismiss(notice, () => setNotice(null));
  // Un proyecto sin aprobar se puede abrir, pero solo para ver este aviso y regresar.
  const gateProject = projectId
    ? projects.find((item) => item.id === projectId)
    : undefined;
  const gateOpen = Boolean(gateProject && !canAccessExecution(gateProject.status));
  const gateRef = useDialogAccessibility<HTMLElement>(gateOpen, closeExecution);

  useEffect(() => {
    let active = true;
    fetch(`${GATEWAY_URL}/api/v1/project-areas`, { credentials: "include" })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<ProjectAreaListResponse>)
          : null,
      )
      .then((result) => {
        if (active && result)
          setCatalogAreas(result.items.map((item) => item.name));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    for (const project of projects) {
      if (!canAccessExecution(project.status)) continue;
      void loadExecutionSummary(project.id)
        .then((summary) => {
          if (active && summary) {
            setSummaries((current) => ({ ...current, [project.id]: summary }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [projects]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get(
      "projectId",
    );
    // Cualquier proyecto se puede abrir; si no está aprobado, una ventana bloquea la edición.
    setProjectId(
      requested && projects.some((project) => project.id === requested)
        ? requested
        : "",
    );
    // La flecha lateral de «Volver» quita ?projectId y esto regresa al listado.
  }, [projects, urlProjectId]);

  useEffect(() => {
    if (!projectId) {
      setPlan(null);
      setDocument(null);
      setStatuses(new Map());
      return;
    }
    setStatuses(new Map());
    setTab("summary");
    syncedStatus.current = null;
    // Sin aprobación no se carga el plan: solo se muestra la ventana que permite regresar.
    const target = projects.find((item) => item.id === projectId);
    if (target && !canAccessExecution(target.status)) {
      setPlan(null);
      setDocument(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
      { credentials: "include", cache: "no-store" },
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            "No fue posible consultar el documento del proyecto.",
          );
        }
        const list = (await response.json()) as RequirementDocumentListResponse;
        const summary =
          list.items.find((item) => item.status === "APPROVED") ??
          list.items[0];
        if (!summary) {
          throw new Error(
            "Este proyecto todavía no tiene un documento con plan de trabajo.",
          );
        }
        const detailResponse = await fetch(
          `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(summary.id)}`,
          { credentials: "include", cache: "no-store" },
        );
        if (!detailResponse.ok) {
          throw new Error("No fue posible cargar el plan de trabajo.");
        }
        return (await detailResponse.json()) as RequirementDocumentDetail;
      })
      .then((detail) => {
        if (!active) return;
        setDocument(detail);
        setPlan(buildExecutionPlan(detail));
        setNotice(null);
      })
      .catch((error) => {
        if (!active) return;
        setDocument(null);
        setPlan(null);
        setNotice({ tone: "danger", text: errorMessage(error) });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, projects]);

  // Estado de cada tarea: viene del servidor. Si todavía no hay y existe una importación de Azure
  // guardada solo en este navegador (versión anterior), se migra al servidor una única vez.
  useEffect(() => {
    if (!projectId || !plan) return;
    let active = true;
    void (async () => {
      try {
        let items: ExecutionTaskStatusDetail[] = await fetchExecutionStatuses(projectId);
        if (items.length === 0) {
          const legacy = readLegacyAzureImport(projectId);
          if (legacy) {
            const updates = azureStatusUpdates(plan, legacy, new Map());
            if (updates.length > 0) {
              try {
                items = await saveExecutionStatuses(projectId, updates);
                clearLegacyAzureImport(projectId);
                if (active) {
                  setNotice({
                    tone: "success",
                    text: "La ejecución importada en este navegador se guardó en el servidor y ahora la ven todas las personas del proyecto.",
                  });
                }
              } catch {
                // Sin permiso de edición se muestra solo lectura con lo importado localmente.
                items = updates.map((update) => ({
                  taskCode: update.taskCode,
                  state: update.state,
                  source: "AZURE_CSV",
                  note: null,
                  completedAt: update.completedAt ?? null,
                  updatedAt: legacy.importedAt,
                  updatedByUserId: "",
                }));
              }
            }
          }
        }
        if (active) setStatuses(statusMapOf(items));
      } catch (error) {
        if (active) {
          setStatuses(new Map());
          setNotice({ tone: "danger", text: errorMessage(error) });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [projectId, plan]);

  const completedCodes = useMemo(() => doneCodesOf(statuses), [statuses]);
  const kpis = useMemo(
    () =>
      plan
        ? planKpis(plan, completedCodes)
        : planKpis({ documentId: "", documentTitle: "", projectId: "", tasks: [], epics: [], timelineStart: 0, timelineEnd: 1, usesDates: false }, completedCodes),
    [completedCodes, plan],
  );
  const completedTasks = kpis.doneTasks;
  const totalTasks = kpis.totalTasks;
  // Solo las épicas con programación, igual que «Plan de trabajo» en el documento.
  const epicProgress = (plan?.epics ?? [])
    .filter((epic) => epic.startLabel !== "Sin programación")
    .map((epic) => {
    const completed = epic.taskCodes.filter((code) =>
      completedCodes.has(normalizeTaskCode(code)),
    ).length;
    return {
      ...epic,
      completed,
      progress: epic.taskCodes.length
        ? Math.round((completed / epic.taskCodes.length) * 100)
        : 0,
    };
  });
  const chart = useMemo(() => {
    if (!plan || plan.tasks.length === 0) return null;
    const length = Math.max(1, plan.timelineEnd - plan.timelineStart);
    const points = Array.from(
      { length: 9 },
      (_, index) => plan.timelineStart + (length * index) / 8,
    );
    const planned = points.map((point) =>
      Math.round(
        (plan.tasks.filter((task) => task.end <= point).length /
          plan.tasks.length) *
          100,
      ),
    );
    // La línea real usa la fecha en que cada tarea se marcó como hecha. En planes sin fechas se
    // cuenta en días desde la primera tarea hecha.
    const doneStatuses = [...statuses.values()].filter(
      (item) => item.state === "DONE" && item.completedAt,
    );
    const baseline = doneStatuses.length
      ? Math.min(...doneStatuses.map((item) => Date.parse(item.completedAt as string)))
      : 0;
    const actual = points.map((point) =>
      doneStatuses.length === 0
        ? 0
        : Math.round(
            (plan.tasks.filter((task) => {
              const status = statuses.get(normalizeTaskCode(task.code));
              if (status?.state !== "DONE" || !status.completedAt) return false;
              const reportedAt = Date.parse(status.completedAt);
              if (!Number.isFinite(reportedAt)) return false;
              const completionPoint = plan.usesDates
                ? reportedAt
                : plan.timelineStart +
                  Math.max(0, Math.floor((reportedAt - baseline) / 86_400_000));
              return completionPoint <= point;
            }).length /
              plan.tasks.length) *
              100,
          ),
    );
    const path = (values: number[]) =>
      values
        .map(
          (value, index) =>
            `${index ? "L" : "M"} ${(index / 8) * 100} ${100 - value}`,
        )
        .join(" ");
    return {
      points,
      plannedPath: path(planned),
      actualPath: path(actual),
    };
  }, [statuses, plan]);

  /** El estado del proyecto sigue al avance: primera tarea → ejecución; todas hechas → completado. */
  async function syncProjectStatus(next: ExecutionStatusMap) {
    if (!plan || !projectId) return;
    const project = projects.find((item) => item.id === projectId);
    const current = syncedStatus.current ?? project?.status;
    if (!project || !current || !canAccessExecution(current)) return;
    const done = [...next.values()].filter((item) => item.state === "DONE").length;
    const active = [...next.values()].filter(
      (item) => item.state === "IN_PROGRESS",
    ).length;
    const target: ProjectStatus | null =
      plan.tasks.length > 0 && done >= plan.tasks.length
        ? "COMPLETED"
        : done > 0 || active > 0 || current === "COMPLETED"
          ? "EXECUTION"
          : null;
    if (!target || target === current) return;
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ status: target }),
      },
    );
    if (response.ok) syncedStatus.current = target;
  }

  /** Aplica cambios de estado al instante y los guarda en el servidor; si falla, los revierte. */
  async function applyStatusUpdates(updates: ExecutionTaskStatusUpdate[]) {
    if (!projectId || updates.length === 0) return;
    const previous = statuses;
    const now = new Date().toISOString();
    // La nota y la fecha de cierre ya registradas se conservan al cambiar solo el estado.
    const complete = updates.map((update) => {
      const before = previous.get(normalizeTaskCode(update.taskCode));
      return {
        ...update,
        note: update.note === undefined ? (before?.note ?? null) : update.note,
        completedAt:
          update.state === "DONE"
            ? (update.completedAt ?? before?.completedAt ?? now)
            : null,
      };
    });
    const optimistic = new Map(previous);
    for (const update of complete) {
      const code = normalizeTaskCode(update.taskCode);
      optimistic.set(code, {
        taskCode: code,
        state: update.state,
        source: update.source ?? "MANUAL",
        note: update.note ?? null,
        completedAt: update.completedAt ?? null,
        updatedAt: now,
        updatedByUserId: previous.get(code)?.updatedByUserId ?? "",
      });
    }
    setStatuses(optimistic);
    setSaving(true);
    try {
      const saved = await saveExecutionStatuses(projectId, complete);
      const confirmed = new Map(optimistic);
      for (const item of saved) confirmed.set(normalizeTaskCode(item.taskCode), item);
      setStatuses(confirmed);
      // El avance guardado de Inicio ya no es válido: se recalcula la próxima vez.
      clearCachedProgress(browserProgressStorage(), projectId);
      await syncProjectStatus(confirmed);
    } catch (error) {
      setStatuses(previous);
      setNotice({ tone: "danger", text: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  function exportToAzure() {
    if (!document) return;
    const exported = buildAzureDevOpsCsv(document);
    if (!exported) {
      setNotice({
        tone: "danger",
        text: "El documento no contiene una jerarquía de trabajo para exportar.",
      });
      return;
    }
    downloadTextFile(
      exported.content,
      exported.fileName,
      "text/csv;charset=utf-8",
    );
    setNotice({
      tone: "success",
      text: `${exported.itemCount} elementos preparados para Azure DevOps.`,
    });
  }

  function downloadRequiredFields() {
    downloadTextFile(
      `\uFEFF${AZURE_REQUIRED_FIELDS_TXT.replace(/\n/gu, "\r\n")}`,
      "campos-requeridos-azure-devops.txt",
      "text/plain;charset=utf-8",
    );
    setNotice({
      tone: "success",
      text: "Se descargó la guía de columnas requeridas para Azure DevOps.",
    });
  }

  function openExecution(nextProjectId: string) {
    if (!projects.some((item) => item.id === nextProjectId)) return;
    const url = new URL(window.location.href);
    url.searchParams.set("projectId", nextProjectId);
    window.history.replaceState(null, "", url);
    setProjectId(nextProjectId);
  }

  function closeExecution() {
    const url = new URL(window.location.href);
    url.searchParams.delete("projectId");
    window.history.replaceState(null, "", url);
    setProjectId("");
    setNotice(initialError ? { tone: "danger", text: initialError } : null);
  }

  async function importFromAzure(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !projectId || !plan) return;
    try {
      const parsed = parseAzureDevOpsCsv(await file.text(), file.name);
      const matchedTasks = plan.tasks.filter((task) =>
        Boolean(importedTaskFor(task, parsed.items)),
      ).length;
      const azureTasks = parsed.items.filter(
        (item) => normalizeTaskCode(item.type) === "TASK",
      ).length;
      const updates = azureStatusUpdates(plan, parsed, statuses);
      if (updates.length > 0) await applyStatusUpdates(updates);
      setNotice({
        tone: "success",
        text: `${parsed.items.length} elementos leídos (${azureTasks} tareas). ${matchedTasks} de ${plan.tasks.length} tareas coincidieron con el plan y quedaron guardadas en el proyecto.`,
      });
    } catch (error) {
      setNotice({ tone: "danger", text: errorMessage(error) });
    }
  }

  const selectedProject = projects.find((project) => project.id === projectId);
  const shownStatus = (project: ProjectListResponse["items"][number]): ProjectStatus =>
    effectiveExecutionStatus(project.status, summaries[project.id]);
  const executionMetrics = {
    total: projects.length,
    approved: projects.filter((project) => shownStatus(project) === "APPROVED")
      .length,
    execution: projects.filter((project) => shownStatus(project) === "EXECUTION")
      .length,
    completed: projects.filter((project) => shownStatus(project) === "COMPLETED")
      .length,
  };
  const areaOptions = [
    ...new Set([
      ...catalogAreas,
      ...projects.map((project) => project.requestingArea),
    ]),
  ].sort((left, right) => left.localeCompare(right, "es"));
  const visibleProjects = [...projects]
    .filter((project) => {
      const query = normalize(search);
      const matchesSearch =
        !query ||
        normalize(project.code).includes(query) ||
        normalize(project.title).includes(query) ||
        normalize(project.requestingArea).includes(query);
      return (
        matchesSearch &&
        (!statusFilter || shownStatus(project) === statusFilter) &&
        (!areaFilter || project.requestingArea === areaFilter)
      );
    })
    .sort((left, right) => {
      if (sort === "UPDATED_ASC")
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      if (sort === "TITLE_ASC")
        return left.title.localeCompare(right.title, "es");
      if (sort === "TITLE_DESC")
        return right.title.localeCompare(left.title, "es");
      if (sort === "CODE_ASC") return left.code.localeCompare(right.code, "es");
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });

  if (!projectId) {
    return (
      <section className="rq-documents-workspace rq-documents-index rq-execution-project-index">
        <section className="rq-module-commandbar">
          <RqKpiGrid label="Resumen de proyectos para ejecución">
            <RqKpiCard
              description="Proyectos visibles"
              icon={<WorkspaceKpiIcon name="projects" />}
              title="Total"
              value={String(executionMetrics.total)}
            />
            <RqKpiCard
              description="Validados (listos para iniciar) / en ejecución (seguimiento habilitado)"
              icon={<WorkspaceKpiIcon name="progress" />}
              title="Validados / en ejecución"
              value={`${executionMetrics.approved} / ${executionMetrics.execution}`}
            />
            <RqKpiCard
              description="Ejecución terminada"
              icon={<WorkspaceKpiIcon name="check" />}
              title="Completados"
              value={String(executionMetrics.completed)}
            />
          </RqKpiGrid>
        </section>

        {notice ? (
          <div
            className="rq-project-alert"
            data-tone={notice.tone}
            role={notice.tone === "danger" ? "alert" : "status"}
          >
            <span>{notice.text}</span>
          </div>
        ) : null}

        <form
          className="rq-projects-filters"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="rq-projects-filter rq-projects-filter--search">
            <span>Buscar proyecto:</span>
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
              aria-label="Buscar proyecto por código, título o área solicitante"
              autoComplete="off"
              id="execution-project-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Código, título o área"
              type="search"
              value={search}
            />
          </label>
          <label className="rq-projects-filter">
            <span>Estado:</span>
            <select
              aria-label="Estado"
              id="execution-project-status"
              onChange={(event) =>
                setStatusFilter(event.target.value as "" | ProjectStatus)
              }
              value={statusFilter}
            >
              <option value="">Todos</option>
              {PROJECT_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rq-projects-filter">
            <span>Área:</span>
            <select
              aria-label="Área solicitante"
              id="execution-project-area"
              onChange={(event) => setAreaFilter(event.target.value)}
              value={areaFilter}
            >
              <option value="">Todas</option>
              {areaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="rq-projects-filter">
            <span>Ordenar:</span>
            <select
              aria-label="Ordenar por"
              id="execution-project-sort"
              onChange={(event) =>
                setSort(event.target.value as ExecutionProjectSort)
              }
              value={sort}
            >
              <option value="UPDATED_DESC">Fecha: más reciente</option>
              <option value="UPDATED_ASC">Fecha: más antigua</option>
              <option value="TITLE_ASC">Nombre: A a Z</option>
              <option value="TITLE_DESC">Nombre: Z a A</option>
              <option value="CODE_ASC">Código</option>
            </select>
          </label>
          <RqActionButton
            onClick={() => {
              setSearch("");
              setStatusFilter("");
              setAreaFilter("");
              setSort("UPDATED_DESC");
            }}
            tone="secondary"
            type="button"
          >
            Limpiar
          </RqActionButton>
        </form>

        <section className="rq-documents-list-shell">
          <header className="rq-documents-list-heading">
            <div className="rq-documents-list-heading__copy">
              <h2>Proyectos en ejecución</h2>
              <p>
                Consulta el estado real y abre el seguimiento de los proyectos
                que ya se encuentran en ejecución.
              </p>
            </div>
          </header>

          <div
            aria-label="Proyectos disponibles para ejecución"
            className="rq-documents-table-frame"
            role="region"
            tabIndex={0}
          >
            {visibleProjects.length === 0 ? (
              <RqEmptyState
                description="No hay proyectos que coincidan con los filtros seleccionados."
                title="No hay proyectos"
              />
            ) : (
              <table className="rq-table rq-document-table">
                <thead>
                  <tr>
                    <th scope="col">Proyecto</th>
                    <th scope="col">Área solicitante</th>
                    <th scope="col">Estado actual</th>
                    <th scope="col">Disponibilidad</th>
                    <th scope="col">Última modificación</th>
                    <th scope="col">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProjects.map((project) => {
                    const executionEnabled = canAccessExecution(project.status);
                    return (
                      <tr key={project.id}>
                        <td>
                          <strong>{project.code}</strong>
                          <small>{project.title}</small>
                        </td>
                        <td>{project.requestingArea}</td>
                        <td>
                          {(() => {
                            const shown = executionStatusPresentation(
                              shownStatus(project),
                            );
                            return (
                              <ProjectStatusBadge
                                status={shownStatus(project)}
                                tone={shown.tone}
                              >
                                {shown.label}
                              </ProjectStatusBadge>
                            );
                          })()}
                        </td>
                        <td>{executionAvailability(shownStatus(project))}</td>
                        <td>{formatProjectDate(project.updatedAt)}</td>
                        <td>
                          <RqActionButton
                            className="rq-row-open"
                            compact
                            onClick={() => openExecution(project.id)}
                            title={
                              executionEnabled
                                ? "Abrir seguimiento"
                                : "Abrir (el proyecto aún no está aprobado)"
                            }
                            tone="operation"
                          >
                            Abrir
                          </RqActionButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </section>
    );
  }

  return (
    <section className="rq-execution-workspace">
      <section className="rq-clean-toolbar">
        <div>
          <span className="rq-clean-toolbar__eyebrow">
            Proyecto seleccionado
          </span>
          <label className="rq-clean-select">
            <span className="sr-only">Proyecto</span>
            <select
              disabled={loading}
              onChange={(event) => openExecution(event.target.value)}
              value={projectId}
            >
              {projects.length === 0 ? (
                <option value="">Sin proyectos disponibles</option>
              ) : null}
              {projects.map((project) => (
                <option
                  key={project.id}
                  value={project.id}
                >
                  {project.code} · {project.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="rq-clean-toolbar__actions">
          {statuses.size > 0 ? (
            <span className="rq-import-chip">
              ✓ {completedTasks} de {totalTasks} tareas hechas
            </span>
          ) : (
            <span className="rq-execution-zero-chip">
              Sin ejecución registrada
            </span>
          )}
          <input
            accept=".csv,text/csv"
            hidden
            onChange={(event) => void importFromAzure(event)}
            ref={inputRef}
            type="file"
          />
          <button
            className="rq-action"
            data-rq-tone="operation"
            disabled={!plan}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            Importar de Azure
          </button>
          <button
            className="rq-action"
            data-rq-tone="secondary"
            disabled={!document}
            onClick={exportToAzure}
            type="button"
          >
            Exportar a Azure
          </button>
          <button
            className="rq-action rq-execution-fields-button"
            data-rq-tone="consult"
            onClick={downloadRequiredFields}
            type="button"
          >
            Campos requeridos · TXT
          </button>
        </div>
      </section>

      {notice ? (
        <div
          className="rq-project-alert"
          data-tone={notice.tone}
          role={notice.tone === "danger" ? "alert" : "status"}
        >
          <span>{notice.text}</span>
        </div>
      ) : null}

      <div
        aria-label="Seguimiento de ejecución"
        className="rq-exec-tabs"
        role="tablist"
      >
        <button
          aria-controls="rq-exec-panel"
          aria-selected={tab === "summary"}
          id="rq-exec-tab-summary"
          onClick={() => setTab("summary")}
          role="tab"
          type="button"
        >
          Resumen de cumplimiento
        </button>
        <button
          aria-controls="rq-exec-panel"
          aria-selected={tab === "tasks"}
          id="rq-exec-tab-tasks"
          onClick={() => setTab("tasks")}
          role="tab"
          type="button"
        >
          Actividades y tareas
          <small>
            {completedTasks}/{totalTasks}
          </small>
        </button>
      </div>

      <div
        aria-labelledby={`rq-exec-tab-${tab}`}
        className="rq-exec-panel"
        id="rq-exec-panel"
        role="tabpanel"
      >
      {tab === "tasks" ? (
        plan ? (
          <ExecutionChecklist
            busy={saving}
            kpis={kpis}
            onUpdate={applyStatusUpdates}
            plan={plan}
            statuses={statuses}
          />
        ) : (
          <div className="rq-execution-empty">
            <strong>{loading ? "Cargando el plan de trabajo…" : "Sin plan de trabajo"}</strong>
            <span>Las tareas salen de la estructura del documento del proyecto.</span>
          </div>
        )
      ) : (
        <>
      <div className="rq-execution-overview">
        <ExecutionKpiStrip hasExecution={completedTasks > 0} kpis={kpis} />

        <section className="rq-clean-card rq-execution-curve">
          <header>
            <div>
              <span>Plan vs. ejecución</span>
              <h2>Avance acumulado a la fecha</h2>
              <p>
                La línea planeada nace de las tareas calendarizadas del
                documento; la ejecutada se actualiza con el CSV de Azure DevOps.
              </p>
            </div>
            <div className="rq-chart-legend">
              <span data-series="planned">Deberíamos estar</span>
              <span data-series="completed">Ejecución real</span>
            </div>
          </header>
          {chart ? (
            <div
              className="rq-burndown-chart"
              role="img"
              aria-label={`Avance planeado y ejecutado de ${selectedProject?.title ?? "proyecto"}`}
            >
              <div className="rq-burndown-chart__scale">
                <span>100%</span>
                <span>75%</span>
                <span>50%</span>
                <span>25%</span>
                <span>0%</span>
              </div>
              <div className="rq-burndown-chart__plot">
                <svg
                  aria-hidden="true"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  <path
                    className="rq-burndown-chart__area"
                    d={`${chart.plannedPath} L 100 100 L 0 100 Z`}
                  />
                  <path
                    className="rq-burndown-chart__planned"
                    d={chart.plannedPath}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    className="rq-burndown-chart__actual"
                    d={chart.actualPath}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <div className="rq-burndown-chart__axis">
                  {[0, 2, 4, 6, 8].map((index) => (
                    <span key={index}>
                      {formatAxis(
                        chart.points[index] ?? 0,
                        plan?.usesDates ?? false,
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="rq-execution-empty">
              <strong>Sin tareas calendarizadas</strong>
              <span>
                Completa el plan de trabajo para construir la línea base.
              </span>
            </div>
          )}
        </section>
      </div>

      <section className="rq-clean-card rq-epics-panel">
        <header>
          <div>
            <span>Línea de tiempo</span>
            <h2>Programación según las tareas</h2>
            <p>
              La barra tenue representa el periodo planeado; el relleno muestra
              el porcentaje realmente completado.
            </p>
          </div>
          <strong className="rq-execution-plan-count">
            {totalTasks} tareas planeadas
          </strong>
        </header>
        {epicProgress.length ? (
          <div className="rq-execution-timeline">
            <div className="rq-execution-timeline__axis">
              <strong>Elemento</strong>
              <div>
                {workPlanAxisLabels(
                  plan?.timelineStart ?? 0,
                  plan?.timelineEnd ?? 1,
                ).map((label, index) => (
                  <span key={index}>{label}</span>
                ))}
              </div>
            </div>
            {epicProgress.map((epic, index) => {
              const length = Math.max(
                1,
                (plan?.timelineEnd ?? 1) - (plan?.timelineStart ?? 0),
              );
              const left =
                ((epic.start - (plan?.timelineStart ?? 0)) / length) * 100;
              const width = Math.max(
                3,
                ((epic.end - epic.start) / length) * 100,
              );
              return (
                <article key={epic.code}>
                  <div>
                    <strong>{epic.code}</strong>
                    <span>{epic.title}</span>
                  </div>
                  <div className="rq-execution-timeline__track">
                    <span
                      data-color={String((index % 3) + 1)}
                      style={
                        {
                          left: `${left}%`,
                          width: `${Math.min(width, 100 - left)}%`,
                          "--actual-progress": `${epic.progress}%`,
                        } as CSSProperties
                      }
                    >
                      <i />
                      <small>{epic.startLabel}</small>
                      <small>{epic.endLabel}</small>
                    </span>
                  </div>
                  <output>{epic.progress}%</output>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rq-execution-empty">
            <strong>Sin épicas programadas</strong>
            <span>El documento todavía no contiene tareas asociadas.</span>
          </div>
        )}
      </section>
        </>
      )}
      </div>

      {gateOpen && gateProject ? (
        <div
          className="rq-project-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeExecution();
          }}
        >
          <section
            aria-describedby="execution-gate-description"
            aria-labelledby="execution-gate-title"
            aria-modal="true"
            className="rq-project-modal rq-execution-gate"
            ref={gateRef}
            role="alertdialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>{gateProject.code}</span>
                <h2 id="execution-gate-title">Proyecto no aprobado</h2>
              </div>
            </header>
            <p id="execution-gate-description">
              El proyecto <strong>{gateProject.title}</strong> está en estado{" "}
              <strong>{projectStatusLabel(gateProject.status)}</strong> y todavía
              no ha sido aprobado. Valida su aprobación antes de empezar su
              ejecución.
            </p>
            <footer className="rq-project-modal__actions">
              <RqActionButton
                autoFocus
                onClick={closeExecution}
                tone="operation"
              >
                Regresar
              </RqActionButton>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
