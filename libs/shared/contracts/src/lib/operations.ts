export const EXPORT_FORMATS = ["PDF", "DOCX"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export interface CreateExportRequest {
  format: ExportFormat;
}

export interface ExportArtifactDetail {
  id: string;
  exportRequestId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: string;
  sha256: string;
  createdAt: string;
}

export interface ExportRequestDetail {
  id: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  versionNumber: number;
  format: ExportFormat;
  status: ExportStatus;
  requestedByUserId: string;
  attemptCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  artifact: ExportArtifactDetail | null;
}

export interface ExportRequestListResponse {
  items: readonly ExportRequestDetail[];
  totalItems: number;
}

export const NOTIFICATION_CHANNELS = ["IN_APP", "EMAIL"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  "PENDING",
  "DELIVERED",
  "FAILED",
  "READ",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "REVIEW_ASSIGNED",
  "CHANGES_REQUESTED",
  "DOCUMENT_APPROVED",
  "DOCUMENT_REJECTED",
  "EXPORT_READY",
  "EXPORT_FAILED",
  "ANALYSIS_FAILED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationDetail {
  id: string;
  recipientUserId: string;
  projectId: string | null;
  notificationType: NotificationType;
  channel: NotificationChannel;
  status: NotificationStatus;
  subject: string;
  body: string;
  resourceType: string | null;
  resourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResponse {
  items: readonly NotificationDetail[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  unreadItems: number;
}

export const AUDIT_RESULTS = ["SUCCEEDED", "FAILED", "DENIED"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export interface AuditEventDetail {
  id: string;
  actorUserId: string | null;
  projectId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: AuditResult;
  correlationId: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Readonly<Record<string, unknown>>;
  occurredAt: string;
}

export interface AuditEventListResponse {
  items: readonly AuditEventDetail[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
