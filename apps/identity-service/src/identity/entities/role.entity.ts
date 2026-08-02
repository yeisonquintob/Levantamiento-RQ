import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import { RolePermissionEntity } from "./role-permission.entity";
import { UserRoleEntity } from "./user-role.entity";

@Entity({ name: "IdentityRoles" })
@Index("UQ_IdentityRoles_Code", ["code"], { unique: true })
export class RoleEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Code", length: 100 })
  code!: string;

  @Column("nvarchar", { name: "Name", length: 160 })
  name!: string;

  @Column("bit", { name: "IsActive", default: true })
  isActive!: boolean;

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

  @OneToMany(() => UserRoleEntity, (userRole) => userRole.role)
  userRoles!: UserRoleEntity[];

  @OneToMany(
    () => RolePermissionEntity,
    (rolePermission) => rolePermission.role,
  )
  rolePermissions!: RolePermissionEntity[];
}
