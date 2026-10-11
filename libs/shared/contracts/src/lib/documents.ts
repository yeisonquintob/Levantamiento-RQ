import type { DocumentTemplateType } from "./document-templates.js";

export const DOCUMENT_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
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
  {
    key: "solutionProposal",
    title: "Solución propuesta del profesional de soluciones",
  },
  { key: "processFlow", title: "Diagrama de flujo" },
  {
    key: "milestones",
    title: "Requerimientos",
  },
  {
    key: "backlogStructure",
    title: "Esquema",
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
  { key: "writingRules", title: "Plantilla aplicada" },
  { key: "visualFormat", title: "Prototipo" },
  {
    key: "automationInstruction",
    title: "KPIs",
  },
] as const;

export const DOCUMENT_SCRUM_SECTION_DEFINITION = {
  key: "scrumPlan",
  title: "Plan de trabajo",
} as const;

/** Transport key; membership is validated against the exact document version. */
export type DocumentTemplateSectionKey = string;

export type DocumentSectionKey =
  | (typeof DOCUMENT_SECTION_DEFINITIONS)[number]["key"]
  | (typeof DOCUMENT_SCRUM_SECTION_DEFINITION)["key"]
  /** Clave histórica: solo lectura/adaptación; no se crea en plantillas nuevas. */
  | "nonFunctionalRequirements";

export function getDocumentSectionDefinitions(
  includesScrum: boolean,
): readonly { readonly key: DocumentSectionKey; readonly title: string }[] {
  return includesScrum
    ? [...DOCUMENT_SECTION_DEFINITIONS, DOCUMENT_SCRUM_SECTION_DEFINITION]
    : [...DOCUMENT_SECTION_DEFINITIONS];
}

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
  includesScrum?: boolean;
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
  /** Number of versions still present, independent of their sequence numbers. */
  versionCount?: number;
  id: string;
  projectId: string;
  title: string;
  status: DocumentStatus;
  revision: number;
  currentVersionNumber: number;
  currentVersion: string;
  /** La sección de prototipo de la versión vigente contiene texto real. */
  hasPrototype?: boolean;
  template: Omit<AppliedDocumentTemplate, "definition">;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface RequirementDocumentDetail extends RequirementDocumentSummary {
  /** Exact immutable applied definition, used by template-directed generation. */
  appliedTemplate?: AppliedDocumentTemplate;
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
  changeSummary?: string;
  idempotencyKey?: string;
}

export interface UpdateRequirementDocumentRequest {
  title: string;
  expectedRevision: number;
}

export interface CreateDocumentVersionRequest {
  expectedRevision: number;
  changeSummary: string;
  idempotencyKey?: string;
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
  sectionKey: DocumentTemplateSectionKey;
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
  sectionKey?: DocumentTemplateSectionKey | null;
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

export interface AiDraftSectionInput {
  key: DocumentTemplateSectionKey;
  content: DocumentJsonValue;
}

export interface ApplyAiAnalysisDraftRequest {
  expectedRevision: number;
  analysisRequestId: string;
  analysisResultId: string;
  sections: readonly AiDraftSectionInput[];
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
