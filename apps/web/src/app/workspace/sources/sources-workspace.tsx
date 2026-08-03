"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CreateTextSourceRequest,
  ProjectListResponse,
  SourceDetail,
  SourceListResponse,
  SourceMetrics,
  SourceStatus,
  SourceSummary,
  SourceType,
  TextSourceType,
  UpdateSourceRequest,
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

interface SourcesWorkspaceProps {
  initialProjects?: ProjectListResponse;
  initialProjectId?: string;
  initialError?: string | null;
}

interface SourceFormState {
  sourceType: TextSourceType;
  title: string;
  content: string;
}

interface AlertState {
  tone: "success" | "danger" | "information";
  message: string;
}

const EMPTY_FORM: SourceFormState = {
  sourceType: "NOTE",
  title: "",
  content: "",
};

function sourceTypeLabel(sourceType: SourceType): string {
  if (sourceType === "FILE") return "Archivo";

  return (
    TYPE_OPTIONS.find((option) => option.value === sourceType)?.label ??
    sourceType
  );
}

function sourceStatusLabel(status: SourceStatus): string {
  return status === "ACTIVE" ? "Activa" : "Archivada";
}

function processingLabel(status: SourceSummary["processingStatus"]): string {
  if (status === "READY") return "Lista";
  if (status === "FAILED") return "Con error";
  return "Pendiente";
}

function processingTone(
  status: SourceSummary["processingStatus"],
): "success" | "danger" | "pending" {
  if (status === "READY") return "success";
  if (status === "FAILED") return "danger";
  return "pending";
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

export function SourcesWorkspace({
  initialProjects = EMPTY_PROJECTS,
  initialProjectId,
  initialError = null,
}: SourcesWorkspaceProps) {
  const firstProjectId = initialProjects.items[0]?.id ?? "";
  const resolvedInitialProjectId =
    initialProjectId &&
    initialProjects.items.some((project) => project.id === initialProjectId)
      ? initialProjectId
      : firstProjectId;

  const [projectId, setProjectId] = useState(resolvedInitialProjectId);
  const [sources, setSources] = useState<SourceListResponse>(EMPTY_LIST);
  const [metrics, setMetrics] = useState<SourceMetrics>(EMPTY_METRICS);
  const [search, setSearch] = useState("");
  const [sourceType, setSourceType] = useState<"" | SourceType>("");
  const [status, setStatus] = useState<SourceStatus>("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDetail | null>(null);
  const [form, setForm] = useState<SourceFormState>(EMPTY_FORM);
  const [alert, setAlert] = useState<AlertState | null>(
    initialError
      ? {
          tone: "danger",
          message: initialError,
        }
      : null,
  );

  const selectedProject = useMemo(
    () => initialProjects.items.find((project) => project.id === projectId),
    [initialProjects.items, projectId],
  );

  const loadSources = useCallback(
    async (
      nextProjectId: string,
      nextSearch: string,
      nextType: "" | SourceType,
      nextStatus: SourceStatus,
    ): Promise<void> => {
      if (!nextProjectId) {
        setSources(EMPTY_LIST);
        setMetrics(EMPTY_METRICS);
        return;
      }

      setLoading(true);

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
        setAlert({
          tone: "danger",
          message:
            error instanceof Error
              ? error.message
              : "No fue posible cargar las fuentes.",
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadSources(projectId, "", "", "ACTIVE");
  }, [loadSources, projectId]);

  useEffect(() => {
    if (!alert) return;

    const timeout = window.setTimeout(() => setAlert(null), 6000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  function changeProject(nextProjectId: string): void {
    setProjectId(nextProjectId);
    setSearch("");
    setSourceType("");
    setStatus("ACTIVE");

    const url = new URL(window.location.href);

    if (nextProjectId) {
      url.searchParams.set("projectId", nextProjectId);
    } else {
      url.searchParams.delete("projectId");
    }

    window.history.replaceState(null, "", url);
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
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  async function openEdit(source: SourceSummary): Promise<void> {
    setLoading(true);

    try {
      const detail = await requestJson<SourceDetail>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(source.id)}`,
      );

      if (detail.sourceType === "FILE") {
        setAlert({
          tone: "information",
          message:
            "La edición de archivos se habilitará con el almacenamiento de documentos.",
        });
        return;
      }

      setEditing(detail);
      setForm({
        sourceType: detail.sourceType,
        title: detail.title,
        content: detail.content ?? "",
      });
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
    setForm(EMPTY_FORM);
  }

  async function saveSource(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!projectId) return;

    setSaving(true);

    try {
      if (editing) {
        const body: UpdateSourceRequest = {
          title: form.title,
          content: form.content,
        };

        await requestJson<SourceDetail>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/sources/${encodeURIComponent(editing.id)}`,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
        );
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

      const wasEditing = Boolean(editing);

      setModalOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setAlert({
        tone: "success",
        message: wasEditing
          ? "La fuente fue actualizada."
          : "La fuente fue creada.",
      });

      await loadSources(projectId, search, sourceType, status);
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

  async function archiveSource(source: SourceSummary): Promise<void> {
    if (
      !window.confirm(
        `¿Archivar la fuente "${source.title}"? Podrás consultarla usando el filtro Archivadas.`,
      )
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
        message: "La fuente fue archivada.",
      });

      await loadSources(projectId, search, sourceType, status);
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

  return (
    <>
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

      <RqPageHero
        eyebrow="Sources Service activo"
        title="Fuentes del levantamiento"
        description="Registra notas, conversaciones y transcripciones asociadas a cada proyecto, con trazabilidad y control de acceso."
        actions={
          <RqActionButton
            disabled={loading || !projectId}
            onClick={openCreate}
            tone="affirmative"
          >
            Nueva fuente
          </RqActionButton>
        }
      />

      <section className="rq-source-project-card">
        <div className="rq-field">
          <label htmlFor="source-project">Proyecto</label>
          <select
            id="source-project"
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
        </div>

        <div className="rq-source-project-card__summary">
          <span>Proyecto seleccionado</span>
          <strong>
            {selectedProject
              ? `${selectedProject.code} · ${selectedProject.title}`
              : "Sin proyecto seleccionado"}
          </strong>
          <small>
            {selectedProject?.requestingArea ?? "Selecciona un proyecto"}
          </small>
        </div>
      </section>

      <RqKpiGrid label="Resumen de fuentes">
        <RqKpiCard
          description="Registradas"
          icon="F"
          title="Fuentes"
          value={String(metrics.total)}
        />
        <RqKpiCard
          description="Contenido directo"
          icon="N"
          title="Notas"
          value={String(metrics.notes)}
        />
        <RqKpiCard
          description="Conversaciones y transcripciones"
          icon="T"
          title="Registros textuales"
          value={String(metrics.conversations + metrics.transcripts)}
        />
        <RqKpiCard
          description="Disponibles para análisis"
          icon="L"
          title="Listas"
          value={String(metrics.ready)}
        />
      </RqKpiGrid>

      <form
        className="rq-filter-bar rq-source-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void loadSources(projectId, search, sourceType, status);
        }}
      >
        <div className="rq-field">
          <label htmlFor="source-search">Buscar fuente</label>
          <input
            id="source-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título o contenido"
            type="search"
            value={search}
          />
        </div>

        <div className="rq-field">
          <label htmlFor="source-type">Tipo</label>
          <select
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
        </div>

        <div className="rq-field">
          <label htmlFor="source-status">Estado</label>
          <select
            id="source-status"
            onChange={(event) =>
              setStatus(event.target.value as SourceStatus)
            }
            value={status}
          >
            <option value="ACTIVE">Activas</option>
            <option value="ARCHIVED">Archivadas</option>
          </select>
        </div>

        <div className="rq-filter-bar__actions">
          <RqActionButton disabled={loading || !projectId} tone="consult" type="submit">
            {loading ? "Consultando…" : "Buscar"}
          </RqActionButton>
          <RqActionButton
            disabled={loading || !projectId}
            onClick={() => {
              setSearch("");
              setSourceType("");
              setStatus("ACTIVE");
              void loadSources(projectId, "", "", "ACTIVE");
            }}
            tone="secondary"
          >
            Limpiar
          </RqActionButton>
        </div>
      </form>

      <RqTableShell
        count={sources.totalItems}
        description="Fuentes almacenadas en RqSourcesDb y vinculadas al proyecto por su identificador externo."
        title="Fuentes"
      >
        <table className="rq-table rq-source-table">
          <thead>
            <tr>
              <th scope="col">Fuente</th>
              <th scope="col">Tipo</th>
              <th scope="col">Procesamiento</th>
              <th scope="col">Estado</th>
              <th scope="col">Actualización</th>
              <th scope="col">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sources.items.length === 0 ? (
              <tr>
                <td colSpan={6}>
                  <RqEmptyState
                    title={
                      projectId
                        ? "Sin fuentes para mostrar"
                        : "Selecciona un proyecto"
                    }
                    description={
                      projectId
                        ? "Registra la primera nota, conversación o transcripción."
                        : "Las fuentes siempre pertenecen a un proyecto accesible."
                    }
                  />
                </td>
              </tr>
            ) : (
              sources.items.map((source) => (
                <tr key={source.id}>
                  <td>
                    <div className="rq-source-table__title">
                      <strong>{source.title}</strong>
                      <span>{source.contentPreview || "Sin vista previa"}</span>
                    </div>
                  </td>
                  <td>{sourceTypeLabel(source.sourceType)}</td>
                  <td>
                    <RqStatusBadge tone={processingTone(source.processingStatus)}>
                      {processingLabel(source.processingStatus)}
                    </RqStatusBadge>
                  </td>
                  <td>
                    <RqStatusBadge
                      tone={source.status === "ACTIVE" ? "success" : "inactive"}
                    >
                      {sourceStatusLabel(source.status)}
                    </RqStatusBadge>
                  </td>
                  <td>{formatDate(source.updatedAt)}</td>
                  <td>
                    <div className="rq-source-table__actions">
                      <RqActionButton
                        compact
                        disabled={loading}
                        onClick={() => void openEdit(source)}
                        tone="operation"
                      >
                        Ver / editar
                      </RqActionButton>
                      {source.status === "ACTIVE" ? (
                        <RqActionButton
                          compact
                          disabled={loading}
                          onClick={() => void archiveSource(source)}
                          tone="danger"
                        >
                          Archivar
                        </RqActionButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </RqTableShell>

      <aside className="rq-foundation-note" role="status">
        <strong>Estado del Paso 13.1</strong>
        <span>
          Sources Service, RqSourcesDb, notas, conversaciones, transcripciones,
          permisos por proyecto, Gateway y vista responsive están integrados.
          La carga binaria de archivos en Azurite se implementará en el Paso
          13.2.
        </span>
      </aside>

      {modalOpen ? (
        <div className="rq-project-modal-backdrop">
          <section
            aria-labelledby="source-modal-title"
            aria-modal="true"
            className="rq-project-modal rq-source-modal"
            role="dialog"
          >
            <header className="rq-project-modal__header">
              <div>
                <span>
                  {selectedProject?.code ?? "Fuente del proyecto"}
                </span>
                <h2 id="source-modal-title">
                  {editing ? "Editar fuente" : "Nueva fuente textual"}
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

            <form className="rq-project-form" onSubmit={saveSource}>
              <div className="rq-field">
                <label htmlFor="source-form-type">Tipo de fuente</label>
                <select
                  disabled={Boolean(editing)}
                  id="source-form-type"
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      sourceType: event.target.value as TextSourceType,
                    }))
                  }
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
                  maxLength={200000}
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
                <small>{form.content.length}/200000</small>
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
                    form.content.trim().length < 1
                  }
                  tone="affirmative"
                  type="submit"
                >
                  {saving
                    ? "Guardando…"
                    : editing
                      ? "Actualizar"
                      : "Crear fuente"}
                </RqActionButton>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
