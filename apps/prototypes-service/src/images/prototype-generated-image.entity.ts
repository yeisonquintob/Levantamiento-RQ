import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type {
  PrototypeGeneratedImageStatus,
  PrototypeImageProviderCode,
  PrototypeVisualDevice,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "PrototypeGeneratedImages" })
@Index(
  "UX_PrototypeGeneratedImages_VisualSpecificationId",
  ["visualSpecificationId"],
  { unique: true },
)
@Index("IX_PrototypeGeneratedImages_GenerationId_Status", [
  "generationId",
  "status",
])
export class PrototypeGeneratedImageEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "GenerationId" }) generationId!: string;
  @Column("uniqueidentifier", { name: "VisualSpecificationId" })
  visualSpecificationId!: string;
  @Column("uniqueidentifier", { name: "ScreenId" }) screenId!: string;
  @Column("nvarchar", { name: "Device", length: 16 })
  device!: PrototypeVisualDevice;
  @Column("nvarchar", { name: "Provider", length: 40 })
  provider!: PrototypeImageProviderCode;
  @Column("nvarchar", { name: "Model", length: 120, nullable: true }) model!:
    string | null;
  @Column("nvarchar", { name: "Status", length: 16 })
  status!: PrototypeGeneratedImageStatus;
  @Column("nvarchar", { name: "MediaType", length: 80, nullable: true })
  mediaType!: "image/png" | null;
  @Column("nvarchar", { name: "StorageKey", length: 700, nullable: true })
  storageKey!: string | null;
  @Column("int", { name: "Width", nullable: true }) width!: number | null;
  @Column("int", { name: "Height", nullable: true }) height!: number | null;
  @Column("int", { name: "AttemptNumber", default: 1 })
  attemptNumber!: number;
  @Column("nvarchar", { name: "PreviousProvider", length: 40, nullable: true })
  previousProvider!: PrototypeImageProviderCode | null;
  @Column("nvarchar", { name: "PreviousModel", length: 120, nullable: true })
  previousModel!: string | null;
  @Column("nvarchar", { name: "PreviousStatus", length: 16, nullable: true })
  previousStatus!: PrototypeGeneratedImageStatus | null;
  @Column("nvarchar", {
    name: "PreviousStorageKey",
    length: 700,
    nullable: true,
  })
  previousStorageKey!: string | null;
  @Column("datetime2", {
    name: "PreviousCompletedAt",
    precision: 7,
    nullable: true,
  })
  previousCompletedAt!: Date | null;
  @Column("nvarchar", { name: "ErrorCode", length: 80, nullable: true })
  errorCode!: string | null;
  @Column("nvarchar", { name: "ErrorMessage", length: 1000, nullable: true })
  errorMessage!: string | null;
  @Column("uniqueidentifier", { name: "CorrelationId", nullable: true })
  correlationId!: string | null;
  @Column("datetime2", { name: "StartedAt", precision: 7, nullable: true })
  startedAt!: Date | null;
  @Column("datetime2", { name: "CompletedAt", precision: 7, nullable: true })
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
