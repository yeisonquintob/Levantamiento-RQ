"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  ProjectListResponse,
  RequirementDocumentDetail,
  RequirementDocumentListResponse,
  SourceListResponse,
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

const EMPTY_REQUESTS: AiAnalysisRequestListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
};

interface Props {
  initialProjects?: ProjectListResponse;
  initialError?: string;
}

type ModalMode = "create" | "review" | null;

async function failure(response: Response): Promise<string> {
  if (response.status === 401) {
    window.location.assign("/sign-in");
    return "Sesión vencida.";
  }
  const payload = (await response.json().catch(() => null)) as unknown;
  if (payload && typeof payload === "object") {
    const record = payload as Readonly<Record<string, unknown>>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.message === "string") return record.message;
  }
  return "La operación no pudo completarse.";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "FAILED") return "danger" as const;
  if (status === "CANCELLED") return "inactive" as const;
  if (status === "PROCESSING") return "process" as const;
  return "pending" as const;
}

export function AnalysisWorkspace({ initialProjects, initialError }: Props) {
  const projects = initialProjects?.items ?? [];
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [sources, setSources] = useState<SourceListResponse | null>(null);
  const [documents, setDocuments] =
    useState<RequirementDocumentListResponse | null>(null);
  const [requests, setRequests] = useState(EMPTY_REQUESTS);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [detail, setDetail] = useState<AiAnalysisRequestDetail | null>(null);
  const [documentDetail, setDocumentDetail] =
    useState<RequirementDocumentDetail | null>(null);
  const [comment, setComment] = useState("");
  const [modal, setModal] = useState<ModalMode>(null);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(initialError ?? "");
  const [alertTone, setAlertTone] = useState<"success" | "danger">("danger");

  const metrics = useMemo(
    () => ({
      total: requests.totalItems,
      pending: requests.items.filter((item) => item.status === "PENDING")
        .length,
      processing: requests.items.filter((item) => item.status === "PROCESSING")
        .length,
      completed: requests.items.filter((item) => item.status === "COMPLETED")
        .length,
    }),
    [requests],
  );

  function show(message: string, tone: "success" | "danger") {
    setAlert(message);
    setAlertTone(tone);
  }

  async function loadProject(selectedProjectId: string) {
    if (!selectedProjectId) {
      setSources(null);
      setDocuments(null);
      setRequests(EMPTY_REQUESTS);
      return;
    }
    setBusy(true);
    try {
      const encoded = encodeURIComponent(selectedProjectId);
      const [sourcesResponse, documentsResponse, requestsResponse] =
        await Promise.all([
          fetch(
            `${GATEWAY_URL}/api/v1/projects/${encoded}/sources?page=1&pageSize=100&processingStatus=READY&status=ACTIVE`,
            { credentials: "include" },
          ),
          fetch(`${GATEWAY_URL}/api/v1/projects/${encoded}/documents`, {
            credentials: "include",
          }),
          fetch(
            `${GATEWAY_URL}/api/v1/projects/${encoded}/analysis-requests?page=1&pageSize=50`,
            { credentials: "include" },
          ),
        ]);
      const failed = [
        sourcesResponse,
        documentsResponse,
        requestsResponse,
      ].find((response) => !response.ok);
      if (failed) throw new Error(await failure(failed));
      const nextSources = (await sourcesResponse.json()) as SourceListResponse;
      const nextDocuments =
        (await documentsResponse.json()) as RequirementDocumentListResponse;
      setSources(nextSources);
      setDocuments(nextDocuments);
      setRequests(
        (await requestsResponse.json()) as AiAnalysisRequestListResponse,
      );
      setDocumentId(nextDocuments.items[0]?.id ?? "");
      setSelectedSourceIds([]);
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadProject(projectId);
  }, [projectId]);

  useEffect(() => {
    if (
      !projectId ||
      !requests.items.some(
        (item) => item.status === "PENDING" || item.status === "PROCESSING",
      )
    )
      return;
    const timer = window.setInterval(() => void loadProject(projectId), 5000);
    return () => window.clearInterval(timer);
  }, [projectId, requests.items]);

  function toggleSource(id: string) {
    setSelectedSourceIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function createAnalysis() {
    if (!projectId || !documentId || selectedSourceIds.length === 0) return;
    setBusy(true);
    try {
      const documentResponse = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(documentId)}`,
        { credentials: "include" },
      );
      if (!documentResponse.ok)
        throw new Error(await failure(documentResponse));
      const currentDocument =
        (await documentResponse.json()) as RequirementDocumentDetail;
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            analysisType: "REQUIREMENT_DOCUMENT",
            documentId,
            documentVersionId: currentDocument.currentVersionDetail.id,
            sourceIds: selectedSourceIds,
          }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      setModal(null);
      setSelectedSourceIds([]);
      await loadProject(projectId);
      show(
        "Análisis encolado. La ejecución continuará en segundo plano.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function openReview(requestId: string) {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(requestId)}`,
        { credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as AiAnalysisRequestDetail;
      const documentResponse = await fetch(
        `${GATEWAY_URL}/api/v1/documents/${encodeURIComponent(result.documentId)}`,
        { credentials: "include" },
      );
      if (!documentResponse.ok)
        throw new Error(await failure(documentResponse));
      setDetail(result);
      setDocumentDetail(
        (await documentResponse.json()) as RequirementDocumentDetail,
      );
      setComment("");
      setModal("review");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function retry(requestId: string) {
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(requestId)}/retry`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      await loadProject(projectId);
      show("Solicitud reenviada a la cola.", "success");
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "accept" | "reject") {
    if (!detail) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}/analysis-requests/${encodeURIComponent(detail.id)}/result/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            comment,
            ...(action === "accept"
              ? {
                  expectedDocumentRevision:
                    documentDetail?.currentVersionDetail.revision,
                }
              : {}),
          }),
        },
      );
      if (!response.ok) throw new Error(await failure(response));
      setModal(null);
      setDetail(null);
      setDocumentDetail(null);
      await loadProject(projectId);
      show(
        action === "accept"
          ? "Borrador aceptado y aplicado al editor documental. Aún requiere revisión y aprobación formal."
          : "Resultado rechazado con trazabilidad del revisor.",
        "success",
      );
    } catch (error) {
      show(error instanceof Error ? error.message : String(error), "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rq-analysis-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Estado del análisis asistido">
          <RqKpiCard
            description="Solicitudes registradas"
            icon="A"
            title="Total"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Esperando trabajador"
            icon="P"
            title="Pendientes"
            value={String(metrics.pending)}
          />
          <RqKpiCard
            description="Proveedor ejecutando"
            icon="E"
            title="Procesando"
            value={String(metrics.processing)}
          />
          <RqKpiCard
            description="Listas para revisión"
            icon="R"
            title="Completadas"
            value={String(metrics.completed)}
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <RqActionButton
            disabled={busy || !projectId}
            onClick={() => setModal("create")}
            tone="affirmative"
          >
            Nuevo análisis
          </RqActionButton>
        </div>
      </section>

      {alert ? (
        <div className="rq-project-alert" data-tone={alertTone} role="alert">
          <span>{alert}</span>
          <button
            aria-label="Cerrar mensaje"
            onClick={() => setAlert("")}
            type="button"
          >
            ×
          </button>
        </div>
      ) : null}

      <section className="rq-analysis-project">
        <label className="rq-field">
          <span>Proyecto de trabajo</span>
          <select
            disabled={busy}
            onChange={(event) => setProjectId(event.target.value)}
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
          <strong>Revisión humana obligatoria</strong>
          <span>
            La IA propone un borrador. Solo un usuario autorizado puede
            incorporarlo al documento; la aprobación formal continúa en
            Validación.
          </span>
        </div>
      </section>

      <RqTableShell
        count={requests.totalItems}
        description="Ejecuciones asíncronas, reintentos, resultados y decisión humana."
        title="Análisis del proyecto"
      >
        {requests.items.length === 0 ? (
          <RqEmptyState
            description="Selecciona fuentes READY y un documento en borrador para iniciar."
            title="Sin análisis"
          />
        ) : (
          <table className="rq-table rq-analysis-table">
            <thead>
              <tr>
                <th>Solicitud</th>
                <th>Estado</th>
                <th>Fuentes</th>
                <th>Intentos</th>
                <th>Actualización</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {requests.items.map((request) => (
                <tr key={request.id}>
                  <td>
                    <strong>{request.analysisType}</strong>
                    <small>{request.id}</small>
                  </td>
                  <td>
                    <RqStatusBadge tone={statusTone(request.status)}>
                      {request.status}
                    </RqStatusBadge>
                  </td>
                  <td>{request.sourceCount}</td>
                  <td>{request.executionCount}</td>
                  <td>{dateTime(request.updatedAt)}</td>
                  <td>
                    <div className="rq-users-table__actions">
                      <RqActionButton
                        compact
                        disabled={busy}
                        onClick={() => void openReview(request.id)}
                        tone="consult"
                      >
                        Ver
                      </RqActionButton>
                      {request.status === "FAILED" ? (
                        <RqActionButton
                          compact
                          disabled={busy}
                          onClick={() => void retry(request.id)}
                          tone="operation"
                        >
                          Reintentar
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

      {modal ? (
        <div
          aria-modal="true"
          className="rq-project-modal-backdrop"
          role="dialog"
        >
          <section className="rq-project-modal rq-analysis-modal">
            <header className="rq-project-modal__header">
              <div>
                <span>Análisis asistido</span>
                <h2>
                  {modal === "create" ? "Nueva solicitud" : "Revisar resultado"}
                </h2>
              </div>
              <button
                aria-label="Cerrar"
                disabled={busy}
                onClick={() => setModal(null)}
                type="button"
              >
                ×
              </button>
            </header>
            {modal === "create" ? (
              <div className="rq-analysis-create">
                <label className="rq-field">
                  <span>Documento</span>
                  <select
                    disabled={busy}
                    onChange={(event) => setDocumentId(event.target.value)}
                    value={documentId}
                  >
                    <option value="">Selecciona un documento</option>
                    {documents?.items.map((document) => (
                      <option key={document.id} value={document.id}>
                        {document.title} · {document.currentVersion}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Fuentes READY</legend>
                  {sources?.items.length ? (
                    sources.items.map((source) => (
                      <label key={source.id}>
                        <input
                          checked={selectedSourceIds.includes(source.id)}
                          disabled={busy}
                          onChange={() => toggleSource(source.id)}
                          type="checkbox"
                        />
                        <span>
                          <strong>{source.title}</strong>
                          <small>
                            {source.classification} · {source.sourceType}
                          </small>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p>No hay fuentes READY disponibles.</p>
                  )}
                </fieldset>
                <div className="rq-project-modal__actions">
                  <RqActionButton
                    disabled={busy}
                    onClick={() => setModal(null)}
                  >
                    Cancelar
                  </RqActionButton>
                  <RqActionButton
                    disabled={
                      busy || !documentId || selectedSourceIds.length === 0
                    }
                    onClick={() => void createAnalysis()}
                    tone="affirmative"
                  >
                    Generar borrador
                  </RqActionButton>
                </div>
              </div>
            ) : detail ? (
              <div className="rq-analysis-review">
                <div className="rq-analysis-review__summary">
                  <RqStatusBadge tone={statusTone(detail.status)}>
                    {detail.status}
                  </RqStatusBadge>
                  <span>
                    {detail.executionCount} intento(s) · {detail.sourceCount}{" "}
                    fuente(s)
                  </span>
                  {detail.result ? (
                    <RqStatusBadge
                      tone={
                        detail.result.status === "ACCEPTED"
                          ? "success"
                          : detail.result.status === "REJECTED"
                            ? "danger"
                            : "pending"
                      }
                    >
                      {detail.result.status}
                    </RqStatusBadge>
                  ) : null}
                </div>
                {detail.result ? (
                  <>
                    <section className="rq-analysis-review__warnings">
                      <strong>Control de calidad</strong>
                      <span>
                        Pendientes:{" "}
                        {detail.result.draft.pendingQuestions.length} ·
                        Contradicciones:{" "}
                        {detail.result.draft.contradictions.length} ·
                        Advertencias: {detail.result.draft.warnings.length}
                      </span>
                    </section>
                    <div className="rq-analysis-sections">
                      {detail.result.draft.sections.map((section) => (
                        <article key={section.key}>
                          <h3>{section.title}</h3>
                          <p>{String(section.content)}</p>
                        </article>
                      ))}
                    </div>
                    <section>
                      <h3>
                        Requisitos propuestos (
                        {detail.result.draft.requirements.length})
                      </h3>
                      {detail.result.draft.requirements.map((requirement) => (
                        <article
                          className="rq-analysis-requirement"
                          key={requirement.clientId}
                        >
                          <strong>
                            {requirement.code} · {requirement.title}
                          </strong>
                          <p>{requirement.description}</p>
                          <small>
                            {requirement.acceptanceCriteria.length} criterio(s)
                            · {requirement.sourceIds.length} fuente(s)
                          </small>
                        </article>
                      ))}
                    </section>
                    {detail.result.status === "GENERATED" ? (
                      <>
                        <label className="rq-field">
                          <span>Comentario de revisión</span>
                          <textarea
                            maxLength={2000}
                            onChange={(event) => setComment(event.target.value)}
                            placeholder="Obligatorio al rechazar; recomendado al aceptar"
                            rows={4}
                            value={comment}
                          />
                        </label>
                        <div className="rq-project-modal__actions">
                          <RqActionButton
                            disabled={busy || !comment.trim()}
                            onClick={() => void review("reject")}
                            tone="danger"
                          >
                            Rechazar
                          </RqActionButton>
                          <RqActionButton
                            disabled={busy || !documentDetail}
                            onClick={() => void review("accept")}
                            tone="affirmative"
                          >
                            Aceptar y aplicar al editor
                          </RqActionButton>
                        </div>
                      </>
                    ) : (
                      <div className="rq-project-modal__actions">
                        <RqActionButton onClick={() => setModal(null)}>
                          Cerrar
                        </RqActionButton>
                      </div>
                    )}
                  </>
                ) : (
                  <RqEmptyState
                    description={
                      detail.status === "FAILED"
                        ? (detail.executions.at(-1)?.errorMessage ??
                          "La ejecución falló.")
                        : "La ejecución todavía no produce un borrador."
                    }
                    title="Sin resultado disponible"
                  />
                )}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
