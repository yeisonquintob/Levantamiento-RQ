import type { DocumentJsonValue, DocumentSectionKey } from "./documents.js";

export const AI_ANALYSIS_TYPES = ["REQUIREMENT_DOCUMENT"] as const;

export type AiAnalysisType = (typeof AI_ANALYSIS_TYPES)[number];

export const AI_DRAFT_GENERATION_PURPOSES = [
  "INITIAL_DRAFT",
  "AI_VERSION",
] as const;

export type AiDraftGenerationPurpose =
  (typeof AI_DRAFT_GENERATION_PURPOSES)[number];

export const AI_ANALYSIS_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUSES)[number];

export const AI_PROVIDER_CODES = [
  "DISABLED",
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "GROQ",
  "CEREBRAS",
  "OLLAMA",
  "FAKE",
] as const;

export type AiProviderCode = (typeof AI_PROVIDER_CODES)[number];

export const AI_PROVIDER_CONFIGURATION_TYPES = [
  "OPENAI",
  "ANTHROPIC",
  "GEMINI",
  "GROQ",
  "CEREBRAS",
  "OLLAMA",
  "OPENAI_COMPATIBLE",
  "COMFYUI",
  "OLLAMA_IMAGES",
] as const;

export type AiProviderConfigurationType =
  (typeof AI_PROVIDER_CONFIGURATION_TYPES)[number];

export const AI_PROVIDER_CONFIGURATION_PURPOSES = ["TEXT", "IMAGE"] as const;

export type AiProviderConfigurationPurpose =
  (typeof AI_PROVIDER_CONFIGURATION_PURPOSES)[number];

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
  purpose: AiProviderConfigurationPurpose;
  model: string;
  baseUrl: string;
  isEnabled: boolean;
  isDefault: boolean;
  timeoutMs: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxAttempts: number;
  credentialConfigured: boolean;
  requiresCredential: boolean;
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
  purpose: AiProviderConfigurationPurpose;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxAttempts?: number;
  apiKey?: string;
  isEnabled?: boolean;
  isDefault?: boolean;
}

export interface DuplicateAiProviderConfiguration {
  name: string;
  providerType: AiProviderConfigurationType;
  purpose: AiProviderConfigurationPurpose;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxAttempts?: number;
}

export interface OllamaInstalledModel {
  name: string;
  size: number | null;
  parameterSize: string | null;
  quantizationLevel: string | null;
  contextLength: number | null;
  capabilities: readonly string[];
}

export interface OllamaInstalledModelsResponse {
  baseUrl: string;
  models: readonly OllamaInstalledModel[];
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

export interface AiVersionSectionInstruction {
  sectionKey: DocumentSectionKey;
  instruction: string;
}

export interface CreateAiAnalysisRequest {
  providerSelections?: AiProviderSelections;
  analysisType?: AiAnalysisType;
  documentId: string;
  documentVersionId: string;
  sourceIds: readonly string[];
  engines?: readonly AiEngine[];
  includePrototype?: boolean;
  purpose?: AiDraftGenerationPurpose;
  instruction?: string | null;
  sectionInstructions?: readonly AiVersionSectionInstruction[];
  idempotencyKey?: string;
}

export interface AiAnalysisRequestSourceDetail {
  id: string;
  analysisRequestId: string;
  sourceId: string;
  sourceUpdatedAt: string;
  sourceSha256: string | null;
  sourceTitle: string | null;
  sourceClassification: string | null;
  position: number;
  createdAt: string;
}

export const AI_ANALYSIS_RESULT_STATUSES = [
  "GENERATED",
  "ACCEPTED",
  "REJECTED",
] as const;

export type AiAnalysisResultStatus =
  (typeof AI_ANALYSIS_RESULT_STATUSES)[number];

export const AI_BACKLOG_CODE_PATTERNS = {
  EPIC: "^EP-[A-Z0-9-]+$",
  FEATURE: "^FE-[A-Z0-9-]+$",
  USER_STORY: "^HU-[A-Z0-9-]+$",
  ACCEPTANCE_CRITERION: "^CA-[A-Z0-9-]+$",
  TASK: "^T-[A-Z0-9-]+$",
} as const;

/**
 * PUNTO_6_7_INDEPENDENT_CODES
 *
 * Los códigos funcionales (Punto 6) y de planificación (Punto 7) viven en
 * espacios distintos. Los patrones legacy HU-/CA- se conservan arriba para
 * poder leer resultados 4.0.0 históricos.
 */
export const AI_FUNCTIONAL_CODE_PATTERNS = {
  USER_STORY: "^HU-F-[A-Z0-9-]+$",
  ACCEPTANCE_CRITERION: "^CA-F-[A-Z0-9-]+$",
} as const;

export const AI_PLANNING_CODE_PATTERNS = {
  USER_STORY: "^HU-P-[A-Z0-9-]+$",
} as const;

export interface AiAnalysisDraftSection {
  key: DocumentSectionKey;
  title: string;
  content: DocumentJsonValue;
}

export interface AiAnalysisDraftRequirement {
  clientId: string;
  sectionKey: DocumentSectionKey;
  code: string;
  title: string;
  description: string;
  requirementType: string;
  acceptanceCriteria: readonly string[];
  sourceIds: readonly string[];
  milestone?: string | null;
  functionality?: string | null;
  category?: string | null;
  measure?: string | null;
  target?: string | null;
}

export interface AiAnalysisDraftV1 {
  schemaVersion: "1.0.0";
  sections: readonly AiAnalysisDraftSection[];
  requirements: readonly AiAnalysisDraftRequirement[];
  pendingQuestions: readonly string[];
  contradictions: readonly string[];
  warnings: readonly string[];
}

export const AI_PROCESS_NODE_KINDS = [
  "START",
  "ACTOR",
  "PROCESS",
  "DECISION",
  "SYSTEM",
  "END",
] as const;

export type AiProcessNodeKind = (typeof AI_PROCESS_NODE_KINDS)[number];

export interface AiProcessNode {
  id: string;
  kind: AiProcessNodeKind;
  label: string;
  laneId?: string | null;
}

export interface AiProcessEdge {
  from: string;
  to: string;
  label: string | null;
}

export interface AiProcessFlow {
  title: string;
  nodes: readonly AiProcessNode[];
  edges: readonly AiProcessEdge[];
  sourceIds: readonly string[];
}

export const AI_PROCESS_LANE_KINDS = ["ACTOR", "SYSTEM"] as const;

export type AiProcessLaneKind = (typeof AI_PROCESS_LANE_KINDS)[number];

export interface AiProcessLane {
  id: string;
  name: string;
  kind: AiProcessLaneKind;
}

export interface AiSwimlaneProcessFlow extends AiProcessFlow {
  objective: string | null;
  lanes: readonly AiProcessLane[];
  problems: readonly string[];
  improvements: readonly string[];
  expectedResults: readonly string[];
}

export const AI_ENTITY_CARDINALITIES = ["1:1", "1:N", "N:1", "N:M"] as const;

export type AiEntityCardinality = (typeof AI_ENTITY_CARDINALITIES)[number];

export interface AiEntityAttribute {
  name: string;
  dataType: string;
  primaryKey: boolean;
  foreignKey: boolean;
  required: boolean;
}

export interface AiEntityDefinition {
  id: string;
  name: string;
  description: string;
  attributes: readonly AiEntityAttribute[];
}

export interface AiEntityRelationshipDefinition {
  from: string;
  to: string;
  cardinality: AiEntityCardinality;
  label: string;
}

export interface AiEntityRelationshipModel {
  title: string;
  entities: readonly AiEntityDefinition[];
  relationships: readonly AiEntityRelationshipDefinition[];
  sourceIds: readonly string[];
}

export interface AiFeature {
  code: string;
  title: string;
  objective: string;
  description: string;
  inScope: readonly string[];
  outOfScope: readonly string[];
  userStoryCodes: readonly string[];
  sourceIds: readonly string[];
}

export interface AiAcceptanceCriterion {
  code: string;
  given: string;
  when: string;
  then: string;
  sourceIds: readonly string[];
}

export interface AiRequiredField {
  name: string;
  dataType: string;
  required: boolean;
  validation: string;
  sourceIds: readonly string[];
}

export interface AiUserStory {
  code: string;
  featureCode: string;
  title: string;
  role: string;
  want: string;
  benefit: string;
  context: string;
  premises: readonly string[];
  impactedSystems: readonly string[];
  fields: readonly AiRequiredField[];
  acceptanceCriteria: readonly AiAcceptanceCriterion[];
  sourceIds: readonly string[];
}

export interface AiTestScenario {
  code: string;
  title: string;
  userStoryCodes: readonly string[];
  acceptanceCriterionCodes: readonly string[];
  precondition: string;
  action: string;
  expectedResult: string;
  sourceIds: readonly string[];
  taskCodes?: readonly string[];
}

export const AI_BACKLOG_TASK_ORIGINS = [
  "EVIDENCE",
  "IMPLEMENTATION_PROPOSAL",
] as const;

export type AiBacklogTaskOrigin = (typeof AI_BACKLOG_TASK_ORIGINS)[number];

export interface AiBacklogTask {
  code: string;
  title: string;
  description: string;
  type: AiScrumTaskType;
  origin: AiBacklogTaskOrigin;
  dependencyCodes: readonly string[];
  sourceIds: readonly string[];
}

export interface AiBacklogUserStory extends AiUserStory {
  description: string;
  tasks: readonly AiBacklogTask[];
}

export interface AiBacklogFeature {
  code: string;
  title: string;
  description: string;
  sourceIds: readonly string[];
  userStories: readonly AiBacklogUserStory[];
}

export interface AiBacklogEpic {
  code: string;
  title: string;
  description: string;
  sourceIds: readonly string[];
  features: readonly AiBacklogFeature[];
}

export interface AiBacklogStructure {
  epics: readonly AiBacklogEpic[];
}

/**
 * Modelo independiente usado desde AiAnalysisDraft 4.1.0.
 * Punto 6 contiene HU funcionales completas; Punto 7 contiene HU de
 * planificación y solo se conectan mediante functionalRequirementCodes.
 */
export type AiFunctionalUserStoryAssignmentStatus =
  "ASSIGNED" | "PENDING_ASSIGNMENT";

export type AiFunctionalUserStoryDocumentationStatus =
  "COMPLETE" | "PENDING_DOCUMENTATION";

/**
 * HUF_PENDING_ASSIGNMENT_V7_1_1
 *
 * Una HU-F puede estar completamente documentada y seguir pendiente de
 * ubicación estructural. PENDING_ASSIGNMENT no significa HU incompleta.
 */
export interface AiFunctionalUserStoryV41 {
  code: string;
  title: string;
  description: string;
  assignmentStatus?: AiFunctionalUserStoryAssignmentStatus;
  documentationStatus?: AiFunctionalUserStoryDocumentationStatus;
  documentationObservation?: string | null;
  milestone: string | null;
  functionality: string | null;
  milestoneDescription: string | null;
  assignmentObservation?: string | null;
  role: string;
  want: string;
  benefit: string;
  context: string;
  premises: readonly string[];
  impactedSystems: readonly string[];
  fields: readonly AiRequiredField[];
  acceptanceCriteria: readonly AiAcceptanceCriterion[];
  /**
   * Cobertura funcional interna de la generación V4.1.
   * Cada código FN-### identifica una necesidad funcional atómica detectada
   * por el preanálisis local. Es opcional para conservar compatibilidad con
   * resultados V4.1 persistidos antes de esta mejora.
   */
  functionalNeedCodes?: readonly string[];
  sourceIds: readonly string[];
}

export interface FunctionalStoryDescriptionInput {
  readonly description?: string | null;
  readonly title?: string | null;
  readonly want?: string | null;
}

/**
 * Mantiene la descripción funcional breve y separada de la narrativa
 * COMO/QUIERO/PARA. También corrige resultados históricos en los que el
 * proveedor copió la historia completa dentro de `description`.
 */
export function conciseFunctionalStoryDescription(
  input: FunctionalStoryDescriptionInput,
  maximumLength = 220,
): string {
  const normalize = (value: string | null | undefined): string =>
    value?.replace(/\s+/gu, " ").trim() ?? "";
  const original = normalize(input.description);
  const repeatsNarrative =
    /^como\b/iu.test(original) && /\bquiero\b/iu.test(original);
  const preferred = repeatsNarrative ? normalize(input.want) : original;
  let result =
    preferred && preferred !== "[PENDIENTE POR DEFINIR]"
      ? preferred
      : normalize(input.want) || normalize(input.title);

  result = result
    .replace(/^(?:descripci[oó]n funcional\s*:\s*)/iu, "")
    .replace(/^quiero\s+/iu, "")
    .trim();

  if (!result) return "[PENDIENTE POR DEFINIR]";
  if (result === "[PENDIENTE POR DEFINIR]") return result;

  if (result.length > maximumLength) {
    const candidate = result.slice(0, maximumLength + 1);
    const boundary = candidate.lastIndexOf(" ");
    result = `${candidate.slice(0, boundary > maximumLength * 0.65 ? boundary : maximumLength).trim()}…`;
  }

  result = result.charAt(0).toLocaleUpperCase("es") + result.slice(1);
  return /[.!?…]$/u.test(result) ? result : `${result}.`;
}

export interface AiPlanningBacklogTaskV41 extends AiBacklogTask {
  /** Numeración humana de la fuente; no es un identificador técnico. */
  sourceNumber: string | null;
}

export interface AiPlanningBacklogUserStoryV41 {
  code: string;
  title: string;
  description: string;
  sourceNumber: string | null;
  functionalRequirementCodes: readonly string[];
  sourceIds: readonly string[];
  tasks: readonly AiPlanningBacklogTaskV41[];
}

export interface AiPlanningBacklogFeatureV41 {
  code: string;
  title: string;
  description: string;
  sourceNumber: string | null;
  sourceIds: readonly string[];
  userStories: readonly AiPlanningBacklogUserStoryV41[];
}

/**
 * POINT_5_PENDING_PLANNING_ASSIGNMENTS_V4_7_5
 *
 * Punto 7 conserva work items completos aunque todavía no exista una relación
 * padre inequívoca. La pertenencia a `pendingAssignments` es estructural; no
 * convierte una HU-P/Task en requisito funcional ni crea padres artificiales.
 */
export interface AiPlanningPendingFeatureV41 {
  assignmentStatus: "PENDING_ASSIGNMENT";
  assignmentObservation: string;
  sourceParentPath: string | null;
  item: AiPlanningBacklogFeatureV41;
}

export interface AiPlanningPendingUserStoryV41 {
  assignmentStatus: "PENDING_ASSIGNMENT";
  assignmentObservation: string;
  sourceParentPath: string | null;
  item: AiPlanningBacklogUserStoryV41;
}

export interface AiPlanningPendingTaskV41 {
  assignmentStatus: "PENDING_ASSIGNMENT";
  assignmentObservation: string;
  sourceParentPath: string | null;
  item: AiPlanningBacklogTaskV41;
}

export interface AiPlanningPendingAssignmentsV41 {
  features: readonly AiPlanningPendingFeatureV41[];
  userStories: readonly AiPlanningPendingUserStoryV41[];
  tasks: readonly AiPlanningPendingTaskV41[];
}

export interface AiPlanningBacklogEpicV41 {
  code: string;
  title: string;
  description: string;
  sourceNumber: string | null;
  sourceIds: readonly string[];
  features: readonly AiPlanningBacklogFeatureV41[];
}

export type AiPlanningStructureStatus = "CONFIRMED" | "AI_SUGGESTED";

/**
 * AI_SUGGESTED_STRUCTURE_CONTRACT_V7_4_4
 *
 * `structureStatus` es opcional únicamente para leer borradores V4.1
 * históricos. Las nuevas generaciones lo devuelven siempre:
 * - CONFIRMED: existe una estructura Epic/Hito explícitamente solicitada.
 * - AI_SUGGESTED: no existe una Epic/Hito humana confirmada. Puede contener
 *   una propuesta de IA o únicamente work items explícitos huérfanos en
 *   pendingAssignments, sin fabricar su raíz.
 */
export interface AiPlanningBacklogStructureV41 {
  structureStatus?: AiPlanningStructureStatus;
  epics: readonly AiPlanningBacklogEpicV41[];
  /**
   * Opcional solo para compatibilidad de lectura con borradores V4.1 previos.
   * Las nuevas generaciones devuelven siempre las tres colecciones.
   */
  pendingAssignments?: AiPlanningPendingAssignmentsV41;
}

export const AI_SCRUM_TASK_TYPES = [
  "ANALYSIS",
  "DESIGN",
  "DEVELOPMENT",
  "CONFIGURATION",
  "INTEGRATION",
  "DATA",
  "TESTING",
  "UAT",
  "DOCUMENTATION",
  "DEPLOYMENT",
] as const;

export type AiScrumTaskType = (typeof AI_SCRUM_TASK_TYPES)[number];

export interface AiScrumTask {
  code: string;
  type: AiScrumTaskType;
  description: string;
  userStoryCode: string;
  suggestedRole: string;
  dependencyCodes: readonly string[];
  expectedResult: string;
  /** Estimación inicial expresada en días de trabajo, nunca en horas. */
  estimatedDurationDays?: number;
  /** Posición absoluta dentro del plan: Día 1, Día 2, etc. */
  startDay?: number;
  endDay?: number;
  /** Fechas materializadas por el sistema cuando existe una fecha confirmada. */
  startDate?: string | null;
  endDate?: string | null;
}

export interface AiScrumSprint {
  code: string;
  number: number;
  period: string;
  startDay: number;
  endDay: number;
  startDate: string | null;
  endDate: string | null;
  objective: string;
  featureCodes: readonly string[];
  userStoryCodes: readonly string[];
  tasks: readonly AiScrumTask[];
  dependencies: readonly string[];
  testCodes: readonly string[];
  deliverables: readonly string[];
  closingCriterion: string;
  risks: readonly string[];
}

export interface AiScrumPlan {
  cadenceDays: 15;
  scheduleBasis: "RELATIVE_DAY" | "CONFIRMED_DATE";
  confirmedStartDate: string | null;
  sourceIds: readonly string[];
  sprints: readonly AiScrumSprint[];
}

export interface AiStructuredContradiction {
  statementA: string;
  sourceIdsA: readonly string[];
  statementB: string;
  sourceIdsB: readonly string[];
  decision: "[PENDIENTE POR DEFINIR]";
}

export interface AiStructuredAnalysis {
  processFlow: AiProcessFlow;
  features: readonly AiFeature[];
  userStories: readonly AiUserStory[];
  tests: readonly AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
}

export interface AiAnalysisDraftV2 {
  schemaVersion: "2.0.0";
  sections: readonly AiAnalysisDraftSection[];
  requirements: readonly AiAnalysisDraftRequirement[];
  structuredAnalysis: AiStructuredAnalysis;
  pendingQuestions: readonly string[];
  contradictions: readonly AiStructuredContradiction[];
  warnings: readonly string[];
}

export interface AiStructuredAnalysisV3 {
  processFlows: {
    asIs: AiSwimlaneProcessFlow;
    toBe: AiSwimlaneProcessFlow;
  };
  entityRelationship: AiEntityRelationshipModel;
  features: readonly AiFeature[];
  userStories: readonly AiUserStory[];
  tests: readonly AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
}

export interface AiStructuredAnalysisV4 extends AiStructuredAnalysisV3 {
  backlogStructure: AiBacklogStructure;
}

export interface AiAnalysisDraftV4 {
  schemaVersion: "4.0.0";
  sections: readonly AiAnalysisDraftSection[];
  requirements: readonly AiAnalysisDraftRequirement[];
  structuredAnalysis: AiStructuredAnalysisV4;
  pendingQuestions: readonly string[];
  contradictions: readonly AiStructuredContradiction[];
  warnings: readonly string[];
}

export interface AiStructuredAnalysisV41 {
  processFlows: {
    asIs: AiSwimlaneProcessFlow;
    toBe: AiSwimlaneProcessFlow;
  };
  entityRelationship: AiEntityRelationshipModel;
  functionalUserStories: readonly AiFunctionalUserStoryV41[];
  backlogStructure: AiPlanningBacklogStructureV41;
  tests: readonly AiTestScenario[];
  scrumPlan: AiScrumPlan | null;
}

export interface AiAnalysisDraftV41 {
  schemaVersion: "4.1.0";
  sections: readonly AiAnalysisDraftSection[];
  /** Desde 4.1.0 esta colección transporta solamente RNF. */
  requirements: readonly AiAnalysisDraftRequirement[];
  structuredAnalysis: AiStructuredAnalysisV41;
  pendingQuestions: readonly string[];
  contradictions: readonly AiStructuredContradiction[];
  warnings: readonly string[];
}

export interface AiAnalysisDraftV3 {
  schemaVersion: "3.0.0";
  sections: readonly AiAnalysisDraftSection[];
  requirements: readonly AiAnalysisDraftRequirement[];
  structuredAnalysis: AiStructuredAnalysisV3;
  pendingQuestions: readonly string[];
  contradictions: readonly AiStructuredContradiction[];
  warnings: readonly string[];
}

/**
 * 1.0.0, 2.0.0, 3.0.0 y 4.0.0 se conservan para resultados históricos.
 * Las nuevas generaciones producen 4.1.0 con Punto 6 y Punto 7 desacoplados,
 * sin migraciones ni cambios de persistencia.
 */
export type AiAnalysisDraft =
  | AiAnalysisDraftV1
  | AiAnalysisDraftV2
  | AiAnalysisDraftV3
  | AiAnalysisDraftV4
  | AiAnalysisDraftV41;

/** Additive transport contract. The service validates it against the exact applied template. */
export interface AiAnalysisLocalOnlyV2Draft {
  readonly pipelineId: "LOCAL_ONLY_V2";
  readonly schemaVersion: "1.0.0";
  readonly templatePlanFingerprint: string;
  /** Internal evidence index, validated by the LOCAL_ONLY_V2 parser. */
  readonly knowledge: unknown;
  readonly sections: readonly {
    readonly blockId: string;
    readonly blockNumber: number;
    readonly blockTotal: number;
    readonly sectionOrder: number;
    readonly key: string;
    readonly title: string;
    readonly content: DocumentJsonValue;
    readonly sourceIds: readonly string[];
  }[];
  readonly coverage: {
    readonly requestedPointCount: number;
    readonly completedPointCount: number;
    readonly assembledPointCount: number;
    readonly missingPointCount: number;
    readonly coverageRatio: number;
  };
}

export interface AiAnalysisResultDetail {
  id: string;
  analysisRequestId: string;
  analysisExecutionId: string;
  status: AiAnalysisResultStatus;
  schemaVersion: string;
  draft: AiAnalysisDraft | AiAnalysisLocalOnlyV2Draft;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewAiAnalysisResult {
  expectedDocumentRevision?: number;
  comment?: string | null;
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
  providerSelections?: AiProviderSelections;
  engines?: readonly AiEngine[];
  models?: Partial<Record<AiEngine, string>>;
  provider?: AiProviderCode | null;
  model?: string | null;
  id: string;
  projectId: string;
  documentId: string;
  documentVersionId: string;
  analysisType: AiAnalysisType;
  purpose: AiDraftGenerationPurpose;
  status: AiAnalysisStatus;
  requestedByUserId: string;
  generatedVersionNumber: number;
  generatedVersion: string;
  sourceCount: number;
  executionCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
}

export const AI_ANALYSIS_PROCESSING_STAGES = [
  "QUEUED",
  "LOCAL_AI_ANALYSIS",
  "LOCAL_AI_CONSOLIDATION",
  "LOCAL_AI_GENERATION",
  "CLOUD_AI_GENERATION",
  "OUTPUT_VALIDATION",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type AiAnalysisProcessingStage =
  (typeof AI_ANALYSIS_PROCESSING_STAGES)[number];

// PASO_3_API_PROGRESO_BLOQUES_V1
export const AI_ANALYSIS_LOCAL_DRAFT_BLOCK_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type AiAnalysisLocalDraftBlockStatus =
  (typeof AI_ANALYSIS_LOCAL_DRAFT_BLOCK_STATUSES)[number];

export type AiAnalysisLocalDraftBlockOperation = "GENERATING" | "REPAIRING";

export interface AiAnalysisLocalDraftBlockProgress {
  updatedAt?: string;
  completedUnits?: number;
  totalUnits?: number;
  blockNumber: number;
  blockTotal: number;
  blockKey: string;
  blockLabel: string;
  status: AiAnalysisLocalDraftBlockStatus;
  currentStagePath?: string | null;
  operation?: AiAnalysisLocalDraftBlockOperation | null;
  repairAttempt?: number | null;
}

export interface AiAnalysisProcessingDetail {
  stage: AiAnalysisProcessingStage;
  label: string;
  progress: number;
  engines?: readonly AiEngine[];
  localCompletedSources: number;
  localTotalSources: number;
  localCacheAvailable: number;
  localSnapshotReady: boolean;
  localCompletedSourceIds?: readonly string[];
  localProcessingSourceIds?: readonly string[];
  currentLocalSourceId?: string | null;
  currentLocalSourceTitle?: string | null;
  currentLocalSourceStartedAt?: string | null;
  localCompletedSegments?: number | null;
  currentLocalSegment?: number | null;
  localTotalSegments?: number | null;
  localDraftBlocks?: readonly AiAnalysisLocalDraftBlockProgress[];
  currentLocalDraftBlock?: AiAnalysisLocalDraftBlockProgress | null;
}

export interface AiAnalysisRequestDetail extends AiAnalysisRequestSummary {
  sources: readonly AiAnalysisRequestSourceDetail[];
  executions: readonly AiAnalysisExecutionDetail[];
  result: AiAnalysisResultDetail | null;
  processing?: AiAnalysisProcessingDetail;
}

export interface AiAnalysisFailureDetail {
  code: string;
  message: string;
  stage: string;
  attempt: number | null;
  provider: AiProviderCode | null;
  model: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerRequestId: string | null;
}

export interface AiAnalysisPromptDetail {
  analysisRequestId: string;
  purpose: AiDraftGenerationPurpose;
  generatedVersion: string;
  status: AiAnalysisStatus;
  estimatedInputTokens: number;
  failure: AiAnalysisFailureDetail | null;
  prompt: string;
  createdAt: string;
}

export interface AiAnalysisTokenEstimateRequest {
  providerSelections?: AiProviderSelections;
  documentId: string;
  sourceIds: readonly string[];
  engines?: readonly AiEngine[];
  purpose?: AiDraftGenerationPurpose;
}

export interface AiAnalysisTokenEstimateResponse {
  sourceCount: number;
  promptCharacters: number;
  estimatedInputTokens: number;
  maxInputTokens: number;
  remainingTokens: number;
  usagePercentage: number;
  canProcess: boolean;
  model: string;
  estimateMethod: "CHARACTERS_DIVIDED_BY_4";
  originalTokens: number;
  localAnalysisTokens: number | null;
  consolidatedTokens: number | null;
  reductionPercentage: number | null;
  openAiInputTokens: number;
  openAiOutputTokens: number | null;
}

export interface AiAnalysisRequestListResponse {
  items: readonly AiAnalysisRequestSummary[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface RequirementDiscussionAnswerInput {
  questionId: string;
  question: string;
  answer: string;
  score: number;
}

export type AiEngine = "LOCAL" | "CLOUD";

/** Configured providers, never credentials or client-supplied endpoints. */
export type AiProviderSelections = Partial<Record<AiEngine, string>>;

export interface AiSelectableProvider {
  id: string;
  name: string;
  model: string;
  engine: AiEngine;
  available: boolean;
  isDefault: boolean;
  message: string;
  maxInputTokens: number;
}

export type RequirementDiscussionEngine = AiEngine;

export interface ProcessRequirementDiscussionRequest {
  providerConfigurationId?: string;
  answers: readonly RequirementDiscussionAnswerInput[];
  conversation: string;
  engine: RequirementDiscussionEngine;
}

export interface RequirementDiscussionProcessedAnswer {
  questionId: string;
  answer: string;
}

export interface ProcessRequirementDiscussionResponse {
  engine: RequirementDiscussionEngine;
  provider: "LOCAL" | "CLOUD" | "FAKE";
  model: string;
  answers: readonly RequirementDiscussionProcessedAnswer[];
}

export interface RequirementDiscussionEngineCapability {
  enabled: boolean;
  model: string | null;
  message: string;
  simulated: boolean;
}

export interface RequirementDiscussionCapabilitiesResponse {
  providers?: readonly AiSelectableProvider[];
  local: RequirementDiscussionEngineCapability;
  cloud: RequirementDiscussionEngineCapability;
}
