import type { DocumentTemplateType } from "./document-templates.js";

export const DOCUMENT_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_SECTION_DEFINITIONS = [
  { key: "header", title: "Encabezado del documento" },
  { key: "objectives", title: "Objetivos del proyecto" },
  { key: "problemDescription", title: "Descripción del problema" },
  { key: "scope", title: "Alcance" },
  { key: "processFlow", title: "Diagrama de flujo" },
  {
    key: "milestones",
    title: "Requerimientos por hito o funcionalidad",
  },
  {
    key: "nonFunctionalRequirements",
    title: "Requerimientos no funcionales",
  },
  { key: "tests", title: "Pruebas" },
  {
    key: "assumptionsDependenciesPending",
    title: "Supuestos, dependencias y pendientes",
  },
  {
    key: "approvalsAndChangeControl",
    title: "Aprobaciones y control de cambios",
  },
  { key: "writingRules", title: "Reglas de redacción" },
  { key: "visualFormat", title: "Formato visual recomendado" },
  {
    key: "automationInstruction",
    title: "Instrucción para automatización",
  },
] as const;

export type DocumentSectionKey =
  (typeof DOCUMENT_SECTION_DEFINITIONS)[number]["key"];

export type DocumentJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DocumentJsonValue[]
  | { readonly [key: string]: DocumentJsonValue };

export interface AppliedDocumentTemplate {
  id: string;
  sourceTemplateId: string;
  code: string;
  name: string;
  version: string;
  templateType: DocumentTemplateType;
  definition: DocumentJsonValue;
  appliedAt: string;
}

export interface DocumentField {
  id: string;
  sectionKey: DocumentSectionKey;
  key: string;
  label: string;
  valueType: string;
  value: DocumentJsonValue;
  order: number;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  order: number;
}

export interface DocumentRequirement {
  id: string;
  sectionKey: DocumentSectionKey;
  code: string;
  title: string;
  description: string;
  requirementType: string;
  status: string;
  order: number;
  acceptanceCriteria: readonly AcceptanceCriterion[];
}

export interface DocumentEvidence {
  id: string;
  sourceId: string;
  sectionKey: DocumentSectionKey | null;
  requirementId: string | null;
  excerpt: string | null;
  note: string | null;
}

export interface DocumentSection {
  id: string;
  key: DocumentSectionKey;
  title: string;
  order: number;
  content: DocumentJsonValue;
  templateControlled: boolean;
}

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  version: string;
  status: DocumentStatus;
  revision: number;
  changeSummary: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
}

export interface DocumentVersionDetail extends DocumentVersionSummary {
  sections: readonly DocumentSection[];
  fields: readonly DocumentField[];
  requirements: readonly DocumentRequirement[];
  evidence: readonly DocumentEvidence[];
}

export interface RequirementDocumentSummary {
  id: string;
  projectId: string;
  title: string;
  status: DocumentStatus;
  revision: number;
  currentVersionNumber: number;
  currentVersion: string;
  template: Omit<AppliedDocumentTemplate, "definition">;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RequirementDocumentDetail
  extends RequirementDocumentSummary {
  currentVersionDetail: DocumentVersionDetail;
}

export interface RequirementDocumentListResponse {
  items: readonly RequirementDocumentSummary[];
  totalItems: number;
}

export interface DocumentHistoryEntry {
  id: string;
  documentId: string;
  versionId: string | null;
  eventType: string;
  actorUserId: string;
  details: DocumentJsonValue;
  createdAt: string;
}

export interface CreateRequirementDocumentRequest {
  title?: string;
}

export interface UpdateRequirementDocumentRequest {
  title: string;
  expectedRevision: number;
}

export interface CreateDocumentVersionRequest {
  expectedRevision: number;
  changeSummary: string;
}

export interface UpdateDocumentSectionRequest {
  expectedRevision: number;
  content: DocumentJsonValue;
}

export interface DocumentFieldInput {
  sectionKey: DocumentSectionKey;
  key: string;
  label: string;
  valueType: string;
  value: DocumentJsonValue;
  order: number;
}

export interface AcceptanceCriterionInput {
  description: string;
  order: number;
}

export interface DocumentRequirementInput {
  clientId?: string;
  sectionKey: DocumentSectionKey;
  code: string;
  title: string;
  description: string;
  requirementType: string;
  status: string;
  order: number;
  acceptanceCriteria: readonly AcceptanceCriterionInput[];
}

export interface DocumentEvidenceInput {
  sourceId: string;
  sectionKey?: DocumentSectionKey | null;
  requirementClientId?: string | null;
  excerpt?: string | null;
  note?: string | null;
}

export interface ReplaceDocumentFieldsRequest {
  expectedRevision: number;
  fields: readonly DocumentFieldInput[];
  requirements: readonly DocumentRequirementInput[];
  evidence: readonly DocumentEvidenceInput[];
}

export interface DocumentTransitionRequest {
  expectedRevision: number;
  comment?: string | null;
}

export interface ArchiveRequirementDocumentRequest {
  expectedRevision: number;
}
