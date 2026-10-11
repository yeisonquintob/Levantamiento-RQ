import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "AiSecurityAudit" })
@Index("IX_AiSecurityAudit_Project_CreatedAt", ["projectId", "createdAt"])
export class AiSecurityAuditEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" }) id!: string;
  @Column("nvarchar", { name: "EventType", length: 64 }) eventType!: string;
  @Column("uniqueidentifier", { name: "ActorUserId", nullable: true }) actorUserId!: string | null;
  @Column("uniqueidentifier", { name: "ProjectId", nullable: true }) projectId!: string | null;
  @Column("uniqueidentifier", { name: "ExecutionId", nullable: true }) executionId!: string | null;
  @Column("nvarchar", { name: "Code", length: 80 }) code!: string;
  @Column("nvarchar", { name: "DetailJson", length: 2000, nullable: true }) detailJson!: string | null;
  @Column("datetime2", { name: "CreatedAt", precision: 7, default: () => "SYSUTCDATETIME()" }) createdAt!: Date;
}
