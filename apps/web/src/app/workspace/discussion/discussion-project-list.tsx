"use client";

// RQ DISCUSION FILTRO AUTOMATICO Y ORDEN V1.1

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type {
  ProjectAreaListResponse,
  ProjectStatus,
  ProjectSummary,
  ViabilityConfiguration,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
} from "@levantamiento-rq/shared-ui";

import { ProjectStatusBadge } from "../project-status-badge";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import {
  DiscussionProjectMetricsCells,
  EMPTY_METRICS,
  evaluateRowViability,
  readDiscussionMetrics,
  type DiscussionMetrics,
  type DiscussionViabilitySummary,
} from "./discussion-project-metrics-cells";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

interface DiscussionRowData {
  metrics: DiscussionMetrics;
  summary: DiscussionViabilitySummary | null;
}

type DiscussionSort =
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"
  | "TITLE_ASC"
  | "TITLE_DESC"
  | "CODE_ASC";

const STATUS_OPTIONS: readonly {
  value: ProjectStatus;
  label: string;
}[] = [
  { value: "DRAFT", label: "Borrador" },
  { value: "DISCUSSION", label: "Discusión" },
  { value: "SOURCES", label: "Fuentes" },
  { value: "DOCUMENT_GENERATED", label: "Documento generado" },
  { value: "VALIDATION", label: "En validación" },
  { value: "APPROVED", label: "Validación aprobada" },
  { value: "EXECUTION", label: "En ejecución" },
  { value: "COMPLETED", label: "Completado" },
  { value: "ARCHIVED", label: "Archivado" },
];

interface DiscussionProjectListProps {
  projects: readonly ProjectSummary[];
  viability?: ViabilityConfiguration;
}

export function DiscussionProjectList({
  projects,
  viability,
}: DiscussionProjectListProps) {
  const [search, setSearch] = useQueryState<string>("q", "");
  const [status, setStatus] = useQueryState<"" | ProjectStatus>("estado", "");
  const [area, setArea] = useQueryState<string>("area", "");
  const [sort, setSort] = useQueryState<DiscussionSort>("orden", "CREATED_DESC");
  const [catalogAreas, setCatalogAreas] = useState<readonly string[]>([]);
  // Lo capturado en Discusión vive en este navegador: se lee una vez montado.
  const [rows, setRows] = useState<Record<string, DiscussionRowData>>({});

  useEffect(() => {
    setRows(
      Object.fromEntries(
        projects.map((project) => {
          const metrics = readDiscussionMetrics(project.id);
          return [
            project.id,
            { metrics, summary: evaluateRowViability(metrics, viability) },
          ];
        }),
      ),
    );
  }, [projects, viability]);

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
      ].sort((left, right) => left.localeCompare(right, "es")),
    [catalogAreas, projects],
  );

  const visibleProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("es-CO");

    const filtered = projects.filter((project) => {
      if (status && project.status !== status) return false;
      if (area && project.requestingArea !== area) return false;
      if (!normalizedSearch) return true;

      return [project.code, project.title].some((value) =>
        value.toLocaleLowerCase("es-CO").includes(normalizedSearch),
      );
    });

    return [...filtered].sort((left, right) => {
      if (sort === "CREATED_DESC" || sort === "CREATED_ASC") {
        const delta =
          new Date(left.createdAt).getTime() -
          new Date(right.createdAt).getTime();
        return sort === "CREATED_ASC" ? delta : -delta;
      }

      if (sort === "TITLE_ASC") {
        return left.title.localeCompare(right.title, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      if (sort === "TITLE_DESC") {
        return right.title.localeCompare(left.title, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      if (sort === "CODE_ASC") {
        return left.code.localeCompare(right.code, "es", {
          numeric: true,
          sensitivity: "base",
        });
      }

      return (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      );
    });
  }, [area, projects, search, sort, status]);

  // Indicadores sobre los proyectos visibles, a partir de lo capturado en Discusión.
  const metrics = useMemo(() => {
    let withResponse = 0;
    let manual = 0;
    let local = 0;
    let cloud = 0;
    let viable = 0;
    for (const project of visibleProjects) {
      const row = rows[project.id];
      if (!row) continue;
      const hasManual = row.metrics.answered > 0;
      const hasLocal = row.metrics.localGenerated > 0;
      const hasCloud = row.metrics.cloudGenerated > 0;
      if (hasManual || hasLocal || hasCloud) withResponse += 1;
      if (hasManual) manual += 1;
      if (hasLocal) local += 1;
      if (hasCloud) cloud += 1;
      if (row.summary?.consolidated.evaluation.viable) viable += 1;
    }
    return {
      total: visibleProjects.length,
      withResponse,
      withoutResponse: visibleProjects.length - withResponse,
      manual,
      local,
      cloud,
      viable,
    };
  }, [rows, visibleProjects]);

  function clearFilters(): void {
    setSearch("");
    setStatus("");
    setArea("");
    setSort("CREATED_DESC");
  }

  if (projects.length === 0) {
    return (
      <section className="rq-table-shell">
        <div className="rq-discussion-empty">
          <strong>No hay proyectos disponibles.</strong>
          <span>Crea un proyecto para iniciar su discusión.</span>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="rq-module-commandbar rq-compact-index-commandbar">
        <RqKpiGrid label="Resumen de discusión">
          <RqKpiCard
            description="Con respuesta / sin respuesta"
            icon={<WorkspaceKpiIcon name="answers" />}
            title="Total"
            value={`${metrics.withResponse}/${metrics.withoutResponse}`}
          />
          <RqKpiCard
            description="Manual / IA local / IA nube"
            icon={<WorkspaceKpiIcon name="processed" />}
            title="Procesados"
            value={`${metrics.manual}/${metrics.local}/${metrics.cloud}`}
          />
          <RqKpiCard
            description="Viables / total"
            icon={<WorkspaceKpiIcon name="viable" />}
            title="Viable para desarrollo"
            value={`${metrics.viable}/${metrics.total}`}
          />
        </RqKpiGrid>
        <div className="rq-module-commandbar__actions">
          <Link
            className="rq-action"
            data-rq-tone="affirmative"
            href="/workspace/projects"
          >
            Administrar proyectos
          </Link>
        </div>
      </section>

      <form
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
            aria-label="Buscar proyecto por código o título"
            id="discussion-search"
            name="discussion-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Código, título"
            type="search"
            value={search}
          />
        </label>

        <label className="rq-projects-filter">
          <span>Estado:</span>
          <select
            aria-label="Estado"
            id="discussion-status"
            name="discussion-status"
            onChange={(event) =>
              setStatus(event.target.value as "" | ProjectStatus)
            }
            value={status}
          >
            <option value="">Todos</option>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="rq-projects-filter">
          <span>Área:</span>
          <select
            aria-label="Área solicitante"
            id="discussion-area"
            name="discussion-area"
            onChange={(event) => setArea(event.target.value)}
            value={area}
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
            id="discussion-sort"
            name="discussion-sort"
            onChange={(event) => setSort(event.target.value as DiscussionSort)}
            value={sort}
          >
            <option value="CREATED_DESC">Fecha de creación</option>
            <option value="CREATED_ASC">Creación: más antigua</option>
            <option value="UPDATED_DESC">Última actualización</option>
            <option value="TITLE_ASC">Nombre: A a Z</option>
            <option value="TITLE_DESC">Nombre: Z a A</option>
            <option value="CODE_ASC">Código</option>
          </select>
        </label>

        <RqActionButton onClick={clearFilters} tone="secondary" type="button">
          Limpiar
        </RqActionButton>
      </form>

      <section className="rq-table-shell rq-compact-index-table-shell">
        {visibleProjects.length === 0 ? (
          <div className="rq-discussion-empty">
            <strong>No hay proyectos que coincidan con los filtros.</strong>
            <span>Modifica la búsqueda, el estado o usa Limpiar.</span>
          </div>
        ) : (
          <div className="rq-table-shell__scroll">
            <table className="rq-table rq-discussion-index__table rq-compact-index-table">
              <thead>
                <tr>
                  <th scope="col">Proyecto</th>
                  <th scope="col">Área solicitante</th>
                  <th scope="col">Estado del proyecto</th>
                  <th scope="col">Respuestas</th>
                  <th scope="col">Respuestas generadas</th>
                  <th scope="col">Viabilidad</th>
                  <th scope="col">Respuestas útiles</th>
                  <th scope="col">Fechas</th>
                  <th scope="col">Acción</th>
                </tr>
              </thead>
              <tbody>
                {visibleProjects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong>{project.title}</strong>
                      <span>{project.code}</span>
                    </td>
                    <td>{project.requestingArea}</td>
                    <td>
                      <ProjectStatusBadge status={project.status} />
                    </td>
                    <DiscussionProjectMetricsCells
                      metrics={rows[project.id]?.metrics ?? EMPTY_METRICS}
                      summary={rows[project.id]?.summary ?? null}
                    />
                    <td>
                      <Link
                        aria-label="Abrir discusión"
                        className="rq-action rq-row-open"
                        data-rq-tone="primary"
                        href={`/workspace/projects/${encodeURIComponent(project.id)}/discussion`}
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
