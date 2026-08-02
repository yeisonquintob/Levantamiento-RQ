import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { RoleEntity } from "./role.entity";
import { UserEntity } from "./user.entity";

@Entity({ name: "IdentityUserRoles" })
export class UserRoleEntity {
  @PrimaryColumn("uniqueidentifier", { name: "UserId" })
  userId!: string;

  @PrimaryColumn("uniqueidentifier", { name: "RoleId" })
  roleId!: string;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @ManyToOne(() => UserEntity, (user) => user.userRoles, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "UserId" })
  user!: UserEntity;

  @ManyToOne(() => RoleEntity, (role) => role.userRoles, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "RoleId" })
  role!: RoleEntity;
}
