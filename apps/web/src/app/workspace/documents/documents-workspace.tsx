"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

import type {
  AiAnalysisRequestListResponse,
  AiEngine,
  DocumentStatus,
  DocumentVersionSummary,
  ProjectAreaListResponse,
  ProjectListResponse,
  ProjectSummary,
  ProjectStatus,
  RequirementDocumentListResponse,
  RequirementDocumentSummary,
} from "@levantamiento-rq/shared-contracts";
import { PROJECT_STATUS_ORDER } from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";

import { ProjectStatusBadge } from "../project-status-badge";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import { DocumentGenerationCells } from "./document-generation-cells";

import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useConfirm } from "../../confirm-dialog";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

export interface DocumentListItem extends RequirementDocumentSummary {
  versionCount?: number;
  projectCode: string;
  projectTitle: string;
}

export interface DocumentVersionListItem extends DocumentVersionSummary {
  documentId: string;
  documentTitle: string;
  documentArchived: boolean;
  currentVersionNumber: number;
  projectId: string;
  projectCode: string;
  projectTitle: string;
  aiEngines: readonly AiEngine[];
  aiModels: Partial<Record<AiEngine, string>>;
}

interface DocumentsWorkspaceProps {
  initialProjects?: ProjectListResponse;
  initialDocuments?: readonly DocumentListItem[];
  initialVersions?: readonly DocumentVersionListItem[];
  initialProjectId?: string;
  initialError?: string;
}

type DocumentsSort =
  | "CREATED_DESC"
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "TITLE_ASC"
  | "TITLE_DESC"
  | "CODE_ASC";

const DOCUMENT_STATUS_OPTIONS: readonly {
  value: DocumentStatus;
  label: string;
}[] = [
  { value: "DRAFT", label: "Borrador" },
  { value: "IN_REVIEW", label: "En validación" },
  { value: "CHANGES_REQUESTED", label: "Cambios solicitados" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "REJECTED", label: "Rechazado" },
  { value: "ARCHIVED", label: "Archivado" },
];

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Borrador",
  DISCUSSION: "En discusión",
  SOURCES: "En fuentes",
  DOCUMENT_GENERATED: "Documento generado",
  VALIDATION: "En validación",
  APPROVED: "Validación aprobada",
  EXECUTION: "En ejecución",
  COMPLETED: "Completado",
  ARCHIVED: "Archivado",
};

function sameProjectId(left: string, right: string | undefined): boolean {
  return left.toLowerCase() === right?.toLowerCase();
}

function projectOfDocument(
  projects: readonly ProjectSummary[],
  projectId: string,
): ProjectSummary | undefined {
  return projects.find((item) => sameProjectId(item.id, projectId));
}

function documentStatusLabel(status: DocumentStatus): string {
  return (
    DOCUMENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ??
    status
  );
}

function documentStatusTone(
  status: DocumentStatus,
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "APPROVED") return "success";
  if (status === "IN_REVIEW") return "process";
  if (status === "CHANGES_REQUESTED" || status === "REJECTED") return "danger";
  if (status === "ARCHIVED") return "inactive";
  return "pending";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function projectOptionLabel(project: ProjectSummary): string {
  return `${project.code} · ${project.title}`;
}

function documentActionLabel(
  status: DocumentStatus,
  current: boolean,
  archived: boolean,
): string {
  if (archived || status === "ARCHIVED") return "Documento cerrado";
  if (status === "APPROVED") return "Versión cerrada";
  if ((status === "DRAFT" || status === "CHANGES_REQUESTED") && current)
    return status === "CHANGES_REQUESTED" ? "Corregir" : "Abrir editor";
  return "Consultar versión";
}

function documentActionColor(
  status: DocumentStatus,
  current: boolean,
  archived: boolean,
): string {
  if (archived || status === "APPROVED" || status === "ARCHIVED")
    return "closed";
  if (current && (status === "DRAFT" || status === "CHANGES_REQUESTED"))
    return "edit";
  return "consult";
}

function documentUrl(
  documentId: string,
  versionNumber?: number,
  fromAllProjects = false,
): string {
  const query = new URLSearchParams();
  if (versionNumber) query.set("version", String(versionNumber));
  if (fromAllProjects) query.set("from", "all");
  const suffix = query.toString();
  return `/workspace/documents/${encodeURIComponent(documentId)}${suffix ? `?${suffix}` : ""}`;
}

async function responseError(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "La sesión terminó.";
  }
  const text = await response.text();
  try {
    const payload = JSON.parse(text) as {
      detail?: string;
      message?: string | readonly string[];
      correlationId?: string;
    };
    const message =
      typeof payload.detail === "string"
        ? payload.detail
        : typeof payload.message === "string"
          ? payload.message
          : payload.message
            ? [...payload.message].join(" ")
            : "La operación no pudo completarse.";
    return payload.correlationId
      ? `${message} Código de seguimiento: ${payload.correlationId}.`
      : message;
  } catch {
    return text || "La operación no pudo completarse.";
  }
}

async function fetchProjectDocuments(
  project: ProjectSummary,
): Promise<readonly DocumentListItem[]> {
  const response = await fetch(
    `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}/documents`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) throw new Error(await responseError(response));
  const documents = (await response.json()) as RequirementDocumentListResponse;
  return documents.items.map((document) => ({
    ...document,
    projectCode: project.code,
    projectTitle: project.title,
  }));
}

async function fetchDocumentVersions(
  document: DocumentListItem,
): Promise<readonly DocumentVersionListItem[]> {
  const [response, analysesResponse] = await Promise.all([
    fetch(
      `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(document.id)}/versions`,
      { credentials: "include", cache: "no-store" },
    ),
    fetch(
      `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(document.projectId)}/analysis-requests?page=1&pageSize=100`,
      { credentials: "include", cache: "no-store" },
    ),
  ]);
  if (!response.ok) throw new Error(await responseError(response));
  const versions = (await response.json()) as readonly DocumentVersionSummary[];
  const analyses = analysesResponse.ok
    ? ((await analysesResponse.json()) as AiAnalysisRequestListResponse).items
    : [];
  return versions.map((version) => {
    const analysis = analyses.find(
      (item) =>
        item.documentId.toLowerCase() === document.id.toLowerCase() &&
        item.generatedVersionNumber === version.versionNumber,
    );
    return {
      ...version,
      documentId: document.id,
      documentTitle: document.title,
      documentArchived: document.status === "ARCHIVED",
      currentVersionNumber: document.currentVersionNumber,
      projectId: document.projectId,
      projectCode: document.projectCode,
      projectTitle: document.projectTitle,
      aiEngines: analysis?.engines ?? [],
      aiModels: analysis?.models ?? {},
    };
  });
}

export function DocumentsWorkspace({
  initialProjects,
  initialDocuments = [],
  initialVersions = [],
  initialProjectId,
  initialError,
}: DocumentsWorkspaceProps) {
  const confirm = useConfirm();
  const [projects, setProjects] = useState(() => initialProjects?.items ?? []);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [documents, setDocuments] =
    useState<readonly DocumentListItem[]>(initialDocuments);
  const [versions, setVersions] =
    useState<readonly DocumentVersionListItem[]>(initialVersions);
  const [alert, setAlert] = useState<string | null>(initialError ?? null);
  useAutoDismiss(alert, () => setAlert(null));
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");
  const [busy, setBusy] = useState(false);
  const [deletingVersionId, setDeletingVersionId] = useState<string | null>(
    null,
  );
  const [selectedVersionIds, setSelectedVersionIds] = useState<Set<string>>(
    new Set(),
  );
  const deletionLock = useRef(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const initialProject = projects.find((project) =>
    sameProjectId(project.id, initialProjectId),
  );
  const [search, setSearch] = useQueryState<string>(
    "q",
    initialProject ? projectOptionLabel(initialProject) : "",
  );
  const [status, setStatus] = useQueryState<"" | DocumentStatus | ProjectStatus>(
    "estado",
    "",
  );
  const [sort, setSort] = useQueryState<DocumentsSort>("orden", "CREATED_DESC");
  const [area, setArea] = useQueryState<string>("area", "");
  const [catalogAreas, setCatalogAreas] = useState<readonly string[]>([]);
  const repairedProjectIdsRef = useRef(new Set<string>());
  const createDialogRef = useDialogAccessibility<HTMLElement>(
    createOpen,
    () => {
      if (!busy) setCreateOpen(false);
    },
  );

  const selectedProject = projects.find((project) =>
    sameProjectId(project.id, projectId),
  );
  const visibleItems = projectId ? versions : documents;
  const [historyCounts, setHistoryCounts] = useState<
    Record<string, number | null>
  >({});

  useEffect(() => {
    if (projectId) return;
    const controller = new AbortController();
    setHistoryCounts({});
    // Older running APIs may not yet include versionCount in the summary.
    void Promise.allSettled(
      documents
        .filter((document) => document.versionCount === undefined)
        .map(async (document) => {
          try {
            const response = await fetch(
              `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(document.id)}/versions`,
              {
                credentials: "include",
                cache: "no-store",
                signal: controller.signal,
              },
            );
            if (!response.ok)
              throw new Error("No fue posible consultar el historial");
            const history: unknown = await response.json();
            if (!Array.isArray(history)) throw new Error("Historial inválido");
            if (!controller.signal.aborted)
              setHistoryCounts((current) => ({
                ...current,
                [document.id]: history.length,
              }));
          } catch {
            if (!controller.signal.aborted)
              setHistoryCounts((current) => ({
                ...current,
                [document.id]: null,
              }));
          }
        }),
    );
    return () => controller.abort();
  }, [documents, projectId]);

  function projectDocumentCount(id: string): number | string {
    const counts = documents
      .filter((document) => sameProjectId(document.projectId, id))
      .map((document) => document.versionCount ?? historyCounts[document.id]);
    if (counts.some((count) => count === null)) return "No disponible";
    if (counts.some((count) => count === undefined)) return "Consultando…";
    return counts.reduce<number>((total, count) => total + (count ?? 0), 0);
  }

  useEffect(() => {
    const documentProjectIds = new Set(
      documents.map((document) => document.projectId.toLowerCase()),
    );
    for (const project of projects) {
      if (
        !documentProjectIds.has(project.id.toLowerCase()) ||
        project.status === "ARCHIVED" ||
        (PROJECT_STATUS_ORDER[project.status] >=
          PROJECT_STATUS_ORDER.DOCUMENT_GENERATED &&
          !(
            project.status !== "DOCUMENT_GENERATED" &&
            documents.some(
              (document) =>
                sameProjectId(document.projectId, project.id) &&
                document.status === "DRAFT",
            )
          )) ||
        repairedProjectIdsRef.current.has(project.id)
      ) {
        continue;
      }
      repairedProjectIdsRef.current.add(project.id);
      void fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(project.id)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "DOCUMENT_GENERATED" }),
        },
      )
        .then((response) => {
          if (!response.ok) {
            repairedProjectIdsRef.current.delete(project.id);
            return;
          }
          setProjects((items) =>
            items.map((item) =>
              sameProjectId(item.id, project.id)
                ? { ...item, status: "DOCUMENT_GENERATED" }
                : item,
            ),
          );
        })
        .catch(() => {
          repairedProjectIdsRef.current.delete(project.id);
        });
    }
  }, [documents, projects]);
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

  const areaOptions = useMemo(
    () =>
      [
        ...new Set([
          ...catalogAreas,
          ...projects.map((project) => project.requestingArea),
        ]),
      ]
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right, "es")),
    [catalogAreas, projects],
  );

  const filteredItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es-CO");
    return [...visibleItems]
      .filter((item) => {
        if (
          area &&
          projects.find((project) => sameProjectId(project.id, item.projectId))
            ?.requestingArea !== area
        )
          return false;
        if (
          status &&
          (projectId
            ? item.status
            : projects.find((project) =>
                sameProjectId(project.id, item.projectId),
              )?.status) !== status
        )
          return false;
        if (
          !query ||
          (selectedProject &&
            query ===
              projectOptionLabel(selectedProject).toLocaleLowerCase("es-CO"))
        )
          return true;
        const documentTitle =
          "documentTitle" in item ? item.documentTitle : item.title;
        const extra =
          "changeSummary" in item
            ? `${item.changeSummary ?? ""} ${item.version}`
            : `${item.template.name} ${item.currentVersion}`;
        return [item.projectCode, item.projectTitle, documentTitle, extra].some(
          (value) => value.toLocaleLowerCase("es-CO").includes(query),
        );
      })
      .sort((left, right) => {
        const leftTitle =
          "documentTitle" in left ? left.documentTitle : left.title;
        const rightTitle =
          "documentTitle" in right ? right.documentTitle : right.title;
        if (sort === "TITLE_ASC" || sort === "TITLE_DESC") {
          const order = leftTitle.localeCompare(rightTitle, "es", {
            numeric: true,
            sensitivity: "base",
          });
          return sort === "TITLE_ASC" ? order : -order;
        }
        if (sort === "CODE_ASC") {
          return left.projectCode.localeCompare(right.projectCode, "es", {
            numeric: true,
          });
        }
        if (sort === "CREATED_DESC")
          return (
            timestamp(right.createdAt) - timestamp(left.createdAt) ||
            ("versionNumber" in right && "versionNumber" in left
              ? right.versionNumber - left.versionNumber
              : 0)
          );
        const order = projectId
          ? timestamp(right.createdAt) - timestamp(left.createdAt) ||
            ("versionNumber" in right && "versionNumber" in left
              ? right.versionNumber - left.versionNumber
              : 0)
          : timestamp(right.updatedAt) - timestamp(left.updatedAt);
        return sort === "UPDATED_ASC" ? -order : order;
      });
  }, [
    area,
    projects,
    projectId,
    search,
    selectedProject,
    sort,
    status,
    visibleItems,
  ]);
  const metrics = useMemo(
    () => ({
      total: filteredItems.length,
      drafts: filteredItems.filter((item) => item.status === "DRAFT").length,
      review: filteredItems.filter((item) => item.status === "IN_REVIEW")
        .length,
      approved: filteredItems.filter((item) => item.status === "APPROVED")
        .length,
    }),
    [filteredItems],
  );

  const selectableVersions = projectId
    ? (filteredItems as readonly DocumentVersionListItem[]).filter(
        (version) => version.status === "DRAFT" && !version.documentArchived,
      )
    : [];
  const selectedVersions = selectableVersions.filter((version) =>
    selectedVersionIds.has(version.id),
  );

  function toggleVersion(id: string): void {
    setSelectedVersionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Elegir o quitar un proyecto carga su URL: el servidor trae sus versiones
  // y la pantalla arranca con ese estado (sin que la sincronización de la URL
  // reinicie la lista).
  function openProjectDocuments(nextProjectId: string): void {
    setBusy(true);
    window.location.assign(
      nextProjectId
        ? `/workspace/documents?projectId=${encodeURIComponent(nextProjectId)}`
        : "/workspace/documents",
    );
  }

  async function loadDocuments(nextProjectId: string): Promise<void> {
    setSelectedVersionIds(new Set());
    setProjectId(nextProjectId);
    setAlert(null);
    setDocuments([]);
    setVersions([]);
    setBusy(true);
    try {
      const projectsToLoad = nextProjectId
        ? projects.filter((item) => sameProjectId(item.id, nextProjectId))
        : projects;
      const loaded = await Promise.allSettled(
        projectsToLoad.map(fetchProjectDocuments),
      );
      const loadedDocuments = loaded.flatMap((result) =>
        result.status === "fulfilled" ? result.value : [],
      );
      if (
        loaded.length > 0 &&
        loaded.every((result) => result.status === "rejected")
      ) {
        throw new Error("No fue posible cargar los documentos.");
      }
      if (!nextProjectId) {
        setDocuments(loadedDocuments);
        setVersions([]);
        window.history.replaceState(null, "", "/workspace/documents");
        if (loaded.some((result) => result.status === "rejected")) {
          setAlert("Algunos proyectos no pudieron cargarse.");
          setAlertTone("danger");
        }
        return;
      }
      const loadedVersions = await Promise.allSettled(
        loadedDocuments.map((document) => fetchDocumentVersions(document)),
      );
      const availableVersions = loadedVersions
        .flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        )
        .sort(
          (left, right) =>
            timestamp(right.createdAt) - timestamp(left.createdAt) ||
            right.versionNumber - left.versionNumber,
        );
      const failures = loadedVersions.filter(
        (result) => result.status === "rejected",
      );
      if (failures.length === loadedVersions.length && failures.length > 0) {
        throw failures[0]?.reason;
      }
      setDocuments(loadedDocuments);
      setVersions(availableVersions);
      window.history.replaceState(
        null,
        "",
        nextProjectId
          ? `/workspace/documents?projectId=${encodeURIComponent(nextProjectId)}`
          : "/workspace/documents",
      );
      if (
        failures.length > 0 ||
        loaded.some((result) => result.status === "rejected")
      ) {
        setAlert(
          "Parte del historial no pudo cargarse. La tabla muestra las versiones disponibles.",
        );
        setAlertTone("danger");
      }
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
      setAlertTone("danger");
    } finally {
      setBusy(false);
    }
  }

  async function createDocument(): Promise<void> {
    if (!projectId || title.trim().length < 3) {
      setAlert("Escribe un título de al menos 3 caracteres.");
      setAlertTone("danger");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/documents`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const created = (await response.json()) as { id: string };
      window.location.assign(
        `/workspace/documents/${encodeURIComponent(created.id)}`,
      );
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
      setAlertTone("danger");
      setBusy(false);
    }
  }

  async function deleteDraftVersions(
    items: readonly DocumentVersionListItem[],
  ): Promise<void> {
    const drafts = items.filter(
      (item) => item.status === "DRAFT" && !item.documentArchived,
    );
    if (!drafts.length || deletionLock.current || busy) return;
    const description = drafts
      .map(
        (item) =>
          `${item.documentTitle}: versión ${item.versionNumber} (v${item.version})`,
      )
      .join("\n");
    if (
      !(await confirm({
        title: "Eliminar borradores",
        message: `¿Eliminar definitivamente ${drafts.length} borrador(es)?\n\n${description}\n\nEsta acción no se puede deshacer.`,
        confirmLabel: "Eliminar definitivamente",
        destructive: true,
      }))
    )
      return;
    deletionLock.current = true;
    const [onlyDraft] = drafts;
    setDeletingVersionId(
      drafts.length === 1 && onlyDraft ? onlyDraft.id : "bulk",
    );
    setAlert(null);
    const failures: string[] = [];
    let deleted = 0;
    try {
      // Serialize changes to the same document's current version.
      for (const version of [...drafts].sort(
        (a, b) => b.versionNumber - a.versionNumber,
      )) {
        try {
          const response = await fetch(
            `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(version.documentId)}/versions/${version.versionNumber}`,
            {
              method: "DELETE",
              credentials: "include",
              headers: { accept: "application/json" },
            },
          );
          if (!response.ok) throw new Error(await responseError(response));
          deleted += 1;
        } catch (error) {
          failures.push(
            `Versión ${version.versionNumber}: ${error instanceof Error ? error.message : "No fue posible eliminarla"}`,
          );
        }
      }
      await loadDocuments(projectId);
      setAlert(
        `${deleted} borrador(es) eliminado(s).${failures.length ? ` No se eliminaron ${failures.length}: ${failures.join("; ")}` : ""}`,
      );
      setAlertTone(failures.length ? "danger" : "success");
    } finally {
      deletionLock.current = false;
      setDeletingVersionId(null);
    }
  }

  return (
    <section className="rq-documents-workspace rq-documents-index">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de documentos">
          <RqKpiCard
            description="Registros visibles"
            icon={<WorkspaceKpiIcon name="file" />}
            title="Total"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Versiones en borrador / esperan revisión"
            icon={<WorkspaceKpiIcon name="drafts" />}
            title="Borradores / en validación"
            value={`${metrics.drafts} / ${metrics.review}`}
          />
          <RqKpiCard
            description="Versiones bloqueadas"
            icon={<WorkspaceKpiIcon name="check" />}
            title="Aprobados"
            value={String(metrics.approved)}
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={
              !selectedProject ||
              !selectedProject.template ||
              busy ||
              deletingVersionId !== null
            }
            onClick={() => {
              setTitle(selectedProject?.title ?? "");
              setCreateOpen(true);
            }}
            tone="affirmative"
          >
            Nuevo documento
          </RqActionButton>
          {projectId ? (
            <RqActionButton
              tone="danger"
              disabled={
                busy ||
                deletingVersionId !== null ||
                selectedVersions.length === 0
              }
              onClick={() => void deleteDraftVersions(selectedVersions)}
            >
              {deletingVersionId === "bulk"
                ? "Eliminando…"
                : `Eliminar seleccionados (${selectedVersions.length})`}
            </RqActionButton>
          ) : null}
        </div>
      </section>

      {alert ? (
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert(null)}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <form
        inert={deletingVersionId !== null}
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
            disabled={busy}
            id="documents-project-filter"
            list="documents-project-options"
            name="documents-project-filter"
            onChange={(event) => {
              const value = event.target.value;
              setSearch(value);
              const selected = projects.find(
                (project) => projectOptionLabel(project) === value,
              );
              if (selected && selected.id !== projectId) {
                setStatus("");
                setSort("CREATED_DESC");
                openProjectDocuments(selected.id);
              } else if (!value && projectId) {
                setStatus("");
                openProjectDocuments("");
              }
            }}
            placeholder="Código, título o área solicitante"
            type="search"
            value={search}
          />
          <datalist id="documents-project-options">
            {projects.map((project) => (
              <option key={project.id} value={projectOptionLabel(project)} />
            ))}
          </datalist>
        </label>

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label={projectId ? "Estado de versión" : "Estado del proyecto"}
            id="documents-status"
            name="documents-status"
            onChange={(event) =>
              setStatus(
                event.target.value as "" | DocumentStatus | ProjectStatus,
              )
            }
            value={status}
          >
            <option value="">Todos</option>
            {(projectId
              ? DOCUMENT_STATUS_OPTIONS
              : Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))
            ).map((option) => (
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
            id="documents-area"
            name="documents-area"
            onChange={(event) => setArea(event.target.value)}
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
            id="documents-sort"
            name="documents-sort"
            onChange={(event) => setSort(event.target.value as DocumentsSort)}
            value={sort}
          >
            <option value="CREATED_DESC">Fecha de creación</option>
            <option value="UPDATED_DESC">Última actualización</option>
            <option value="UPDATED_ASC">Actualización: más antigua</option>
            <option value="TITLE_ASC">Nombre: A a Z</option>
            <option value="TITLE_DESC">Nombre: Z a A</option>
            <option value="CODE_ASC">Código</option>
          </select>
        </label>

        <RqActionButton
          onClick={() => {
            setSearch("");
            setStatus("");
            setArea("");
            setSort("CREATED_DESC");
            if (projectId) openProjectDocuments("");
          }}
          tone="secondary"
          type="button"
        >
          Limpiar
        </RqActionButton>
      </form>

      <section className="rq-documents-list-shell">
        <div
          aria-label={
            projectId
              ? "Versiones de documentos"
              : "Documentos de requerimientos"
          }
          className="rq-documents-table-frame"
          role="region"
          tabIndex={0}
        >
          {busy ? (
            <div className="rq-document-loading" role="status">
              Cargando documentos…
            </div>
          ) : filteredItems.length === 0 ? (
            <RqEmptyState
              description={
                projectId
                  ? "Este proyecto todavía no tiene documentos generados."
                  : "No hay documentos generados."
              }
              title="No hay documentos"
            />
          ) : projectId ? (
            <table className="rq-table rq-document-table">
              <thead>
                <tr>
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Seleccionar todos los borradores visibles"
                      disabled={
                        deletingVersionId !== null ||
                        selectableVersions.length === 0
                      }
                      checked={
                        selectableVersions.length > 0 &&
                        selectedVersions.length === selectableVersions.length
                      }
                      ref={(input) => {
                        if (input)
                          input.indeterminate =
                            selectedVersions.length > 0 &&
                            selectedVersions.length < selectableVersions.length;
                      }}
                      onChange={(event) =>
                        setSelectedVersionIds(
                          new Set(
                            event.target.checked
                              ? selectableVersions.map((version) => version.id)
                              : [],
                          ),
                        )
                      }
                    />
                  </th>
                  <th scope="col">Proyecto</th>
                  <th scope="col">Documento</th>
                  <th scope="col">Versión</th>
                  <th scope="col">Resumen del cambio</th>
                  <th scope="col">IA utilizada</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Creación</th>
                  <th scope="col">Última modificación</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(filteredItems as readonly DocumentVersionListItem[]).map(
                  (version) => (
                    <tr key={version.id}>
                      <td>
                        {version.status === "DRAFT" &&
                        !version.documentArchived ? (
                          <input
                            type="checkbox"
                            aria-label={`Seleccionar borrador versión ${version.versionNumber} de ${version.documentTitle}`}
                            disabled={deletingVersionId !== null}
                            checked={selectedVersionIds.has(version.id)}
                            onChange={() => toggleVersion(version.id)}
                          />
                        ) : null}
                      </td>
                      <td>
                        <strong>{version.projectCode}</strong>
                        <small>{version.projectTitle}</small>
                      </td>
                      <td>
                        <strong>{version.documentTitle}</strong>
                      </td>
                      <td>
                        Versión {version.versionNumber} · v{version.version}
                      </td>
                      <td>
                        {version.changeSummary || "Sin resumen de cambio"}
                      </td>
                      <td>
                        {version.aiEngines.length > 0
                          ? version.aiEngines
                              .map((engine) => {
                                const label =
                                  engine === "LOCAL" ? "IA local" : "IA nube";
                                const model = version.aiModels[engine];
                                return model ? `${label} · ${model}` : label;
                              })
                              .join(" + ")
                          : "Generación manual"}
                      </td>
                      <td>
                        <RqStatusBadge
                          tone={documentStatusTone(version.status)}
                        >
                          {documentStatusLabel(version.status)}
                        </RqStatusBadge>
                      </td>
                      <td>{formatDate(version.createdAt)}</td>
                      <td>{formatDate(version.updatedAt)}</td>
                      <td>
                        <div className="rq-document-actions">
                          <a
                            className="rq-action rq-row-open rq-document-open"
                            data-rq-tone="primary"
                            data-document-action={documentActionColor(
                              version.status,
                              version.versionNumber ===
                                version.currentVersionNumber,
                              version.documentArchived,
                            )}
                            title={documentActionLabel(
                              version.status,
                              version.versionNumber ===
                                version.currentVersionNumber,
                              version.documentArchived,
                            )}
                            href={documentUrl(
                              version.documentId,
                              version.versionNumber,
                              !projectId,
                            )}
                          >
                            Abrir
                          </a>
                          {version.status === "DRAFT" &&
                          !version.documentArchived ? (
                            <RqActionButton
                              aria-label="Eliminar borrador"
                              className="rq-row-delete"
                              disabled={deletingVersionId !== null}
                              onClick={() =>
                                void deleteDraftVersions([version])
                              }
                              tone="danger"
                            >
                              {deletingVersionId === version.id
                                ? "Eliminando…"
                                : "Eliminar"}
                            </RqActionButton>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          ) : (
            <table className="rq-table rq-document-table rq-document-project-summary">
              <thead>
                <tr>
                  <th scope="col">Proyecto</th>
                  <th scope="col">Versión actual</th>
                  <th scope="col">N° de doc</th>
                  <th scope="col">Plantilla</th>
                  <th scope="col">Estado del proyecto</th>
                  <th scope="col">Ejecución última versión</th>
                  <th scope="col">Prototipo</th>
                  <th scope="col">Existe borrador</th>
                  <th scope="col">Última modificación</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {(filteredItems as readonly DocumentListItem[]).map(
                  (document) => (
                    <tr key={document.id}>
                      <td>
                        <strong>{document.projectTitle}</strong>
                        <small>{document.projectCode}</small>
                      </td>
                      <td>
                        Versión {document.currentVersionNumber} · v
                        {document.currentVersion}
                      </td>
                      <td title="Documentos existentes en el historial completo del proyecto; excluye los eliminados">
                        {projectDocumentCount(document.projectId)}
                      </td>
                      <td>{document.template.name}</td>
                      <td>
                        {(() => {
                          const project = projectOfDocument(
                            projects,
                            document.projectId,
                          );
                          return project ? (
                            <ProjectStatusBadge status={project.status} />
                          ) : (
                            <RqStatusBadge tone="neutral">
                              No disponible
                            </RqStatusBadge>
                          );
                        })()}
                      </td>
                      <DocumentGenerationCells
                        gatewayUrl={GATEWAY_URL}
                        projectId={document.projectId}
                        documentId={document.id}
                        versionNumber={document.currentVersionNumber}
                        hasPrototype={document.hasPrototype === true}
                      />
                      <td>{formatDate(document.updatedAt)}</td>
                      <td>
                        <a
                          className="rq-action rq-row-open rq-document-open"
                          data-rq-tone="primary"
                          data-document-action={documentActionColor(
                            document.status,
                            true,
                            document.status === "ARCHIVED",
                          )}
                          title={documentActionLabel(
                            document.status,
                            true,
                            document.status === "ARCHIVED",
                          )}
                          href={documentUrl(document.id, undefined, true)}
                        >
                          Abrir
                        </a>
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {createOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="new-document-title"
            aria-modal="true"
            className="rq-project-modal rq-document-create-modal"
            ref={createDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Creación manual</span>
                <h2 id="new-document-title">Nuevo documento</h2>
              </div>
              <button
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setCreateOpen(false)}
                type="button"
              >
                ×
              </button>
            </header>
            <form
              className="rq-project-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createDocument();
              }}
            >
              <label className="rq-field rq-document-create-title">
                <span>Título obligatorio</span>
                <input
                  autoFocus
                  maxLength={240}
                  minLength={3}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  value={title}
                />
                <small>
                  El documento copiará las secciones configuradas en la
                  plantilla aplicada, incluido el Plan Scrum cuando corresponda.
                </small>
              </label>
              <div className="rq-project-modal__actions">
                <RqActionButton
                  disabled={busy}
                  onClick={() => setCreateOpen(false)}
                >
                  Cancelar
                </RqActionButton>
                <RqActionButton
                  disabled={busy}
                  tone="affirmative"
                  type="submit"
                >
                  {busy ? "Creando…" : "Crear y abrir"}
                </RqActionButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
