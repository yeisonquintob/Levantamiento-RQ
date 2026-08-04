export const SOURCE_TYPES = [
  "FILE",
  "NOTE",
  "CONVERSATION",
  "TRANSCRIPT",
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

export const TEXT_SOURCE_TYPES = [
  "NOTE",
  "CONVERSATION",
  "TRANSCRIPT",
] as const;

export type TextSourceType = (typeof TEXT_SOURCE_TYPES)[number];

export const SOURCE_STATUSES = ["ACTIVE", "ARCHIVED"] as const;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];

export const SOURCE_PROCESSING_STATUSES = [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
] as const;

export type SourceProcessingStatus =
  (typeof SOURCE_PROCESSING_STATUSES)[number];

export const SOURCE_CLASSIFICATIONS = [
  "REQUIREMENT",
  "MEETING",
  "CURRENT_PROCESS",
  "BUSINESS_RULE",
  "EVIDENCE",
  "MANUAL",
  "INTEGRATION",
  "DATA",
  "OTHER",
] as const;

export type SourceClassification =
  (typeof SOURCE_CLASSIFICATIONS)[number];

export const SOURCE_FILE_EXTENSIONS = [
  "pdf",
  "docx",
  "xlsx",
  "txt",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export type SourceFileExtension = (typeof SOURCE_FILE_EXTENSIONS)[number];

export interface SourceSummary {
  id: string;
  projectId: string;
  sourceType: SourceType;
  title: string;
  description: string | null;
  classification: SourceClassification | null;
  contentPreview: string | null;
  processingStatus: SourceProcessingStatus;
  processingMessage: string | null;
  processedAt: string | null;
  status: SourceStatus;
  originalFileName: string | null;
  fileExtension: SourceFileExtension | null;
  mediaType: string | null;
  fileSizeBytes: string | null;
  sha256: string | null;
  pageCount: number | null;
  sheetCount: number | null;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDetail extends SourceSummary {
  content: string | null;
  extractedText: string | null;
  storageContainer: string | null;
  storagePath: string | null;
}

export interface SourceMetrics {
  total: number;
  files: number;
  notes: number;
  conversations: number;
  transcripts: number;
  ready: number;
  pending: number;
  failed: number;
  archived: number;
}

export interface SourceListResponse {
  items: readonly SourceSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface CreateTextSourceRequest {
  sourceType: TextSourceType;
  title: string;
  content: string;
}

export interface UpdateSourceRequest {
  title?: string;
  content?: string;
  description?: string | null;
  classification?: SourceClassification;
}

export interface SourceUploadFileMetadata {
  fileName: string;
  classification: SourceClassification;
  description?: string | null;
}

export interface SourceUploadRejected {
  fileName: string;
  reason: string;
  duplicateSourceId?: string;
}

export interface SourceUploadBatchResponse {
  accepted: readonly SourceDetail[];
  rejected: readonly SourceUploadRejected[];
  totalFiles: number;
  acceptedFiles: number;
  rejectedFiles: number;
}
