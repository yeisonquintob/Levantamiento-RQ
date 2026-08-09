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
