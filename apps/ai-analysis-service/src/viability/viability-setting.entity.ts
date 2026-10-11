import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity({ name: "ViabilitySettings" })
export class ViabilitySettingEntity {
  @PrimaryColumn("nvarchar", { name: "SettingKey", length: 80 }) key!: string;
  @Column("int", { name: "IntegerValue" }) integerValue!: number;
  @Column("datetime2", { name: "UpdatedAt", precision: 7, default: () => "SYSUTCDATETIME()" }) updatedAt!: Date;
}
