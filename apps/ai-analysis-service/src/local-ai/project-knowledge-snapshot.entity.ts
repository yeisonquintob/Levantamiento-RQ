import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "ProjectKnowledgeSnapshots" })
@Index("IX_ProjectKnowledgeSnapshots_Project", ["projectId", "createdAt"])
export class ProjectKnowledgeSnapshotEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "ProjectId" }) projectId!: string;
  @Column("uniqueidentifier", { name: "AnalysisRequestId" }) analysisRequestId!: string;
  @Column("nvarchar", { name: "Model", length: 120 }) model!: string;
  @Column("nvarchar", { name: "PromptVersion", length: 30 }) promptVersion!: string;
  @Column("nvarchar", { name: "SnapshotJson" }) snapshotJson!: string;
  @Column("bigint", { name: "OriginalCharacters" }) originalCharacters!: string;
  @Column("bigint", { name: "EstimatedOriginalTokens" }) estimatedOriginalTokens!: string;
  @Column("bigint", { name: "AnalysisCharacters" }) analysisCharacters!: string;
  @Column("bigint", { name: "EstimatedAnalysisTokens" }) estimatedAnalysisTokens!: string;
  @Column("bigint", { name: "SnapshotCharacters" }) snapshotCharacters!: string;
  @Column("bigint", { name: "EstimatedSnapshotTokens" }) estimatedSnapshotTokens!: string;
  @Column("decimal", { name: "ReductionPercentage", precision: 6, scale: 2 }) reductionPercentage!: string;
  @Column("datetime2", { name: "CreatedAt", precision: 7 }) createdAt!: Date;
}
