"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectAreaListResponse,
  ProjectStatus,
  ProjectSummary,
} from "@levantamiento-rq/shared-contracts";
import {
  RqActionButton,
  RqKpiCard,
  RqKpiGrid,
} from "@levantamiento-rq/shared-ui";

import { ProjectStatusBadge } from "../project-status-badge";
import { WorkspaceKpiIcon } from "../workspace-kpi-icon";
import { SourcesProjectMetricsCells } from "./sources-project-metrics-cells";

import { authenticatedFetch } from "../../authenticated-fetch";
import { useAutoDismissedProp } from "../../use-auto-dismiss";
import { useQueryState } from "../use-query-state";

const GATEWAY_URL =
  process.env.NODE_ENV === "development" && typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : (process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://127.0.0.1:3000");

type SourcesSort =
  | "CREATED_DESC"
  | "CREATED_ASC"
  | "UPDATED_DESC"
  | "UPDATED_ASC"
  | "TITLE_ASC"
  | "TITLE_DESC"
  | "CODE_ASC";

const STATUS_OPTIONS: readonly { value: ProjectStatus; label: string }[] = [
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

const STATUS_ORDER: Record<ProjectStatus, number> = {
  DRAFT: 0,
  DISCUSSION: 1,
  SOURCES: 2,
  DOCUMENT_GENERATED: 3,
  VALIDATION: 4,
  APPROVED: 5,
  EXECUTION: 6,
  COMPLETED: 7,
  ARCHIVED: 8,
};

export function SourcesProjectList({
  initialError,
  projects,
}: {
  initialError?: string;
  projects: readonly ProjectSummary[];
}) {
  const [currentProjects, setCurrentProjects] = useState(projects);
  const visibleInitialError = useAutoDismissedProp(initialError);
  const [search, setSearch] = useQueryState<string>("q", "");
  const [status, setStatus] = useQueryState<"" | ProjectStatus>("estado", "");
  const [sort, setSort] = useQueryState<SourcesSort>("orden", "CREATED_DESC");
  const [area, setArea] = useQueryState<string>("area", "");
  const [catalogAreas, setCatalogAreas] = useState<readonly string[]>([]);
  const pendingStatusUpdates = useRef(new Set<string>());

  useEffect(() => setCurrentProjects(projects), [projects]);

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
          ...currentProjects.map((project) => project.requestingArea),
        ]),
      ].sort((left, right) => left.localeCompare(right, "es")),
    [catalogAreas, currentProjects],
  );

  const reconcileProjectStatus = useCallback(
    (projectId: string, metrics: { total: number; processed: boolean }) => {
      const desiredStatus: ProjectStatus | null = metrics.processed
        ? "DOCUMENT_GENERATED"
        : metrics.total > 0
          ? "SOURCES"
          : null;
      if (!desiredStatus || pendingStatusUpdates.current.has(projectId)) return;

      const project = currentProjects.find((item) => item.id === projectId);
      if (
        !project ||
        STATUS_ORDER[project.status] >= STATUS_ORDER[desiredStatus]
      )
        return;

      pendingStatusUpdates.current.add(projectId);
      void authenticatedFetch(
        `${GATEWAY_URL}/api/v1/projects/${encodeURIComponent(projectId)}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: desiredStatus }),
        },
      )
        .then((response) => {
          if (!response.ok) return;
          setCurrentProjects((items) =>
            items.map((item) =>
              item.id === projectId ? { ...item, status: desiredStatus } : item,
            ),
          );
        })
        .finally(() => pendingStatusUpdates.current.delete(projectId));
    },
    [currentProjects],
  );

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es-CO");
    return [...currentProjects]
      .filter(
        (project) =>
          (!status || project.status === status) &&
          (!area || project.requestingArea === area) &&
          (!query ||
            [project.code, project.title].some((value) =>
              value.toLocaleLowerCase("es-CO").includes(query),
            )),
      )
      .sort((left, right) => {
        if (sort === "TITLE_ASC" || sort === "TITLE_DESC") {
          const order = left.title.localeCompare(right.title, "es", {
            numeric: true,
            sensitivity: "base",
          });
          return sort === "TITLE_ASC" ? order : -order;
        }
        if (sort === "CODE_ASC")
          return left.code.localeCompare(right.code, "es", { numeric: true });
        if (sort === "CREATED_DESC" || sort === "CREATED_ASC") {
          const created =
            Date.parse(right.createdAt) - Date.parse(left.createdAt);
          return sort === "CREATED_ASC" ? -created : created;
        }
        const order = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
        return sort === "UPDATED_ASC" ? -order : order;
      });
  }, [area, currentProjects, search, sort, status]);

  const metrics = useMemo(
    () => ({
      total: visibleProjects.length,
      discussion: visibleProjects.filter(
        (project) => project.status === "DISCUSSION",
      ).length,
      sources: visibleProjects.filter((project) => project.status === "SOURCES")
        .length,
      processed: visibleProjects.filter(
        (project) =>
          STATUS_ORDER[project.status] >= STATUS_ORDER.DOCUMENT_GENERATED,
      ).length,
    }),
    [visibleProjects],
  );

  return (
    <div className="rq-sources-index">
      <section className="rq-module-commandbar rq-compact-index-commandbar">
        <RqKpiGrid label="Resumen de fuentes">
          <RqKpiCard
            description="Proyectos visibles"
            icon={<WorkspaceKpiIcon name="projects" />}
            title="Total"
            value={String(metrics.total)}
          />
          <RqKpiCard
            description="En discusión / en fuentes"
            icon={<WorkspaceKpiIcon name="layers" />}
            title="Discusión y fuentes"
            value={`${metrics.discussion} / ${metrics.sources}`}
          />
          <RqKpiCard
            description="Documento o etapa posterior"
            icon={<WorkspaceKpiIcon name="processed" />}
            title="Procesados"
            value={String(metrics.processed)}
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
      {visibleInitialError ? (
        <div className="rq-project-alert" data-tone="danger" role="alert">
          <span>{visibleInitialError}</span>
        </div>
      ) : null}
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
            id="sources-project-search"
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
            id="sources-project-status"
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
            id="sources-project-area"
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
            id="sources-project-sort"
            onChange={(event) => setSort(event.target.value as SourcesSort)}
            value={sort}
          >
            <option value="CREATED_DESC">Fecha de creación</option>
            <option value="CREATED_ASC">Creación: más antigua</option>
            <option value="UPDATED_DESC">Última actualización</option>
            <option value="UPDATED_ASC">Actualización: más antigua</option>
            <option value="TITLE_ASC">Nombre: A a Z</option>
            <option value="TITLE_DESC">Nombre: Z a A</option>
            <option value="CODE_ASC">Código</option>
          </select>
        </label>
        <RqActionButton
          onClick={() => {
            setSearch("");
            setStatus("");
            setArea("");
            setSort("CREATED_DESC");
          }}
          tone="secondary"
          type="button"
        >
          Limpiar
        </RqActionButton>
      </form>
      <section className="rq-table-shell rq-compact-index-table-shell">
        <div className="rq-table-shell__scroll">
          <table className="rq-table rq-discussion-index__table rq-sources-index__table rq-compact-index-table">
            <thead>
              <tr>
                <th scope="col">Proyecto</th>
                <th scope="col">Estado del proyecto</th>
                <th scope="col">Textuales</th>
                <th scope="col">Fuentes</th>
                <th scope="col">Discusión</th>
                <th scope="col">Fuentes procesadas</th>
                <th scope="col">Procesamiento</th>
                <th scope="col">Última generación completada</th>
                <th scope="col">IA utilizada</th>
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
                  <td>
                    <ProjectStatusBadge status={project.status} />
                  </td>
                  <SourcesProjectMetricsCells
                    onMetricsResolved={reconcileProjectStatus}
                    projectId={project.id}
                  />
                  <td>
                    <Link
                      aria-label="Abrir fuentes"
                      className="rq-action rq-row-open"
                      data-rq-tone="primary"
                      href={`/workspace/sources?projectId=${encodeURIComponent(project.id)}`}
                    >
                      Abrir
                    </Link>
                  </td>
                </tr>
              ))}
              {visibleProjects.length === 0 ? (
                <tr>
                  <td className="rq-sources-index__empty" colSpan={10}>
                    No hay proyectos que coincidan con los filtros.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
