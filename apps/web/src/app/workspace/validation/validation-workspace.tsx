"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

import type {
  DocumentStatus,
  ExportFormat,
  ExportRequestDetail,
  ExportRequestListResponse,
  ProjectAreaListResponse,
  ProjectListResponse,
  RequirementDocumentDetail,
  RequirementDocumentSummary,
} from "@levantamiento-rq/shared-contracts";
import {
  RqEmptyState,
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
} from "@levantamiento-rq/shared-ui";

import { ProjectStatusBadge } from "../project-status-badge";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import { createBrowserUuid } from "../../browser-uuid";
import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { buildReadableBacklogTxtExport } from "./devops-txt-export";
import { downloadProjectPresentation } from "./project-presentation-export";
import { useAutoDismiss, useAutoDismissedProp } from "../../use-auto-dismiss";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

export interface ValidationDocumentItem extends RequirementDocumentSummary {
  projectCode: string;
  projectTitle: string;
}

interface ValidationWorkspaceProps {
  initialDocuments: readonly ValidationDocumentItem[];
  initialError?: string;
  initialProjects?: ProjectListResponse;
}

type ValidationSort =
  "CREATED_DESC" | "STATUS" | "NAME_ASC" | "NAME_DESC" | "PROGRESS_DESC";

function statusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
  if (status === "CHANGES_REQUESTED") return "Correcciones solicitadas";
  if (status === "APPROVED") return "Aprobado";
  if (status === "REJECTED") return "Rechazado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function statusTone(
  status: DocumentStatus,
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "APPROVED") return "success";
  if (status === "IN_REVIEW") return "process";
  if (status === "CHANGES_REQUESTED") return "pending";
  if (status === "REJECTED") return "danger";
  if (status === "ARCHIVED") return "inactive";
  return "pending";
}

function documentProgress(status: DocumentStatus): number {
  if (status === "APPROVED" || status === "ARCHIVED") return 100;
  if (status === "IN_REVIEW") return 85;
  if (status === "CHANGES_REQUESTED") return 70;
  if (status === "REJECTED") return 60;
  return 40;
}

function actionLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "Revisar";
  if (status === "CHANGES_REQUESTED") return "Corregir";
  if (status === "REJECTED") return "Consultar";
  if (status === "APPROVED" || status === "ARCHIVED") return "Consultar";
  return "Preparar";
}

const DOCUMENT_STATUS_OPTIONS: readonly {
  value: DocumentStatus;
  label: string;
}[] = [
  { value: "IN_REVIEW", label: "En validación" },
  { value: "CHANGES_REQUESTED", label: "Correcciones solicitadas" },
  { value: "REJECTED", label: "Rechazado" },
  { value: "DRAFT", label: "Borrador" },
  { value: "APPROVED", label: "Aprobado" },
  { value: "ARCHIVED", label: "Archivado" },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function filterText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLocaleLowerCase("es");
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return `La solicitud falló (${response.status}).`;
  try {
    const payload = JSON.parse(text) as Readonly<Record<string, unknown>>;
    const message = payload.message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join(" ");
  } catch {
    return text;
  }
  return text;
}

function exportStatusLabel(status: ExportRequestDetail["status"]): string {
  if (status === "PENDING") return "Pendiente";
  if (status === "PROCESSING") return "Procesando";
  if (status === "COMPLETED") return "Completada";
  if (status === "CANCELLED") return "Cancelada";
  return "Fallida";
}

function exportStatusTone(
  status: ExportRequestDetail["status"],
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "COMPLETED") return "success";
  if (status === "PROCESSING") return "process";
  if (status === "PENDING") return "pending";
  if (status === "CANCELLED") return "inactive";
  return "danger";
}

export function ValidationWorkspace({
  initialDocuments,
  initialError,
  initialProjects,
}: ValidationWorkspaceProps) {
  const projects = initialProjects?.items ?? [];
  const [projectFilter, setProjectFilter] = useQueryState<string>("proyecto", "");
  const visibleInitialError = useAutoDismissedProp(initialError);
  const [statusFilter, setStatusFilter] = useQueryState<string>("estado", "");
  const [areaFilter, setAreaFilter] = useQueryState<string>("area", "");
  const [catalogAreas, setCatalogAreas] = useState<readonly string[]>([]);
  const [sort, setSort] = useQueryState<ValidationSort>("orden", "CREATED_DESC");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    initialDocuments[0]?.id ?? null,
  );
  const [exportDocument, setExportDocument] =
    useState<ValidationDocumentItem | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportRequests, setExportRequests] = useState<
    readonly ExportRequestDetail[]
  >([]);
  const [exportError, setExportError] = useState<string | null>(null);
  useAutoDismiss(exportError, () => setExportError(null));
  const [devOpsBusyDocumentId, setDevOpsBusyDocumentId] = useState<
    string | null
  >(null);
  const [devOpsMessage, setDevOpsMessage] = useState<{
    text: string;
    tone: "danger" | "success";
  } | null>(null);
  useAutoDismiss(devOpsMessage, () => setDevOpsMessage(null));
  const [presentationBusyDocumentId, setPresentationBusyDocumentId] = useState<
    string | null
  >(null);
  const [presentationMessage, setPresentationMessage] = useState<{
    text: string;
    tone: "danger" | "success";
  } | null>(null);
  useAutoDismiss(presentationMessage, () => setPresentationMessage(null));
  const exportDialogRef = useDialogAccessibility<HTMLElement>(
    Boolean(exportDocument),
    () => {
      if (!exportBusy) setExportDocument(null);
    },
  );

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

  const metrics = useMemo(
    () => ({
      review: initialDocuments.filter((item) => item.status === "IN_REVIEW")
        .length,
      drafts: initialDocuments.filter((item) => item.status === "DRAFT").length,
      rejected: initialDocuments.filter(
        (item) =>
          item.status === "REJECTED" || item.status === "CHANGES_REQUESTED",
      ).length,
      approved: initialDocuments.filter((item) => item.status === "APPROVED")
        .length,
    }),
    [initialDocuments],
  );

  const visibleDocuments = useMemo(
    () =>
      initialDocuments
        .filter((item) => {
          const query = filterText(projectFilter);
          return (
            !query ||
            filterText(`${item.projectTitle} ${item.projectCode}`).includes(
              query,
            )
          );
        })
        .filter(
          (item) =>
            !areaFilter ||
            projects.find((project) => project.id === item.projectId)
              ?.requestingArea === areaFilter,
        )
        .filter((item) => {
          const query = filterText(statusFilter);
          return (
            !query ||
            filterText(`${statusLabel(item.status)} ${item.status}`).includes(
              query,
            )
          );
        })
        .toSorted((left, right) => {
          const priority = (value: DocumentStatus): number => {
            if (value === "IN_REVIEW") return 0;
            if (value === "CHANGES_REQUESTED") return 1;
            if (value === "REJECTED") return 2;
            if (value === "DRAFT") return 3;
            if (value === "APPROVED") return 4;
            return 5;
          };

          if (sort === "CREATED_DESC")
            return (
              (Date.parse(right.createdAt) || 0) -
              (Date.parse(left.createdAt) || 0)
            );
          if (sort === "NAME_ASC")
            return left.projectTitle.localeCompare(right.projectTitle, "es");
          if (sort === "NAME_DESC")
            return right.projectTitle.localeCompare(left.projectTitle, "es");
          if (sort === "PROGRESS_DESC")
            return (
              documentProgress(right.status) - documentProgress(left.status) ||
              left.projectTitle.localeCompare(right.projectTitle, "es")
            );
          return (
            priority(left.status) - priority(right.status) ||
            left.projectTitle.localeCompare(right.projectTitle, "es")
          );
        }),
    [areaFilter, initialDocuments, projectFilter, projects, sort, statusFilter],
  );
  const selectedDocument =
    visibleDocuments.find((item) => item.id === selectedDocumentId) ?? null;

  const visibleExportRequests = useMemo(
    () => exportRequests.filter((item) => item.format === exportFormat),
    [exportFormat, exportRequests],
  );

  useEffect(() => {
    if (selectedDocumentId && !selectedDocument) {
      setSelectedDocumentId(null);
    }
  }, [selectedDocument, selectedDocumentId]);

  useEffect(() => {
    if (!exportDocument) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(
          `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(exportDocument.projectId)}/documents/${encodeURIComponent(exportDocument.id)}/exports`,
          { credentials: "include", cache: "no-store" },
        );
        if (!response.ok) throw new Error(await responseError(response));
        const list = (await response.json()) as ExportRequestListResponse;
        if (active) setExportRequests(list.items);
      } catch (error) {
        if (active)
          setExportError(
            error instanceof Error ? error.message : String(error),
          );
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [exportDocument]);

  function openExports(
    document: ValidationDocumentItem,
    format: ExportFormat = "PDF",
  ): void {
    setExportRequests([]);
    setExportError(null);
    setExportFormat(format);
    setExportDocument(document);
    if (format === "MARKDOWN") {
      void requestExport(document, format);
    }
  }

  async function requestExport(
    targetDocument = exportDocument,
    targetFormat = exportFormat,
  ): Promise<void> {
    if (!targetDocument || targetDocument.status !== "APPROVED") return;
    setExportBusy(true);
    setExportError(null);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(targetDocument.projectId)}/documents/${encodeURIComponent(targetDocument.id)}/versions/${targetDocument.currentVersionNumber}/exports`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": createBrowserUuid(),
          },
          body: JSON.stringify({ format: targetFormat }),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      const created = (await response.json()) as ExportRequestDetail;
      setExportRequests((current) => [
        created,
        ...current.filter((item) => item.id !== created.id),
      ]);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error));
    } finally {
      setExportBusy(false);
    }
  }

  async function exportReadableBacklogTxt(
    item: ValidationDocumentItem,
  ): Promise<void> {
    setDevOpsBusyDocumentId(item.id);
    setDevOpsMessage(null);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(item.id)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));

      const detail = (await response.json()) as RequirementDocumentDetail;
      const exported = buildReadableBacklogTxtExport(detail);
      if (!exported) {
        throw new Error(
          "El documento todavía no contiene una estructura Epic → Feature → Historia de usuario → Task en el Punto 7.",
        );
      }

      const blob = new Blob([exported.content], {
        type: "text/plain;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName;
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setDevOpsMessage({
        text: `Esquema TXT generado con ${exported.itemCount} elementos.`,
        tone: "success",
      });
    } catch (error) {
      setDevOpsMessage({
        text: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      setDevOpsBusyDocumentId(null);
    }
  }

  async function exportProjectPresentation(
    item: ValidationDocumentItem,
  ): Promise<void> {
    setPresentationBusyDocumentId(item.id);
    setPresentationMessage(null);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(item.id)}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await responseError(response));

      const detail = (await response.json()) as RequirementDocumentDetail;
      const exported = await downloadProjectPresentation(detail);
      setPresentationMessage({
        text: `Presentación ${exported.fileName} generada.`,
        tone: "success",
      });
    } catch (error) {
      setPresentationMessage({
        text: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      setPresentationBusyDocumentId(null);
    }
  }

  return (
    <section
      className="rq-documents-workspace rq-validation-workspace"
      onPointerDown={(event) => {
        const target = event.target;
        if (
          target instanceof Element &&
          !target.closest(".rq-validation-project-card") &&
          !target.closest(".rq-validation-toolbar-actions") &&
          !target.closest(".rq-project-modal")
        ) {
          setSelectedDocumentId(null);
        }
      }}
    >
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de validación">
          <RqKpiCard
            description="Esperan una decisión"
            icon={<WorkspaceKpiIcon name="clock" />}
            title="Por validar"
            value={String(metrics.review)}
          />
          <RqKpiCard
            description="En preparación / con correcciones"
            icon={<WorkspaceKpiIcon name="drafts" />}
            title="Borradores / observados"
            value={`${metrics.drafts} / ${metrics.rejected}`}
          />
          <RqKpiCard
            description="Versiones inmutables"
            icon={<WorkspaceKpiIcon name="check" />}
            title="Aprobados"
            value={String(metrics.approved)}
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions rq-validation-toolbar-actions">
          {selectedDocument ? (
            <Link
              className="rq-action"
              data-rq-tone="operation"
              href={`/workspace/documents/${encodeURIComponent(selectedDocument.id)}`}
            >
              {actionLabel(selectedDocument.status)}
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rq-action rq-action--disabled"
              data-rq-tone="operation"
              title="Selecciona un documento para prepararlo"
            >
              Preparar
            </span>
          )}
        </div>
      </section>

      {visibleInitialError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{visibleInitialError}</span>
        </div>
      ) : null}

      {devOpsMessage ? (
        <div
          className="rq-project-alert"
          data-tone={devOpsMessage.tone}
          role={devOpsMessage.tone === "danger" ? "alert" : "status"}
        >
          <span>{devOpsMessage.text}</span>
        </div>
      ) : null}

      {presentationMessage ? (
        <div
          className="rq-project-alert"
          data-tone={presentationMessage.tone}
          role={presentationMessage.tone === "danger" ? "alert" : "status"}
        >
          <span>{presentationMessage.text}</span>
        </div>
      ) : null}

      <form
        aria-label="Filtros de validación"
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
            aria-label="Buscar proyecto por título o código"
            autoComplete="off"
            list="validation-project-options"
            name="validation-project-filter"
            onChange={(event) => setProjectFilter(event.target.value)}
            placeholder="Título o código"
            type="search"
            value={projectFilter}
          />
          <datalist id="validation-project-options">
            {projects.map((project) => (
              <option
                key={project.id}
                value={`${project.title} · ${project.code}`}
              />
            ))}
          </datalist>
        </label>

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado documental"
            name="validation-status-filter"
            onChange={(event) => setStatusFilter(event.target.value)}
            value={statusFilter}
          >
            <option value="">Todos</option>
            {DOCUMENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-projects-filter">
          <span>Área:</span>
          <select
            aria-label="Área solicitante"
            name="validation-area-filter"
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
            name="validation-sort"
            onChange={(event) => setSort(event.target.value as ValidationSort)}
            value={sort}
          >
            <option value="CREATED_DESC">Fecha de creación</option>
            <option value="STATUS">Estado</option>
            <option value="NAME_ASC">Nombre · A a Z</option>
            <option value="NAME_DESC">Nombre · Z a A</option>
            <option value="PROGRESS_DESC">Avance total</option>
          </select>
        </label>

        <RqActionButton
          onClick={() => {
            setProjectFilter("");
            setStatusFilter("");
            setAreaFilter("");
            setSort("CREATED_DESC");
          }}
          tone="secondary"
          type="button"
        >
          Limpiar
        </RqActionButton>
      </form>

      <section
        className="rq-validation-projects"
        aria-label="Proyectos disponibles"
      >
        {visibleDocuments.length === 0 ? (
          <RqEmptyState
            description="No hay documentos que coincidan con los filtros seleccionados."
            title="Sin documentos para validar"
          />
        ) : (
          <div className="rq-validation-project-cards">
            {visibleDocuments.map((document) => {
              const project = projects.find(
                (item) => item.id === document.projectId,
              );
              const selected = document.id === selectedDocument?.id;
              return (
                <article
                  className="rq-validation-project-card"
                  data-selected={selected}
                  key={document.id}
                >
                  <button
                    aria-label={`Seleccionar ${document.projectTitle}`}
                    aria-pressed={selected}
                    className="rq-validation-project-card__selector"
                    onClick={() => setSelectedDocumentId(document.id)}
                    type="button"
                  />
                  <header>
                    <div>
                      <small>{document.projectCode}</small>
                      <h3>{document.projectTitle}</h3>
                    </div>
                    {project ? (
                      <ProjectStatusBadge status={project.status} />
                    ) : (
                      <RqStatusBadge tone={statusTone(document.status)}>
                        {statusLabel(document.status)}
                      </RqStatusBadge>
                    )}
                  </header>
                  <p>{project?.description || "Sin descripción registrada."}</p>
                  <div className="rq-validation-project-card__tags">
                    <span>v{document.currentVersion}</span>
                    <span>{documentProgress(document.status)}% de avance</span>
                    {project?.requestingArea ? (
                      <span>{project.requestingArea}</span>
                    ) : null}
                    {project?.template ? (
                      <span>{project.template.name}</span>
                    ) : null}
                  </div>
                  <footer>
                    <small>Actualizado {formatDate(document.updatedAt)}</small>
                    <details
                      className="rq-document-overflow-menu rq-validation-card-menu"
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
                    >
                      <summary
                        aria-label={`Más acciones de ${document.projectTitle}`}
                        title="Más acciones"
                      >
                        <span
                          aria-hidden="true"
                          className="rq-document-overflow-menu__icon"
                        >
                          <i />
                          <i />
                          <i />
                        </span>
                      </summary>
                      <div>
                        <button
                          disabled={document.status !== "APPROVED"}
                          onClick={() => {
                            setSelectedDocumentId(document.id);
                            openExports(document, "PDF");
                          }}
                          type="button"
                        >
                          PDF
                        </button>
                        <button
                          disabled={document.status !== "APPROVED"}
                          onClick={() => {
                            setSelectedDocumentId(document.id);
                            openExports(document, "DOCX");
                          }}
                          type="button"
                        >
                          Word
                        </button>
                        <button
                          disabled={document.status !== "APPROVED"}
                          onClick={() => {
                            setSelectedDocumentId(document.id);
                            openExports(document, "MARKDOWN");
                          }}
                          type="button"
                        >
                          Generar Markdown
                        </button>
                        {document.status === "APPROVED" ? (
                          <a
                            href={`/workspace/execution?projectId=${encodeURIComponent(document.projectId)}`}
                          >
                            Ejecución
                          </a>
                        ) : (
                          <button disabled type="button">
                            Ejecución
                          </button>
                        )}
                        <button
                          disabled={devOpsBusyDocumentId === document.id}
                          onClick={() => {
                            setSelectedDocumentId(document.id);
                            void exportReadableBacklogTxt(document);
                          }}
                          type="button"
                        >
                          {devOpsBusyDocumentId === document.id
                            ? "Preparando…"
                            : "DevOps · TXT"}
                        </button>
                        <button
                          disabled={presentationBusyDocumentId === document.id}
                          onClick={() => {
                            setSelectedDocumentId(document.id);
                            void exportProjectPresentation(document);
                          }}
                          type="button"
                        >
                          {presentationBusyDocumentId === document.id
                            ? "Preparando…"
                            : "Presentación"}
                        </button>
                      </div>
                    </details>
                  </footer>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {exportDocument ? (
        <div
          className="rq-project-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !exportBusy) {
              setExportDocument(null);
            }
          }}
          role="presentation"
        >
          <section
            aria-labelledby="validation-export-title"
            aria-modal="true"
            className="rq-project-modal rq-document-export-modal"
            ref={exportDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>Versión aprobada e inmutable</span>
                <h2 id="validation-export-title">
                  {exportFormat === "DOCX"
                    ? "Descargas Word"
                    : exportFormat === "MARKDOWN"
                      ? "Descargas Markdown"
                      : "Descargas PDF"}
                </h2>
              </div>
              <button
                aria-label="Cerrar descargas"
                disabled={exportBusy}
                onClick={() => setExportDocument(null)}
                type="button"
              >
                ×
              </button>
            </header>
            {exportError ? (
              <div
                className="rq-document-alert"
                data-tone="danger"
                role="alert"
              >
                {exportError}
              </div>
            ) : null}
            <div className="rq-document-export-create">
              <div>
                <strong>
                  {exportDocument.projectCode} · v
                  {exportDocument.currentVersion}
                </strong>
                <span>
                  Se genera exactamente desde la versión APPROVED. Esta acción
                  no ejecuta IA.
                </span>
              </div>
              <div className="rq-document-export-format">
                <span>Formato</span>
                <strong>
                  {exportFormat === "DOCX" ? "Word (.docx)" : exportFormat}
                </strong>
              </div>
              <RqActionButton
                disabled={exportBusy}
                onClick={() => void requestExport()}
                tone="affirmative"
              >
                {exportBusy ? "Generando…" : `Generar ${exportFormat}`}
              </RqActionButton>
            </div>
            <section className="rq-document-export-history">
              <header>
                <div>
                  <strong>Historial de exportaciones</strong>
                  <span>Actualización automática cada 3 segundos.</span>
                </div>
                <span>{visibleExportRequests.length} solicitudes</span>
              </header>
              {visibleExportRequests.length === 0 ? (
                <p className="rq-document-export-empty">
                  Todavía no hay entregables de este formato.
                </p>
              ) : (
                <div className="rq-document-export-table-wrap">
                  <table className="rq-document-export-table">
                    <thead>
                      <tr>
                        <th scope="col">Formato</th>
                        <th scope="col">Estado</th>
                        <th scope="col">Fecha</th>
                        <th scope="col">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleExportRequests.map((item) => (
                        <tr key={item.id}>
                          <td>{item.format}</td>
                          <td>
                            <RqStatusBadge tone={exportStatusTone(item.status)}>
                              {exportStatusLabel(item.status)}
                            </RqStatusBadge>
                          </td>
                          <td>{formatDate(item.requestedAt)}</td>
                          <td>
                            {item.status === "COMPLETED" && item.artifact ? (
                              <a
                                className="rq-document-export-download"
                                href={`${GATEWAY_URL}/api/v1/exports/${encodeURIComponent(item.id)}/download`}
                              >
                                Descargar {item.format}
                              </a>
                            ) : (
                              <span>En espera</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </section>
        </div>
      ) : null}
    </section>
  );
}
