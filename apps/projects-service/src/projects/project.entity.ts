import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { ProjectStatus } from "@levantamiento-rq/shared-contracts";

import { ProjectParticipantEntity } from "./project-participant.entity";

@Entity({ name: "Projects" })
@Index("UQ_Projects_Code", ["code"], { unique: true })
@Index("IX_Projects_Status_UpdatedAt", ["status", "updatedAt"])
@Index("IX_Projects_OwnerUserId", ["ownerUserId"])
export class ProjectEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("nvarchar", { name: "Code", length: 30 })
  code!: string;

  @Column("nvarchar", { name: "Title", length: 200 })
  title!: string;

  @Column("nvarchar", { name: "RequestingArea", length: 160 })
  requestingArea!: string;

  @Column("nvarchar", {
    name: "Description",
    length: 2000,
    nullable: true,
  })
  description!: string | null;

  @Column("nvarchar", { name: "Status", length: 32, default: "DRAFT" })
  status!: ProjectStatus;

  @Column("uniqueidentifier", { name: "OwnerUserId" })
  ownerUserId!: string;

  @Column("uniqueidentifier", { name: "CreatedByUserId" })
  createdByUserId!: string;

  @Column("uniqueidentifier", { name: "UpdatedByUserId" })
  updatedByUserId!: string;

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
    () => ProjectParticipantEntity,
    (participant) => participant.project,
  )
  participants!: ProjectParticipantEntity[];
}
