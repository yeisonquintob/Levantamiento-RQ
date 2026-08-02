import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import { RolePermissionEntity } from "./role-permission.entity";

@Entity({ name: "IdentityPermissions" })
@Index("UQ_IdentityPermissions_Code", ["code"], { unique: true })
export class PermissionEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Code", length: 160 })
  code!: string;

  @Column("nvarchar", { name: "Name", length: 200 })
  name!: string;

  @Column("nvarchar", {
    name: "Description",
    length: 500,
    nullable: true,
  })
  description!: string | null;

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

  @OneToMany(
    () => RolePermissionEntity,
    (rolePermission) => rolePermission.permission,
  )
  rolePermissions!: RolePermissionEntity[];
}
