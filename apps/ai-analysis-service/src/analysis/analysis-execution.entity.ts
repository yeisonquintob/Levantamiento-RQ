import {
  Column,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

import type {
  AiAnalysisStatus,
  AiProviderCode,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "AnalysisExecutions" })
@Index(
  "UQ_AnalysisExecutions_Request_Attempt",
  ["analysisRequestId", "attempt"],
  { unique: true },
)
@Index("IX_AnalysisExecutions_Status_CreatedAt", ["status", "createdAt"])
export class AnalysisExecutionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "AnalysisRequestId" })
  analysisRequestId!: string;

  @Column("int", { name: "Attempt" })
  attempt!: number;

  @Column("nvarchar", {
    name: "Status",
    length: 24,
    default: "PENDING",
  })
  status!: AiAnalysisStatus;

  @Column("nvarchar", {
    name: "Provider",
    length: 40,
    default: "DISABLED",
  })
  provider!: AiProviderCode;

  @Column("nvarchar", {
    name: "Model",
    length: 120,
    nullable: true,
  })
  model!: string | null;

  @Column("datetime2", {
    name: "StartedAt",
    precision: 7,
    nullable: true,
  })
  startedAt!: Date | null;

  @Column("datetime2", {
    name: "FinishedAt",
    precision: 7,
    nullable: true,
  })
  finishedAt!: Date | null;

  @Column("bigint", {
    name: "DurationMs",
    nullable: true,
  })
  durationMs!: string | null;

  @Column("int", {
    name: "InputTokens",
    nullable: true,
  })
  inputTokens!: number | null;

  @Column("int", {
    name: "OutputTokens",
    nullable: true,
  })
  outputTokens!: number | null;

  @Column("decimal", {
    name: "EstimatedCost",
    precision: 18,
    scale: 8,
    nullable: true,
  })
  estimatedCost!: string | null;

  @Column("nvarchar", {
    name: "ProviderRequestId",
    length: 200,
    nullable: true,
  })
  providerRequestId!: string | null;

  @Column("nvarchar", {
    name: "ErrorCode",
    length: 100,
    nullable: true,
  })
  errorCode!: string | null;

  @Column("nvarchar", {
    name: "ErrorMessage",
    length: 2000,
    nullable: true,
  })
  errorMessage!: string | null;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;
}
