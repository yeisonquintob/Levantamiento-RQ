import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import type {
  DocumentTemplateStatus,
  DocumentTemplateType,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "DocumentTemplates" })
@Index("UQ_DocumentTemplates_Code_Version", ["code", "version"], {
  unique: true,
})
@Index("IX_DocumentTemplates_Status_UpdatedAt", ["status", "updatedAt"])
@Index("IX_DocumentTemplates_Type_Status", ["templateType", "status"])
export class DocumentTemplateEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Code", length: 40 })
  code!: string;

  @Column("nvarchar", { name: "Name", length: 200 })
  name!: string;

  @Column("nvarchar", {
    name: "Description",
    length: 2000,
    nullable: true,
  })
  description!: string | null;

  @Column("nvarchar", { name: "TemplateType", length: 40 })
  templateType!: DocumentTemplateType;

  @Column("nvarchar", { name: "Version", length: 32 })
  version!: string;

  @Column("nvarchar", { name: "Status", length: 24, default: "DRAFT" })
  status!: DocumentTemplateStatus;

  @Column("bit", { name: "IncludesScrum", default: false })
  includesScrum!: boolean;

  @Column("nvarchar", { name: "DefinitionJson", length: "MAX" })
  definitionJson!: string;

  @Column("uniqueidentifier", {
    name: "SourceTemplateId",
    nullable: true,
  })
  sourceTemplateId!: string | null;

  @Column("uniqueidentifier", {
    name: "CreatedByUserId",
    nullable: true,
  })
  createdByUserId!: string | null;

  @Column("uniqueidentifier", {
    name: "UpdatedByUserId",
    nullable: true,
  })
  updatedByUserId!: string | null;

  @Column("uniqueidentifier", {
    name: "PublishedByUserId",
    nullable: true,
  })
  publishedByUserId!: string | null;

  @Column("uniqueidentifier", {
    name: "RetiredByUserId",
    nullable: true,
  })
  retiredByUserId!: string | null;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @Column("datetime2", {
    name: "UpdatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  updatedAt!: Date;

  @Column("datetime2", {
    name: "PublishedAt",
    precision: 7,
    nullable: true,
  })
  publishedAt!: Date | null;

  @Column("datetime2", {
    name: "RetiredAt",
    precision: 7,
    nullable: true,
  })
  retiredAt!: Date | null;
}
