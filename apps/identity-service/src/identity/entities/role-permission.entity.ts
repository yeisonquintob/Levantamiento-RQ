import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";

import { PermissionEntity } from "./permission.entity";
import { RoleEntity } from "./role.entity";

@Entity({ name: "IdentityRolePermissions" })
export class RolePermissionEntity {
  @PrimaryColumn("uniqueidentifier", { name: "RoleId" })
  roleId!: string;

  @PrimaryColumn("uniqueidentifier", { name: "PermissionId" })
  permissionId!: string;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @ManyToOne(() => RoleEntity, (role) => role.rolePermissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "RoleId" })
  role!: RoleEntity;

  @ManyToOne(
    () => PermissionEntity,
    (permission) => permission.rolePermissions,
    { onDelete: "CASCADE" },
  )
  @JoinColumn({ name: "PermissionId" })
  permission!: PermissionEntity;
}
