import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type { AiAnalysisResultStatus } from "@levantamiento-rq/shared-contracts";

@Entity({ name: "AnalysisResults" })
@Index("UQ_AnalysisResults_Request", ["analysisRequestId"], { unique: true })
@Index("UQ_AnalysisResults_Execution", ["analysisExecutionId"], {
  unique: true,
})
export class AnalysisResultEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "AnalysisRequestId" })
  analysisRequestId!: string;

  @Column("uniqueidentifier", { name: "AnalysisExecutionId" })
  analysisExecutionId!: string;

  @Column("nvarchar", {
    name: "Status",
    length: 24,
    default: "GENERATED",
  })
  status!: AiAnalysisResultStatus;

  @Column("nvarchar", { name: "SchemaVersion", length: 30 })
  schemaVersion!: string;

  @Column("nvarchar", { name: "ContentJson" })
  contentJson!: string;

  @Column("uniqueidentifier", { name: "ReviewedByUserId", nullable: true })
  reviewedByUserId!: string | null;

  @Column("datetime2", {
    name: "ReviewedAt",
    precision: 7,
    nullable: true,
  })
  reviewedAt!: Date | null;

  @Column("nvarchar", {
    name: "ReviewComment",
    length: 2000,
    nullable: true,
  })
  reviewComment!: string | null;

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
