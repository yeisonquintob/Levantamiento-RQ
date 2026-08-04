import type { DocumentTemplateType } from "./document-templates.js";

export const PROJECT_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "VALIDATION",
  "APPROVED",
  "ARCHIVED",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_PARTICIPANT_ROLES = [
  "OWNER",
  "EDITOR",
  "REVIEWER",
  "VIEWER",
] as const;

export type ProjectParticipantRole =
  (typeof PROJECT_PARTICIPANT_ROLES)[number];

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
  archived: number;
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
}

export interface AddProjectParticipantRequest {
  userId: string;
  role: Exclude<ProjectParticipantRole, "OWNER">;
}
