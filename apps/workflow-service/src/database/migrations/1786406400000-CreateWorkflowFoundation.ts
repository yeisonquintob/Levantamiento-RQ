import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateWorkflowFoundation1786406400000
  implements MigrationInterface
{
  name = "CreateWorkflowFoundation1786406400000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dbo.WorkflowReviewRequests (
        Id uniqueidentifier NOT NULL,
        ProjectId uniqueidentifier NOT NULL,
        DocumentId uniqueidentifier NOT NULL,
        DocumentVersionId uniqueidentifier NOT NULL,
        VersionNumber int NOT NULL,
        Status nvarchar(32) NOT NULL,
        Revision int NOT NULL,
        RequestedByUserId uniqueidentifier NOT NULL,
        RequestedAt datetime2(7) NOT NULL,
        CompletedByUserId uniqueidentifier NULL,
        CompletedAt datetime2(7) NULL,
        CreatedAt datetime2(7) NOT NULL,
        UpdatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_WorkflowReviewRequests PRIMARY KEY (Id),
        CONSTRAINT CK_WorkflowReviewRequests_VersionNumber
          CHECK (VersionNumber > 0),
        CONSTRAINT CK_WorkflowReviewRequests_Revision CHECK (Revision > 0),
        CONSTRAINT CK_WorkflowReviewRequests_Status
          CHECK (
            Status IN (
              'IN_REVIEW',
              'CHANGES_REQUESTED',
              'APPROVED',
              'REJECTED',
              'CANCELLED'
            )
          ),
        CONSTRAINT UQ_WorkflowReviewRequests_Document_Version
          UNIQUE (DocumentId, VersionNumber)
      );

      CREATE INDEX IX_WorkflowReviewRequests_Project_Status_UpdatedAt
        ON dbo.WorkflowReviewRequests (ProjectId, Status, UpdatedAt DESC);

      CREATE INDEX IX_WorkflowReviewRequests_Status_UpdatedAt
        ON dbo.WorkflowReviewRequests (Status, UpdatedAt DESC);

      CREATE TABLE dbo.WorkflowReviewAssignments (
        Id uniqueidentifier NOT NULL,
        ReviewRequestId uniqueidentifier NOT NULL,
        UserId uniqueidentifier NOT NULL,
        Role nvarchar(24) NOT NULL,
        Status nvarchar(24) NOT NULL,
        AssignedAt datetime2(7) NOT NULL,
        CompletedAt datetime2(7) NULL,
        CONSTRAINT PK_WorkflowReviewAssignments PRIMARY KEY (Id),
        CONSTRAINT FK_WorkflowReviewAssignments_Request
          FOREIGN KEY (ReviewRequestId)
          REFERENCES dbo.WorkflowReviewRequests(Id)
          ON DELETE CASCADE,
        CONSTRAINT CK_WorkflowReviewAssignments_Role
          CHECK (Role IN ('REVIEWER', 'APPROVER')),
        CONSTRAINT CK_WorkflowReviewAssignments_Status
          CHECK (Status IN ('PENDING', 'COMPLETED')),
        CONSTRAINT UQ_WorkflowReviewAssignments_Request_User_Role
          UNIQUE (ReviewRequestId, UserId, Role)
      );

      CREATE INDEX IX_WorkflowReviewAssignments_User_Status
        ON dbo.WorkflowReviewAssignments (UserId, Status);

      CREATE TABLE dbo.WorkflowReviewActivities (
        Id uniqueidentifier NOT NULL,
        ReviewRequestId uniqueidentifier NOT NULL,
        ActivityType nvarchar(32) NOT NULL,
        ActorUserId uniqueidentifier NOT NULL,
        Comment nvarchar(4000) NULL,
        CorrelationId uniqueidentifier NOT NULL,
        IdempotencyKey nvarchar(120) NULL,
        CreatedAt datetime2(7) NOT NULL,
        CONSTRAINT PK_WorkflowReviewActivities PRIMARY KEY (Id),
        CONSTRAINT FK_WorkflowReviewActivities_Request
          FOREIGN KEY (ReviewRequestId)
          REFERENCES dbo.WorkflowReviewRequests(Id)
          ON DELETE CASCADE,
        CONSTRAINT CK_WorkflowReviewActivities_Type
          CHECK (
            ActivityType IN (
              'REVIEW_REQUESTED',
              'COMMENTED',
              'CHANGES_REQUESTED',
              'APPROVED',
              'REJECTED'
            )
          )
      );

      CREATE INDEX IX_WorkflowReviewActivities_Request_CreatedAt
        ON dbo.WorkflowReviewActivities (ReviewRequestId, CreatedAt DESC);

      CREATE UNIQUE INDEX UX_WorkflowReviewActivities_Request_IdempotencyKey
        ON dbo.WorkflowReviewActivities (ReviewRequestId, IdempotencyKey)
        WHERE IdempotencyKey IS NOT NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE dbo.WorkflowReviewActivities;
      DROP TABLE dbo.WorkflowReviewAssignments;
      DROP TABLE dbo.WorkflowReviewRequests;
    `);
  }
}
