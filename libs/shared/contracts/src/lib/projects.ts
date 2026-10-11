import type { DocumentTemplateType } from "./document-templates.js";

export const PROJECT_STATUSES = [
  "DRAFT",
  "DISCUSSION",
  "SOURCES",
  "DOCUMENT_GENERATED",
  "VALIDATION",
  "APPROVED",
  "EXECUTION",
  "COMPLETED",
  "ARCHIVED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_ORDER: Readonly<Record<ProjectStatus, number>> = {
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

/** A new document reopens the document stage; other automatic transitions only advance. */
export function advanceProjectLifecycleStatus(
  current: ProjectStatus,
  target: ProjectStatus,
): ProjectStatus {
  if (current === "ARCHIVED" || target === "ARCHIVED") return current;
  if (target === "DOCUMENT_GENERATED") return target;
  return PROJECT_STATUS_ORDER[target] > PROJECT_STATUS_ORDER[current]
    ? target
    : current;
}

/**
 * Situación del proyecto, independiente de su etapa: un proyecto pausado o eliminado conserva
 * la etapa en la que iba y todos sus datos. «Eliminado» es reversible.
 */
export const PROJECT_ACTIVITY_STATES = ["ACTIVE", "PAUSED", "DELETED"] as const;

export type ProjectActivityState = (typeof PROJECT_ACTIVITY_STATES)[number];

export const PROJECT_PARTICIPANT_ROLES = [
  "OWNER",
  "EDITOR",
  "REVIEWER",
  "VIEWER",
] as const;

export type ProjectParticipantRole = (typeof PROJECT_PARTICIPANT_ROLES)[number];

export interface ProjectParticipant {
  id: string;
  userId: string;
  role: ProjectParticipantRole;
  createdAt: string;
}

export interface ProjectTemplateReference {
  id: string;
  code: string;
  name: string;
  version: string;
  templateType: DocumentTemplateType;
}

export interface ProjectSummary {
  id: string;
  code: string;
  title: string;
  requestingArea: string;
  description: string | null;
  status: ProjectStatus;
  activityState: ProjectActivityState;
  template: ProjectTemplateReference | null;
  ownerUserId: string;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectSummary {
  participants: readonly ProjectParticipant[];
}

export interface ProjectMetrics {
  total: number;
  draft: number;
  inProgress: number;
  validation: number;
  approved: number;
  completed: number;
  archived: number;
  /** Proyectos que no están eliminados (activos y pausados). */
  active: number;
  paused: number;
  deleted: number;
}

/** Iconos disponibles para un área (el trazo se dibuja en la aplicación web). */
export const PROJECT_AREA_ICONS = [
  "wallet",
  "calculator",
  "chart",
  "laptop",
  "truck",
  "gear",
  "users",
  "scale",
  "cart",
  "wrench",
  "calendar",
  "megaphone",
  "shield",
  "headset",
  "box",
  "building",
] as const;

export type ProjectAreaIcon = (typeof PROJECT_AREA_ICONS)[number];

/** Colores disponibles para el icono de un área. */
export const PROJECT_AREA_COLORS = [
  "purple",
  "blue",
  "teal",
  "green",
  "orange",
  "red",
  "brown",
  "slate",
] as const;

export type ProjectAreaColor = (typeof PROJECT_AREA_COLORS)[number];

/** Catálogo de áreas solicitantes administrado en Configuración → Parámetros → Área. */
export interface ProjectAreaSummary {
  id: string;
  name: string;
  icon: ProjectAreaIcon | null;
  color: ProjectAreaColor | null;
  /** Proyectos que usan esta área (no eliminados). */
  projectCount: number;
}

export interface ProjectAreaListResponse {
  items: readonly ProjectAreaSummary[];
}

export interface SaveProjectAreaRequest {
  name?: string;
  icon?: ProjectAreaIcon | null;
  color?: ProjectAreaColor | null;
}

export interface ProjectListResponse {
  items: readonly ProjectSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CreateProjectRequest {
  title: string;
  requestingArea: string;
  description?: string | null;
  templateId: string;
}

export interface UpdateProjectRequest {
  title?: string;
  requestingArea?: string;
  description?: string | null;
  status?: ProjectStatus;
  activityState?: ProjectActivityState;
}

export interface AddProjectParticipantRequest {
  userId: string;
  role: Exclude<ProjectParticipantRole, "OWNER">;
}

export interface ProjectDomainPurgeResult {
  deleted: true;
  count: number;
}

export interface ProjectDeleteResult {
  deleted: true;
  projectId: string;
  code: string;
  removed: {
    sources: number;
    documents: number;
    analysisRequests: number;
    reviews: number;
    operations: number;
  };
}
