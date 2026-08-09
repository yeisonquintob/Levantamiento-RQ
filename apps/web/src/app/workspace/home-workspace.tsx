import Link from "next/link";

import type {
  ProjectListResponse,
  ProjectMetrics,
  ProjectStatus,
} from "@levantamiento-rq/shared-contracts";
import {
  RqEmptyState,
  RqKpiCard,
  RqKpiGrid,
  RqStatusBadge,
  RqTableShell,
} from "@levantamiento-rq/shared-ui";

const EMPTY_METRICS: ProjectMetrics = {
  total: 0,
  draft: 0,
  inProgress: 0,
  validation: 0,
  approved: 0,
  archived: 0,
};

const DOCUMENT_FLOW_BASE = [
  {
    number: "1",
    title: "Crear proyecto y encabezado",
    description: "Crear el proyecto y definir la información principal.",
  },
  {
    number: "2",
    title: "Cargar datos y fuentes",
    description: "Registrar notas, conversaciones, transcripciones y archivos.",
  },
  {
    number: "3",
    title: "Analizar con IA",
    description: "Interpretar las fuentes y detectar vacíos o contradicciones.",
  },
  {
    number: "4",
    title: "Borradores versionados",
    description: "Generar el primer borrador y las versiones siguientes.",
  },
  {
    number: "5",
    title: "Aprobar",
    description: "Validar el contenido y bloquear la versión aprobada.",
  },
  {
    number: "6",
    title: "PDF y Markdown",
    description: "Publicar los entregables desde el contenido aprobado.",
  },
] as const;

type FlowState = "current" | "available" | "pending" | "locked";

interface HomeWorkspaceProps {
  initialList?: ProjectListResponse;
  initialMetrics?: ProjectMetrics;
  initialError?: string | null;
}

function statusLabel(status: ProjectStatus): string {
  if (status === "IN_PROGRESS") return "En elaboración";
  if (status === "VALIDATION") return "En validación";
  if (status === "APPROVED") return "Aprobado";
  if (status === "ARCHIVED") return "Archivado";
  return "Borrador";
}

function statusTone(
  status: ProjectStatus,
): "success" | "process" | "pending" | "inactive" | "neutral" {
  if (status === "APPROVED") return "success";
  if (status === "IN_PROGRESS") return "process";
  if (status === "VALIDATION") return "pending";
  if (status === "ARCHIVED") return "inactive";
  return "neutral";
}

function projectStageLabel(status: ProjectStatus): string {
  if (status === "IN_PROGRESS") return "Carga de datos y fuentes";
  if (status === "VALIDATION") return "Revisión del borrador";
  if (status === "APPROVED") return "Documento aprobado";
  if (status === "ARCHIVED") return "Proyecto archivado";
  return "Título y encabezado";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
  }).format(new Date(value));
}

export function HomeWorkspace({
  initialList,
  initialMetrics,
  initialError,
}: HomeWorkspaceProps) {
  const metrics = initialMetrics ?? EMPTY_METRICS;
  const recentProjects = initialList?.items ?? [];
  const activeProjects = metrics.inProgress + metrics.validation;
  const hasProject = recentProjects.length > 0;
  const currentStageLabel = hasProject
    ? "Etapa actual: cargar datos y fuentes"
    : "Etapa actual: crear proyecto y encabezado";
  const documentFlow = DOCUMENT_FLOW_BASE.map((step, index) => {
    let state: FlowState = "pending";

    if (index === 0) {
      state = hasProject ? "available" : "current";
    } else if (index === 1) {
      state = hasProject ? "current" : "locked";
    }

    return { ...step, state };
  });

  return (
    <section className="rq-home-workspace">
      <section className="rq-module-commandbar">
        <RqKpiGrid label="Resumen general">
          <RqKpiCard
            description="Registrados y accesibles"
            icon="P"
            title="Proyectos"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="Pendientes de elaboración"
            icon="B"
            title="Borradores"
            value={String(metrics.draft)}
          />
          <RqKpiCard
            description="Elaboración o validación"
            icon="E"
            title="En curso"
            value={String(activeProjects)}
          />
          <RqKpiCard
            description="Versiones finalizadas"
            icon="A"
            title="Aprobados"
            value={String(metrics.approved)}
          />
        </RqKpiGrid>

        <div className="rq-module-commandbar__actions">
          <Link
            className="rq-action"
            data-rq-tone="affirmative"
            href="/workspace/projects"
          >
            Gestionar proyectos
          </Link>
          {hasProject ? (
            <Link
              className="rq-action"
              data-rq-tone="consult"
              href="/workspace/sources"
            >
              Cargar fuentes
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="rq-action rq-action--disabled"
              data-rq-tone="consult"
              title="Primero crea un proyecto"
            >
              Cargar fuentes
            </span>
          )}
        </div>
      </section>

      <div className="rq-home-layout">
        <section className="rq-home-flow" aria-labelledby="rq-home-flow-title">
          <header className="rq-home-section-header">
            <div>
              <span>Proceso documental</span>
              <h2 id="rq-home-flow-title">Etapas del levantamiento</h2>
              <p>
                El documento avanza por etapas controladas y conserva cada
                borrador antes de la aprobación.
              </p>
            </div>
            <strong className="rq-home-current-stage">
              {currentStageLabel}
            </strong>
          </header>

          <ol className="rq-home-flow-list">
            {documentFlow.map((step) => (
              <li data-state={step.state} key={step.number}>
                <span className="rq-home-flow-number">{step.number}</span>
                <span className="rq-home-flow-copy">
                  <strong>{step.title}</strong>
                  <span>{step.description}</span>
                </span>
                <span className="rq-home-flow-state">
                  {step.state === "current"
                    ? "En desarrollo"
                    : step.state === "available"
                      ? "Disponible"
                      : step.state === "locked"
                        ? "Bloqueado"
                        : "Pendiente"}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <aside
          className="rq-home-project-state"
          aria-labelledby="rq-home-project-state-title"
        >
          <header className="rq-home-section-header">
            <div>
              <span>Estado del proyecto</span>
              <h2 id="rq-home-project-state-title">Etapa por proyecto</h2>
              <p>
                Consulta el punto actual y cambia directamente al proyecto que
                necesitas continuar.
              </p>
            </div>
          </header>

          {recentProjects.length === 0 ? (
            <div className="rq-home-project-state__empty">
              <strong>Sin proyectos disponibles</strong>
              <span>Crea un proyecto para iniciar el flujo documental.</span>
            </div>
          ) : (
            <nav
              aria-label="Cambiar de proyecto"
              className="rq-home-project-state__list"
            >
              {recentProjects.map((project) => (
                <Link
                  href={`/workspace/sources?projectId=${encodeURIComponent(project.id)}`}
                  key={project.id}
                >
                  <span className="rq-home-project-state__identity">
                    <strong>{project.code}</strong>
                    <small>{project.title}</small>
                  </span>
                  <span className="rq-home-project-state__stage">
                    <strong>{projectStageLabel(project.status)}</strong>
                    <RqStatusBadge tone={statusTone(project.status)}>
                      {statusLabel(project.status)}
                    </RqStatusBadge>
                  </span>
                </Link>
              ))}
            </nav>
          )}
        </aside>
      </div>

      <RqTableShell
        count={recentProjects.length}
        description="Últimos proyectos disponibles para el usuario autenticado."
        title="Proyectos recientes"
      >
        {recentProjects.length === 0 ? (
          <RqEmptyState
            description="Crea el primer proyecto para comenzar a cargar fuentes y construir el documento."
            title="Todavía no hay proyectos"
          />
        ) : (
          <table className="rq-table rq-home-recent-table">
            <thead>
              <tr>
                <th scope="col">Código</th>
                <th scope="col">Proyecto</th>
                <th scope="col">Área solicitante</th>
                <th scope="col">Estado</th>
                <th scope="col">Actualización</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {recentProjects.map((project) => (
                <tr key={project.id}>
                  <td>
                    <strong>{project.code}</strong>
                  </td>
                  <td>{project.title}</td>
                  <td>{project.requestingArea}</td>
                  <td>
                    <RqStatusBadge tone={statusTone(project.status)}>
                      {statusLabel(project.status)}
                    </RqStatusBadge>
                  </td>
                  <td>{formatDate(project.updatedAt)}</td>
                  <td>
                    <div className="rq-home-recent-actions">
                      <Link
                        className="rq-action rq-action--compact"
                        data-rq-tone="consult"
                        href={`/workspace/sources?projectId=${encodeURIComponent(project.id)}`}
                      >
                        Fuentes
                      </Link>
                      <Link
                        className="rq-action rq-action--compact"
                        data-rq-tone="secondary"
                        href="/workspace/projects"
                      >
                        Ver proyecto
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RqTableShell>

      {initialError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{initialError}</span>
        </div>
      ) : null}
    </section>
  );
}
