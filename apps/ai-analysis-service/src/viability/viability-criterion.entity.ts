import { Column, Entity, Index, PrimaryColumn } from "typeorm";

@Entity({ name: "ViabilityCriteria" })
@Index("UQ_ViabilityCriteria_Level", ["level"], { unique: true })
export class ViabilityCriterionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" }) id!: string;
  @Column("int", { name: "Level" }) level!: number;
  @Column("int", { name: "MinimumPercentage" }) minimumPercentage!: number;
  @Column("int", { name: "MaximumPercentage" }) maximumPercentage!: number;
  @Column("nvarchar", { name: "Name", length: 120 }) name!: string;
  @Column("nvarchar", { name: "Description", length: 1000 }) description!: string;
  @Column("nvarchar", { name: "Recommendation", length: 1000 }) recommendation!: string;
  @Column("bit", { name: "Viable" }) viable!: boolean;
  @Column("int", { name: "DisplayOrder" }) order!: number;
  @Column("bit", { name: "Active" }) active!: boolean;
  @Column("datetime2", { name: "CreatedAt", precision: 7, default: () => "SYSUTCDATETIME()" }) createdAt!: Date;
  @Column("datetime2", { name: "UpdatedAt", precision: 7, default: () => "SYSUTCDATETIME()" }) updatedAt!: Date;
}
