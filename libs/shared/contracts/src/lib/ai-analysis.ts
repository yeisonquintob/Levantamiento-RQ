export const AI_ANALYSIS_TYPES = ["REQUIREMENT_DOCUMENT"] as const;

export type AiAnalysisType = (typeof AI_ANALYSIS_TYPES)[number];

export const AI_ANALYSIS_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUSES)[number];

export const AI_PROVIDER_CODES = ["DISABLED"] as const;

export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];

export const AI_ANALYSIS_PROJECT_ACTIONS = [
  "READ",
  "CREATE",
  "CANCEL",
] as const;

export type AiAnalysisProjectAction =
  (typeof AI_ANALYSIS_PROJECT_ACTIONS)[number];

export interface CreateAiAnalysisRequest {
  analysisType?: AiAnalysisType;
  documentId: string;
  documentVersionId: string;
  sourceIds: readonly string[];
}

export interface AiAnalysisRequestSourceDetail {
  id: string;
  analysisRequestId: string;
  sourceId: string;
  sourceUpdatedAt: string;
  sourceSha256: string | null;
  position: number;
  createdAt: string;
}

export interface AiAnalysisExecutionDetail {
  id: string;
  analysisRequestId: string;
  attempt: number;
  status: AiAnalysisStatus;
  provider: AiProviderCode;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCost: string | null;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AiAnalysisRequestDetail {
  id: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  analysisType: AiAnalysisType;
  status: AiAnalysisStatus;
  requestedByUserId: string;
  sources: readonly AiAnalysisRequestSourceDetail[];
  executions: readonly AiAnalysisExecutionDetail[];
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}
