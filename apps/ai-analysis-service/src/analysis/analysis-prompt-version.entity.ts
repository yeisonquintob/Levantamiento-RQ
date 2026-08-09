import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "AnalysisPromptVersions" })
@Index("UQ_AnalysisPromptVersions_Code_Version", ["code", "version"], {
  unique: true,
})
export class AnalysisPromptVersionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Code", length: 80 })
  code!: string;

  @Column("nvarchar", { name: "Version", length: 30 })
  version!: string;

  @Column("nvarchar", { name: "SystemInstruction" })
  systemInstruction!: string;

  @Column("nvarchar", { name: "SchemaVersion", length: 30 })
  schemaVersion!: string;

  @Column("bit", { name: "IsActive", default: true })
  isActive!: boolean;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;
}
