import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "ProjectAreas" })
@Index("UQ_ProjectAreas_Name", ["name"], { unique: true })
export class ProjectAreaEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Name", length: 160 })
  name!: string;

  @Column("nvarchar", { name: "Icon", length: 30, nullable: true })
  icon!: string | null;

  @Column("nvarchar", { name: "Color", length: 20, nullable: true })
  color!: string | null;

  @Column("uniqueidentifier", { name: "CreatedByUserId", nullable: true })
  createdByUserId!: string | null;

  @Column("datetime2", { name: "CreatedAt", default: () => "SYSUTCDATETIME()" })
  createdAt!: Date;
}
