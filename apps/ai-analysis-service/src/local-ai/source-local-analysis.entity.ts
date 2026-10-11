import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "SourceLocalAnalyses" })
@Index("UQ_SourceLocalAnalyses_Cache", ["sourceId", "sourceSha256", "model", "promptVersion"], { unique: true })
@Index("IX_SourceLocalAnalyses_Project", ["projectId", "status"])
export class SourceLocalAnalysisEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "ProjectId" }) projectId!: string;
  @Column("uniqueidentifier", { name: "SourceId" }) sourceId!: string;
  @Column("char", { name: "SourceSha256", length: 64 }) sourceSha256!: string;
  @Column("nvarchar", { name: "Provider", length: 30 }) provider!: "OLLAMA";
  @Column("nvarchar", { name: "Model", length: 120 }) model!: string;
  @Column("nvarchar", { name: "PromptVersion", length: 30 }) promptVersion!: string;
  @Column("nvarchar", { name: "Status", length: 30 }) status!: "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
  @Column("nvarchar", { name: "AnalysisJson", nullable: true }) analysisJson!: string | null;
  @Column("bigint", { name: "OriginalCharacters" }) originalCharacters!: string;
  @Column("bigint", { name: "EstimatedOriginalTokens" }) estimatedOriginalTokens!: string;
  @Column("bigint", { name: "AnalysisCharacters", nullable: true }) analysisCharacters!: string | null;
  @Column("bigint", { name: "EstimatedAnalysisTokens", nullable: true }) estimatedAnalysisTokens!: string | null;
  @Column("nvarchar", { name: "ErrorCode", length: 100, nullable: true }) errorCode!: string | null;
  @Column("nvarchar", { name: "ErrorMessage", length: 1000, nullable: true }) errorMessage!: string | null;
  @Column("datetime2", { name: "CreatedAt", precision: 7 }) createdAt!: Date;
  @Column("datetime2", { name: "UpdatedAt", precision: 7 }) updatedAt!: Date;
}
