import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "IdentitySecurityAudit" })
@Index("IX_IdentitySecurityAudit_TargetUserId_CreatedAt", [
  "targetUserId",
  "createdAt",
])
export class SecurityAuditEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "EventType", length: 64 })
  eventType!: string;

  @Column("uniqueidentifier", { name: "ActorUserId" })
  actorUserId!: string;

  @Column("uniqueidentifier", { name: "TargetUserId" })
  targetUserId!: string;

  @Column("nvarchar", { name: "Detail", length: 2000, nullable: true })
  detail!: string | null;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;
}
