import { Column, Entity, Index, PrimaryColumn } from "typeorm";

import type {
  WorkflowActivityType,
  WorkflowAssignmentRole,
  WorkflowAssignmentStatus,
  WorkflowReviewStatus,
} from "@levantamiento-rq/shared-contracts";

@Entity({ name: "WorkflowReviewRequests" })
@Index("UQ_WorkflowReviewRequests_Document_Version", [
  "documentId",
  "versionNumber",
], { unique: true })
@Index("IX_WorkflowReviewRequests_Project_Status_UpdatedAt", [
  "projectId",
  "status",
  "updatedAt",
])
@Index("IX_WorkflowReviewRequests_Status_UpdatedAt", ["status", "updatedAt"])
export class WorkflowReviewRequestEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ProjectId" })
  projectId!: string;

  @Column("uniqueidentifier", { name: "DocumentId" })
  documentId!: string;

  @Column("uniqueidentifier", { name: "DocumentVersionId" })
  documentVersionId!: string;

  @Column("int", { name: "VersionNumber" })
  versionNumber!: number;

  @Column("nvarchar", { name: "Status", length: 32 })
  status!: WorkflowReviewStatus;

  @Column("int", { name: "Revision" })
  revision!: number;

  @Column("uniqueidentifier", { name: "RequestedByUserId" })
  requestedByUserId!: string;

  @Column("datetime2", { name: "RequestedAt", precision: 7 })
  requestedAt!: Date;

  @Column("uniqueidentifier", {
    name: "CompletedByUserId",
    nullable: true,
  })
  completedByUserId!: string | null;

  @Column("datetime2", {
    name: "CompletedAt",
    precision: 7,
    nullable: true,
  })
  completedAt!: Date | null;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;

  @Column("datetime2", { name: "UpdatedAt", precision: 7 })
  updatedAt!: Date;
}

@Entity({ name: "WorkflowReviewAssignments" })
@Index("UQ_WorkflowReviewAssignments_Request_User_Role", [
  "reviewRequestId",
  "userId",
  "role",
], { unique: true })
@Index("IX_WorkflowReviewAssignments_User_Status", ["userId", "status"])
export class WorkflowReviewAssignmentEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ReviewRequestId" })
  reviewRequestId!: string;

  @Column("uniqueidentifier", { name: "UserId" })
  userId!: string;

  @Column("nvarchar", { name: "Role", length: 24 })
  role!: WorkflowAssignmentRole;

  @Column("nvarchar", { name: "Status", length: 24 })
  status!: WorkflowAssignmentStatus;

  @Column("datetime2", { name: "AssignedAt", precision: 7 })
  assignedAt!: Date;

  @Column("datetime2", {
    name: "CompletedAt",
    precision: 7,
    nullable: true,
  })
  completedAt!: Date | null;
}

@Entity({ name: "WorkflowReviewActivities" })
@Index("IX_WorkflowReviewActivities_Request_CreatedAt", [
  "reviewRequestId",
  "createdAt",
])
export class WorkflowReviewActivityEntity {
  @PrimaryColumn("uniqueidentifier", { name: "Id" })
  id!: string;

  @Column("uniqueidentifier", { name: "ReviewRequestId" })
  reviewRequestId!: string;

  @Column("nvarchar", { name: "ActivityType", length: 32 })
  type!: WorkflowActivityType;

  @Column("uniqueidentifier", { name: "ActorUserId" })
  actorUserId!: string;

  @Column("nvarchar", { name: "Comment", length: 4000, nullable: true })
  comment!: string | null;

  @Column("uniqueidentifier", { name: "CorrelationId" })
  correlationId!: string;

  @Column("nvarchar", {
    name: "IdempotencyKey",
    length: 120,
    nullable: true,
  })
  idempotencyKey!: string | null;

  @Column("datetime2", { name: "CreatedAt", precision: 7 })
  createdAt!: Date;
}
