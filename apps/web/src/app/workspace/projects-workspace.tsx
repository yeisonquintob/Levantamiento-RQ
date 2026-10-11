"use client";

import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  CreateProjectRequest,
  DocumentTemplateListResponse,
  DocumentTemplateSummary,
  ProjectActivityState,
  ProjectAreaListResponse,
  ProjectAreaSummary,
  ProjectDetail,
  ProjectListResponse,
  ProjectMetrics,
  ProjectStatus,
  ProjectSummary,
  RequirementDocumentListResponse,
  SourceListResponse,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";

import { AreaIcon } from "./area-icon";
import { WorkspaceKpiIcon } from "./workspace-kpi-icon";
import { useDialogAccessibility } from "../use-dialog-accessibility";
import { parseDiscussionStageSnapshot } from "./home-stage-progress";
import { useAutoDismiss } from "../use-auto-dismiss";
import { useConfirm } from "../confirm-dialog";
import { useQueryState } from "./use-query-state";

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

function normalizeProjectMetrics(
  metrics: Partial<ProjectMetrics> | null | undefined,
): ProjectMetrics {
  return {
    ...EMPTY_METRICS,
    ...metrics,
    completed: metrics?.completed ?? 0,
  };
}

const EMPTY_LIST: ProjectListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
};

const STATUS_OPTIONS: readonly {
  value: ProjectStatus;
  label: string;
}[] = [
  { value: "DRAFT", label: "Borrador" },
  { value: "DISCUSSION", label: "Discusión" },
  { value: "SOURCES", label: "Fuentes" },
  { value: "DOCUMENT_GENERATED", label: "Documento generado" },
  { value: "VALIDATION", label: "En validación" },
  { value: "APPROVED", label: "Validación aprobada" },
  { value: "EXECUTION", label: "En ejecución" },
  { value: "COMPLETED", label: "Completado" },
  { value: "ARCHIVED", label: "Archivado" },
];

interface ProjectsWorkspaceProps {
  initialList?: ProjectListResponse;
  initialMetrics?: ProjectMetrics;
  initialTemplates?: DocumentTemplateListResponse;
  initialError?: string | null;
}

interface ProjectFormState {
  title: string;
  requestingArea: string;
  description: string;
  templateId: string;
  status: ProjectStatus;
  activityState: ProjectActivityState;
}

interface AlertState {
  tone: "success" | "danger" | "information";
  message: string;
}

// RQ PROYECTOS FILTRO AUTOMATICO Y ORDEN V1.2
type ProjectSort =
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "TITLE_ASC"
  | "TITLE_DESC"
  | "CODE_ASC";

/** Valores del filtro «Estado»: situación del proyecto o etapa del ciclo de vida. */
type ProjectFilter = "ACTIVE" | "PAUSED" | "DELETED" | "ALL" | ProjectStatus;

const ACTIVITY_OPTIONS: readonly { value: ProjectFilter; label: string }[] = [
  { value: "ACTIVE", label: "Activos" },
  { value: "PAUSED", label: "Pausados" },
  { value: "DELETED", label: "Eliminados" },
  { value: "ALL", label: "Todos" },
];

const ACTIVITY_LABEL: Record<ProjectActivityState, string> = {
  ACTIVE: "Activo",
  PAUSED: "Pausado",
  DELETED: "Eliminado",
};

function filterQuery(filter: ProjectFilter): [string, string] | null {
  if (filter === "ACTIVE") return null;
  if (filter === "ALL" || filter === "PAUSED" || filter === "DELETED") {
    return ["activityState", filter];
  }
  return ["status", filter];
}

/** Insignia de la tarjeta: eliminado rojo, pausado gris, completado verde y en curso naranja. */
function projectBadge(project: {
  status: ProjectStatus;
  activityState: ProjectActivityState;
}): {
  tone: "success" | "pending" | "danger" | "inactive" | "neutral";
  label: string;
} {
  if (project.activityState === "DELETED") {
    return { tone: "danger", label: "Eliminado" };
  }
  if (project.activityState === "PAUSED") {
    return { tone: "inactive", label: "Pausado" };
  }
  // La ejecución es otro proceso: aquí un proyecto aprobado, en ejecución o completado figura aprobado.
  if (["APPROVED", "EXECUTION", "COMPLETED"].includes(project.status)) {
    return { tone: "success", label: "Aprobado" };
  }
  if (project.status === "ARCHIVED") {
    return { tone: "inactive", label: statusLabel(project.status) };
  }
  if (project.status === "DRAFT") {
    return { tone: "neutral", label: statusLabel(project.status) };
  }
  return { tone: "pending", label: statusLabel(project.status) };
}

const EMPTY_FORM: ProjectFormState = {
  title: "",
  requestingArea: "",
  description: "",
  templateId: "",
  status: "DRAFT",
  activityState: "ACTIVE",
};

function statusLabel(status: ProjectStatus): string {
  return (
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
  );
}

function statusDescription(status: ProjectStatus): string {
  if (status === "DRAFT") {
    return "Proyecto creado, pendiente de completar la discusión inicial.";
  }
  if (status === "DISCUSSION") return "El proyecto inició la discusión.";
  if (status === "SOURCES") return "El proyecto ya contiene fuentes.";
  if (status === "DOCUMENT_GENERATED") return "El documento fue generado.";
  if (status === "VALIDATION") {
    return "El documento está en revisión y validación.";
  }
  if (status === "APPROVED") {
    return "La versión fue aprobada y sus exportaciones están habilitadas.";
  }
  if (status === "EXECUTION")
    return "La ejecución se actualiza desde Azure DevOps.";
  if (status === "COMPLETED") return "La ejecución real alcanzó el 100 %.";
  return "Proyecto conservado únicamente para consulta histórica.";
}

function projectStatusFromDocuments(
  currentStatus: ProjectStatus,
  documents: RequirementDocumentListResponse,
  sources: SourceListResponse,
  discussionPercentage: number,
): ProjectStatus {
  if (currentStatus === "ARCHIVED") return "ARCHIVED";
  if (currentStatus === "COMPLETED" || currentStatus === "EXECUTION") {
    return currentStatus;
  }
  if (
    currentStatus === "APPROVED" ||
    documents.items.some((document) => document.status === "APPROVED")
  ) {
    return "APPROVED";
  }
  if (
    currentStatus === "VALIDATION" ||
    documents.items.some((document) =>
      ["IN_REVIEW", "CHANGES_REQUESTED"].includes(document.status),
    )
  ) {
    return "VALIDATION";
  }
  if (currentStatus === "DOCUMENT_GENERATED" || documents.items.length > 0) {
    return "DOCUMENT_GENERATED";
  }
  if (currentStatus === "SOURCES" || sources.items.length > 0) {
    return "SOURCES";
  }
  if (currentStatus === "DISCUSSION" || discussionPercentage > 0) {
    return "DISCUSSION";
  }
  return currentStatus;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();

  if (!text) {
    return `La solicitud no pudo completarse (${response.status}).`;
  }

  try {
    const payload = JSON.parse(text) as Readonly<Record<string, unknown>>;

    for (const field of ["detail", "message", "title"]) {
      if (typeof payload[field] === "string" && payload[field].trim()) {
        return payload[field].trim();
      }
    }
  } catch {
    return text;
  }

  return `La solicitud no pudo completarse (${response.status}).`;
}

async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      accept: "application/json",
      ...(options?.body ? { "content-type": "application/json" } : {}),
    },
  });

  if (response.status === 401) {
    window.location.assign("/sign-in");
    throw new Error("Sesión vencida.");
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as T;
}

export function ProjectsWorkspace({
  initialList = EMPTY_LIST,
  initialMetrics = EMPTY_METRICS,
  initialTemplates,
  initialError = null,
}: ProjectsWorkspaceProps) {
  const confirm = useConfirm();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectListResponse>(initialList);
  const [metrics, setMetrics] = useState<ProjectMetrics>(() =>
    normalizeProjectMetrics(initialMetrics),
  );
  const templates: readonly DocumentTemplateSummary[] =
    initialTemplates?.items ?? [];
  const [search, setSearch] = useQueryState<string>("q", "");
  const [filter, setFilter] = useQueryState<ProjectFilter>("estado", "ACTIVE");
  const [area, setArea] = useQueryState<string>("area", "");
  const [catalog, setCatalog] = useState<readonly ProjectAreaSummary[]>([]);
  const catalogAreas = useMemo(
    () => catalog.map((item) => item.name),
    [catalog],
  );
  const areaStyles = useMemo(
    () =>
      new Map(
        catalog.map((item) => [item.name, [item.icon, item.color]] as const),
      ),
    [catalog],
  );
  const [sort, setSort] = useQueryState<ProjectSort>("orden", "CREATED_DESC");
  const [menuOpen, setMenuOpen] = useState(false);
  const searchTimeoutRef = useRef<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const dialogRef = useDialogAccessibility<HTMLElement>(modalOpen, () => {
    if (!saving) closeModal();
  });
  const [editing, setEditing] = useState<ProjectDetail | null>(null);
  const [form, setForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [alert, setAlert] = useState<AlertState | null>(
    initialError
      ? {
          tone: "danger",
          message: initialError,
        }
      : null,
  );
  useAutoDismiss(alert, () => setAlert(null));
  const selectedProject =
    projects.items.find((project) => project.id === selectedProjectId) ?? null;

  const sortedProjects = useMemo(() => {
    const items = [...projects.items];

    items.sort((left, right) => {
      if (sort === "CREATED_DESC" || sort === "CREATED_ASC") {
        const delta =
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime();
        return sort === "CREATED_ASC" ? delta : -delta;
      }

      if (sort === "TITLE_ASC") {
        return left.title.localeCompare(right.title, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      if (sort === "TITLE_DESC") {
        return right.title.localeCompare(left.title, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      if (sort === "UPDATED_ASC") {
        return (
          new Date(left.updatedAt).getTime() -
          new Date(right.updatedAt).getTime()
        );
      }

      if (sort === "CODE_ASC") {
        return left.code.localeCompare(right.code, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    });

    return items;
  }, [projects.items, sort]);

  useEffect(() => {
    let active = true;
    requestJson<ProjectAreaListResponse>("/api/v1/project-areas")
      .then((result) => {
        if (active) setCatalog(result.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // Catálogo de Configuración más las áreas que ya aparecen en los proyectos cargados.
  const areaOptions = useMemo(
    () =>
      [
        ...new Set([
          ...catalogAreas,
          ...projects.items.map((project) => project.requestingArea),
        ]),
      ].sort((left, right) => left.localeCompare(right, "es")),
    [catalogAreas, projects.items],
  );

  useEffect(() => {
    if (!alert) return;

    const timeout = window.setTimeout(() => setAlert(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current !== null) {
        window.clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function closeFromOutside(event: PointerEvent): void {
      if (
        event.target instanceof Element &&
        !event.target.closest(".rq-projects-menu")
      ) {
        setMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    function clearSelectionFromOutside(event: PointerEvent): void {
      if (!(event.target instanceof Element)) return;

      const clickedProject = event.target.closest(".rq-project-card");
      const clickedProjectActions = event.target.closest(
        ".rq-projects-commandbar .rq-module-commandbar__actions",
      );

      if (!clickedProject && !clickedProjectActions) {
        setSelectedProjectId(null);
      }
    }

    document.addEventListener("pointerdown", clearSelectionFromOutside);
    return () =>
      document.removeEventListener("pointerdown", clearSelectionFromOutside);
  }, []);

  useEffect(() => {
    let active = true;

    async function synchronizeExistingStatuses(): Promise<void> {
      const updates = await Promise.allSettled(
        initialList.items.map(async (project) => {
          const encodedProjectId = encodeURIComponent(project.id);
          const [documents, sources] = await Promise.all([
            requestJson<RequirementDocumentListResponse>(
              `/api/v1/projects/${encodedProjectId}/documents`,
            ),
            requestJson<SourceListResponse>(
              `/api/v1/projects/${encodedProjectId}/sources?page=1&pageSize=1&status=ACTIVE`,
            ),
          ]);
          const discussionPercentage = parseDiscussionStageSnapshot(
            window.localStorage.getItem(
              `rq-requirement-discussion-v1:${project.id}`,
            ),
          ).percentage;
          const nextStatus = projectStatusFromDocuments(
            project.status,
            documents,
            sources,
            discussionPercentage,
          );
          if (nextStatus === project.status) return false;

          await requestJson<ProjectDetail>(
            `/api/v1/projects/${encodeURIComponent(project.id)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ status: nextStatus }),
            },
          );
          return true;
        }),
      );

      const changed = updates.some(
        (result) => result.status === "fulfilled" && result.value,
      );
      if (active && changed) await reload("", "ACTIVE");
    }

    void synchronizeExistingStatuses();
    return () => {
      active = false;
    };
  }, [initialList.items]);

  async function reload(
    nextSearch: string = search,
    nextFilter: ProjectFilter = filter,
    nextArea: string = area,
  ): Promise<void> {
    setLoading(true);

    try {
      const query = new URLSearchParams({
        page: "1",
        pageSize: "50",
      });

      if (nextSearch.trim()) {
        query.set("search", nextSearch.trim());
      }

      if (nextArea) {
        query.set("area", nextArea);
      }

      const extra = filterQuery(nextFilter);
      if (extra) {
        query.set(extra[0], extra[1]);
      }

      const [list, summary] = await Promise.all([
        requestJson<ProjectListResponse>(
          `/api/v1/projects?${query.toString()}`,
        ),
        requestJson<ProjectMetrics>("/api/v1/projects/summary"),
      ]);

      setProjects(list);
      setMetrics(normalizeProjectMetrics(summary));
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible actualizar los proyectos.",
      });
    } finally {
      setLoading(false);
    }
  }

  function openCreate(): void {
    if (templates.length === 0) {
      setAlert({
        tone: "danger",
        message:
          "No hay plantillas publicadas disponibles. Publica una plantilla antes de crear el proyecto.",
      });
      return;
    }

    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  async function openEdit(project: ProjectSummary): Promise<void> {
    setLoading(true);

    try {
      const detail = await requestJson<ProjectDetail>(
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
      );

      setEditing(detail);
      setForm({
        title: detail.title,
        requestingArea: detail.requestingArea,
        description: detail.description ?? "",
        templateId: detail.template?.id ?? "",
        status: detail.status,
        activityState: detail.activityState,
      });
      setModalOpen(true);
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible abrir el proyecto.",
      });
    } finally {
      setLoading(false);
    }
  }

  function closeModal(): void {
    setModalOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
  }

  async function saveProject(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);

    try {
      if (editing) {
        const body: UpdateProjectRequest = {
          title: form.title,
          requestingArea: form.requestingArea,
          description: form.description || null,
          ...(form.activityState !== editing.activityState
            ? { activityState: form.activityState }
            : {}),
        };

        if (
          body.activityState === "DELETED" &&
          !(await confirm({
            title: "Marcar proyecto como eliminado",
            message: `Se marcará ${editing.code} · ${editing.title} como eliminado. No se borra ningún dato y se puede reactivar desde «Ver / editar».`,
            confirmLabel: "Marcar como eliminado",
            destructive: true,
          }))
        ) {
          setSaving(false);
          return;
        }

        await requestJson<ProjectDetail>(
          `/api/v1/projects/${encodeURIComponent(editing.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
        );

        setAlert({
          tone: "success",
          message: "Proyecto actualizado correctamente.",
        });
      } else {
        const body: CreateProjectRequest = {
          title: form.title,
          requestingArea: form.requestingArea,
          description: form.description || null,
          templateId: form.templateId,
        };

        await requestJson<ProjectDetail>("/api/v1/projects", {
          method: "POST",
          body: JSON.stringify(body),
        });

        setAlert({
          tone: "success",
          message: "Proyecto creado correctamente.",
        });
      }

      closeModal();
      await reload();
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible guardar el proyecto.",
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteProject(project: ProjectSummary): Promise<void> {
    if (
      !(await confirm({
        title: "Marcar proyecto como eliminado",
        message: `Se marcará ${project.code} · ${project.title} como eliminado.\n\nNo se borra ningún dato: el proyecto, sus fuentes y documentos se conservan y puedes reactivarlo desde «Ver / editar».`,
        confirmLabel: "Marcar como eliminado",
        destructive: true,
      }))
    ) {
      return;
    }

    setLoading(true);
    try {
      await requestJson<ProjectDetail>(
        `/api/v1/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ activityState: "DELETED" }),
        },
      );
      setAlert({
        tone: "success",
        message: `Proyecto ${project.code} marcado como eliminado. Puedes reactivarlo desde «Ver / editar».`,
      });
      setSelectedProjectId(null);
      await reload();
    } catch (error) {
      setAlert({
        tone: "danger",
        message:
          error instanceof Error
            ? error.message
            : "No fue posible eliminar el proyecto.",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleSearchChange(value: string): void {
    setSearch(value);

    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = window.setTimeout(() => {
      searchTimeoutRef.current = null;
      void reload(value, filter);
    }, 250);
  }

  function handleAreaChange(nextArea: string): void {
    setArea(nextArea);
    void reload(search, filter, nextArea);
  }

  function handleFilterChange(nextFilter: ProjectFilter): void {
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    setFilter(nextFilter);
    void reload(search, nextFilter);
  }

  function clearFilters(): void {
    if (searchTimeoutRef.current !== null) {
      window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    }

    setSearch("");
    setFilter("ACTIVE");
    setArea("");
    setSort("CREATED_DESC");
    void reload("", "ACTIVE", "");
  }

  return (
    <section className="rq-projects-workspace">
      {alert ? (
        <div
          className="rq-project-alert"
          data-tone={alert.tone}
          role={alert.tone === "danger" ? "alert" : "status"}
        >
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

      <section className="rq-module-commandbar rq-projects-commandbar">
        <RqKpiGrid label="Resumen de proyectos">
          <RqKpiCard
            description="Activos / eliminados"
            icon={<WorkspaceKpiIcon name="projects" />}
            title="Proyectos"
            value={`${metrics.active} / ${metrics.deleted}`}
          />
          <RqKpiCard
            description="Sin iniciar"
            icon={<WorkspaceKpiIcon name="drafts" />}
            title="Borradores"
            value={String(metrics.draft)}
          />
          <RqKpiCard
            description="En curso / completados"
            icon={<WorkspaceKpiIcon name="progress" />}
            title="Avance"
            value={`${metrics.inProgress} / ${metrics.completed}`}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={loading}
            onClick={openCreate}
            tone="affirmative"
          >
            Nuevo proyecto
          </RqActionButton>
          <div className="rq-projects-menu">
            <button
              aria-controls="rq-projects-menu-panel"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Más acciones del proyecto seleccionado"
              className="rq-projects-menu__trigger"
              disabled={loading}
              onClick={() => setMenuOpen((current) => !current)}
              title="Más acciones"
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="20"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
                width="20"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>
            {menuOpen ? (
              <div
                className="rq-projects-menu__panel"
                id="rq-projects-menu-panel"
                role="menu"
              >
                <button
                  disabled={!selectedProject}
                  onClick={() => {
                    setMenuOpen(false);
                    if (!selectedProject) return;
                    router.push(
                      `/workspace/projects/${encodeURIComponent(selectedProject.id)}/discussion`,
                    );
                  }}
                  role="menuitem"
                  title={selectedProject ? undefined : "Selecciona un proyecto"}
                  type="button"
                >
                  Discusión
                </button>
                <button
                  disabled={!selectedProject}
                  onClick={() => {
                    setMenuOpen(false);
                    if (!selectedProject) return;
                    router.push(
                      `/workspace/sources?projectId=${encodeURIComponent(selectedProject.id)}`,
                    );
                  }}
                  role="menuitem"
                  title={selectedProject ? undefined : "Selecciona un proyecto"}
                  type="button"
                >
                  Fuentes
                </button>
                <button
                  data-rq-danger="true"
                  disabled={
                    !selectedProject ||
                    selectedProject.activityState === "DELETED"
                  }
                  onClick={() => {
                    setMenuOpen(false);
                    if (selectedProject) void deleteProject(selectedProject);
                  }}
                  role="menuitem"
                  title={selectedProject ? undefined : "Selecciona un proyecto"}
                  type="button"
                >
                  Eliminar
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </section>

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
            aria-label="Buscar proyecto por código o título"
            id="project-search"
            name="project-search"
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder="Código, título"
            type="search"
            value={search}
          />
        </label>

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado"
            id="project-status"
            name="project-status"
            onChange={(event) =>
              handleFilterChange(event.target.value as ProjectFilter)
            }
            value={filter}
          >
            {ACTIVITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <optgroup label="Etapa">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>

        <label className="rq-projects-filter">
          <span>Área:</span>
          <select
            aria-label="Área solicitante"
            id="project-area-filter"
            name="project-area-filter"
            onChange={(event) => handleAreaChange(event.target.value)}
            value={area}
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
            id="project-sort"
            name="project-sort"
            onChange={(event) => setSort(event.target.value as ProjectSort)}
            value={sort}
          >
            <option value="CREATED_DESC">Fecha de creación</option>
            <option value="CREATED_ASC">Creación: más antigua</option>
            <option value="UPDATED_DESC">Última actualización</option>
            <option value="TITLE_ASC">Nombre: A a Z</option>
            <option value="TITLE_DESC">Nombre: Z a A</option>
            <option value="CODE_ASC">Código</option>
          </select>
        </label>

        <RqActionButton
          disabled={loading}
          onClick={clearFilters}
          tone="secondary"
          type="button"
        >
          Limpiar
        </RqActionButton>
      </form>

      <div className="rq-projects-list" id="proyectos">
        {projects.items.length === 0 ? (
          <RqEmptyState
            title="Sin proyectos para mostrar"
            description="Crea el primer proyecto o ajusta los filtros de búsqueda."
          />
        ) : (
          <div className="rq-project-card-grid">
            {sortedProjects.map((project) => {
              const badge = projectBadge(project);
              return (
                <article
                  className="rq-project-card"
                  data-activity={project.activityState}
                  data-selected={project.id === selectedProjectId}
                  key={project.id}
                >
                  <button
                    aria-label={`Seleccionar proyecto ${project.code}: ${project.title}`}
                    aria-pressed={project.id === selectedProjectId}
                    className="rq-project-card__selector"
                    onClick={() => setSelectedProjectId(project.id)}
                    type="button"
                  />
                  <header className="rq-project-card__header">
                    <span className="rq-project-card__code">
                      {project.code}
                    </span>
                    <RqStatusBadge tone={badge.tone}>
                      {badge.label}
                    </RqStatusBadge>
                  </header>
                  <h3>{project.title}</h3>
                  {project.description ? (
                    <p className="rq-project-card__description">
                      {project.description}
                    </p>
                  ) : null}
                  <div className="rq-project-card__tags">
                    <span className="rq-project-card__area">
                      <AreaIcon
                        color={
                          areaStyles.get(project.requestingArea)?.[1] ?? null
                        }
                        name={
                          areaStyles.get(project.requestingArea)?.[0] ?? null
                        }
                        size={14}
                      />
                      {project.requestingArea}
                    </span>
                    {project.template ? (
                      <span>
                        {project.template.name} · {project.template.version}
                      </span>
                    ) : null}
                  </div>
                  <footer className="rq-project-card__footer">
                    <div className="rq-project-card__metadata">
                      <span>{project.participantCount} participante(s)</span>
                      <span>Creado {formatDate(project.createdAt)}</span>
                    </div>
                    <div className="rq-project-card__actions">
                      <RqActionButton
                        className="rq-row-open"
                        compact
                        data-rq-project-action="view"
                        disabled={loading}
                        onClick={() => {
                          setSelectedProjectId(project.id);
                          void openEdit(project);
                        }}
                        tone="secondary"
                      >
                        Abrir
                      </RqActionButton>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {modalOpen ? (
        <div
          className="rq-project-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !saving) closeModal();
          }}
        >
          <section
            aria-labelledby="project-modal-title"
            aria-modal="true"
            className="rq-project-modal rq-project-modal--form"
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>{editing ? editing.code : "Nuevo proyecto"}</span>
                <h2 id="project-modal-title">
                  {editing ? "Editar proyecto" : "Crear proyecto"}
                </h2>
              </div>
              <button
                aria-label="Cerrar"
                disabled={saving}
                onClick={closeModal}
                type="button"
              >
                ×
              </button>
            </header>

            <form className="rq-project-form" onSubmit={saveProject}>
              <div className="rq-project-form__body">
                <div className="rq-field">
                  <label htmlFor="project-title">Nombre del proyecto</label>
                  <input
                    autoFocus
                    id="project-title"
                    maxLength={200}
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
                  <label htmlFor="project-area">Área solicitante</label>
                  <select
                    id="project-area"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        requestingArea: event.target.value,
                      }))
                    }
                    required
                    value={form.requestingArea}
                  >
                    <option value="">Selecciona un área</option>
                    {[
                      ...new Set([
                        ...areaOptions,
                        ...(form.requestingArea ? [form.requestingArea] : []),
                      ]),
                    ].map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  {areaOptions.length === 0 ? (
                    <small>
                      Aún no hay áreas: agrégalas en Configuración → Parámetros
                      → Área.
                    </small>
                  ) : null}
                </div>

                {editing ? (
                  <>
                    <div className="rq-field">
                      <label>Plantilla</label>
                      <div className="rq-project-template-readonly">
                        {editing.template ? (
                          <>
                            <strong>{editing.template.name}</strong>
                            <span>
                              {editing.template.code} ·{" "}
                              {editing.template.version}
                            </span>
                          </>
                        ) : (
                          <span>Proyecto anterior sin plantilla asignada</span>
                        )}
                      </div>
                    </div>
                    <div className="rq-field">
                      <label>Etapa (automática)</label>
                      <div className="rq-project-status-readonly">
                        <RqStatusBadge
                          tone={
                            projectBadge({
                              status: form.status,
                              activityState: "ACTIVE",
                            }).tone
                          }
                        >
                          {statusLabel(form.status)}
                        </RqStatusBadge>
                        <span>{statusDescription(form.status)}</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rq-field rq-project-form__wide">
                    <label htmlFor="project-template">
                      Plantilla publicada
                    </label>
                    <select
                      id="project-template"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          templateId: event.target.value,
                        }))
                      }
                      required
                      value={form.templateId}
                    >
                      <option value="">Selecciona una plantilla</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name} — {template.version}
                        </option>
                      ))}
                    </select>
                    <small>
                      El proyecto conservará esta versión exacta como
                      referencia.
                    </small>
                  </div>
                )}

                {editing ? (
                  <div className="rq-field rq-project-form__wide">
                    <label id="project-activity-label">
                      Situación del proyecto
                    </label>
                    <div
                      aria-labelledby="project-activity-label"
                      className="rq-project-segmented"
                      role="radiogroup"
                    >
                      {(
                        Object.keys(ACTIVITY_LABEL) as ProjectActivityState[]
                      ).map((value) => (
                        <button
                          aria-checked={form.activityState === value}
                          data-rq-activity={value}
                          key={value}
                          onClick={() =>
                            setForm((current) => ({
                              ...current,
                              activityState: value,
                            }))
                          }
                          role="radio"
                          type="button"
                        >
                          {ACTIVITY_LABEL[value]}
                        </button>
                      ))}
                    </div>
                    <small>
                      {form.activityState === "DELETED"
                        ? "Eliminado no borra datos: elige «Activo» para reactivarlo."
                        : form.activityState === "PAUSED"
                          ? "Pausado conserva la etapa y los datos; elige «Activo» para continuar."
                          : "Activo: el proyecto sigue su flujo normal."}
                    </small>
                  </div>
                ) : null}

                <div className="rq-field rq-project-form__wide rq-project-form__description">
                  <label htmlFor="project-description">Descripción</label>
                  <textarea
                    id="project-description"
                    maxLength={2000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    rows={3}
                    value={form.description}
                  />
                  <small>{form.description.length}/2000</small>
                </div>

                {editing ? (
                  <div className="rq-project-form__metadata rq-project-form__wide">
                    <span>
                      <strong>Participantes</strong>
                      {editing.participantCount}
                    </span>
                    <span>
                      <strong>Creación</strong>
                      {formatDate(editing.createdAt)}
                    </span>
                    <span>
                      <strong>Actualización</strong>
                      {formatDate(editing.updatedAt)}
                    </span>
                  </div>
                ) : null}
              </div>

              <footer className="rq-project-modal__actions">
                <RqActionButton
                  disabled={saving}
                  onClick={closeModal}
                  tone="secondary"
                >
                  Cancelar
                </RqActionButton>
                <RqActionButton
                  disabled={
                    saving ||
                    form.title.trim().length < 3 ||
                    form.requestingArea.trim().length < 2
                  }
                  tone="affirmative"
                  type="submit"
                >
                  {saving
                    ? "Guardando…"
                    : editing
                      ? "Actualizar"
                      : "Crear proyecto"}
                </RqActionButton>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
