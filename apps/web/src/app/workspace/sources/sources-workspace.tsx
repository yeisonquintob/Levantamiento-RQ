"use client";

import type { DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CreateTextSourceRequest,
  ProjectListResponse,
  ProjectStatus,
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

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const FILE_ACCEPT = ".pdf,.docx,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp";

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
  return status === "ACTIVE" ? "Activa" : "Eliminada";
}

function projectStatusLabel(status: ProjectStatus): string {
  if (status === "IN_PROGRESS") return "En elaboración";
  if (status === "VALIDATION") return "En validación";
  if (status === "APPROVED") return "Aprobado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function projectStageLabel(status: ProjectStatus): string {
  if (status === "IN_PROGRESS") return "Carga de datos y fuentes";
  if (status === "VALIDATION") return "Revisión del borrador";
  if (status === "APPROVED") return "Documento aprobado";
  if (status === "ARCHIVED") return "Proyecto archivado";
  return "Título y encabezado";
}

function processingLabel(status: SourceProcessingStatus): string {
  if (status === "READY") return "Lista";
  if (status === "PROCESSING") return "Procesando";
  if (status === "FAILED") return "Con error";
  return "Pendiente";
}

function processingTone(
  status: SourceProcessingStatus,
): "success" | "danger" | "pending" | "process" {
  if (status === "READY") return "success";
  if (status === "PROCESSING") return "process";
  if (status === "FAILED") return "danger";
  return "pending";
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

  const response = await fetch(`${GATEWAY_URL}${path}`, {
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
  const [processingStatus, setProcessingStatus] = useState<
    "" | SourceProcessingStatus
  >("");
  const [status, setStatus] = useState<SourceStatus>("ACTIVE");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDetail | null>(null);
  const [creationMode, setCreationMode] = useState<CreationMode>("TEXT");
  const [form, setForm] = useState<SourceFormState>(EMPTY_FORM);
  const [selectedFiles, setSelectedFiles] = useState<SelectedSourceFile[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [batchProcessing, setBatchProcessing] =
    useState<BatchProcessingMode | null>(null);
  const [dragActive, setDragActive] = useState(false);
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
  const eligibleVisibleSourceIds = useMemo(
    () =>
      sources.items
        .filter(
          (source) =>
            source.sourceType === "FILE" &&
            source.status === "ACTIVE" &&
            source.processingStatus !== "PROCESSING",
        )
        .map((source) => source.id),
    [sources.items],
  );
  const allEligibleVisibleSelected =
    eligibleVisibleSourceIds.length > 0 &&
    eligibleVisibleSourceIds.every((sourceId) =>
      selectedSourceIds.has(sourceId),
    );

  const loadSources = useCallback(
    async (
      nextProjectId: string,
      nextSearch: string,
      nextType: "" | SourceType,
      nextProcessingStatus: "" | SourceProcessingStatus,
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
    void loadSources(projectId, "", "", "", "ACTIVE");
  }, [loadSources, projectId]);

  useEffect(() => {
    const visibleIds = new Set(sources.items.map((source) => source.id));

    setSelectedSourceIds((current) => {
      const next = new Set(
        [...current].filter((sourceId) => visibleIds.has(sourceId)),
      );

      return next.size === current.size ? current : next;
    });
  }, [sources.items]);

  useEffect(() => {
    if (!alert) return;

    const timeout = window.setTimeout(() => setAlert(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [alert]);

  function changeProject(nextProjectId: string): void {
    setProjectId(nextProjectId);
    setSearch("");
    setSourceType("");
    setProcessingStatus("");
    setStatus("ACTIVE");
    setSelectedSourceIds(new Set());

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
    const next = Array.from(files)
      .slice(0, 20)
      .map((file) => ({
        key: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        classification: "OTHER" as const,
        description: "",
      }));

    setSelectedFiles(next);
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

  async function processBatch(): Promise<void> {
    if (!projectId || batchProcessing || selectedSourceIds.size === 0) return;

    const selectedIds = [...selectedSourceIds];
    const confirmed = window.confirm(
      `Se procesarán o reprocesarán las ${selectedIds.length} fuente(s) seleccionada(s).`,
    );

    if (!confirmed) return;

    setBatchProcessing("SELECTED");

    try {
      const result = await requestJson<SourceBatchProcessingResponse>(
        `/api/v1/projects/${encodeURIComponent(projectId)}/sources/process`,
        {
          method: "POST",
          body: JSON.stringify({ sourceIds: selectedIds }),
        },
      );
      const summary =
        `Procesadas: ${result.enqueued}. ` +
        `Omitidas: ${result.skipped}. Fallidas: ${result.failed}.`;

      setSelectedSourceIds(new Set());
      setAlert({
        tone:
          result.failed > 0
            ? result.enqueued > 0
              ? "information"
              : "danger"
            : result.enqueued > 0
              ? "success"
              : "information",
        message: summary,
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
            : "No fue posible iniciar el procesamiento.",
      });
    } finally {
      setBatchProcessing(null);
    }
  }

  async function archiveSource(source: SourceSummary): Promise<void> {
    if (
      !window.confirm(
        `¿Eliminar la fuente "${source.title}" de la vista activa? Se conservará para trazabilidad y podrás consultarla con el filtro Eliminadas.`,
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
        message: "La fuente fue eliminada de la vista activa.",
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
            : "No fue posible eliminar la fuente.",
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
        : form.title.trim().length >= 3 && form.content.trim().length >= 1);

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

      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de fuentes">
          <RqKpiCard
            description="Registradas"
            icon="F"
            title="Fuentes"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Archivos almacenados"
            icon="A"
            title="Archivos"
            value={String(metrics.files)}
          />
          <RqKpiCard
            description="Notas, conversaciones y transcripciones"
            icon="T"
            title="Textuales"
            value={String(
              metrics.notes + metrics.conversations + metrics.transcripts,
            )}
          />
          <RqKpiCard
            description="Disponibles para análisis"
            icon="L"
            title="Listas"
            value={String(metrics.ready)}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={
              loading ||
              batchProcessing !== null ||
              selectedSourceIds.size === 0
            }
            onClick={() => void processBatch()}
            tone="operation"
          >
            {batchProcessing ? "Procesando..." : "Procesar"}
          </RqActionButton>
          <RqActionButton
            disabled={loading || batchProcessing !== null || !projectId}
            onClick={openCreate}
            tone="affirmative"
          >
            Nueva fuente
          </RqActionButton>
        </div>
      </section>

      <section className="rq-source-project-card">
        <div className="rq-field">
          <label htmlFor="source-project">Proyecto de trabajo</label>
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

        <div className="rq-source-project-card__stage">
          <span>Etapa del proyecto</span>
          <strong>
            {selectedProject
              ? projectStageLabel(selectedProject.status)
              : "Sin etapa disponible"}
          </strong>
          <small>
            {selectedProject
              ? `Estado: ${projectStatusLabel(selectedProject.status)}`
              : "Selecciona un proyecto para consultar su avance"}
          </small>
        </div>
      </section>

      <form
        className="rq-filter-bar rq-source-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void loadSources(
            projectId,
            search,
            sourceType,
            processingStatus,
            status,
          );
        }}
      >
        <div className="rq-field">
          <label htmlFor="source-search">Buscar fuente</label>
          <input
            id="source-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título, contenido o archivo"
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
          <label htmlFor="source-processing">Procesamiento</label>
          <select
            id="source-processing"
            onChange={(event) =>
              setProcessingStatus(
                event.target.value as "" | SourceProcessingStatus,
              )
            }
            value={processingStatus}
          >
            <option value="">Todos</option>
            <option value="PENDING">Pendiente</option>
            <option value="PROCESSING">Procesando</option>
            <option value="READY">Lista</option>
            <option value="FAILED">Con error</option>
          </select>
        </div>

        <div className="rq-field">
          <label htmlFor="source-status">Estado</label>
          <select
            id="source-status"
            onChange={(event) => setStatus(event.target.value as SourceStatus)}
            value={status}
          >
            <option value="ACTIVE">Activas</option>
            <option value="ARCHIVED">Eliminadas</option>
          </select>
        </div>

        <div className="rq-filter-bar__actions">
          <RqActionButton
            disabled={loading || !projectId}
            tone="consult"
            type="submit"
          >
            {loading ? "Consultando…" : "Buscar"}
          </RqActionButton>
          <RqActionButton
            disabled={loading || !projectId}
            onClick={() => {
              setSearch("");
              setSourceType("");
              setProcessingStatus("");
              setStatus("ACTIVE");
              void loadSources(projectId, "", "", "", "ACTIVE");
            }}
            tone="secondary"
          >
            Limpiar
          </RqActionButton>
        </div>
      </form>

      <RqTableShell
        count={sources.totalItems}
        description="Fuentes textuales y archivos almacenados en Azurite, con contenido extraído y trazabilidad por proyecto."
        title="Fuentes"
      >
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
              <th scope="col">Tipo</th>
              <th scope="col">Clasificación</th>
              <th scope="col">Archivo</th>
              <th scope="col">Procesamiento</th>
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
              sources.items.map((source) => (
                <tr key={source.id}>
                  <td>
                    {source.sourceType === "FILE" &&
                    source.status === "ACTIVE" &&
                    source.processingStatus !== "PROCESSING" ? (
                      <input
                        aria-label={`Seleccionar ${source.title}`}
                        checked={selectedSourceIds.has(source.id)}
                        disabled={loading || batchProcessing !== null}
                        onChange={() => toggleSourceSelection(source.id)}
                        type="checkbox"
                      />
                    ) : (
                      <span aria-hidden="true">—</span>
                    )}
                  </td>
                  <td>
                    <div className="rq-source-table__title">
                      <strong>{source.title}</strong>
                      <span>
                        {source.description ||
                          source.contentPreview ||
                          source.processingMessage ||
                          "Sin descripción"}
                      </span>
                    </div>
                  </td>
                  <td>{sourceTypeLabel(source.sourceType)}</td>
                  <td>{classificationLabel(source.classification)}</td>
                  <td>{fileDescription(source)}</td>
                  <td>
                    <RqStatusBadge
                      tone={processingTone(source.processingStatus)}
                    >
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
                        onClick={() => void openDetail(source)}
                        tone="operation"
                      >
                        Editar
                      </RqActionButton>
                      {source.sourceType === "FILE" ? (
                        <RqActionButton
                          compact
                          disabled={loading}
                          onClick={() => void downloadSource(source)}
                          tone="consult"
                        >
                          Descargar
                        </RqActionButton>
                      ) : null}
                      {source.status === "ACTIVE" ? (
                        <RqActionButton
                          compact
                          disabled={loading}
                          onClick={() => void archiveSource(source)}
                          tone="danger"
                        >
                          Eliminar
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
        <strong>Paso 13 completo</strong>
        <span>
          Puedes registrar fuentes textuales o cargar varios archivos PDF, Word,
          Excel, CSV, TXT e imágenes. Los archivos quedan en Azurite, se validan
          por firma, se protegen contra duplicados y se procesan manualmente
          para preparar su contenido para el análisis posterior.
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
                <span>{selectedProject?.code ?? "Fuente del proyecto"}</span>
                <h2 id="source-modal-title">
                  {editing
                    ? editing.sourceType === "FILE"
                      ? "Editar archivo"
                      : "Editar fuente"
                    : "Nueva fuente"}
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

            {!editing ? (
              <div className="rq-source-mode-tabs" role="tablist">
                <button
                  aria-selected={creationMode === "TEXT"}
                  data-active={creationMode === "TEXT"}
                  onClick={() => setCreationMode("TEXT")}
                  role="tab"
                  type="button"
                >
                  Fuente textual
                </button>
                <button
                  aria-selected={creationMode === "FILES"}
                  data-active={creationMode === "FILES"}
                  onClick={() => setCreationMode("FILES")}
                  role="tab"
                  type="button"
                >
                  Subir archivos
                </button>
              </div>
            ) : null}

            <form className="rq-project-form" onSubmit={saveSource}>
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
                      o selecciónalos desde tu equipo. Máximo 20 archivos por
                      operación.
                    </span>
                    <label htmlFor="source-files">Seleccionar archivos</label>
                    <input
                      accept={FILE_ACCEPT}
                      id="source-files"
                      multiple
                      onChange={(event) =>
                        selectFiles(event.target.files ?? [])
                      }
                      type="file"
                    />
                    <small>
                      PDF, DOCX, XLSX, TXT, CSV, PNG, JPG, JPEG y WEBP.
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
                          {fileDetail.pageCount ?? fileDetail.sheetCount ?? "—"}
                        </strong>
                      </div>
                    </div>
                  ) : (
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
                  )}

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

                  {fileDetail ? (
                    <>
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
                  ) : (
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
                  )}
                </>
              )}

              <footer className="rq-project-modal__actions">
                {fileDetail ? (
                  <RqActionButton
                    disabled={saving}
                    onClick={() => void downloadSource(fileDetail)}
                    tone="consult"
                  >
                    Descargar
                  </RqActionButton>
                ) : null}
                <RqActionButton
                  disabled={saving}
                  onClick={closeModal}
                  tone="secondary"
                >
                  Cancelar
                </RqActionButton>
                <RqActionButton
                  disabled={!canSubmit}
                  tone="affirmative"
                  type="submit"
                >
                  {saving
                    ? creationMode === "FILES" && !editing
                      ? "Cargando…"
                      : "Guardando…"
                    : editing
                      ? "Actualizar"
                      : creationMode === "FILES"
                        ? "Cargar archivos"
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
