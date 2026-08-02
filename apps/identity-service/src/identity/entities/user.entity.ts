import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import { RefreshSessionEntity } from "./refresh-session.entity";
import { UserRoleEntity } from "./user-role.entity";

@Entity({ name: "IdentityUsers" })
@Index("UQ_IdentityUsers_EmailNormalized", ["emailNormalized"], {
  unique: true,
})
export class UserEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Email", length: 320 })
  email!: string;

  @Column("nvarchar", { name: "EmailNormalized", length: 320 })
  emailNormalized!: string;

  @Column("nvarchar", { name: "DisplayName", length: 200 })
  displayName!: string;

  @Column("nvarchar", { name: "PasswordHash", length: 500 })
  passwordHash!: string;

  @Column("bit", { name: "IsActive", default: true })
  isActive!: boolean;

  @Column("datetime2", {
    name: "LastLoginAt",
    precision: 7,
    nullable: true,
  })
  lastLoginAt!: Date | null;

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

  @OneToMany(() => UserRoleEntity, (userRole) => userRole.user)
  userRoles!: UserRoleEntity[];

  @OneToMany(() => RefreshSessionEntity, (session) => session.user)
  refreshSessions!: RefreshSessionEntity[];
}
