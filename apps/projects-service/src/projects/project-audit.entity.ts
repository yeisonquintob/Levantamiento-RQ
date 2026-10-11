import { Column, Entity, Index, PrimaryColumn } from "typeorm";
@Entity({ name: "ProjectAuditEvents" })
@Index("IX_ProjectAudit_Project_Date", ["projectId", "occurredAt"])
export class ProjectAuditEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" }) id!: string;
  @Column("uniqueidentifier", { name: "ProjectId" }) projectId!: string;
  @Column("uniqueidentifier", { name: "ActorUserId" }) actorUserId!: string;
  @Column("nvarchar", { name: "ActorName", length: 200, nullable: true })
  actorName!: string | null;
  @Column("nvarchar", { name: "ProjectLabel", length: 260 })
  projectLabel!: string;
  @Column("nvarchar", { name: "Action", length: 80 }) action!: string;
  @Column("nvarchar", { name: "MetadataJson", length: "MAX" })
  metadataJson!: string;
  @Column("datetime2", { name: "OccurredAt", precision: 7 }) occurredAt!: Date;
}
