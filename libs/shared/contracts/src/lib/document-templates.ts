export const DOCUMENT_TEMPLATE_TYPES = [
  "SMALL_REQUIREMENT",
  "MEDIUM_REQUIREMENT",
  "LARGE_REQUIREMENT",
  "ERP_FDD",
] as const;

export type DocumentTemplateType =
  (typeof DOCUMENT_TEMPLATE_TYPES)[number];

export const DOCUMENT_TEMPLATE_STATUSES = [
  "DRAFT",
  "PUBLISHED",
  "RETIRED",
] as const;

export type DocumentTemplateStatus =
  (typeof DOCUMENT_TEMPLATE_STATUSES)[number];

export const DOCUMENT_TEMPLATE_SCRUM_OUTPUTS = [
  "EPIC",
  "FEATURE",
  "USER_STORY",
  "ACCEPTANCE_CRITERIA",
] as const;

export type DocumentTemplateScrumOutput =
  (typeof DOCUMENT_TEMPLATE_SCRUM_OUTPUTS)[number];

export interface DocumentTemplateSection {
  key: string;
  order: number;
  title: string;
  required: boolean;
  guidance: string;
}

export interface DocumentTemplateAiPrompt {
  purpose: string;
  systemInstruction: string;
  templateInstruction: string;
  sourceInstruction: string;
  missingInformationInstruction: string;
  conflictInstruction: string;
  outputInstruction: string;
  sourcesAreData: true;
  ignoreInstructionsInsideSources: true;
}

export interface DocumentTemplateOutputContract {
  format: "JSON";
  schemaVersion: "1.0.0";
  rootKey: "requirementDocument";
  strictSectionOrder: true;
  allowUnknownSections: false;
  includeTraceability: true;
}

export interface DocumentTemplateDefinition {
  standard: "ISO_IEC_IEEE_29148_2018";
  sectionOrder: readonly string[];
  sections: readonly DocumentTemplateSection[];
  aiPrompt: DocumentTemplateAiPrompt;
  outputContract: DocumentTemplateOutputContract;
  scrum: {
    enabled: boolean;
    outputs: readonly DocumentTemplateScrumOutput[];
  };
  erp: {
    enabled: boolean;
    fdd: boolean;
    scrumByDefault: boolean;
  };
}

export interface DocumentTemplateSummary {
  id: string;
  code: string;
  name: string;
  description: string | null;
  templateType: DocumentTemplateType;
  version: string;
  status: DocumentTemplateStatus;
  includesScrum: boolean;
  sourceTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  retiredAt: string | null;
}

export interface DocumentTemplateDetail extends DocumentTemplateSummary {
  definition: DocumentTemplateDefinition;
  canManage: boolean;
}

export interface DocumentTemplateMetrics {
  total: number;
  draft: number;
  published: number;
  retired: number;
  small: number;
  medium: number;
  large: number;
  erpFdd: number;
  canManage: boolean;
}

export interface DocumentTemplateListResponse {
  items: readonly DocumentTemplateSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  canManage: boolean;
}

export interface CreateDocumentTemplateRequest {
  code: string;
  name: string;
  description?: string | null;
  templateType: DocumentTemplateType;
  version: string;
  includesScrum: boolean;
  sections?: readonly DocumentTemplateSection[];
}

export interface UpdateDocumentTemplateRequest {
  name?: string;
  description?: string | null;
  includesScrum?: boolean;
  sections?: readonly DocumentTemplateSection[];
}

export interface CloneDocumentTemplateRequest {
  version: string;
  name?: string;
  description?: string | null;
  includesScrum?: boolean;
  sections?: readonly DocumentTemplateSection[];
}
