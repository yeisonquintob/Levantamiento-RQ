import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type {
  AiAnalysisStatus,
  AiAnalysisType,
  AiDraftGenerationPurpose,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "AnalysisRequests" })
@Index("IX_AnalysisRequests_ProjectId_CreatedAt", ["projectId", "createdAt"])
@Index("IX_AnalysisRequests_DocumentVersionId_Status", [
  "documentVersionId",
  "status",
])
@Index("IX_AnalysisRequests_Status_UpdatedAt", ["status", "updatedAt"])
@Index(
  "UQ_AnalysisRequests_Project_IdempotencyKey",
  ["projectId", "idempotencyKey"],
  { unique: true },
)
export class AnalysisRequestEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("uniqueidentifier", { name: "DocumentId" })
  documentId!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("nvarchar", {
    name: "AnalysisType",
    length: 50,
    default: "REQUIREMENT_DOCUMENT",
  })
  analysisType!: AiAnalysisType;

  @Column("nvarchar", {
    name: "Purpose",
    length: 24,
    default: "INITIAL_DRAFT",
  })
  purpose!: AiDraftGenerationPurpose;

  @Column("nvarchar", { name: "Instruction", length: 2000, nullable: true })
  instruction!: string | null;

  @Column("nvarchar", { name: "IdempotencyKey", length: 120 })
  idempotencyKey!: string;

  @Column("int", { name: "GeneratedVersionNumber" })
  generatedVersionNumber!: number;

  @Column("nvarchar", { name: "GeneratedVersion", length: 32 })
  generatedVersion!: string;

  @Column("nvarchar", {
    name: "Status",
    length: 24,
    default: "PENDING",
  })
  status!: AiAnalysisStatus;

  @Column("uniqueidentifier", { name: "RequestedByUserId" })
  requestedByUserId!: string;

  @Column("nvarchar", { name: "DocumentSnapshotJson", nullable: true })
  documentSnapshotJson!: string | null;

  @Column("nvarchar", { name: "ErrorCode", length: 100, nullable: true })
  errorCode!: string | null;

  @Column("nvarchar", { name: "ErrorMessage", length: 2000, nullable: true })
  errorMessage!: string | null;

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
    name: "CancelledAt",
    precision: 7,
    nullable: true,
  })
  cancelledAt!: Date | null;
}
