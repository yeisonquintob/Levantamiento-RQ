"use client";

import React, { useMemo, useState } from "react";

import type {
  DocumentStatus,
  ProjectListResponse,
  RequirementDocumentSummary,
} from "@levantamiento-rq/shared-contracts";
import {
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

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

export function ValidationWorkspace({
  initialDocuments,
  initialError,
  initialProjects,
}: ValidationWorkspaceProps) {
  const projects = initialProjects?.items ?? [];
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<"" | DocumentStatus>("");

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
                <th>Proyecto</th>
                <th>Documento</th>
                <th>Versión</th>
                <th>Estado</th>
                <th>Actualización</th>
                <th>Acción</th>
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
                    <a
                      className="rq-document-open"
                      href={`/workspace/documents/${encodeURIComponent(document.id)}`}
                    >
                      {actionLabel(document.status)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>
    </section>
  );
}
