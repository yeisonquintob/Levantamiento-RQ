"use client";

import { useMemo, useState } from "react";

import type {
  NotificationDetail,
  NotificationListResponse,
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
  initialError?: string;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function typeLabel(value: NotificationDetail["notificationType"]): string {
  return {
    REVIEW_ASSIGNED: "Revisión asignada",
    CHANGES_REQUESTED: "Correcciones",
    DOCUMENT_APPROVED: "Aprobación",
    DOCUMENT_REJECTED: "Rechazo",
    EXPORT_READY: "Exportación lista",
    EXPORT_FAILED: "Exportación fallida",
    ANALYSIS_FAILED: "Análisis fallido",
  }[value];
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

export function NotificationsWorkspace({ initialList, initialError }: Props) {
  const [list, setList] = useState(initialList ?? EMPTY);
  const [state, setState] = useState<"ALL" | "UNREAD" | "READ">("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [alert, setAlert] = useState(initialError ?? "");
  const readItems = useMemo(
    () => Math.max(0, list.totalItems - list.unreadItems),
    [list],
  );

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
      setAlert("");
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function markRead(notification: NotificationDetail) {
    if (notification.status === "READ") return;
    setBusyId(notification.id);
    try {
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/notifications/${encodeURIComponent(notification.id)}/read`,
        { method: "POST", credentials: "include" },
      );
      if (!response.ok) throw new Error(await failure(response));
      await refresh();
      setAlert("");
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rq-module-page rq-notifications-workspace">
      {alert ? (
        <div className="rq-inline-alert" data-tone="danger" role="alert">
          {alert}
        </div>
      ) : null}

      <RqKpiGrid label="Resumen de notificaciones">
        <RqKpiCard
          icon="N"
          title="Total"
          description="Registros consultables"
          value={String(list.totalItems)}
        />
        <RqKpiCard
          icon="P"
          title="Pendientes"
          description="Sin leer"
          value={String(list.unreadItems)}
        />
        <RqKpiCard
          icon="L"
          title="Leídas"
          description="Atendidas"
          value={String(readItems)}
        />
        <RqKpiCard
          icon="C"
          title="Canal"
          description="Entrega activa"
          value="Interno"
        />
      </RqKpiGrid>

      <div className="rq-filter-bar">
        <div className="rq-field">
          <label htmlFor="notification-state">Estado</label>
          <select
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
        </div>
        <div />
        <div className="rq-filter-bar__actions">
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
              void applyFilter("ALL");
            }}
            tone="secondary"
          >
            Limpiar
          </RqActionButton>
        </div>
      </div>

      <RqTableShell
        count={list.totalItems}
        description="Avisos generados por eventos funcionales, sin duplicados ni contenido sensible."
        title="Bandeja personal"
      >
        {list.items.length === 0 ? (
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
              {list.items.map((item) => (
                <tr key={item.id} data-unread={item.status !== "READ"}>
                  <td>
                    <strong>{typeLabel(item.notificationType)}</strong>
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
                    <RqActionButton
                      compact
                      disabled={item.status === "READ" || busyId !== null}
                      onClick={() => void markRead(item)}
                      tone="consult"
                    >
                      {busyId === item.id ? "Guardando…" : "Marcar leída"}
                    </RqActionButton>
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
