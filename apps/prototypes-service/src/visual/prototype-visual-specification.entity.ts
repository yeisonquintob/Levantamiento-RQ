import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type {
  PrototypeDesignSystemCode,
  PrototypeVisualDevice,
  PrototypeVisualTemplateCode,
} from "@levantamiento-rq/shared-contracts";
@Entity({ name: "PrototypeVisualSpecifications" })
@Index(
  "UX_PrototypeVisualSpecifications_ScreenId_Device",
  ["screenId", "device"],
  { unique: true },
)
@Index("IX_PrototypeVisualSpecifications_GenerationId_Device", [
  "generationId",
  "device",
])
export class PrototypeVisualSpecificationEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "GenerationId" }) generationId!: string;
  @Column("uniqueidentifier", { name: "ScreenId" }) screenId!: string;
  @Column("nvarchar", { name: "Device", length: 16 })
  device!: PrototypeVisualDevice;
  @Column("nvarchar", { name: "TemplateCode", length: 40 })
  templateCode!: PrototypeVisualTemplateCode;
  @Column("nvarchar", { name: "DesignSystemCode", length: 40 })
  designSystemCode!: PrototypeDesignSystemCode;
  @Column("nvarchar", { name: "SpecificationJson", length: "MAX" })
  specificationJson!: string;
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
