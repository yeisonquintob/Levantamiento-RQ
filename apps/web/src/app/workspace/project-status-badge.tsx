import type { ProjectStatus } from "@levantamiento-rq/shared-contracts";
import type { ReactElement, ReactNode } from "react";

export type ProjectStatusTone =
  "success" | "pending" | "process" | "inactive" | "neutral";

const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  DRAFT: "Borrador",
  DISCUSSION: "Discusión",
  SOURCES: "Fuentes",
  DOCUMENT_GENERATED: "Documento generado",
  VALIDATION: "En validación",
  APPROVED: "Aprobado",
  // La ejecución es otro proceso: fuera de Ejecución, un proyecto en ejecución o completado
  // sigue siendo un proyecto aprobado.
  EXECUTION: "Aprobado",
  COMPLETED: "Aprobado",
  ARCHIVED: "Archivado",
};

export function projectStatusLabel(status: ProjectStatus): string {
  return PROJECT_STATUS_LABELS[status] ?? status;
}

/** Mismos colores que la insignia de Proyectos: aprobado verde, en curso naranja. */
export function projectStatusTone(status: ProjectStatus): ProjectStatusTone {
  if (status === "APPROVED" || status === "EXECUTION" || status === "COMPLETED") {
    return "success";
  }
  if (status === "ARCHIVED") return "inactive";
  if (status === "DRAFT") return "neutral";
  return "pending";
}

/** Insignia del estado del proyecto: la misma en Proyectos, Discusión, Fuentes, Documentos y Ejecución. */
export function ProjectStatusBadge({
  children,
  status,
  tone,
}: {
  status: ProjectStatus;
  children?: ReactNode;
  tone?: ProjectStatusTone;
}): ReactElement {
  return (
    <span
      className="rq-status rq-project-status"
      data-rq-status={tone ?? projectStatusTone(status)}
    >
      {children ?? projectStatusLabel(status)}
    </span>
  );
}

/** Estado que se muestra dentro de Ejecución: en ejecución morado, completado (100 %) verde. */
export function executionStatusPresentation(status: ProjectStatus): {
  label: string;
  tone: ProjectStatusTone;
} {
  if (status === "COMPLETED") return { label: "Completado", tone: "success" };
  if (status === "EXECUTION") return { label: "En ejecución", tone: "process" };
  return { label: projectStatusLabel(status), tone: projectStatusTone(status) };
}
