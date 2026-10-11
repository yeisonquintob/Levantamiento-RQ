"use client";

import { useMemo, useRef, useState } from "react";

import type {
  AiAnalysisPromptDetail,
  NotificationDetail,
  NotificationClearResult,
  NotificationListResponse,
  ProjectListResponse,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

import { announceNotificationsChanged } from "../../notification-events";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import { useDialogAccessibility } from "../../use-dialog-accessibility";
import { useAutoDismiss } from "../../use-auto-dismiss";
import { useConfirm } from "../../confirm-dialog";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

const EMPTY: NotificationListResponse = {
  items: [],
  page: 1,
  pageSize: 50,
  totalItems: 0,
  totalPages: 0,
  unreadItems: 0,
};

interface Props {
  initialList?: NotificationListResponse;
  initialProjects?: ProjectListResponse;
  initialError?: string;
}

interface AlertState {
  message: string;
  tone: "danger" | "success";
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function integer(value: number): string {
  return new Intl.NumberFormat("es-CO").format(value);
}

function filterText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/giu, " ")
    .trim()
    .toLocaleLowerCase("es");
}

function duration(value: string | null): string {
  if (!value) return "No disponible";
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds)) return value;
  if (milliseconds < 1000) return `${integer(Math.round(milliseconds))} ms`;
  const seconds = milliseconds / 1000;
  return `${seconds.toLocaleString("es-CO", {
    maximumFractionDigits: seconds >= 10 ? 0 : 1,
  })} s`;
}

function failureLabel(code: string): string {
  const labels: Readonly<Record<string, string>> = {
    AI_CONFIGURATION_REQUIRED: "Configuración de IA incompleta",
    AI_AUTO_APPLY_UNAVAILABLE:
      "No fue posible aplicar el resultado al documento",
    AI_AUTO_APPLY_CONFLICT: "Conflicto al aplicar el resultado al documento",
    AI_UNKNOWN_SOURCE_REFERENCE: "La IA referenció una fuente no permitida",
    AI_EXECUTION_FAILED: "Error general durante la ejecución",
    OPENAI_TIMEOUT: "OpenAI superó el tiempo máximo de espera",
    OPENAI_UNAVAILABLE: "No fue posible conectar con OpenAI",
    OPENAI_INVALID_RESPONSE: "OpenAI devolvió una respuesta inválida",
    OPENAI_INVALID_JSON: "La respuesta estructurada no contiene JSON válido",
    OPENAI_HTTP_401: "La credencial de OpenAI fue rechazada",
    OPENAI_HTTP_429: "OpenAI aplicó un límite temporal de solicitudes",
  };

  if (labels[code]) return labels[code];

  if (code.startsWith("OPENAI_HTTP_")) {
    return `OpenAI rechazó la ejecución (${code.replace("OPENAI_HTTP_", "HTTP ")})`;
  }

  return "Falla registrada durante el análisis";
}

function typeLabel(value: NotificationDetail["notificationType"]): string {
  return {
    REVIEW_ASSIGNED: "Revisión asignada",
    CHANGES_REQUESTED: "Correcciones",
    DOCUMENT_APPROVED: "Aprobación",
    DOCUMENT_REJECTED: "Rechazo",
    EXPORT_READY: "Exportación lista",
    EXPORT_FAILED: "Exportación fallida",
    ANALYSIS_COMPLETED: "Borrador generado",
    ANALYSIS_FAILED: "Análisis fallido",
  }[value];
}

function canViewPrompt(notification: NotificationDetail): boolean {
  const terminalAnalysis =
    notification.notificationType === "ANALYSIS_COMPLETED" ||
    notification.notificationType === "ANALYSIS_FAILED";
  const generatedFromSources =
    notification.resourceType === "SourceAnalysisRequest" ||
    (notification.notificationType === "ANALYSIS_COMPLETED" &&
      notification.resourceType === "AnalysisRequest");

  return (
    terminalAnalysis &&
    generatedFromSources &&
    Boolean(notification.projectId) &&
    Boolean(notification.resourceId)
  );
}

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

export function NotificationsWorkspace({
  initialList,
  initialProjects,
  initialError,
}: Props) {
  const confirm = useConfirm();
  const [list, setList] = useState(initialList ?? EMPTY);
  const [state, setState] = useState<"ALL" | "UNREAD" | "READ">("ALL");
  const [projectFilter, setProjectFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [promptLoadingId, setPromptLoadingId] = useState<string | null>(null);
  const [promptView, setPromptView] = useState<AiAnalysisPromptDetail | null>(
    null,
  );
  const [alert, setAlert] = useState<AlertState | null>(
    initialError ? { message: initialError, tone: "danger" } : null,
  );
  useAutoDismiss(alert, () => setAlert(null));
  const readInFlight = useRef(new Set<string>());
  const projects = initialProjects?.items ?? [];
  const promptDialogRef = useDialogAccessibility<HTMLElement>(
    Boolean(promptView),
    () => setPromptView(null),
  );
  const readItems = useMemo(
    () => Math.max(0, list.totalItems - list.unreadItems),
    [list],
  );
  const visibleItems = useMemo(() => {
    const projectQuery = filterText(projectFilter);
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
    return list.items.filter((item) => {
      const project = projects.find((entry) => entry.id === item.projectId);
      const projectText = filterText(
        `${project?.title ?? ""} ${project?.code ?? ""} ${item.projectId ?? ""}`,
      );
      const created = new Date(item.createdAt).getTime();
      return (
        (!projectQuery || projectText.includes(projectQuery)) &&
        (from === null || created >= from) &&
        (to === null || created <= to)
      );
    });
  }, [dateFrom, dateTo, list.items, projectFilter, projects]);

  async function refresh(nextState = state) {
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/notifications?state=${nextState}&page=1&pageSize=50`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) throw new Error(await failure(response));
    setList((await response.json()) as NotificationListResponse);
  }

  async function applyFilter(nextState = state) {
    setBusyId("filter");
    try {
      await refresh(nextState);
      setAlert(null);
    } catch (error) {
      setAlert({
        message: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function persistRead(notification: NotificationDetail) {
    if (notification.status === "READ") return;
    const response = await fetch(
      `${GATEWAY_URL}/api/v1/notifications/${encodeURIComponent(notification.id)}/read`,
      { method: "POST", credentials: "include" },
    );
    if (!response.ok) throw new Error(await failure(response));
    await refresh();
    announceNotificationsChanged();
  }

  async function markRead(notification: NotificationDetail) {
    if (
      notification.status === "READ" ||
      readInFlight.current.has(notification.id)
    )
      return;
    readInFlight.current.add(notification.id);
    setBusyId(notification.id);
    try {
      await persistRead(notification);
      setAlert(null);
    } catch (error) {
      setAlert({
        message: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      readInFlight.current.delete(notification.id);
      setBusyId(null);
    }
  }

  async function viewPrompt(notification: NotificationDetail) {
    if (
      !canViewPrompt(notification) ||
      !notification.projectId ||
      !notification.resourceId
    ) {
      return;
    }

    setPromptLoadingId(notification.id);
    try {
      await persistRead(notification);
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(
          notification.projectId,
        )}/analysis-requests/${encodeURIComponent(
          notification.resourceId,
        )}/prompt`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await failure(response));
      setPromptView((await response.json()) as AiAnalysisPromptDetail);
      setAlert(null);
    } catch (error) {
      setAlert({
        message: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      setPromptLoadingId(null);
    }
  }

  async function clearNotifications() {
    if (list.totalItems === 0) return;
    if (
      !(await confirm({
        title: "Vaciar notificaciones",
        message: `Se eliminarán las ${list.totalItems} notificación(es) de tu bandeja. Esta acción no elimina proyectos ni documentos.`,
        confirmLabel: "Eliminar notificaciones",
        destructive: true,
      }))
    ) {
      return;
    }

    setBusyId("clear");
    try {
      const response = await fetch(`${GATEWAY_URL}/api/v1/notifications`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await failure(response));
      const result = (await response.json()) as NotificationClearResult;
      setList(EMPTY);
      setState("ALL");
      announceNotificationsChanged();
      setAlert({
        message:
          result.count === 1
            ? "Se eliminó 1 notificación."
            : `Se eliminaron ${result.count} notificaciones.`,
        tone: "success",
      });
    } catch (error) {
      setAlert({
        message: error instanceof Error ? error.message : String(error),
        tone: "danger",
      });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rq-module-page rq-notifications-workspace">
      {alert ? (
        <div className="rq-inline-alert" data-tone={alert.tone} role="alert">
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

      <section className="rq-module-commandbar rq-notifications-commandbar">
        <RqKpiGrid label="Resumen de notificaciones">
          <RqKpiCard
            icon={<WorkspaceKpiIcon name="bell" />}
            title="Total"
            description="Avisos en la bandeja"
            value={String(list.totalItems)}
          />
          <RqKpiCard
            icon={<WorkspaceKpiIcon name="eye" />}
            title="Pendientes / leídas"
            description="Pendientes por atender / eventos ya revisados"
            value={`${list.unreadItems} / ${readItems}`}
          />
          <RqKpiCard
            icon={<WorkspaceKpiIcon name="server" />}
            title="Canal"
            description="Entrega en la aplicación"
            value="Interno"
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions rq-notifications-commandbar__actions">
          <RqActionButton
            disabled={busyId !== null}
            onClick={() => void applyFilter()}
            tone="consult"
          >
            Consultar
          </RqActionButton>
          <RqActionButton
            disabled={busyId !== null}
            onClick={() => {
              setState("ALL");
              setProjectFilter("");
              setDateFrom("");
              setDateTo("");
              void applyFilter("ALL");
            }}
            tone="secondary"
          >
            Restablecer filtros
          </RqActionButton>
          <RqActionButton
            disabled={busyId !== null || list.totalItems === 0}
            onClick={() => void clearNotifications()}
            tone="danger"
          >
            {busyId === "clear" ? "Eliminando…" : "Limpiar notificaciones"}
          </RqActionButton>
        </div>
      </section>

      <form
        className="rq-projects-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado"
            id="notification-state"
            value={state}
            onChange={(event) =>
              setState(event.target.value as "ALL" | "UNREAD" | "READ")
            }
          >
            <option value="ALL">Todas</option>
            <option value="UNREAD">Sin leer</option>
            <option value="READ">Leídas</option>
          </select>
        </label>
        <label className="rq-projects-filter rq-projects-filter--search">
          <span>Proyecto:</span>
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
            aria-label="Proyecto"
            autoComplete="off"
            id="notification-project"
            list="notification-project-options"
            onChange={(event) => setProjectFilter(event.target.value)}
            placeholder="Escribe o selecciona un proyecto"
            type="search"
            value={projectFilter}
          />
          <datalist id="notification-project-options">
            {projects.map((project) => (
              <option
                key={project.id}
                value={`${project.title} · ${project.code}`}
              />
            ))}
          </datalist>
        </label>
        <label className="rq-projects-filter">
          <span>Desde:</span>
          <input
            aria-label="Desde"
            id="notification-date-from"
            onChange={(event) => setDateFrom(event.target.value)}
            type="date"
            value={dateFrom}
          />
        </label>
        <label className="rq-projects-filter">
          <span>Hasta:</span>
          <input
            aria-label="Hasta"
            id="notification-date-to"
            min={dateFrom || undefined}
            onChange={(event) => setDateTo(event.target.value)}
            type="date"
            value={dateTo}
          />
        </label>
      </form>

      <RqTableShell
        count={visibleItems.length}
        description="Abre un evento para consultar su detalle; la notificación se marcará como leída automáticamente."
        title="Bandeja personal"
      >
        {visibleItems.length === 0 ? (
          <RqEmptyState
            description="Los eventos relevantes de tus proyectos aparecerán aquí."
            title="Sin notificaciones para mostrar"
          />
        ) : (
          <table className="rq-table">
            <thead>
              <tr>
                <th scope="col">Evento</th>
                <th scope="col">Mensaje</th>
                <th scope="col">Estado</th>
                <th scope="col">Fecha</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr
                  key={item.id}
                  data-unread={item.status !== "READ"}
                  onPointerEnter={() => void markRead(item)}
                >
                  <td>
                    <button
                      className="rq-notification-event-button"
                      disabled={
                        busyId !== null ||
                        promptLoadingId !== null ||
                        (item.status === "READ" && !canViewPrompt(item))
                      }
                      onClick={() =>
                        void (canViewPrompt(item)
                          ? viewPrompt(item)
                          : markRead(item))
                      }
                      type="button"
                    >
                      {typeLabel(item.notificationType)}
                    </button>
                  </td>
                  <td>
                    <strong>{item.subject}</strong>
                    <small className="rq-table-secondary">{item.body}</small>
                  </td>
                  <td>
                    <RqStatusBadge
                      tone={item.status === "READ" ? "neutral" : "pending"}
                    >
                      {item.status === "READ" ? "Leída" : "Sin leer"}
                    </RqStatusBadge>
                  </td>
                  <td>{dateTime(item.createdAt)}</td>
                  <td>
                    <div className="rq-notification-table__actions">
                      {canViewPrompt(item) ? (
                        <RqActionButton
                          className="rq-row-open"
                          compact
                          disabled={busyId !== null || promptLoadingId !== null}
                          onClick={() => void viewPrompt(item)}
                          tone="consult"
                        >
                          {promptLoadingId === item.id ? "Cargando…" : "Abrir"}
                        </RqActionButton>
                      ) : null}
                      <RqActionButton
                        compact
                        disabled={
                          item.status === "READ" ||
                          busyId !== null ||
                          promptLoadingId !== null
                        }
                        onClick={() => void markRead(item)}
                        tone="consult"
                      >
                        {busyId === item.id ? "Guardando…" : "Marcar leída"}
                      </RqActionButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

      {promptView ? (
        <div className="rq-project-modal-backdrop" role="presentation">
          <section
            aria-labelledby="notification-prompt-title"
            aria-modal="true"
            className="rq-project-modal rq-notification-prompt-modal"
            ref={promptDialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="rq-project-modal__header">
              <div>
                <span>
                  {promptView.status === "FAILED"
                    ? "Diagnóstico de la ejecución"
                    : "Solicitud a la IA"}
                </span>
                <h2 id="notification-prompt-title">
                  {promptView.status === "FAILED"
                    ? "Detalle de la falla"
                    : "Prompt de la solicitud"}
                </h2>
              </div>
              <button
                aria-label="Cerrar detalle de la solicitud"
                onClick={() => setPromptView(null)}
                type="button"
              >
                ×
              </button>
            </header>
            <div className="rq-notification-prompt">
              <small>
                Solicitud {promptView.analysisRequestId} · versión{" "}
                {promptView.generatedVersion}
              </small>

              {promptView.failure ? (
                <section
                  aria-label="Detalle técnico de la falla"
                  className="rq-notification-failure-detail"
                >
                  <div className="rq-notification-failure-detail__header">
                    <div>
                      <span>Razón registrada</span>
                      <strong>{failureLabel(promptView.failure.code)}</strong>
                    </div>
                    <span className="rq-notification-failure-detail__badge">
                      Fallida
                    </span>
                  </div>

                  <p>{promptView.failure.message}</p>

                  <dl className="rq-notification-failure-detail__grid">
                    <div>
                      <dt>Código técnico</dt>
                      <dd>
                        <code>{promptView.failure.code}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Etapa</dt>
                      <dd>{promptView.failure.stage}</dd>
                    </div>
                    <div>
                      <dt>Intento</dt>
                      <dd>{promptView.failure.attempt ?? "No disponible"}</dd>
                    </div>
                    <div>
                      <dt>Proveedor</dt>
                      <dd>{promptView.failure.provider ?? "No disponible"}</dd>
                    </div>
                    <div>
                      <dt>Modelo</dt>
                      <dd>{promptView.failure.model ?? "No disponible"}</dd>
                    </div>
                    <div>
                      <dt>Duración</dt>
                      <dd>{duration(promptView.failure.durationMs)}</dd>
                    </div>
                    <div>
                      <dt>Tokens entrada reales</dt>
                      <dd>
                        {promptView.failure.inputTokens === null
                          ? "No disponibles"
                          : integer(promptView.failure.inputTokens)}
                      </dd>
                    </div>
                    <div>
                      <dt>Tokens salida</dt>
                      <dd>
                        {promptView.failure.outputTokens === null
                          ? "No disponibles"
                          : integer(promptView.failure.outputTokens)}
                      </dd>
                    </div>
                    <div>
                      <dt>Fecha de finalización</dt>
                      <dd>
                        {dateTime(
                          promptView.failure.finishedAt ?? promptView.createdAt,
                        )}
                      </dd>
                    </div>
                    {promptView.failure.providerRequestId ? (
                      <div>
                        <dt>Request ID proveedor</dt>
                        <dd className="rq-notification-failure-detail__technical">
                          {promptView.failure.providerRequestId}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              <div className="rq-notification-prompt__heading">
                <strong>Prompt preparado</strong>
                <small>
                  ≈ {integer(promptView.estimatedInputTokens)} tokens estimados
                </small>
              </div>
              <pre>{promptView.prompt}</pre>
              <div className="rq-project-modal__actions">
                <RqActionButton
                  onClick={() => setPromptView(null)}
                  tone="secondary"
                >
                  Cerrar
                </RqActionButton>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
