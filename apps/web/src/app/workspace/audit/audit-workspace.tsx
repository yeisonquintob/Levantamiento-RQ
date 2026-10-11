"use client";

import { useEffect, useState } from "react";
import type {
  AuditHistoryResponse,
  AuditChangeValue,
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
import { authenticatedFetch } from "../../authenticated-fetch";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import styles from "./audit-workspace.module.css";
import { useAutoDismiss } from "../../use-auto-dismiss";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");
const EMPTY: AuditHistoryResponse = {
  items: [],
  page: 1,
  pageSize: 25,
  totalItems: 0,
  totalPages: 0,
};
const VIEWS = {
  changes: "Cambios administrativos",
  projects: "Proyectos",
  approvals: "Aprobaciones",
} as const;
type View = keyof typeof VIEWS;
const ACTIONS: Record<string, string> = {
  CREATED: "Proveedor creado",
  UPDATED: "Proveedor modificado",
  DUPLICATED: "Proveedor duplicado",
  DELETED: "Proveedor eliminado",
  CREDENTIAL_ROTATED: "Credencial cambiada",
  CONNECTION_TESTED: "Conexión verificada",
  USER_CREATED: "Usuario creado",
  USER_SELF_REGISTERED: "Cuenta registrada",
  USER_UPDATED: "Usuario modificado",
  USER_ACTIVATED: "Usuario activado / aprobado",
  USER_DEACTIVATED: "Usuario desactivado",
  ROLE_ASSIGNED: "Rol asignado",
  ROLE_REMOVED: "Rol retirado",
  PASSWORD_RESET: "Contraseña restablecida",
  SESSIONS_REVOKED: "Sesiones cerradas",
  PROJECT_CREATED: "Proyecto creado",
  PROJECT_UPDATED: "Proyecto modificado",
  PROJECT_DELETED: "Proyecto eliminado",
  PROJECT_PARTICIPANT_ADDED: "Participante agregado",
  PROJECT_PARTICIPANT_REMOVED: "Participante retirado",
  REVIEW_REQUESTED: "Revisión solicitada",
  DOCUMENT_CHANGES_REQUESTED: "Correcciones solicitadas",
  DOCUMENT_APPROVED: "Documento aprobado",
  DOCUMENT_REJECTED: "Documento rechazado",
};
const FIELDS: Record<string, string> = {
  title: "Título",
  requestingArea: "Área solicitante",
  description: "Descripción",
  status: "Estado",
  template: "Plantilla",
  participant: "Participante",
  role: "Rol",
  displayName: "Nombre",
  email: "Correo",
  roles: "Roles",
  isActive: "Activo",
  name: "Nombre",
  purpose: "Uso",
  providerType: "Proveedor",
  model: "Modelo",
  baseUrl: "Dirección del servicio",
  isEnabled: "Habilitado",
  isDefault: "Predeterminado",
  timeoutMs: "Tiempo máximo (ms)",
  maxInputTokens: "Límite de entrada",
  maxOutputTokens: "Límite de salida",
  maxAttempts: "Intentos",
  credential: "Credencial",
};
const VALUES: Record<string, string> = {
  DRAFT: "Borrador",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  CHANGES_REQUESTED: "Correcciones solicitadas",
  ARCHIVED: "Archivado",
};
export function auditValue(value: AuditChangeValue): string {
  if (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return "Vacío";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  return Array.isArray(value)
    ? value.join(", ")
    : (VALUES[String(value)] ?? String(value));
}
function dateTime(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(new Date(value));
}

export function AuditWorkspace({
  initialProjects,
  initialError,
}: {
  initialProjects?: ProjectListResponse;
  initialError?: string;
}) {
  const [view, setView] = useState<View>("changes");
  const [module, setModule] = useState("ai");
  const [filters, setFilters] = useState({
    search: "",
    projectId: "",
    result: "",
    from: "",
    to: "",
    page: 1,
  });
  const [list, setList] = useState(EMPTY);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useAutoDismiss(error, () => setError(""));
  const [revision, setRevision] = useState(0);
  function filter(key: keyof typeof filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(async () => {
      const query = new URLSearchParams({
        page: String(filters.page),
        pageSize: "25",
      });
      for (const key of ["search", "result", "from", "to"] as const)
        if (filters[key]) query.set(key, filters[key]);
      if (view !== "changes" && filters.projectId)
        query.set("projectId", filters.projectId);
      const path =
        view === "projects"
          ? "projects/audit-events"
          : view === "approvals"
            ? "admin/audit/approvals"
            : module === "ai"
              ? "admin/ai-providers/audit-events"
              : "users/audit-events";
      try {
        const response = await authenticatedFetch(
          `${GATEWAY_URL}/api/v1/${path}?${query}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(
            payload.detail ??
              payload.message ??
              "No fue posible consultar la auditoría.",
          );
        }
        const data = (await response.json()) as AuditHistoryResponse;
        if (!controller.signal.aborted) setList(data);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setList(EMPTY);
          setError(
            reason instanceof Error
              ? reason.message
              : "No fue posible consultar la auditoría.",
          );
        }
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [view, module, filters, revision]);

  return (
    <section className="rq-module-page rq-audit-workspace">
      <div className={styles.tabs} role="group" aria-label="Tipo de auditoría">
        {(Object.entries(VIEWS) as [View, string][]).map(([key, label]) => (
          <RqActionButton
            key={key}
            tone={view === key ? "operation" : "secondary"}
            aria-pressed={view === key}
            onClick={() => {
              setView(key);
              setFilters({
                search: "",
                projectId: "",
                result: "",
                from: "",
                to: "",
                page: 1,
              });
            }}
          >
            {label}
          </RqActionButton>
        ))}
      </div>
      <RqKpiGrid label="Resumen de auditoría">
        <RqKpiCard
          icon={<WorkspaceKpiIcon name="file" />}
          title="Eventos"
          description="Resultado filtrado"
          value={busy ? "…" : String(list.totalItems)}
        />
        <RqKpiCard
          icon={<WorkspaceKpiIcon name="check" />}
          title="Correctos / fallidos"
          description="Correctos / fallidos en la página actual"
          value={
            busy
              ? "…"
              : `${list.items.filter((item) => item.result === "SUCCEEDED").length} / ${list.items.filter((item) => item.result === "FAILED").length}`
          }
        />
      </RqKpiGrid>
      <form
        className="rq-projects-filters"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="rq-projects-filter rq-projects-filter--search">
          <span>Buscar:</span>
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
            aria-label="Buscar por persona, recurso, acción o cambio"
            id="audit-search"
            placeholder="Persona, recurso, acción o cambio"
            maxLength={200}
            type="search"
            value={filters.search}
            onChange={(event) => filter("search", event.target.value)}
          />
        </label>
        {view === "changes" ? (
          <label className="rq-projects-filter">
            <span>Configuración:</span>
            <select
              aria-label="Configuración"
              id="audit-module"
              value={module}
              onChange={(event) => {
                setModule(event.target.value);
                setFilters((current) => ({ ...current, page: 1 }));
              }}
            >
              <option value="ai">Proveedores de IA</option>
              <option value="users">Usuarios y roles</option>
            </select>
          </label>
        ) : (
          <label className="rq-projects-filter">
            <span>Proyecto:</span>
            <select
              aria-label="Proyecto"
              id="audit-project"
              value={filters.projectId}
              onChange={(event) => filter("projectId", event.target.value)}
            >
              <option value="">Todos los proyectos</option>
              {initialProjects?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="rq-projects-filter">
          <span>Desde:</span>
          <input
            aria-label="Desde"
            id="audit-from"
            type="date"
            value={filters.from}
            onChange={(event) => filter("from", event.target.value)}
          />
        </label>
        <label className="rq-projects-filter">
          <span>Hasta:</span>
          <input
            aria-label="Hasta"
            id="audit-to"
            type="date"
            value={filters.to}
            onChange={(event) => filter("to", event.target.value)}
          />
        </label>
        <label className="rq-projects-filter">
          <span>Resultado:</span>
          <select
            aria-label="Resultado"
            id="audit-result"
            value={filters.result}
            onChange={(event) => filter("result", event.target.value)}
          >
            <option value="">Todos</option>
            <option value="SUCCEEDED">Correcto</option>
            <option value="FAILED">Fallido</option>
            <option value="DENIED">Denegado</option>
          </select>
        </label>
        <RqActionButton
          tone="secondary"
          onClick={() =>
            setFilters({
              search: "",
              projectId: "",
              result: "",
              from: "",
              to: "",
              page: 1,
            })
          }
        >
          Limpiar
        </RqActionButton>
        <RqActionButton
          tone="consult"
          disabled={busy}
          onClick={() => setRevision((current) => current + 1)}
        >
          Actualizar
        </RqActionButton>
      </form>
      {initialError && view !== "changes" ? (
        <p role="status">
          {initialError} Puedes consultar el historial completo y buscar el
          proyecto por su nombre.
        </p>
      ) : null}
      {error ? (
        <div className="rq-inline-alert" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}
      <RqTableShell
        count={busy ? undefined : list.totalItems}
        title={VIEWS[view]}
        description="Quién realizó el cambio, dónde y qué valores se modificaron. Fechas en hora de Colombia."
      >
        {busy ? (
          <p className={styles.message} role="status">
            Cargando historial…
          </p>
        ) : error ? (
          <p className={styles.message}>
            La consulta falló. Pulsa Actualizar para reintentar.
          </p>
        ) : list.items.length === 0 ? (
          <RqEmptyState
            title="Sin cambios para estos filtros"
            description="El historial se consulta automáticamente. Prueba otro módulo o amplía las fechas."
          />
        ) : (
          <div className={styles.scroll}>
            <table className={`rq-table ${styles.table}`}>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Persona</th>
                  <th scope="col">Acción</th>
                  <th scope="col">Dónde</th>
                  <th scope="col">Cambios</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((item) => (
                  <tr key={item.id}>
                    <td>{dateTime(item.occurredAt)}</td>
                    <td>
                      <strong>
                        {item.actorName ??
                          (item.actorUserId ? "Usuario registrado" : "Sistema")}
                      </strong>
                      {item.actorUserId ? (
                        <small className="rq-table-secondary">
                          {item.actorUserId}
                        </small>
                      ) : null}
                    </td>
                    <td>
                      {ACTIONS[item.action] ??
                        ACTIONS[item.action.replace(/^AI_PROVIDER_/u, "")] ??
                        item.action}
                    </td>
                    <td>
                      <strong>{item.resourceLabel}</strong>
                      <small className="rq-table-secondary">
                        {view === "changes"
                          ? module === "ai"
                            ? "Configuración · Proveedores de IA"
                            : "Configuración · Usuarios y roles"
                          : view === "projects"
                            ? "Proyectos"
                            : "Validación · Documentos"}
                      </small>
                    </td>
                    <td>
                      {item.changes.length ? (
                        <details>
                          <summary>
                            {item.changes.length}{" "}
                            {item.changes.length === 1
                              ? "campo modificado"
                              : "campos modificados"}
                          </summary>
                          <dl className={styles.changes}>
                            {item.changes.map((change, index) => (
                              <div key={`${change.field}-${index}`}>
                                <dt>{FIELDS[change.field] ?? change.field}</dt>
                                <dd>
                                  <span>Antes</span>
                                  <p>{auditValue(change.before)}</p>
                                </dd>
                                <dd>
                                  <span>Después</span>
                                  <p>{auditValue(change.after)}</p>
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      ) : (
                        <span>
                          {item.details
                            ? "Acción registrada"
                            : "Sin detalle de campos registrado"}
                        </span>
                      )}
                      {item.details ? (
                        <p className={styles.detail}>{item.details}</p>
                      ) : null}
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
                        {item.result === "SUCCEEDED"
                          ? "Correcto"
                          : item.result === "FAILED"
                            ? "Fallido"
                            : "Denegado"}
                      </RqStatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RqTableShell>
      <div className={styles.pagination}>
        <RqActionButton
          tone="secondary"
          disabled={busy || filters.page <= 1}
          onClick={() =>
            setFilters((current) => ({ ...current, page: current.page - 1 }))
          }
        >
          Anterior
        </RqActionButton>
        <span aria-live="polite">
          Página {list.totalPages ? filters.page : 0} de {list.totalPages}
        </span>
        <RqActionButton
          tone="secondary"
          disabled={busy || filters.page >= list.totalPages}
          onClick={() =>
            setFilters((current) => ({ ...current, page: current.page + 1 }))
          }
        >
          Siguiente
        </RqActionButton>
      </div>
    </section>
  );
}
