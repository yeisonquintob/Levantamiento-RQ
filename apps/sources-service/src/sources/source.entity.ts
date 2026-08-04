import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

import type {
  SourceClassification,
  SourceFileExtension,
  SourceProcessingStatus,
  SourceStatus,
  SourceType,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "Sources" })
@Index("IX_Sources_ProjectId_Status_UpdatedAt", [
  "projectId",
  "status",
  "updatedAt",
])
@Index("IX_Sources_ProjectId_SourceType", ["projectId", "sourceType"])
@Index("IX_Sources_ProjectId_ProcessingStatus", [
  "projectId",
  "processingStatus",
])
@Index("IX_Sources_Sha256", ["sha256"])
export class SourceEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("nvarchar", { name: "SourceType", length: 32 })
  sourceType!: SourceType;

  @Column("nvarchar", { name: "Title", length: 240 })
  title!: string;

  @Column("nvarchar", {
    name: "Description",
    length: 2000,
    nullable: true,
  })
  description!: string | null;

  @Column("nvarchar", {
    name: "Classification",
    length: 40,
    nullable: true,
  })
  classification!: SourceClassification | null;

  @Column("nvarchar", {
    name: "Content",
    length: "MAX",
    nullable: true,
  })
  content!: string | null;

  @Column("nvarchar", {
    name: "ExtractedText",
    length: "MAX",
    nullable: true,
  })
  extractedText!: string | null;

  @Column("nvarchar", {
    name: "ProcessingStatus",
    length: 32,
    default: "PENDING",
  })
  processingStatus!: SourceProcessingStatus;

  @Column("nvarchar", {
    name: "ProcessingMessage",
    length: 2000,
    nullable: true,
  })
  processingMessage!: string | null;

  @Column("datetime2", {
    name: "ProcessedAt",
    precision: 7,
    nullable: true,
  })
  processedAt!: Date | null;

  @Column("nvarchar", {
    name: "Status",
    length: 32,
    default: "ACTIVE",
  })
  status!: SourceStatus;

  @Column("nvarchar", {
    name: "OriginalFileName",
    length: 260,
    nullable: true,
  })
  originalFileName!: string | null;

  @Column("nvarchar", {
    name: "FileExtension",
    length: 24,
    nullable: true,
  })
  fileExtension!: SourceFileExtension | null;

  @Column("nvarchar", {
    name: "MediaType",
    length: 160,
    nullable: true,
  })
  mediaType!: string | null;

  @Column("bigint", {
    name: "FileSizeBytes",
    nullable: true,
  })
  fileSizeBytes!: string | null;

  @Column("char", {
    name: "Sha256",
    length: 64,
    nullable: true,
  })
  sha256!: string | null;

  @Column("nvarchar", {
    name: "StorageContainer",
    length: 120,
    nullable: true,
  })
  storageContainer!: string | null;

  @Column("nvarchar", {
    name: "StoragePath",
    length: 700,
    nullable: true,
  })
  storagePath!: string | null;

  @Column("int", {
    name: "PageCount",
    nullable: true,
  })
  pageCount!: number | null;

  @Column("int", {
    name: "SheetCount",
    nullable: true,
  })
  sheetCount!: number | null;

  @Column("uniqueidentifier", { name: "CreatedByUserId" })
  createdByUserId!: string;

  @Column("uniqueidentifier", { name: "UpdatedByUserId" })
  updatedByUserId!: string;

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
}
