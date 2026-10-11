import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type { AiAnalysisLocalDraftBlockStatus } from "@levantamiento-rq/shared-contracts";

// PASO_5_CHECKPOINTS_PERSISTENTES_V1
@Entity({ name: "LocalDraftBlockCheckpoints" })
@Index(
  "UQ_LocalDraftBlockCheckpoints_Request_BlockKey",
  ["analysisRequestId", "blockKey"],
  { unique: true },
)
@Index("IX_LocalDraftBlockCheckpoints_Request_BlockNumber", [
  "analysisRequestId",
  "blockNumber",
])
export class LocalDraftBlockCheckpointEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "AnalysisRequestId" })
  analysisRequestId!: string;

  @Column("nvarchar", { name: "BlockKey", length: 160 })
  blockKey!: string;

  @Column("int", { name: "BlockNumber" })
  blockNumber!: number;

  @Column("int", { name: "BlockTotal" })
  blockTotal!: number;

  @Column("nvarchar", { name: "BlockLabel", length: 300 })
  blockLabel!: string;

  @Column("nvarchar", {
    name: "Status",
    length: 24,
    default: "PENDING",
  })
  status!: AiAnalysisLocalDraftBlockStatus;

  @Column("nvarchar", {
    name: "SchemaVersion",
    length: 30,
    default: "4.1.0",
  })
  schemaVersion!: string;

  @Column("nvarchar", {
    name: "StageValuesJson",
    nullable: true,
  })
  stageValuesJson!: string | null;

  @Column("datetime2", {
    name: "CompletedAt",
    precision: 7,
    nullable: true,
  })
  completedAt!: Date | null;

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
