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

export const AI_PROVIDER_CODES = ["DISABLED", "OPENAI", "FAKE"] as const;

export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];

export const AI_PROVIDER_CONFIGURATION_TYPES = ["OPENAI"] as const;

export type AiProviderConfigurationType =
  (typeof AI_PROVIDER_CONFIGURATION_TYPES)[number];

export const AI_PROVIDER_TEST_STATUSES = [
  "NOT_TESTED",
  "SUCCEEDED",
  "FAILED",
] as const;

export type AiProviderTestStatus = (typeof AI_PROVIDER_TEST_STATUSES)[number];

export interface AiProviderConfigurationSummary {
  id: string;
  name: string;
  providerType: AiProviderConfigurationType;
  model: string;
  baseUrl: string;
  isEnabled: boolean;
  isDefault: boolean;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxAttempts: number;
  credentialConfigured: boolean;
  lastConnectionTestAt: string | null;
  lastConnectionTestStatus: AiProviderTestStatus;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiProviderConfigurationListResponse {
  items: readonly AiProviderConfigurationSummary[];
  totalItems: number;
  enabled: number;
  credentialConfigured: number;
}

export interface CreateAiProviderConfiguration {
  name: string;
  providerType: AiProviderConfigurationType;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxAttempts?: number;
  apiKey: string;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface UpdateAiProviderConfiguration {
  name?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxAttempts?: number;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface RotateAiProviderCredential {
  apiKey: string;
}

export interface AiProviderConnectionTestResult {
  providerConfiguration: AiProviderConfigurationSummary;
  succeeded: boolean;
  testedAt: string;
  message: string;
}

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

export interface AiAnalysisRequestSummary {
  id: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  analysisType: AiAnalysisType;
  status: AiAnalysisStatus;
  requestedByUserId: string;
  sourceCount: number;
  executionCount: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export interface AiAnalysisRequestDetail extends AiAnalysisRequestSummary {
  sources: readonly AiAnalysisRequestSourceDetail[];
  executions: readonly AiAnalysisExecutionDetail[];
}

export interface AiAnalysisRequestListResponse {
  items: readonly AiAnalysisRequestSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}
