"use client";

import { useEffect, useState } from "react";

import type {
  AuditEventListResponse,
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

const GATEWAY_URL =
  process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000";

const EMPTY: AuditEventListResponse = {
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

function dateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
  return "La consulta no pudo completarse.";
}

export function AuditWorkspace({ initialProjects, initialError }: Props) {
  const projects = initialProjects?.items ?? [];
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const [list, setList] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [alert, setAlert] = useState(initialError ?? "");

  async function load(
    selectedProject = projectId,
    selectedAction = action,
    selectedResult = result,
  ) {
    if (!selectedProject) {
      setList(EMPTY);
      return;
    }
    setBusy(true);
    try {
      const query = new URLSearchParams({ page: "1", pageSize: "50" });
      if (selectedAction.trim()) query.set("action", selectedAction.trim());
      if (selectedResult) query.set("result", selectedResult);
      const response = await fetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(selectedProject)}/audit-events?${query}`,
        { credentials: "include", cache: "no-store" },
      );
      if (!response.ok) throw new Error(await failure(response));
      setList((await response.json()) as AuditEventListResponse);
      setAlert("");
    } catch (error) {
      setAlert(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load(projectId, "", "");
  }, [projectId]);

  const succeeded = list.items.filter(
    (item) => item.result === "SUCCEEDED",
  ).length;
  const failed = list.items.filter((item) => item.result === "FAILED").length;
  const denied = list.items.filter((item) => item.result === "DENIED").length;

  return (
    <section className="rq-module-page rq-audit-workspace">
      {alert ? (
        <div className="rq-inline-alert" data-tone="danger" role="alert">
          {alert}
        </div>
      ) : null}

      <RqKpiGrid label="Resumen de auditoría">
        <RqKpiCard
          icon="E"
          title="Eventos"
          description="Resultado filtrado"
          value={String(list.totalItems)}
        />
        <RqKpiCard
          icon="C"
          title="Correctos"
          description="En la página actual"
          value={String(succeeded)}
        />
        <RqKpiCard
          icon="F"
          title="Fallidos"
          description="En la página actual"
          value={String(failed)}
        />
        <RqKpiCard
          icon="D"
          title="Denegados"
          description="En la página actual"
          value={String(denied)}
        />
      </RqKpiGrid>

      <div className="rq-filter-bar rq-audit-filter-bar">
        <div className="rq-field">
          <label htmlFor="audit-project">Proyecto</label>
          <select
            id="audit-project"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.code} · {project.title}
              </option>
            ))}
          </select>
        </div>
        <div className="rq-field">
          <label htmlFor="audit-action">Acción exacta</label>
          <input
            id="audit-action"
            maxLength={120}
            onChange={(event) => setAction(event.target.value)}
            placeholder="Ej. DOCUMENT_APPROVED"
            value={action}
          />
        </div>
        <div className="rq-field">
          <label htmlFor="audit-result">Resultado</label>
          <select
            id="audit-result"
            onChange={(event) => setResult(event.target.value)}
            value={result}
          >
            <option value="">Todos</option>
            <option value="SUCCEEDED">Correcto</option>
            <option value="FAILED">Fallido</option>
            <option value="DENIED">Denegado</option>
          </select>
        </div>
        <div className="rq-filter-bar__actions">
          <RqActionButton
            disabled={busy || !projectId}
            onClick={() => void load()}
            tone="consult"
          >
            {busy ? "Consultando…" : "Consultar"}
          </RqActionButton>
          <RqActionButton
            disabled={busy}
            onClick={() => {
              setAction("");
              setResult("");
              void load(projectId, "", "");
            }}
            tone="secondary"
          >
            Limpiar
          </RqActionButton>
        </div>
      </div>

      <RqTableShell
        count={list.totalItems}
        description="Actor, recurso, resultado, correlación y contexto técnico seguro por proyecto."
        title="Trazabilidad operacional"
      >
        {list.items.length === 0 ? (
          <RqEmptyState
            description={
              projectId
                ? "Ajusta los filtros o ejecuta una operación funcional del proyecto."
                : "Crea o selecciona un proyecto para consultar su actividad."
            }
            title="Sin eventos para mostrar"
          />
        ) : (
          <table className="rq-table rq-audit-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
                <th>Recurso</th>
                <th>Resultado</th>
                <th>Actor</th>
                <th>Correlación</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((item) => (
                <tr key={item.id}>
                  <td>{dateTime(item.occurredAt)}</td>
                  <td>
                    <strong>{item.action}</strong>
                  </td>
                  <td>
                    {item.resourceType}
                    <small className="rq-table-secondary">
                      {item.resourceId ?? "Sin identificador"}
                    </small>
                  </td>
                  <td>
                    <RqStatusBadge
                      tone={
                        item.result === "SUCCEEDED"
                          ? "success"
                          : item.result === "FAILED"
                            ? "danger"
                            : "pending"
                      }
                    >
                      {item.result}
                    </RqStatusBadge>
                  </td>
                  <td>{item.actorUserId ?? "Sistema"}</td>
                  <td>
                    <code>{item.correlationId}</code>
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
