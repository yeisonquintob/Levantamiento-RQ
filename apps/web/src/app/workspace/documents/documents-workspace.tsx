"use client";

import React, { useMemo, useState } from "react";

import type {
  DocumentStatus,
  ProjectListResponse,
  RequirementDocumentListResponse,
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

const EMPTY_DOCUMENTS: RequirementDocumentListResponse = {
  items: [],
  totalItems: 0,
};

interface DocumentsWorkspaceProps {
  initialProjects?: ProjectListResponse;
  initialDocuments?: RequirementDocumentListResponse;
  initialProjectId?: string;
  initialError?: string;
}

function statusLabel(status: DocumentStatus): string {
  if (status === "IN_REVIEW") return "En validación";
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
  if (status === "REJECTED") return "danger";
  if (status === "ARCHIVED") return "inactive";
  return "pending";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export function DocumentsWorkspace({
  initialProjects,
  initialDocuments,
  initialProjectId,
  initialError,
}: DocumentsWorkspaceProps) {
  const projects = initialProjects?.items ?? [];
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [documents, setDocuments] = useState(
    initialDocuments ?? EMPTY_DOCUMENTS,
  );
  const [alert, setAlert] = useState<string | null>(initialError ?? null);
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");

  const selectedProject = projects.find((project) => project.id === projectId);
  const metrics = useMemo(
    () => ({
      total: documents.totalItems,
      drafts: documents.items.filter((item) => item.status === "DRAFT").length,
      review: documents.items.filter((item) => item.status === "IN_REVIEW").length,
      approved: documents.items.filter((item) => item.status === "APPROVED").length,
    }),
    [documents],
  );

  async function loadDocuments(nextProjectId: string): Promise<void> {
    setProjectId(nextProjectId);
    setAlert(null);
    if (!nextProjectId) {
      setDocuments(EMPTY_DOCUMENTS);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(nextProjectId)}/documents`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setDocuments((await response.json()) as RequirementDocumentListResponse);
      window.history.replaceState(
        null,
        "",
        `/workspace/documents?projectId=${encodeURIComponent(nextProjectId)}`,
      );
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
      window.location.assign(`/workspace/documents/${encodeURIComponent(created.id)}`);
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
      setAlertTone("danger");
      setBusy(false);
    }
  }

  return (
    <section className="rq-documents-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen de documentos">
          <RqKpiCard description="Documentos del proyecto" icon="D" title="Total" value={String(metrics.total)} />
          <RqKpiCard description="Versiones editables" icon="B" title="Borradores" value={String(metrics.drafts)} />
          <RqKpiCard description="Esperan revisión" icon="V" title="En validación" value={String(metrics.review)} />
          <RqKpiCard description="Versiones bloqueadas" icon="A" title="Aprobados" value={String(metrics.approved)} />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={!selectedProject || !selectedProject.template || busy}
            onClick={() => {
              setTitle(selectedProject?.title ?? "");
              setCreateOpen(true);
            }}
            tone="affirmative"
          >
            Nuevo documento
          </RqActionButton>
        </div>
      </section>

      {alert ? (
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          <button aria-label="Cerrar mensaje" onClick={() => setAlert(null)} type="button">×</button>
        </div>
      ) : null}

      <section className="rq-document-project-card">
        <label className="rq-field">
          <span>Proyecto</span>
          <select
            disabled={busy}
            onChange={(event) => void loadDocuments(event.target.value)}
            value={projectId}
          >
            <option value="">Selecciona un proyecto</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.title}
              </option>
            ))}
          </select>
        </label>
        <div>
          <span>Plantilla aplicada</span>
          <strong>
            {selectedProject?.template
              ? `${selectedProject.template.name} · v${selectedProject.template.version}`
              : "El proyecto no tiene plantilla publicada"}
          </strong>
        </div>
      </section>

      <RqTableShell
        count={documents.totalItems}
        description="Borradores y versiones actuales vinculados al proyecto seleccionado."
        title="Documentos de requerimientos"
      >
        {busy ? (
          <div className="rq-document-loading" role="status">Cargando documentos…</div>
        ) : documents.items.length === 0 ? (
          <RqEmptyState
            description={projectId ? "Crea el primer documento manual para comenzar el levantamiento." : "Selecciona un proyecto para consultar sus documentos."}
            title="No hay documentos"
          />
        ) : (
          <table className="rq-table rq-document-table">
            <thead>
              <tr><th>Título</th><th>Versión</th><th>Plantilla</th><th>Estado</th><th>Última modificación</th><th>Acción</th></tr>
            </thead>
            <tbody>
              {documents.items.map((document) => (
                <tr key={document.id}>
                  <td><strong>{document.title}</strong></td>
                  <td>v{document.currentVersion}</td>
                  <td>{document.template.name}</td>
                  <td><RqStatusBadge tone={statusTone(document.status)}>{statusLabel(document.status)}</RqStatusBadge></td>
                  <td>{formatDate(document.updatedAt)}</td>
                  <td>
                    <a className="rq-document-open" href={`/workspace/documents/${encodeURIComponent(document.id)}`}>
                      Abrir editor
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

      {createOpen ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section aria-labelledby="new-document-title" aria-modal="true" className="rq-project-modal rq-document-create-modal" role="dialog">
            <header className="rq-project-modal__header">
              <div><span>Creación manual</span><h2 id="new-document-title">Nuevo documento</h2></div>
              <button aria-label="Cerrar" disabled={busy} onClick={() => setCreateOpen(false)} type="button">×</button>
            </header>
            <form
              className="rq-project-form"
              onSubmit={(event) => { event.preventDefault(); void createDocument(); }}
            >
              <label className="rq-field rq-document-create-title">
                <span>Título obligatorio</span>
                <input autoFocus maxLength={240} minLength={3} onChange={(event) => setTitle(event.target.value)} required value={title} />
                <small>El documento copiará exactamente las 13 secciones de la plantilla aplicada.</small>
              </label>
              <div className="rq-project-modal__actions">
                <RqActionButton disabled={busy} onClick={() => setCreateOpen(false)}>Cancelar</RqActionButton>
                <RqActionButton disabled={busy} tone="affirmative" type="submit">{busy ? "Creando…" : "Crear y abrir"}</RqActionButton>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </section>
  );
}
