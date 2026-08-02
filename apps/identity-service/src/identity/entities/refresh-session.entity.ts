import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { UserEntity } from "./user.entity";

@Entity({ name: "IdentityRefreshSessions" })
@Index("IX_IdentityRefreshSessions_UserId", ["userId"])
@Index("IX_IdentityRefreshSessions_ExpiresAt", ["expiresAt"])
@Index("UQ_IdentityRefreshSessions_TokenHash", ["tokenHash"], {
  unique: true,
})
export class RefreshSessionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "UserId" })
  userId!: string;

  @Column("char", { name: "TokenHash", length: 64 })
  tokenHash!: string;

  @Column("datetime2", { name: "ExpiresAt", precision: 7 })
  expiresAt!: Date;

  @Column("datetime2", {
    name: "RevokedAt",
    precision: 7,
    nullable: true,
  })
  revokedAt!: Date | null;

  @Column("uniqueidentifier", {
    name: "ReplacedBySessionId",
    nullable: true,
  })
  replacedBySessionId!: string | null;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @Column("datetime2", {
    name: "LastUsedAt",
    precision: 7,
    nullable: true,
  })
  lastUsedAt!: Date | null;

  @Column("nvarchar", {
    name: "UserAgent",
    length: 512,
    nullable: true,
  })
  userAgent!: string | null;

  @Column("nvarchar", {
    name: "IpAddress",
    length: 64,
    nullable: true,
  })
  ipAddress!: string | null;

  @ManyToOne(() => UserEntity, (user) => user.refreshSessions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "UserId" })
  user!: UserEntity;
}
