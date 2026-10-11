import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "LocalAiAuditEvents" })
@Index("IX_LocalAiAuditEvents_Project_CreatedAt", ["projectId", "createdAt"])
export class LocalAiAuditEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "ProjectId" }) projectId!: string;
  @Column("uniqueidentifier", { name: "AnalysisRequestId" }) analysisRequestId!: string;
  @Column("nvarchar", { name: "Action", length: 80 }) action!: "RAW_SOURCE_FALLBACK";
  @Column("nvarchar", { name: "ReasonCode", length: 100 }) reasonCode!: string;
  @Column("uniqueidentifier", { name: "CorrelationId", nullable: true }) correlationId!: string | null;
  @Column("datetime2", { name: "CreatedAt", precision: 7 }) createdAt!: Date;
}
