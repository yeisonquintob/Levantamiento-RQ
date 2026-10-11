import type {
  AppliedDocumentTemplate,
  DocumentHistoryEntry,
  DocumentSectionKey,
  DocumentVersionDetail,
  DocumentVersionSummary,
  RequirementDocumentSummary,
} from "@levantamiento-rq/shared-contracts";

import type {
  AcceptanceCriterionEntity,
  AppliedDocumentTemplateEntity,
  DocumentEvidenceEntity,
  DocumentFieldEntity,
  DocumentHistoryEntity,
  DocumentRequirementEntity,
  DocumentSectionEntity,
  DocumentVersionEntity,
  RequirementDocumentEntity,
} from "./document.entities";
import { parseJson, toIso } from "./documents-json";
import { appliedTemplateIncludesScrum } from "./documents-template-layout";

export function templateWithoutDefinition(
  template: AppliedDocumentTemplateEntity,
): Omit<AppliedDocumentTemplate, "definition"> {
  return {
    id: template.id,
    sourceTemplateId: template.sourceTemplateId,
    code: template.code,
    name: template.name,
    version: template.version,
    templateType: template.templateType,
    includesScrum: appliedTemplateIncludesScrum(template),
    appliedAt: toIso(template.appliedAt),
  };
}

export function versionSummary(
  version: DocumentVersionEntity,
): DocumentVersionSummary {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    version: version.version,
    status: version.status,
    revision: version.revision,
    changeSummary: version.changeSummary,
    createdByUserId: version.createdByUserId,
    createdAt: toIso(version.createdAt),
    updatedAt: toIso(version.updatedAt),
    approvedByUserId: version.approvedByUserId,
    approvedAt: version.approvedAt ? toIso(version.approvedAt) : null,
  };
}

export function toDocumentSummary(
  document: RequirementDocumentEntity,
  version: DocumentVersionEntity,
  template: AppliedDocumentTemplateEntity,
  hasPrototype: boolean,
): RequirementDocumentSummary {
  return {
    id: document.id,
    projectId: document.projectId,
    title: document.title,
    status: document.status,
    revision: document.revision,
    currentVersionNumber: document.currentVersionNumber,
    currentVersion: version.version,
    hasPrototype,
    template: templateWithoutDefinition(template),
    createdByUserId: document.createdByUserId,
    createdAt: toIso(document.createdAt),
    updatedAt: toIso(document.updatedAt),
    archivedAt: document.archivedAt ? toIso(document.archivedAt) : null,
  };
}

export function toHistoryEntry(
  row: DocumentHistoryEntity,
): DocumentHistoryEntry {
  return {
    id: row.id,
    documentId: row.documentId,
    versionId: row.versionId,
    eventType: row.eventType,
    actorUserId: row.actorUserId,
    details: parseJson(row.detailsJson),
    createdAt: toIso(row.createdAt),
  };
}

export function toVersionDetail(
  version: DocumentVersionEntity,
  sections: readonly DocumentSectionEntity[],
  fields: readonly DocumentFieldEntity[],
  requirements: readonly DocumentRequirementEntity[],
  criteria: readonly AcceptanceCriterionEntity[],
  evidence: readonly DocumentEvidenceEntity[],
): DocumentVersionDetail {
  return {
    ...versionSummary(version),
    sections: sections.map((section) => ({
      id: section.id,
      key: section.key as DocumentSectionKey,
      title: section.title,
      order: section.orderIndex,
      content: parseJson(section.contentJson),
      templateControlled: section.templateControlled,
    })),
    fields: fields.map((field) => ({
      id: field.id,
      sectionKey: field.sectionKey as DocumentSectionKey,
      key: field.key,
      label: field.label,
      valueType: field.valueType,
      value: parseJson(field.valueJson),
      order: field.orderIndex,
    })),
    requirements: requirements.map((requirement) => ({
      id: requirement.id,
      sectionKey: requirement.sectionKey as DocumentSectionKey,
      code: requirement.code,
      title: requirement.title,
      description: requirement.description,
      requirementType: requirement.requirementType,
      status: requirement.status,
      order: requirement.orderIndex,
      acceptanceCriteria: criteria
        .filter((criterion) => criterion.requirementId === requirement.id)
        .map((criterion) => ({
          id: criterion.id,
          description: criterion.description,
          order: criterion.orderIndex,
        })),
    })),
    evidence: evidence.map((item) => ({
      id: item.id,
      sourceId: item.sourceId,
      sectionKey: item.sectionKey as DocumentSectionKey | null,
      requirementId: item.requirementId,
      excerpt: item.excerpt,
      note: item.note,
    })),
  };
}
