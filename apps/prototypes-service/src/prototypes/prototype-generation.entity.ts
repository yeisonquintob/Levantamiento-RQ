import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type {
  PrototypeGenerationStatus,
  PrototypeImageProviderCode,
  PrototypePlannerProviderCode,
  PrototypeTargetDevice,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "PrototypeGenerations" })
@Index("IX_PrototypeGenerations_SourceSha256", ["sourceSha256"])
@Index("IX_PrototypeGenerations_ProjectId_CreatedAt", [
  "projectId",
  "createdAt",
])
export class PrototypeGenerationEntity {
  @Column("uniqueidentifier", { name: "PlannerConfigurationId", nullable: true })
  plannerConfigurationId!: string | null;
  @Column("uniqueidentifier", { name: "ImageConfigurationId", nullable: true })
  imageConfigurationId!: string | null;
  @PrimaryGeneratedColumn("uuid", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "ProjectId", nullable: true })
  projectId!: string | null;
  @Column("nvarchar", { name: "SourceFileName", length: 260 })
  sourceFileName!: string;
  @Column("nvarchar", { name: "SourceMarkdown", length: "MAX" })
  sourceMarkdown!: string;
  @Column("char", { name: "SourceSha256", length: 64 }) sourceSha256!: string;
  @Column("bigint", { name: "SourceSizeBytes" }) sourceSizeBytes!: string;
  @Column("nvarchar", { name: "TargetDevice", length: 16 })
  targetDevice!: PrototypeTargetDevice;
  @Column("nvarchar", { name: "Status", length: 24, default: "SOURCE_READY" })
  status!: PrototypeGenerationStatus;
  @Column("nvarchar", { name: "PlannerProvider", length: 80, nullable: true })
  plannerProvider!: PrototypePlannerProviderCode | null;
  @Column("nvarchar", { name: "PlannerModel", length: 120, nullable: true })
  plannerModel!: string | null;
  @Column("nvarchar", { name: "ApplicationName", length: 240, nullable: true })
  applicationName!: string | null;
  @Column("nvarchar", { name: "Summary", length: 2000, nullable: true })
  summary!: string | null;
  @Column("nvarchar", { name: "ImageProvider", length: 80, nullable: true })
  imageProvider!: PrototypeImageProviderCode | null;
  @Column("int", { name: "TotalScreens", default: 0 }) totalScreens!: number;
  @Column("int", { name: "GeneratedScreens", default: 0 })
  generatedScreens!: number;
  @Column("int", { name: "TotalVisualSpecifications", default: 0 })
  totalVisualSpecifications!: number;
  @Column("int", { name: "TotalImages", default: 0 }) totalImages!: number;
  @Column("int", { name: "CompletedImages", default: 0 })
  completedImages!: number;
  @Column("int", { name: "FailedImages", default: 0 }) failedImages!: number;
  @Column("nvarchar", { name: "ErrorCode", length: 80, nullable: true })
  errorCode!: string | null;
  @Column("nvarchar", { name: "ErrorMessage", length: 2000, nullable: true })
  errorMessage!: string | null;
  @Column("uniqueidentifier", { name: "RequestedByUserId" })
  requestedByUserId!: string;
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
