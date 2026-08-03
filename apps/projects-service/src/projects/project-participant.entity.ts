import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";

import type { ProjectParticipantRole } from "@levantamiento-rq/shared-contracts";

import { ProjectEntity } from "./project.entity";

@Entity({ name: "ProjectParticipants" })
@Index("UQ_ProjectParticipants_ProjectId_UserId", ["projectId", "userId"], {
  unique: true,
})
@Index("IX_ProjectParticipants_UserId", ["userId"])
export class ProjectParticipantEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("uniqueidentifier", { name: "UserId" })
  userId!: string;

  @Column("nvarchar", { name: "Role", length: 32 })
  role!: ProjectParticipantRole;

  @Column("uniqueidentifier", { name: "AddedByUserId" })
  addedByUserId!: string;

  @Column("datetime2", {
    name: "CreatedAt",
    precision: 7,
    default: () => "SYSUTCDATETIME()",
  })
  createdAt!: Date;

  @ManyToOne(() => ProjectEntity, (project) => project.participants, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "ProjectId" })
  project!: ProjectEntity;
}
