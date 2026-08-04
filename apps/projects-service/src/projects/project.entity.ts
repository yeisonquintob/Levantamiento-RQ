import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";

import type {
  DocumentTemplateType,
  ProjectStatus,
} from "@levantamiento-rq/shared-contracts";

import { ProjectParticipantEntity } from "./project-participant.entity";

@Entity({ name: "Projects" })
@Index("UQ_Projects_Code", ["code"], { unique: true })
@Index("IX_Projects_Status_UpdatedAt", ["status", "updatedAt"])
@Index("IX_Projects_OwnerUserId", ["ownerUserId"])
@Index("IX_Projects_TemplateId", ["templateId"])
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

  @Column("uniqueidentifier", {
    name: "TemplateId",
    nullable: true,
  })
  templateId!: string | null;

  @Column("nvarchar", {
    name: "TemplateCode",
    length: 40,
    nullable: true,
  })
  templateCode!: string | null;

  @Column("nvarchar", {
    name: "TemplateName",
    length: 200,
    nullable: true,
  })
  templateName!: string | null;

  @Column("nvarchar", {
    name: "TemplateVersion",
    length: 32,
    nullable: true,
  })
  templateVersion!: string | null;

  @Column("nvarchar", {
    name: "TemplateType",
    length: 40,
    nullable: true,
  })
  templateType!: DocumentTemplateType | null;

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
