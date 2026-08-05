import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

import type {
  DocumentStatus,
  DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "AppliedDocumentTemplates" })
@Index("IX_AppliedDocumentTemplates_SourceTemplateId", ["sourceTemplateId"])
export class AppliedDocumentTemplateEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "SourceTemplateId" })
  sourceTemplateId!: string;

  @Column("nvarchar", { name: "Code", length: 40 })
  code!: string;

  @Column("nvarchar", { name: "Name", length: 200 })
  name!: string;

  @Column("nvarchar", { name: "Version", length: 32 })
  version!: string;

  @Column("nvarchar", { name: "TemplateType", length: 40 })
  templateType!: DocumentTemplateType;

  @Column("nvarchar", { name: "DefinitionJson", length: "MAX" })
  definitionJson!: string;

  @Column("datetime2", { name: "AppliedAt", precision: 7 })
  appliedAt!: Date;
}

@Entity({ name: "RequirementDocuments" })
@Index("IX_RequirementDocuments_ProjectId_UpdatedAt", ["projectId", "updatedAt"])
@Index("IX_RequirementDocuments_Status", ["status"])
export class RequirementDocumentEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("uniqueidentifier", { name: "AppliedTemplateId" })
  appliedTemplateId!: string;

  @Column("nvarchar", { name: "Title", length: 240 })
  title!: string;

  @Column("nvarchar", { name: "Status", length: 24 })
  status!: DocumentStatus;

  @Column("int", { name: "Revision" })
  revision!: number;

  @Column("int", { name: "CurrentVersionNumber" })
  currentVersionNumber!: number;

  @Column("uniqueidentifier", { name: "CreatedByUserId" })
  createdByUserId!: string;

  @Column("uniqueidentifier", { name: "UpdatedByUserId" })
  updatedByUserId!: string;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;

  @Column("datetime2", { name: "UpdatedAt", precision: 7 })
  updatedAt!: Date;

  @Column("uniqueidentifier", {
    name: "ArchivedByUserId",
    nullable: true,
  })
  archivedByUserId!: string | null;

  @Column("datetime2", {
    name: "ArchivedAt",
    precision: 7,
    nullable: true,
  })
  archivedAt!: Date | null;
}

@Entity({ name: "DocumentVersions" })
@Index("UQ_DocumentVersions_DocumentId_Number", ["documentId", "versionNumber"], { unique: true })
@Index("IX_DocumentVersions_DocumentId_Status", ["documentId", "status"])
export class DocumentVersionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentId" })
  documentId!: string;

  @Column("int", { name: "VersionNumber" })
  versionNumber!: number;

  @Column("nvarchar", { name: "Version", length: 32 })
  version!: string;

  @Column("nvarchar", { name: "Status", length: 24 })
  status!: DocumentStatus;

  @Column("int", { name: "Revision" })
  revision!: number;

  @Column("nvarchar", { name: "ChangeSummary", length: 1000 })
  changeSummary!: string;

  @Column("uniqueidentifier", { name: "CreatedByUserId" })
  createdByUserId!: string;

  @Column("uniqueidentifier", { name: "UpdatedByUserId" })
  updatedByUserId!: string;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;

  @Column("datetime2", { name: "UpdatedAt", precision: 7 })
  updatedAt!: Date;

  @Column("uniqueidentifier", {
    name: "ApprovedByUserId",
    nullable: true,
  })
  approvedByUserId!: string | null;

  @Column("datetime2", {
    name: "ApprovedAt",
    precision: 7,
    nullable: true,
  })
  approvedAt!: Date | null;

  @Column("uniqueidentifier", {
    name: "RejectedByUserId",
    nullable: true,
  })
  rejectedByUserId!: string | null;

  @Column("datetime2", {
    name: "RejectedAt",
    precision: 7,
    nullable: true,
  })
  rejectedAt!: Date | null;
}

@Entity({ name: "DocumentSections" })
@Index("UQ_DocumentSections_Version_Key", ["documentVersionId", "key"], { unique: true })
@Index("UQ_DocumentSections_Version_Order", ["documentVersionId", "orderIndex"], { unique: true })
export class DocumentSectionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("nvarchar", { name: "SectionKey", length: 64 })
  key!: string;

  @Column("nvarchar", { name: "Title", length: 200 })
  title!: string;

  @Column("int", { name: "OrderIndex" })
  orderIndex!: number;

  @Column("nvarchar", { name: "ContentJson", length: "MAX" })
  contentJson!: string;

  @Column("bit", { name: "TemplateControlled" })
  templateControlled!: boolean;
}

@Entity({ name: "DocumentFields" })
@Index("UQ_DocumentFields_Version_Section_Key", ["documentVersionId", "sectionKey", "key"], { unique: true })
export class DocumentFieldEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("nvarchar", { name: "SectionKey", length: 64 })
  sectionKey!: string;

  @Column("nvarchar", { name: "FieldKey", length: 100 })
  key!: string;

  @Column("nvarchar", { name: "Label", length: 200 })
  label!: string;

  @Column("nvarchar", { name: "ValueType", length: 40 })
  valueType!: string;

  @Column("nvarchar", { name: "ValueJson", length: "MAX" })
  valueJson!: string;

  @Column("int", { name: "OrderIndex" })
  orderIndex!: number;
}

@Entity({ name: "DocumentRequirements" })
@Index("UQ_DocumentRequirements_Version_Code", ["documentVersionId", "code"], { unique: true })
export class DocumentRequirementEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("nvarchar", { name: "SectionKey", length: 64 })
  sectionKey!: string;

  @Column("nvarchar", { name: "Code", length: 40 })
  code!: string;

  @Column("nvarchar", { name: "Title", length: 240 })
  title!: string;

  @Column("nvarchar", { name: "Description", length: "MAX" })
  description!: string;

  @Column("nvarchar", { name: "RequirementType", length: 40 })
  requirementType!: string;

  @Column("nvarchar", { name: "Status", length: 40 })
  status!: string;

  @Column("int", { name: "OrderIndex" })
  orderIndex!: number;
}

@Entity({ name: "AcceptanceCriteria" })
@Index("IX_AcceptanceCriteria_Requirement_Order", ["requirementId", "orderIndex"])
export class AcceptanceCriterionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "RequirementId" })
  requirementId!: string;

  @Column("nvarchar", { name: "Description", length: 2000 })
  description!: string;

  @Column("int", { name: "OrderIndex" })
  orderIndex!: number;
}

@Entity({ name: "DocumentEvidence" })
@Index("IX_DocumentEvidence_Version_Source", ["documentVersionId", "sourceId"])
export class DocumentEvidenceEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("uniqueidentifier", { name: "SourceId" })
  sourceId!: string;

  @Column("nvarchar", {
    name: "SectionKey",
    length: 64,
    nullable: true,
  })
  sectionKey!: string | null;

  @Column("uniqueidentifier", {
    name: "RequirementId",
    nullable: true,
  })
  requirementId!: string | null;

  @Column("nvarchar", { name: "Excerpt", length: 4000, nullable: true })
  excerpt!: string | null;

  @Column("nvarchar", { name: "Note", length: 2000, nullable: true })
  note!: string | null;
}

@Entity({ name: "DocumentHistory" })
@Index("IX_DocumentHistory_Document_CreatedAt", ["documentId", "createdAt"])
export class DocumentHistoryEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "DocumentId" })
  documentId!: string;

  @Column("uniqueidentifier", { name: "VersionId", nullable: true })
  versionId!: string | null;

  @Column("nvarchar", { name: "EventType", length: 80 })
  eventType!: string;

  @Column("uniqueidentifier", { name: "ActorUserId" })
  actorUserId!: string;

  @Column("nvarchar", { name: "DetailsJson", length: "MAX" })
  detailsJson!: string;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;
}
