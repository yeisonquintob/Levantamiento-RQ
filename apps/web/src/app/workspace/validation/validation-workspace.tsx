"use client";

import React, { useEffect, useMemo, useState } from "react";

import type {
  DocumentStatus,
  ExportFormat,
  ExportRequestDetail,
  ExportRequestListResponse,
  ProjectListResponse,
  RequirementDocumentSummary,
} from "@levantamiento-rq/shared-contracts";
import {
  RqEmptyState,
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

import { useDialogAccessibility } from "../../use-dialog-accessibility";

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

export interface ValidationDocumentItem extends RequirementDocumentSummary {
  projectCode: string;
  projectTitle: string;
}

interface ValidationWorkspaceProps {
  initialDocuments: readonly ValidationDocumentItem[];
  initialError?: string;
  initialProjects?: ProjectListResponse;
}

function statusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
  if (status === "APPROVED") return "Aprobado";
  if (status === "REJECTED") return "Con observaciones";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function statusTone(
  status: DocumentStatus,
): "success" | "process" | "pending" | "danger" | "inactive" {
  if (status === "APPROVED") return "success";
  if (status === "IN_REVIEW") return "process";
  if (status === "REJECTED") return "danger";
  if (status === "ARCHIVED") return "inactive";
  return "pending";
}

function actionLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "Revisar";
  if (status === "REJECTED") return "Corregir";
  if (status === "APPROVED" || status === "ARCHIVED") return "Consultar";
  return "Preparar";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<"" | DocumentStatus>("");
  const [exportDocument, setExportDocument] =
    useState<ValidationDocumentItem | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("PDF");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportRequests, setExportRequests] = useState<
    readonly ExportRequestDetail[]
  >([]);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportDialogRef = useDialogAccessibility<HTMLElement>(
    Boolean(exportDocument),
    () => {
      if (!exportBusy) setExportDocument(null);
    },
  );

  const metrics = useMemo(
    () => ({
      review: initialDocuments.filter((item) => item.status === "IN_REVIEW")
        .length,
      drafts: initialDocuments.filter((item) => item.status === "DRAFT").length,
      rejected: initialDocuments.filter((item) => item.status === "REJECTED")
        .length,
      approved: initialDocuments.filter((item) => item.status === "APPROVED")
        .length,
    }),
    [initialDocuments],
  );

  const visibleDocuments = useMemo(
    () =>
      initialDocuments
        .filter((item) => !projectId || item.projectId === projectId)
        .filter((item) => !status || item.status === status)
        .toSorted((left, right) => {
          const priority = (value: DocumentStatus): number => {
            if (value === "IN_REVIEW") return 0;
            if (value === "REJECTED") return 1;
            if (value === "DRAFT") return 2;
            if (value === "APPROVED") return 3;
            return 4;
          };

          return (
            priority(left.status) - priority(right.status) ||
            right.updatedAt.localeCompare(left.updatedAt)
          );
        }),
    [initialDocuments, projectId, status],
  );

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

  function openExports(document: ValidationDocumentItem): void {
    setExportRequests([]);
    setExportError(null);
    setExportFormat("PDF");
    setExportDocument(document);
  }

  async function requestExport(): Promise<void> {
    if (!exportDocument || exportDocument.status !== "APPROVED") return;
    setExportBusy(true);
    setExportError(null);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(exportDocument.projectId)}/documents/${encodeURIComponent(exportDocument.id)}/versions/${exportDocument.currentVersionNumber}/exports`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ format: exportFormat }),
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

  return (
    <section className="rq-documents-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de validación">
          <RqKpiCard
            description="Esperan una decisión"
            icon="V"
            title="Por validar"
            value={String(metrics.review)}
          />
          <RqKpiCard
            description="En preparación"
            icon="B"
            title="Borradores"
            value={String(metrics.drafts)}
          />
          <RqKpiCard
            description="Requieren correcciones"
            icon="O"
            title="Observados"
            value={String(metrics.rejected)}
          />
          <RqKpiCard
            description="Versiones inmutables"
            icon="A"
            title="Aprobados"
            value={String(metrics.approved)}
          />
        </RqKpiGrid>
      </section>

      {initialError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{initialError}</span>
        </div>
      ) : null}

      <section
        className="rq-document-project-card"
        aria-label="Filtros de validación"
      >
        <label className="rq-field">
          <span>Proyecto</span>
          <select
            onChange={(event) => setProjectId(event.target.value)}
            value={projectId}
          >
            <option value="">Todos los proyectos</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.title}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-field">
          <span>Estado documental</span>
          <select
            onChange={(event) =>
              setStatus(event.target.value as "" | DocumentStatus)
            }
            value={status}
          >
            <option value="">Todos los estados</option>
            <option value="IN_REVIEW">En validación</option>
            <option value="REJECTED">Con observaciones</option>
            <option value="DRAFT">Borrador</option>
            <option value="APPROVED">Aprobado</option>
            <option value="ARCHIVED">Archivado</option>
          </select>
        </label>
      </section>

      <RqTableShell
        count={visibleDocuments.length}
        description="Abre el editor para registrar observaciones, enviar a revisión, aprobar o corregir cada versión."
        title="Bandeja de validación"
      >
        {visibleDocuments.length === 0 ? (
          <RqEmptyState
            description="No hay documentos que coincidan con los filtros seleccionados."
            title="Sin documentos para validar"
          />
        ) : (
          <table className="rq-table rq-document-table">
            <thead>
              <tr>
                <th scope="col">Proyecto</th>
                <th scope="col">Documento</th>
                <th scope="col">Versión</th>
                <th scope="col">Estado</th>
                <th scope="col">Actualización</th>
                <th scope="col">Acción</th>
              </tr>
            </thead>
            <tbody>
              {visibleDocuments.map((document) => (
                <tr key={document.id}>
                  <td>
                    <strong>{document.projectCode}</strong>
                    <br />
                    {document.projectTitle}
                  </td>
                  <td>
                    <strong>{document.title}</strong>
                  </td>
                  <td>v{document.currentVersion}</td>
                  <td>
                    <RqStatusBadge tone={statusTone(document.status)}>
                      {statusLabel(document.status)}
                    </RqStatusBadge>
                  </td>
                  <td>{formatDate(document.updatedAt)}</td>
                  <td>
                    <div className="rq-validation-actions">
                      <a
                        className="rq-document-open"
                        href={`/workspace/documents/${encodeURIComponent(document.id)}`}
                      >
                        {actionLabel(document.status)}
                      </a>
                      {document.status === "APPROVED" ? (
                        <RqActionButton
                          compact
                          onClick={() => openExports(document)}
                          tone="affirmative"
                        >
                          PDF / DOCX
                        </RqActionButton>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

      {exportDocument ? (
        <div className="rq-project-modal-backdrop" role="presentation">
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
                <h2 id="validation-export-title">Descargas PDF y DOCX</h2>
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
              <label>
                <span>Formato</span>
                <select
                  disabled={exportBusy}
                  onChange={(event) =>
                    setExportFormat(event.target.value as ExportFormat)
                  }
                  value={exportFormat}
                >
                  <option value="PDF">PDF</option>
                  <option value="DOCX">DOCX</option>
                </select>
              </label>
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
                <span>{exportRequests.length} solicitudes</span>
              </header>
              {exportRequests.length === 0 ? (
                <p className="rq-document-export-empty">
                  Todavía no hay entregables generados.
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
                      {exportRequests.map((item) => (
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
