export const WORKFLOW_REVIEW_STATUSES = [
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type WorkflowReviewStatus =
  (typeof WORKFLOW_REVIEW_STATUSES)[number];

export const WORKFLOW_ASSIGNMENT_ROLES = ["REVIEWER", "APPROVER"] as const;

export type WorkflowAssignmentRole =
  (typeof WORKFLOW_ASSIGNMENT_ROLES)[number];

export const WORKFLOW_ASSIGNMENT_STATUSES = ["PENDING", "COMPLETED"] as const;

export type WorkflowAssignmentStatus =
  (typeof WORKFLOW_ASSIGNMENT_STATUSES)[number];

export const WORKFLOW_ACTIVITY_TYPES = [
  "REVIEW_REQUESTED",
  "COMMENTED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
] as const;

export type WorkflowActivityType =
  (typeof WORKFLOW_ACTIVITY_TYPES)[number];

export interface WorkflowReviewAssignment {
  id: string;
  userId: string;
  role: WorkflowAssignmentRole;
  status: WorkflowAssignmentStatus;
  assignedAt: string;
  completedAt: string | null;
}

export interface WorkflowReviewActivity {
  id: string;
  type: WorkflowActivityType;
  actorUserId: string;
  comment: string | null;
  correlationId: string;
  createdAt: string;
}

export interface WorkflowReviewSummary {
  id: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  versionNumber: number;
  status: WorkflowReviewStatus;
  revision: number;
  requestedByUserId: string;
  requestedAt: string;
  completedByUserId: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowReviewDetail extends WorkflowReviewSummary {
  assignments: readonly WorkflowReviewAssignment[];
  activities: readonly WorkflowReviewActivity[];
}

export interface WorkflowReviewListResponse {
  items: readonly WorkflowReviewSummary[];
  totalItems: number;
}

export interface CreateWorkflowReviewRequest {
  expectedDocumentRevision: number;
  comment?: string | null;
}

export interface AddWorkflowCommentRequest {
  expectedReviewRevision: number;
  comment: string;
}

export interface DecideWorkflowReviewRequest {
  expectedReviewRevision: number;
  expectedDocumentRevision: number;
  comment?: string | null;
}
