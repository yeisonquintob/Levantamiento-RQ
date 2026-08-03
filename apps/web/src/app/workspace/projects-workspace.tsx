"use client";

import Link from "next/link";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import type {
  CreateProjectRequest,
  ProjectDetail,
  ProjectListResponse,
  ProjectMetrics,
  ProjectStatus,
  ProjectSummary,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqPageHero,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const EMPTY_METRICS: ProjectMetrics = {
  total: 0,
  draft: 0,
  inProgress: 0,
  validation: 0,
  approved: 0,
  archived: 0,
};

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
  { value: "IN_PROGRESS", label: "En elaboración" },
  { value: "VALIDATION", label: "En validación" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "ARCHIVED", label: "Archivado" },
];

interface ProjectsWorkspaceProps {
  initialList?: ProjectListResponse;
  initialMetrics?: ProjectMetrics;
  initialError?: string | null;
}

interface ProjectFormState {
  title: string;
  requestingArea: string;
  description: string;
  status: ProjectStatus;
}

interface AlertState {
  tone: "success" | "danger" | "information";
  message: string;
}

const EMPTY_FORM: ProjectFormState = {
  title: "",
  requestingArea: "",
  description: "",
  status: "DRAFT",
};

function statusLabel(status: ProjectStatus): string {
  return (
    STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status
  );
}

function statusTone(
  status: ProjectStatus,
): "success" | "process" | "pending" | "inactive" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "IN_PROGRESS") return "process";
  if (status === "VALIDATION") return "pending";
  if (status === "ARCHIVED") return "inactive";
  return "neutral";
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
  initialError = null,
}: ProjectsWorkspaceProps) {
  const [projects, setProjects] = useState<ProjectListResponse>(initialList);
  const [metrics, setMetrics] = useState<ProjectMetrics>(initialMetrics);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"" | ProjectStatus>("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
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

  useEffect(() => {
    if (!alert) return;

    const timeout = window.setTimeout(() => setAlert(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  async function reload(
    nextSearch: string = search,
    nextStatus: "" | ProjectStatus = status,
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

      if (nextStatus) {
        query.set("status", nextStatus);
      }

      const [list, summary] = await Promise.all([
        requestJson<ProjectListResponse>(
          `/api/v1/projects?${query.toString()}`,
        ),
        requestJson<ProjectMetrics>("/api/v1/projects/summary"),
      ]);

      setProjects(list);
      setMetrics(summary);
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
        status: detail.status,
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
          status: form.status,
        };

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

  function clearFilters(): void {
    setSearch("");
    setStatus("");
    void reload("", "");
  }

  return (
    <>
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

      <RqPageHero
        eyebrow="Projects Service activo"
        title="Gestión de proyectos"
        description="Crea y administra los proyectos que agrupan las fuentes, el análisis y el documento de levantamiento."
        actions={
          <RqActionButton
            disabled={loading}
            onClick={openCreate}
            tone="affirmative"
          >
            Nuevo proyecto
          </RqActionButton>
        }
      />

      <RqKpiGrid label="Resumen de proyectos">
        <RqKpiCard
          description="Accesibles"
          icon="P"
          title="Proyectos"
          value={String(metrics.total)}
        />
        <RqKpiCard
          description="Sin iniciar"
          icon="B"
          title="Borradores"
          value={String(metrics.draft)}
        />
        <RqKpiCard
          description="Elaboración y validación"
          icon="E"
          title="En curso"
          value={String(metrics.inProgress + metrics.validation)}
        />
        <RqKpiCard
          description="Finalizados"
          icon="A"
          title="Aprobados"
          value={String(metrics.approved)}
        />
      </RqKpiGrid>

      <form
        className="rq-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void reload();
        }}
      >
        <div className="rq-field">
          <label htmlFor="project-search">Buscar proyecto</label>
          <input
            id="project-search"
            name="project-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, título o área solicitante"
            type="search"
            value={search}
          />
        </div>

        <div className="rq-field">
          <label htmlFor="project-status">Estado</label>
          <select
            id="project-status"
            name="project-status"
            onChange={(event) =>
              setStatus(event.target.value as "" | ProjectStatus)
            }
            value={status}
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="rq-filter-bar__actions">
          <RqActionButton disabled={loading} tone="consult" type="submit">
            {loading ? "Consultando…" : "Buscar"}
          </RqActionButton>
          <RqActionButton
            disabled={loading}
            onClick={clearFilters}
            tone="secondary"
          >
            Limpiar
          </RqActionButton>
        </div>
      </form>

      <div id="proyectos">
        <RqTableShell
          count={projects.totalItems}
          description="Proyectos almacenados en RqProjectsDb y accesibles para el usuario autenticado."
          title="Proyectos"
        >
          <table className="rq-table rq-project-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Proyecto</th>
                <th scope="col">Área solicitante</th>
                <th scope="col">Estado</th>
                <th scope="col">Participantes</th>
                <th scope="col">Actualización</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {projects.items.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <RqEmptyState
                      title="Sin proyectos para mostrar"
                      description="Crea el primer proyecto o ajusta los filtros de búsqueda."
                    />
                  </td>
                </tr>
              ) : (
                projects.items.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.code}</strong>
                    </td>
                    <td>
                      <div className="rq-project-table__title">
                        <strong>{project.title}</strong>
                        <span>{project.description || "Sin descripción"}</span>
                      </div>
                    </td>
                    <td>{project.requestingArea}</td>
                    <td>
                      <RqStatusBadge tone={statusTone(project.status)}>
                        {statusLabel(project.status)}
                      </RqStatusBadge>
                    </td>
                    <td>{project.participantCount}</td>
                    <td>{formatDate(project.updatedAt)}</td>
                    <td>
                      <div className="rq-project-table__actions">
                        <Link
                          className="rq-action rq-action--compact"
                          data-rq-tone="consult"
                          href={`/workspace/sources?projectId=${encodeURIComponent(project.id)}`}
                        >
                          Fuentes
                        </Link>
                        <RqActionButton
                          compact
                          disabled={loading}
                          onClick={() => void openEdit(project)}
                          tone="operation"
                        >
                          Ver / editar
                        </RqActionButton>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </RqTableShell>
      </div>

      <aside className="rq-foundation-note" role="status">
        <strong>Estado del Paso 12</strong>
        <span>
          Projects Service, RqProjectsDb, acceso por participantes, Gateway y
          Workspace están integrados. El botón Fuentes abre la gestión textual
          implementada en el Paso 13.1.
        </span>
      </aside>

      {modalOpen ? (
        <div className="rq-project-modal-backdrop">
          <section
            aria-labelledby="project-modal-title"
            aria-modal="true"
            className="rq-project-modal"
            role="dialog"
          >
            <header className="rq-project-modal__header">
              <div>
                <span>{editing ? editing.code : "Nuevo proyecto"}</span>
                <h2 id="project-modal-title">
                  {editing ? "Editar proyecto" : "Crear proyecto"}
                </h2>
              </div>
              <button
                aria-label="Cerrar ventana"
                disabled={saving}
                onClick={closeModal}
                type="button"
              >
                ×
              </button>
            </header>

            <form className="rq-project-form" onSubmit={saveProject}>
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
                <input
                  id="project-area"
                  maxLength={160}
                  minLength={2}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requestingArea: event.target.value,
                    }))
                  }
                  required
                  value={form.requestingArea}
                />
              </div>

              {editing ? (
                <div className="rq-field">
                  <label htmlFor="project-edit-status">Estado</label>
                  <select
                    id="project-edit-status"
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as ProjectStatus,
                      }))
                    }
                    value={form.status}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="rq-field rq-project-form__description">
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
                  rows={5}
                  value={form.description}
                />
                <small>{form.description.length}/2000</small>
              </div>

              {editing ? (
                <div className="rq-project-form__metadata">
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
    </>
  );
}
