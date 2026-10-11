import { checkpointProgress } from "./local-draft-checkpoint-progress";
import { LocalOnlyV2PersistentStore } from "./local-only-v2-checkpoint-store";
import { runLocalOnlyV2DocumentRuntime } from "./local-only-v2-runtime-adapter";
import {
  isLocalOnlyV2DocumentResult,
  parseLocalOnlyV2PersistedDocumentResult,
} from "./local-only-v2-document-result";
import {
  buildPrototypeRequestBrief,
  isPrototypeRequested,
  PROTOTYPE_NOT_REQUESTED,
} from "./prototype-request-brief";
import { sanitizeVisualFormatContent } from "./visual-format-content";
import { normalizeLocalOnlyV2Sections } from "./local-only-v2-backlog-alignment";
import { resolveLocalOnlyV2Pipeline } from "./local-only-v2-pipeline";
import { randomUUID } from "node:crypto";
import { readProviderSnapshots } from "../providers/provider-selection";

import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, EntityManager, Repository } from "typeorm";

import type {
  AiAnalysisDraft,
  AiProviderCode,
  DocumentJsonValue,
  DocumentSectionKey,
  RequirementDocumentDetail,
} from "@levantamiento-rq/shared-contracts";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import { AnalysisExecutionEntity } from "../analysis/analysis-execution.entity";
import { AnalysisPromptVersionEntity } from "../analysis/analysis-prompt-version.entity";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";
import { isSourcesGenerationRequest } from "../analysis/analysis-request-origin";
import { AnalysisResultEntity } from "../analysis/analysis-result.entity";
import { LocalDraftBlockCheckpointEntity } from "../analysis/local-draft-block-checkpoint.entity";
import { AiAnalysisDocumentsAccessClient } from "../analysis/documents-access.client";
import { AiAnalysisServiceToken } from "../analysis/ai-analysis-service-token.service";
import {
  AI_PROVIDER_RUNTIME_CONFIG,
  type AiProviderRuntimeConfig,
} from "../providers/ai-provider.config";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import {
  buildAiAnalysisOutputSchemaV41,
  collectAiDraftSourceIds,
  parseAiAnalysisDraft,
  reconcileAiDraftSourceIds,
} from "./ai-analysis-draft";
// PASO_1_ORCHESTRATION_GENERATION_MODE_V1
import {
  assertAiDocumentGenerationBoundary,
  resolveAiDocumentGenerationMode,
} from "./ai-document-generation-mode";
import {
  appendAiValidationRetryGuidance,
  buildAiAnalysisPrompt,
  estimateAiPromptTokens,
  reconcileAlignedFunctionalDocumentation,
  reconcileExplicitPlanningFunctionalStoriesV479,
  reconcileExplicitPlanningStructure,
  validateExplicitPlanningCoverage,
  validateExplicitPlanningFunctionalAlignment,
} from "./ai-prompt-builder";
import { AiProviderError } from "./ai-text-provider";
import { calculateOpenAiTokenCost } from "./ai-cost-pricing";
import { summarizeDraftShape } from "./ai-draft-shape";
import { writeAiProviderTrace } from "./ai-provider-trace";
import { FakeAiProvider } from "./fake-ai.provider";
import { OllamaDraftProvider } from "./ollama-draft.provider";
import {
  buildLocalDraftLogicalBlocks,
  localDraftBlockPrerequisiteStagePaths,
  LocalDraftBlockProgressStore,
  resolveLocalDraftLogicalBlock,
  type LocalDraftBlockCheckpointEvent,
  type LocalDraftBlockProgress,
  type LocalDraftLogicalBlock,
} from "./local-draft-block-map";
import { localDraftStages } from "./local-draft-stages";
import { createCloudTextProvider } from "./cloud-text-provider";
import {
  appendLocalOnlyV2RuntimeEvidence,
  createLocalOnlyV2BoundedDocumentClient,
  prepareLocalOnlyV2RuntimeBridge,
  type LocalOnlyV2RuntimeBridge,
} from "./local-only-v2-runtime-adapter";
import {
  LOCAL_AI_CONFIG,
  loadLocalAiConfig,
  type LocalAiConfig,
} from "../local-ai/ollama.config";
import { LocalAiError } from "../local-ai/ollama.client";
import {
  buildHybridCloudPromptFromKnowledgeSnapshot,
  buildLocalDocumentPromptFromKnowledgeSnapshot,
  buildFunctionalCoverageManifest,
  LocalAiPipelineService,
  reconcileFunctionalCoveragePendingNeeds,
  reconcileFunctionalCoverageSourceIds,
  validateFunctionalCoverage,
} from "../local-ai/local-ai-pipeline.service";
import type { ProjectKnowledgeSnapshot } from "../local-ai/local-ai-output";
import { LocalAiAuditEntity } from "../local-ai/local-ai-audit.entity";
import { LocalAiSettingsService } from "../local-ai/local-ai-settings.service";
import { AiUsageGuardService } from "../security/ai-usage-guard.service";
import { AiSecurityAuditEntity } from "../security/ai-security-audit.entity";

function errorDetails(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof AiProviderError) {
    return {
      code: error.code,
      message: error.message.slice(0, 2000),
      retryable: error.retryable,
    };
  }
  if (error instanceof LocalAiError) {
    return {
      code: error.code,
      message: error.message.slice(0, 2000),
      retryable: error.retryable,
    };
  }
  if (error instanceof ConflictException) {
    return {
      code: "AI_CONFIGURATION_REQUIRED",
      message: error.message.slice(0, 2000),
      retryable: false,
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    const responseMessage =
      typeof response === "string"
        ? response
        : response && typeof response === "object" && "message" in response
          ? Array.isArray(response.message)
            ? response.message.join(" ")
            : String(response.message)
          : response && typeof response === "object" && "detail" in response
            ? String(response.detail)
            : error.message;
    return {
      code:
        status >= 500 ? "AI_AUTO_APPLY_UNAVAILABLE" : "AI_AUTO_APPLY_CONFLICT",
      message: responseMessage.slice(0, 2000),
      retryable: status >= 500,
    };
  }
  return {
    code: "AI_EXECUTION_FAILED",
    message:
      error instanceof Error
        ? error.message.slice(0, 2000)
        : "La ejecución de IA falló.",
    retryable: false,
  };
}

function documentJson(value: unknown): DocumentJsonValue {
  return JSON.parse(JSON.stringify(value)) as DocumentJsonValue;
}

export function resolveAppliedRequirementSectionKey(
  sectionKey: DocumentSectionKey,
  availableSectionKeys: ReadonlySet<DocumentSectionKey>,
): DocumentSectionKey {
  if (availableSectionKeys.has(sectionKey)) return sectionKey;

  // El contrato 4.1 distingue los RNF semánticamente, pero las plantillas
  // actuales los presentan dentro de `milestones`. La evidencia debe apuntar
  // a la sección física de la versión documental que se está aplicando.
  if (
    sectionKey === "nonFunctionalRequirements" &&
    availableSectionKeys.has("milestones")
  ) {
    return "milestones";
  }

  throw new Error(
    `La sección de trazabilidad ${sectionKey} no existe en la versión documental.`,
  );
}

export function generatedSectionContent(
  draft: AiAnalysisDraft,
  key: DocumentSectionKey,
  fallback: DocumentJsonValue,
  includePrototype = false,
): DocumentJsonValue {
  if (draft.schemaVersion === "1.0.0") return fallback;
  switch (key) {
    case "processFlow":
      return documentJson(
        draft.schemaVersion === "2.0.0"
          ? draft.structuredAnalysis.processFlow
          : {
              processFlows: draft.structuredAnalysis.processFlows,
              entityRelationship: draft.structuredAnalysis.entityRelationship,
            },
      );
    case "milestones":
      if (draft.schemaVersion === "4.1.0") {
        const milestoneContent = draft.sections.find(
          (section) => section.key === "milestones",
        )?.content;

        const pendingFunctionalNeeds =
          milestoneContent &&
          typeof milestoneContent === "object" &&
          !Array.isArray(milestoneContent)
            ? ((milestoneContent as Record<string, DocumentJsonValue>)
                .pendingFunctionalNeeds ?? [])
            : [];

        return documentJson({
          functionalRequirements:
            draft.structuredAnalysis.functionalUserStories,
          nonFunctionalRequirements: draft.requirements,
          pendingFunctionalNeeds,
        });
      }
      if (draft.schemaVersion === "4.0.0") {
        /*
         * PUNTO_6_COMPLETE_USER_STORIES
         *
         * Los funcionales se proyectan desde la fuente canónica:
         * Epic -> Feature -> HU.
         *
         * Los RNF continúan viniendo de requirements y permanecen
         * separados en la segunda pestaña.
         */
        /*
         * PUNTO_6_HITO_METADATA
         *
         * requirements transporta únicamente la clasificación
         * funcional del Hito.
         *
         * backlogStructure conserva la HU completa y la
         * estructura Epic -> Feature -> HU -> Task.
         *
         * HITO y FEATURE son conceptos independientes.
         */
        const milestoneMetadata = new Map(
          draft.requirements
            .filter((item) => item.sectionKey === "milestones")
            .map((item) => [item.code.trim().toUpperCase(), item] as const),
        );

        const functionalRequirements =
          draft.structuredAnalysis.backlogStructure.epics.flatMap((epic) =>
            epic.features.flatMap((feature) =>
              feature.userStories.map((story) => {
                const metadata = milestoneMetadata.get(
                  story.code.trim().toUpperCase(),
                );

                return {
                  /*
                   * Metadatos internos del Punto 7.
                   * Se conservan para sincronización,
                   * pero no se muestran como Hito.
                   */
                  epicCode: epic.code,
                  epicTitle: epic.title,
                  featureCode: feature.code,
                  featureTitle: feature.title,

                  /*
                   * HU completa del Punto 6.
                   */
                  code: story.code,
                  title: story.title,
                  description: story.description,
                  requirementType: "USER_STORY",

                  role: story.role,
                  want: story.want,
                  benefit: story.benefit,
                  context: story.context,

                  premises: story.premises,
                  impactedSystems: story.impactedSystems,
                  fields: story.fields,
                  acceptanceCriteria: story.acceptanceCriteria,
                  sourceIds: story.sourceIds,

                  /*
                   * Hito real.
                   *
                   * En el contrato de salida:
                   * milestone = código H-###
                   * functionality = nombre del Hito
                   * description del requirement =
                   * descripción del Hito.
                   */
                  milestone: metadata?.milestone ?? null,

                  functionality: metadata?.functionality ?? null,

                  milestoneDescription: metadata?.description ?? null,
                };
              }),
            ),
          );

        return documentJson({
          functionalRequirements:
            functionalRequirements.length > 0
              ? functionalRequirements
              : draft.requirements.filter(
                  (item) => item.sectionKey === "milestones",
                ),

          nonFunctionalRequirements: draft.requirements.filter(
            (item) => item.sectionKey === "nonFunctionalRequirements",
          ),
        });
      }
      return documentJson({
        features: draft.structuredAnalysis.features,
        userStories: draft.structuredAnalysis.userStories,
      });
    case "backlogStructure":
      return draft.schemaVersion === "4.0.0" || draft.schemaVersion === "4.1.0"
        ? documentJson(draft.structuredAnalysis.backlogStructure)
        : fallback;
    case "tests":
      return documentJson({ scenarios: draft.structuredAnalysis.tests });
    case "visualFormat": {
      if (!includePrototype) return PROTOTYPE_NOT_REQUESTED;
      // Punto 13: información para solicitar el prototipo, igual en IA local,
      // híbrida y nube (ver prototype-request-brief.ts).
      const sectionContent = (sectionKey: string) =>
        draft.sections.find((section) => section.key === sectionKey)?.content;
      const proposal = sectionContent("solutionProposal");
      const prototypeMarkdown =
        proposal && typeof proposal === "object" && !Array.isArray(proposal)
          ? (proposal as Record<string, DocumentJsonValue>).prototypeMarkdown
          : null;
      if (
        typeof prototypeMarkdown === "string" &&
        prototypeMarkdown.trim().length > 0
      ) {
        return prototypeMarkdown;
      }
      const brief = buildPrototypeRequestBrief({
        header: sectionContent("header"),
        objectives: sectionContent("objectives"),
        scope: sectionContent("scope"),
        milestones: generatedSectionContent(
          draft,
          "milestones" as DocumentSectionKey,
          null,
        ),
      });
      return brief ?? sanitizeVisualFormatContent(fallback);
    }
    case "automationInstruction": {
      const scope = draft.sections.find((section) => section.key === "scope")
        ?.content;
      const scopeRecord =
        scope && typeof scope === "object" && !Array.isArray(scope)
          ? (scope as Record<string, DocumentJsonValue>)
          : null;
      return documentJson({
        kpis: scopeRecord?.kpis ?? [],
        dataSource: "AZURE_DEVOPS_EXECUTION",
        currentValues: [0, 0, 0],
      });
    }
    case "scrumPlan":
      return documentJson(draft.structuredAnalysis.scrumPlan ?? fallback);
    case "assumptionsDependenciesPending":
      return documentJson({
        ...(fallback && typeof fallback === "object" && !Array.isArray(fallback)
          ? fallback
          : { narrative: fallback }),
        pendingQuestions: draft.pendingQuestions,
        contradictions: draft.contradictions,
        warnings: draft.warnings,
      });
    default:
      return fallback;
  }
}

@Injectable()
export class AiAnalysisExecutionService {
  // PASO_2_BACKEND_BLOQUE_ACTUAL_V1
  private readonly localDraftBlockProgress = new LocalDraftBlockProgressStore();

  // PASO_5_CHECKPOINTS_PERSISTENTES_V1
  async getLocalDraftBlockProgress(
    analysisRequestId: string,
  ): Promise<readonly LocalDraftBlockProgress[]> {
    const inMemory = this.localDraftBlockProgress.get(analysisRequestId);
    if (inMemory.length > 0 || !this.localDraftBlockCheckpoints) {
      return inMemory;
    }

    const persisted = await this.localDraftBlockCheckpoints.find({
      where: { analysisRequestId },
      order: { blockNumber: "ASC" },
    });

    return checkpointProgress(persisted);
  }

  private async initializeLocalDraftBlockCheckpoints(
    analysisRequestId: string,
    blocks: readonly LocalDraftLogicalBlock[],
  ): Promise<void> {
    if (!this.localDraftBlockCheckpoints) return;

    const existing = await this.localDraftBlockCheckpoints.find({
      where: { analysisRequestId },
    });
    const existingKeys = new Set(existing.map((item) => item.blockKey));
    const now = new Date();

    const missing = blocks
      .filter((block) => !existingKeys.has(block.blockKey))
      .map((block) =>
        this.localDraftBlockCheckpoints!.create({
          id: randomUUID(),
          analysisRequestId,
          blockKey: block.blockKey,
          blockNumber: block.blockNumber,
          blockTotal: block.blockTotal,
          blockLabel: block.blockLabel,
          status: "PENDING",
          schemaVersion: "4.1.0",
          stageValuesJson: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );

    if (missing.length > 0) {
      await this.localDraftBlockCheckpoints.save(missing);
    }
  }

  // PASO_6_REANUDAR_REINTENTAR_BLOQUE_V1
  private async prepareLocalDraftBlockResume(
    analysisRequestId: string,
    blocks: readonly LocalDraftLogicalBlock[],
    stagePaths: readonly string[],
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!this.localDraftBlockCheckpoints) return {};

    const checkpoints = await this.localDraftBlockCheckpoints.find({
      where: { analysisRequestId },
      order: { blockNumber: "ASC" },
    });
    const resumedValues: Record<string, unknown> = {};
    const reset: LocalDraftBlockCheckpointEntity[] = [];
    const now = new Date();

    for (const checkpoint of checkpoints) {
      const block = blocks.find(
        (item) => item.blockKey === checkpoint.blockKey,
      );
      if (!block) continue;

      const expectedPaths = [
        ...new Set([
          ...localDraftBlockPrerequisiteStagePaths(block.blockKey).filter(
            (stagePath) => stagePaths.includes(stagePath),
          ),
          ...stagePaths.filter(
            (stagePath) =>
              resolveLocalDraftLogicalBlock(stagePath, blocks)?.blockKey ===
              block.blockKey,
          ),
        ]),
      ];

      let parsedValues: Record<string, unknown> | null = null;
      if (
        checkpoint.status === "COMPLETED" &&
        checkpoint.schemaVersion === "4.1.0" &&
        checkpoint.stageValuesJson
      ) {
        try {
          const parsed = JSON.parse(checkpoint.stageValuesJson) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            parsedValues = parsed as Record<string, unknown>;
          }
        } catch {
          parsedValues = null;
        }
      }

      const completeCheckpoint =
        parsedValues !== null &&
        ((expectedPaths.length === 0 &&
          block.presentationSource !== "AI_STAGE" &&
          block.presentationSource !== "UNMAPPED") ||
          (expectedPaths.length > 0 &&
            expectedPaths.every((stagePath) =>
              Object.hasOwn(parsedValues!, stagePath),
            )));

      if (completeCheckpoint) {
        for (const stagePath of expectedPaths) {
          resumedValues[stagePath] = parsedValues![stagePath];
        }
        this.localDraftBlockProgress.update(analysisRequestId, {
          blockNumber: block.blockNumber,
          blockTotal: block.blockTotal,
          blockKey: block.blockKey,
          blockLabel: block.blockLabel,
          status: "COMPLETED",
        });
        continue;
      }

      if (
        checkpoint.status !== "PENDING" ||
        checkpoint.stageValuesJson !== null ||
        checkpoint.completedAt !== null
      ) {
        checkpoint.blockNumber = block.blockNumber;
        checkpoint.blockTotal = block.blockTotal;
        checkpoint.blockLabel = block.blockLabel;
        checkpoint.status = "PENDING";
        checkpoint.stageValuesJson = null;
        checkpoint.completedAt = null;
        checkpoint.updatedAt = now;
        reset.push(checkpoint);
      }
    }

    if (reset.length > 0) {
      await this.localDraftBlockCheckpoints.save(reset);
    }

    return resumedValues;
  }

  private async persistLocalDraftBlockCheckpoint(
    analysisRequestId: string,
    progress: LocalDraftBlockCheckpointEvent,
  ): Promise<void> {
    if (!this.localDraftBlockCheckpoints) return;

    const now = new Date();
    let checkpoint = await this.localDraftBlockCheckpoints.findOneBy({
      analysisRequestId,
      blockKey: progress.blockKey,
    });

    if (!checkpoint) {
      checkpoint = this.localDraftBlockCheckpoints.create({
        id: randomUUID(),
        analysisRequestId,
        blockKey: progress.blockKey,
        blockNumber: progress.blockNumber,
        blockTotal: progress.blockTotal,
        blockLabel: progress.blockLabel,
        status: "PENDING",
        schemaVersion: "4.1.0",
        stageValuesJson: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    checkpoint.blockNumber = progress.blockNumber;
    checkpoint.blockTotal = progress.blockTotal;
    checkpoint.blockLabel = progress.blockLabel;
    checkpoint.status = progress.status;
    checkpoint.updatedAt = now;

    if (progress.status === "COMPLETED") {
      checkpoint.stageValuesJson = JSON.stringify(progress.stageValues ?? {});
      checkpoint.completedAt = now;
    } else {
      checkpoint.completedAt = null;
    }

    await this.localDraftBlockCheckpoints.save(checkpoint);
  }

  constructor(
    @InjectRepository(AnalysisRequestEntity)
    private readonly requests: Repository<AnalysisRequestEntity>,
    @InjectRepository(AnalysisRequestSourceEntity)
    private readonly sources: Repository<AnalysisRequestSourceEntity>,
    @InjectRepository(AnalysisExecutionEntity)
    private readonly executions: Repository<AnalysisExecutionEntity>,
    @InjectRepository(AnalysisPromptVersionEntity)
    private readonly prompts: Repository<AnalysisPromptVersionEntity>,
    @InjectRepository(AnalysisResultEntity)
    private readonly results: Repository<AnalysisResultEntity>,
    private readonly dataSource: DataSource,
    private readonly providerConfigurations: AiProviderConfigurationsService,
    private readonly documentsAccess: AiAnalysisDocumentsAccessClient,
    private readonly serviceToken: AiAnalysisServiceToken,
    @Inject(AI_PROVIDER_RUNTIME_CONFIG)
    private readonly runtime: AiProviderRuntimeConfig,
    private readonly events: IntegrationEventsPublisher,
    @Optional()
    @Inject(LOCAL_AI_CONFIG)
    private readonly localAiConfig: LocalAiConfig = loadLocalAiConfig(),
    @Optional()
    @Inject(LocalAiPipelineService)
    private readonly localAi: LocalAiPipelineService | null = null,
    @Optional()
    @Inject(LocalAiSettingsService)
    private readonly localAiSettings: LocalAiSettingsService | null = null,
    @Optional() private readonly usageGuard: AiUsageGuardService | null = null,
    @Optional()
    @InjectRepository(AiSecurityAuditEntity)
    private readonly securityAudits: Repository<AiSecurityAuditEntity> | null = null,
    @Optional()
    @InjectRepository(LocalDraftBlockCheckpointEntity)
    private readonly localDraftBlockCheckpoints: Repository<LocalDraftBlockCheckpointEntity> | null = null,
  ) {}

  // AI_ANALYSIS_CANCEL_RACE_GUARD_V1
  // Una cancelación concurrente pudo marcar CANCELLED mientras el proveedor
  // generaba. Este update solo avanza a PROCESSING si ese estado sigue
  // vigente; de lo contrario el resultado queda GENERATED sin aplicarse al
  // documento. Compartido por la ruta cloud/FAKE y la ruta LOCAL_ONLY_V2.
  private async claimRequestStillActive(
    manager: EntityManager,
    requestId: string,
    finishedAt: Date,
  ): Promise<boolean> {
    const claim = await manager
      .createQueryBuilder()
      .update(AnalysisRequestEntity)
      .set({
        status: "PROCESSING",
        errorCode: null,
        errorMessage: null,
        updatedAt: finishedAt,
      })
      .where("Id = :id", { id: requestId })
      .andWhere("Status != :cancelled", { cancelled: "CANCELLED" })
      .execute();
    return claim.affected === 1;
  }

  async process(
    analysisRequestId: string,
    finalAttempt: boolean,
    correlationId = analysisRequestId,
  ): Promise<void> {
    const request = await this.requests.findOneBy({ id: analysisRequestId });
    if (
      !request ||
      request.status === "CANCELLED" ||
      request.status === "COMPLETED"
    )
      return;

    const existingResult = await this.results.findOneBy({ analysisRequestId });
    if (existingResult) {
      if (existingResult.status === "ACCEPTED") {
        await this.requests.update(analysisRequestId, {
          status: "COMPLETED",
          errorCode: null,
          errorMessage: null,
          updatedAt: new Date(),
        });
        return;
      }
      await this.applyExistingResult(
        request,
        existingResult,
        finalAttempt,
        correlationId,
      );
      return;
    }

    const claim = await this.requests
      .createQueryBuilder()
      .update(AnalysisRequestEntity)
      .set({ status: "PROCESSING", updatedAt: new Date() })
      .where("Id = :id", { id: analysisRequestId })
      .andWhere("Status IN (:...statuses)", { statuses: ["PENDING", "FAILED"] })
      .execute();
    if (claim.affected !== 1) return;

    const previous = await this.executions.find({
      where: { analysisRequestId },
      order: { attempt: "DESC" },
      take: 1,
    });
    const previousExecution = previous[0] ?? null;
    let resumableProviderRequestId: string | null = null;
    const attempt = (previousExecution?.attempt ?? 0) + 1;
    const startedAt = new Date();
    const runtimeMetrics = getRuntimeMetrics("ai-analysis-service");
    const execution = this.executions.create({
      id: randomUUID(),
      analysisRequestId,
      attempt,
      status: "PROCESSING",
      provider: this.runtime.executionMode === "FAKE" ? "FAKE" : "DISABLED",
      model:
        this.runtime.executionMode === "FAKE" ? "deterministic-e2e-v1" : null,
      providerConfigurationId: null,
      promptVersionId: null,
      startedAt,
      finishedAt: null,
      durationMs: null,
      inputTokens: null,
      outputTokens: null,
      estimatedCost: null,
      providerRequestId: null,
      errorCode: null,
      errorMessage: null,
      createdAt: startedAt,
    });
    await this.executions.save(execution);
    await this.events.publish({
      eventName: "analysis.started",
      correlationId,
      causationId: analysisRequestId,
      data: {
        projectId: request.projectId,
        analysisRequestId,
        executionId: execution.id,
        attempt,
      },
    });

    let providerCompleted = false;
    try {
      const [snapshotSources, prompt] = await Promise.all([
        this.sources.find({
          where: { analysisRequestId },
          order: { position: "ASC" },
        }),
        this.prompts.findOneBy({
          code: "REQUIREMENT_DOCUMENT",
          isActive: true,
        }),
      ]);
      if (!prompt)
        throw new ConflictException(
          "No existe un prompt activo para el análisis.",
        );
      if (!request.documentSnapshotJson) {
        throw new ConflictException(
          "La solicitud no contiene la instantánea documental requerida.",
        );
      }
      const document = JSON.parse(
        request.documentSnapshotJson,
      ) as RequirementDocumentDetail;
      const rawSourcesPrompt = buildAiAnalysisPrompt(
        document,
        snapshotSources,
        request.instruction,
        request.purpose,
      );
      const includesScrum = document.currentVersionDetail.sections.some(
        (section) => section.key === "scrumPlan",
      );
      const snapshotSourceIds = snapshotSources.map(
        (source) => source.sourceId,
      );
      const allowedDraftSourceIds = [
        ...new Set([
          ...snapshotSourceIds,
          ...(request.purpose === "AI_VERSION"
            ? document.currentVersionDetail.evidence.map(
                (evidence) => evidence.sourceId,
              )
            : []),
        ]),
      ];
      const outputSchema = buildAiAnalysisOutputSchemaV41(
        includesScrum,
        document.template.templateType,
        allowedDraftSourceIds,
      );
      const requestedUseLocalAi = request.useLocalAi !== false;
      const selectedProviders = readProviderSnapshots(
        request.providerSelectionsJson,
      );
      const requestedUseCloudAi = request.useCloudAi !== false;
      if (!requestedUseLocalAi && !requestedUseCloudAi) {
        throw new ConflictException(
          "La solicitud debe usar IA local, IA nube o ambas.",
        );
      }

      const generationMode = resolveAiDocumentGenerationMode(
        requestedUseLocalAi,
        requestedUseCloudAi,
      );
      const useLocalAi = generationMode !== "CLOUD_ONLY";
      const useCloudAi = generationMode !== "LOCAL_ONLY";
      const resolvedOpenAi =
        this.runtime.executionMode === "OPENAI" && useCloudAi
          ? await this.providerConfigurations.resolveDefault(
              selectedProviders.CLOUD?.id,
              selectedProviders.CLOUD,
            )
          : null;
      if (
        resolvedOpenAi &&
        resolvedOpenAi.configuration.lastConnectionTestStatus !== "SUCCEEDED"
      ) {
        throw new ConflictException(
          "El proveedor predeterminado debe superar una prueba de conexión antes de ejecutar análisis.",
        );
      }
      let userPrompt = rawSourcesPrompt;
      let knowledgeSnapshot: ProjectKnowledgeSnapshot | null = null;
      const effectiveLocalConfig = useLocalAi
        ? this.localAiSettings
          ? await this.localAiSettings.resolve(
              selectedProviders.LOCAL?.id,
              selectedProviders.LOCAL,
            )
          : this.localAiConfig
        : { ...this.localAiConfig, enabled: false };
      if (useLocalAi && !effectiveLocalConfig.enabled) {
        throw new ConflictException(
          "La IA local fue seleccionada, pero Ollama no está habilitado y validado.",
        );
      }
      if (
        this.runtime.executionMode === "OPENAI" &&
        resolveLocalOnlyV2Pipeline(generationMode)
      ) {
        if (!this.localDraftBlockCheckpoints) {
          throw new Error(
            "LOCAL_ONLY_V2 requiere persistencia de checkpoints.",
          );
        }
        // Older requests did not snapshot the applied definition; recover the exact immutable version.
        let localDocument = document;
        if (!localDocument.appliedTemplate) {
          localDocument = await this.documentsAccess.requireCurrentVersion(
            request.projectId,
            request.documentId,
            request.documentVersionId,
            await this.serviceToken.issue(),
            correlationId,
          );
          if (
            localDocument.template.id !== document.template.id ||
            localDocument.template.version !== document.template.version
          ) {
            throw new Error(
              "La plantilla aplicada cambió respecto a la solicitud.",
            );
          }
          request.documentSnapshotJson = JSON.stringify(localDocument);
          await this.requests.update(request.id, {
            documentSnapshotJson: request.documentSnapshotJson,
          });
        }
        execution.provider = "OLLAMA";
        execution.providerConfigurationId = selectedProviders.LOCAL?.id ?? null;
        execution.model = effectiveLocalConfig.model;
        execution.promptVersionId = prompt.id;
        await this.executions.update(execution.id, {
          provider: execution.provider,
          providerConfigurationId: execution.providerConfigurationId,
          model: execution.model,
          promptVersionId: prompt.id,
        });
        const checkCancelled = async () => {
          const current = await this.requests.findOneBy({ id: request.id });
          if (!current || current.status === "CANCELLED")
            throw new AiProviderError(
              "AI_CANCELLED",
              "AI_CANCELLED: generación cancelada.",
              false,
            );
        };
        const result = await runLocalOnlyV2DocumentRuntime({
          document: localDocument,
          sources: snapshotSources,
          config: effectiveLocalConfig,
          store: new LocalOnlyV2PersistentStore(
            this.localDraftBlockCheckpoints,
            request.id,
          ),
          checkCancelled,
          instruction: request.instruction,
          purpose: request.purpose,
        });
        await checkCancelled();
        const finishedAt = new Date();
        const resultId = randomUUID();
        let requestStillActive = true;
        await this.dataSource.transaction(async (manager) => {
          await manager.save(AnalysisResultEntity, {
            id: resultId,
            analysisRequestId: request.id,
            analysisExecutionId: execution.id,
            status: "GENERATED",
            schemaVersion: result.schemaVersion,
            contentJson: JSON.stringify(result),
            reviewedByUserId: null,
            reviewedAt: null,
            reviewComment: null,
            createdAt: finishedAt,
            updatedAt: finishedAt,
          });
          await manager.update(AnalysisExecutionEntity, execution.id, {
            status: "COMPLETED",
            finishedAt,
            durationMs: String(finishedAt.valueOf() - startedAt.valueOf()),
            inputTokens: null,
            outputTokens: null,
            estimatedCost: null,
          });
          requestStillActive = await this.claimRequestStillActive(
            manager,
            request.id,
            finishedAt,
          );
        });
        providerCompleted = true;
        if (!requestStillActive) return;
        await this.applyGeneratedResult(
          request,
          await this.results.findOneByOrFail({ id: resultId }),
          correlationId,
        );
        await this.events.publish({
          eventName: "analysis.completed",
          correlationId,
          causationId: execution.id,
          data: {
            projectId: request.projectId,
            analysisRequestId: request.id,
            executionId: execution.id,
            requestedByUserId: request.requestedByUserId,
            sourceGeneration: isSourcesGenerationRequest(request),
            durationMs: finishedAt.valueOf() - startedAt.valueOf(),
            inputTokens: null,
            outputTokens: null,
            purpose: request.purpose,
            generatedVersion: request.generatedVersion,
          },
        });
        runtimeMetrics.observeOperation(
          "ai_analysis",
          "succeeded",
          finishedAt.valueOf() - startedAt.valueOf(),
        );
        return;
      }

      const requiresFunctionalCoverage =
        this.runtime.executionMode === "OPENAI" && useLocalAi;

      // LOCAL_ONLY_V2_18_5_RUNTIME_INTEGRATION
      const localOnlyV2RuntimeBridge: LocalOnlyV2RuntimeBridge | null =
        this.runtime.executionMode === "OPENAI" &&
        generationMode === "LOCAL_ONLY"
          ? prepareLocalOnlyV2RuntimeBridge(
              snapshotSources,
              effectiveLocalConfig,
            )
          : null;

      if (useLocalAi) {
        try {
          if (!this.localAi)
            throw new LocalAiError(
              "LOCAL_AI_NOT_CONFIGURED",
              "El pipeline de IA local no está configurado.",
              false,
            );
          knowledgeSnapshot = await this.localAi.buildSnapshot(
            request.projectId,
            analysisRequestId,
            snapshotSources,
            resolvedOpenAi
              ? {
                  maxInputTokens: resolvedOpenAi.configuration.maxInputTokens,
                  systemInstruction: prompt.systemInstruction,
                  basePrompt: rawSourcesPrompt,
                  structuredOutputSchema: outputSchema,
                }
              : undefined,
            rawSourcesPrompt,
            effectiveLocalConfig,
            // PASO_3_LOCAL_ONLY_PREANALISIS_THINK_FALSE_V1
            // AI_ANALYSIS_HYBRID_COMPACT_PREANALYSIS_V1
            // En LOCAL_CLOUD la IA local solo compacta las fuentes para la nube.
            // El perfil completo (think low + esquema con sourceIds por hallazgo)
            // agotaba los 8.192 tokens de salida sin cerrar el JSON; el perfil
            // compacto (think desactivado, sin sourceIds) sí termina.
            generationMode === "LOCAL_ONLY" || generationMode === "LOCAL_CLOUD"
              ? "LOCAL_EXTRACT"
              : "DEFAULT",
          );
          if (!knowledgeSnapshot)
            throw new LocalAiError(
              "LOCAL_AI_SNAPSHOT_MISSING",
              "No se generó el snapshot local requerido.",
              false,
            );
          userPrompt =
            generationMode === "LOCAL_ONLY"
              ? buildLocalDocumentPromptFromKnowledgeSnapshot(
                  rawSourcesPrompt,
                  knowledgeSnapshot,
                )
              : buildHybridCloudPromptFromKnowledgeSnapshot(
                  rawSourcesPrompt,
                  knowledgeSnapshot,
                );

          if (localOnlyV2RuntimeBridge) {
            userPrompt = appendLocalOnlyV2RuntimeEvidence(
              userPrompt,
              localOnlyV2RuntimeBridge,
            );
          }
        } catch (error) {
          /*
           * Cuando la IA local está habilitada para OPENAI, el modo híbrido
           * conserva fail-closed: si falla el preanálisis local no degradamos
           * silenciosamente a fuentes crudas porque perderíamos la garantía
           * FN -> HU-F del manifiesto local. Cuando la IA local está deshabilitada,
           * este bloque no se ejecuta y userPrompt conserva rawSourcesPrompt.
           */
          if (
            requiresFunctionalCoverage ||
            !effectiveLocalConfig.fallbackToRawSources
          ) {
            throw error;
          }
          await this.dataSource.getRepository(LocalAiAuditEntity).save({
            id: randomUUID(),
            projectId: request.projectId,
            analysisRequestId,
            action: "RAW_SOURCE_FALLBACK",
            reasonCode:
              error instanceof LocalAiError ? error.code : "LOCAL_AI_FAILED",
            correlationId: /^[0-9a-f-]{36}$/iu.test(correlationId)
              ? correlationId
              : null,
            createdAt: new Date(),
          });
          runtimeMetrics.observeOperation("local_ai_fallback", "succeeded", 0);
        }
      }
      if (requiresFunctionalCoverage) {
        if (!knowledgeSnapshot) {
          throw new LocalAiError(
            "LOCAL_AI_SNAPSHOT_MISSING",
            "No existe snapshot local para validar cobertura funcional.",
            false,
          );
        }

        if (buildFunctionalCoverageManifest(knowledgeSnapshot).length === 0) {
          throw new LocalAiError(
            "LOCAL_AI_FUNCTIONAL_NEEDS_EMPTY",
            "El preanálisis local no identificó necesidades funcionales suficientemente completas para generar HU-F sin inventar información.",
            false,
          );
        }
      }

      userPrompt = appendAiValidationRetryGuidance(
        userPrompt,
        previousExecution?.errorCode,
        previousExecution?.errorMessage,
      );

      execution.promptVersionId = prompt.id;

      // Both providers keep the same reconciliation and validation rules.
      const prepareDraft = (input: AiAnalysisDraft): AiAnalysisDraft => {
        const draftWithSources = reconcileAiDraftSourceIds(
          input,
          allowedDraftSourceIds,
        );
        const draftWithPlanning = reconcileExplicitPlanningStructure(
          draftWithSources,
          snapshotSources,
          request.instruction,
        );
        /*
         * POINT_8_EXPLICIT_HUP_FUNCTIONAL_ALIGNMENT_V4_7_9
         * El backend alinea todas las HU-P del árbol final con una HU-F distinta.
         * La documentación estándar omitida se completa de forma conservadora
         * antes de validar; una contradicción estructural sí conserva fail-closed.
         */
        const draftWithPlanningLinks =
          reconcileExplicitPlanningFunctionalStoriesV479(
            draftWithPlanning,
            snapshotSources,
            request.instruction,
          );
        /*
         * POINT_2_FUNCTIONAL_SOURCE_TRACE_V4_7_2
         * La IA decide qué FN cubre cada HU-F. El backend únicamente materializa
         * la trazabilidad sourceIds ya perteneciente a esas FN antes de validar.
         */
        const draftWithFunctionalSources = knowledgeSnapshot
          ? reconcileFunctionalCoverageSourceIds(
              draftWithPlanningLinks,
              knowledgeSnapshot,
            )
          : draftWithPlanningLinks;

        const draftWithCompleteFunctionalDocumentation =
          reconcileAlignedFunctionalDocumentation(
            draftWithFunctionalSources,
            snapshotSources,
          );

        return knowledgeSnapshot
          ? reconcileFunctionalCoveragePendingNeeds(
              draftWithCompleteFunctionalDocumentation,
              knowledgeSnapshot,
            )
          : draftWithCompleteFunctionalDocumentation;
      };

      let provider;
      if (this.runtime.executionMode === "FAKE") {
        provider = new FakeAiProvider(
          snapshotSources.map((source) => ({
            id: source.sourceId,
            title: source.sourceTitle ?? "Fuente",
            text: source.snapshotText ?? "",
          })),
        );
      } else {
        if (useCloudAi) {
          if (!resolvedOpenAi) {
            throw new ConflictException(
              "No hay un proveedor de IA nube habilitado y predeterminado.",
            );
          }
          if (
            estimateAiPromptTokens(userPrompt) >
            resolvedOpenAi.configuration.maxInputTokens
          ) {
            throw new ConflictException(
              "Las fuentes exceden el límite de entrada configurado.",
            );
          }
          execution.provider = resolvedOpenAi.configuration
            .providerType as AiProviderCode;
          execution.providerConfigurationId = resolvedOpenAi.configuration.id;
          execution.model = resolvedOpenAi.configuration.model;
          resumableProviderRequestId =
            previousExecution?.provider === "OPENAI" &&
            previousExecution.providerConfigurationId ===
              resolvedOpenAi.configuration.id &&
            previousExecution.model === resolvedOpenAi.configuration.model &&
            previousExecution.errorCode === "OPENAI_TIMEOUT"
              ? previousExecution.providerRequestId
              : null;
          provider = createCloudTextProvider(resolvedOpenAi);
        } else {
          execution.provider = "OLLAMA";
          execution.providerConfigurationId =
            selectedProviders.LOCAL?.id ?? null;
          execution.model = effectiveLocalConfig.model;
          const draftStages = localDraftStages(outputSchema);
          const logicalBlocks = buildLocalDraftLogicalBlocks(
            document.currentVersionDetail.sections,
            draftStages,
          );
          this.localDraftBlockProgress.initialize(
            analysisRequestId,
            logicalBlocks,
          );
          await this.initializeLocalDraftBlockCheckpoints(
            analysisRequestId,
            logicalBlocks,
          );
          const resumeStageValues = await this.prepareLocalDraftBlockResume(
            analysisRequestId,
            logicalBlocks,
            draftStages.map((stage) => stage.path),
          );

          provider = new OllamaDraftProvider(
            effectiveLocalConfig,
            localOnlyV2RuntimeBridge
              ? createLocalOnlyV2BoundedDocumentClient(
                  effectiveLocalConfig,
                  localOnlyV2RuntimeBridge,
                )
              : undefined,
            async () => {
              const current = await this.requests.findOneBy({
                id: analysisRequestId,
              });
              if (!current || current.status === "CANCELLED") {
                throw new AiProviderError(
                  "AI_CANCELLED",
                  "Generación local cancelada.",
                  false,
                );
              }
            },
            (input) => {
              const candidate = prepareDraft(input);
              return [
                ...validateExplicitPlanningCoverage(
                  candidate,
                  snapshotSources,
                  request.instruction,
                ).map(
                  (message) =>
                    `structuredAnalysis.backlogStructure: ${message}`,
                ),
                ...validateExplicitPlanningFunctionalAlignment(
                  candidate,
                  snapshotSources,
                  request.instruction,
                  allowedDraftSourceIds,
                ).map(
                  (message) =>
                    `structuredAnalysis.functionalUserStories: ${message}`,
                ),
                ...(knowledgeSnapshot
                  ? validateFunctionalCoverage(
                      candidate,
                      knowledgeSnapshot,
                    ).map(
                      (message) =>
                        `structuredAnalysis.functionalUserStories: ${message}`,
                    )
                  : []),
              ];
            },
            logicalBlocks,
            async (progress) => {
              this.localDraftBlockProgress.update(analysisRequestId, progress);
              await this.persistLocalDraftBlockCheckpoint(
                analysisRequestId,
                progress,
              );
            },
            resumeStageValues,
          );
        }
      }

      // PASO_4_BLINDAJE_FRONTERAS_TRES_MODOS_V2
      // Antes de invocar el proveedor final, verifica que el modo resuelto no
      // haya mezclado accidentalmente proveedor, snapshot o prompt.
      if (this.runtime.executionMode === "OPENAI") {
        assertAiDocumentGenerationBoundary({
          mode: generationMode,
          provider: execution.provider,
          hasKnowledgeSnapshot: Boolean(knowledgeSnapshot),
          snapshotPromptReady: userPrompt.includes(
            "PROJECT_KNOWLEDGE_SNAPSHOT_LOCAL",
          ),
        });
      }

      await this.executions.update(execution.id, {
        promptVersionId: execution.promptVersionId,
        provider: execution.provider,
        providerConfigurationId: execution.providerConfigurationId,
        model: execution.model,
      });
      const generated = await provider.generate({
        systemInstruction: prompt.systemInstruction,
        userPrompt,
        schema: outputSchema,
        attempt,
        idempotencyKey: analysisRequestId,
        resumeProviderRequestId:
          this.runtime.executionMode === "OPENAI"
            ? resumableProviderRequestId
            : null,
        onProviderRequestId: async (providerRequestId) => {
          execution.providerRequestId = providerRequestId;
          await this.executions.update(execution.id, { providerRequestId });
        },
      });

      /*
       * AI_PROVIDER_USAGE_BEFORE_LOCAL_VALIDATION_V1
       * El costo ya ocurrió cuando el proveedor completó. Persistimos requestId
       * y tokens antes de reconciliar/validar el dominio para que un rechazo
       * local no oculte consumo real ni provoque una segunda generación.
       */
      execution.providerRequestId =
        generated.providerRequestId ?? execution.providerRequestId;
      const estimatedCost =
        execution.provider === "OPENAI" &&
        execution.model &&
        generated.inputTokens !== null &&
        generated.outputTokens !== null
          ? calculateOpenAiTokenCost(
              execution.model,
              generated.inputTokens,
              generated.outputTokens,
            ).costUsd
          : null;
      await this.executions.update(execution.id, {
        providerRequestId: execution.providerRequestId,
        inputTokens: generated.inputTokens,
        outputTokens: generated.outputTokens,
        estimatedCost,
      });
      if (estimatedCost !== null) {
        await this.usageGuard?.reconcileActualCost(
          request.id,
          Number(estimatedCost),
        );
      }

      const draft = prepareDraft(generated.draft);

      const missingPlanningRows = validateExplicitPlanningCoverage(
        draft,
        snapshotSources,
        request.instruction,
      );
      if (missingPlanningRows.length > 0) {
        // Solo cantidades y estados: permite ver qué devolvió la IA sin
        // guardar texto del documento ni de las fuentes.
        await writeAiProviderTrace(execution.id, "validation-error", {
          provider: execution.provider,
          model: execution.model,
          phase: "AI_EXPLICIT_STRUCTURE_SHAPE",
          errors: missingPlanningRows.slice(0, 8),
          draftShape: summarizeDraftShape(draft),
        });
        throw new AiProviderError(
          "AI_EXPLICIT_STRUCTURE_INVALID",
          `La estructura explícita devuelta por la IA no coincide con lo solicitado: ${missingPlanningRows
            .slice(0, 8)
            .join("; ")}${missingPlanningRows.length > 8 ? "; …" : ""}`,
          true,
        );
      }

      const functionalAlignmentErrors =
        validateExplicitPlanningFunctionalAlignment(
          draft,
          snapshotSources,
          request.instruction,
          allowedDraftSourceIds,
        );
      if (functionalAlignmentErrors.length > 0) {
        throw new AiProviderError(
          "AI_EXPLICIT_HUP_FUNCTIONAL_ALIGNMENT_INVALID",
          `La alineación 1:1 HU-P/HU-F del esquema final es inconsistente: ${functionalAlignmentErrors
            .slice(0, 8)
            .join("; ")}${functionalAlignmentErrors.length > 8 ? "; …" : ""}`,
          true,
        );
      }

      if (knowledgeSnapshot) {
        const functionalCoverageErrors = validateFunctionalCoverage(
          draft,
          knowledgeSnapshot,
        );
        if (functionalCoverageErrors.length > 0) {
          throw new AiProviderError(
            "AI_FUNCTIONAL_COVERAGE_INCOMPLETE",
            `La cobertura funcional del Punto 6 está incompleta o es inconsistente: ${functionalCoverageErrors
              .slice(0, 8)
              .join("; ")}${functionalCoverageErrors.length > 8 ? "; …" : ""}`,
            true,
          );
        }
      }

      const allowedSourceIds = new Set(
        allowedDraftSourceIds.map((sourceId) => sourceId.toLowerCase()),
      );
      if (
        collectAiDraftSourceIds(draft).some(
          (sourceId) => !allowedSourceIds.has(sourceId.toLowerCase()),
        )
      ) {
        throw new AiProviderError(
          "AI_UNKNOWN_SOURCE_REFERENCE",
          "La salida de IA referencia una fuente que no pertenece a la solicitud.",
          true,
        );
      }
      const finishedAt = new Date();

      const resultId = randomUUID();
      let requestStillActive = true;
      await this.dataSource.transaction(async (manager) => {
        await manager.save(
          manager.create(AnalysisResultEntity, {
            id: resultId,
            analysisRequestId,
            analysisExecutionId: execution.id,
            status: "GENERATED",
            schemaVersion: draft.schemaVersion,
            contentJson: JSON.stringify(draft),
            reviewedByUserId: null,
            reviewedAt: null,
            reviewComment: null,
            createdAt: finishedAt,
            updatedAt: finishedAt,
          }),
        );
        await manager.update(AnalysisExecutionEntity, execution.id, {
          status: "COMPLETED",
          finishedAt,
          durationMs: String(finishedAt.valueOf() - startedAt.valueOf()),
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          estimatedCost,
          providerRequestId: execution.providerRequestId,
        });
        requestStillActive = await this.claimRequestStillActive(
          manager,
          analysisRequestId,
          finishedAt,
        );
      });
      providerCompleted = true;
      if (!requestStillActive) return;
      const generatedResult = await this.results.findOneByOrFail({
        id: resultId,
      });
      await this.applyGeneratedResult(request, generatedResult, correlationId);
      await this.events.publish({
        eventName: "analysis.completed",
        correlationId,
        causationId: execution.id,
        data: {
          projectId: request.projectId,
          analysisRequestId,
          executionId: execution.id,
          requestedByUserId: request.requestedByUserId,
          sourceGeneration: isSourcesGenerationRequest(request),
          durationMs: finishedAt.valueOf() - startedAt.valueOf(),
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          purpose: request.purpose,
          generatedVersion: request.generatedVersion,
        },
      });
      runtimeMetrics.observeOperation(
        "ai_analysis",
        "succeeded",
        finishedAt.valueOf() - startedAt.valueOf(),
      );
    } catch (error) {
      const failure = errorDetails(error);
      const finishedAt = new Date();
      if (providerCompleted) {
        await writeAiProviderTrace(execution.id, "application-error", {
          provider: execution.provider,
          model: execution.model,
          phase: "DOCUMENT_APPLY",
          code: failure.code,
          errorMessage: failure.message,
          retryable: failure.retryable,
        });
      }
      if (failure.code.endsWith("_DLP_BLOCKED")) {
        await this.securityAudits?.save(
          this.securityAudits.create({
            eventType: "DLP_BLOCKED",
            actorUserId: request.requestedByUserId,
            projectId: request.projectId,
            executionId: execution.id,
            code: failure.code,
            detailJson: JSON.stringify({
              provider: execution.provider,
              model: execution.model,
            }),
            createdAt: finishedAt,
          }),
        );
      }
      const cancelled =
        (await this.requests.findOneBy({ id: analysisRequestId }))?.status ===
        "CANCELLED";
      runtimeMetrics.observeOperation(
        "ai_analysis",
        "failed",
        finishedAt.valueOf() - startedAt.valueOf(),
      );
      await this.dataSource.transaction(async (manager) => {
        if (!providerCompleted) {
          await manager.update(AnalysisExecutionEntity, execution.id, {
            status: "FAILED",
            finishedAt,
            durationMs: String(finishedAt.valueOf() - startedAt.valueOf()),
            errorCode: failure.code,
            errorMessage: failure.message,
          });
        }
        if (!cancelled) {
          await manager.update(AnalysisRequestEntity, analysisRequestId, {
            status: failure.retryable && !finalAttempt ? "PENDING" : "FAILED",
            errorCode: failure.code,
            errorMessage: failure.message,
            updatedAt: finishedAt,
          });
        }
      });

      if (cancelled) return;

      if (!failure.retryable || finalAttempt) {
        await this.events.publish({
          eventName: "analysis.failed",
          correlationId,
          causationId: execution.id,
          data: {
            projectId: request.projectId,
            analysisRequestId,
            executionId: execution.id,
            requestedByUserId: request.requestedByUserId,
            sourceGeneration: isSourcesGenerationRequest(request),
            purpose: request.purpose,
            generatedVersion: request.generatedVersion,
            errorCode: failure.code,
          },
        });
      }

      if (failure.retryable && !finalAttempt) {
        throw new AiProviderError(failure.code, failure.message, true);
      }
    }
  }

  private async applyExistingResult(
    request: AnalysisRequestEntity,
    result: AnalysisResultEntity,
    finalAttempt: boolean,
    correlationId: string,
  ): Promise<void> {
    try {
      await this.applyGeneratedResult(request, result, correlationId);
      await this.events.publish({
        eventName: "analysis.completed",
        correlationId,
        causationId: result.analysisExecutionId,
        data: {
          projectId: request.projectId,
          analysisRequestId: request.id,
          executionId: result.analysisExecutionId,
          requestedByUserId: request.requestedByUserId,
          sourceGeneration: isSourcesGenerationRequest(request),
          purpose: request.purpose,
          generatedVersion: request.generatedVersion,
          recoveredApplication: true,
        },
      });
    } catch (error) {
      const failure = errorDetails(error);
      await this.requests.update(request.id, {
        status: failure.retryable && !finalAttempt ? "PENDING" : "FAILED",
        errorCode: failure.code,
        errorMessage: failure.message,
        updatedAt: new Date(),
      });
      if (failure.retryable && !finalAttempt) {
        throw new AiProviderError(failure.code, failure.message, true);
      }
    }
  }

  private async applyGeneratedResult(
    request: AnalysisRequestEntity,
    result: AnalysisResultEntity,
    correlationId: string,
  ): Promise<void> {
    const accessToken = await this.serviceToken.issue();
    const document = await this.documentsAccess.requireCurrentVersion(
      request.projectId,
      request.documentId,
      request.documentVersionId,
      accessToken,
      correlationId,
    );
    const persisted: unknown = JSON.parse(result.contentJson);
    if (isLocalOnlyV2DocumentResult(persisted)) {
      if (
        resolveAiDocumentGenerationMode(
          request.useLocalAi !== false,
          request.useCloudAi !== false,
        ) !== "LOCAL_ONLY"
      ) {
        throw new Error(
          "Un resultado LOCAL_ONLY_V2 solo puede aplicarse en LOCAL_ONLY.",
        );
      }
      const dynamic = parseLocalOnlyV2PersistedDocumentResult(
        persisted,
        document,
      );
      const sources = await this.sources.find({
        where: { analysisRequestId: request.id },
      });
      const sourceIds = new Set(sources.map((source) => source.sourceId));
      if (
        dynamic.sections.some((section) =>
          section.sourceIds.some((id) => !sourceIds.has(id)),
        )
      ) {
        throw new Error(
          "LOCAL_ONLY_V2 referencia una fuente ajena a la solicitud.",
        );
      }
      const editable = [...document.currentVersionDetail.sections].sort(
        (a, b) => a.order - b.order,
      );
      const sections = dynamic.sections.filter((section) =>
        editable.some((current) => current.key === section.key),
      );
      if (
        sections.length !== editable.length ||
        sections.some((section, index) => section.key !== editable[index]?.key)
      ) {
        throw new Error(
          "LOCAL_ONLY_V2 no coincide con las secciones reales del documento.",
        );
      }
      await this.documentsAccess.applyAiDraft(
        request.documentId,
        request.generatedVersionNumber,
        {
          expectedRevision: document.currentVersionDetail.revision,
          analysisRequestId: request.id,
          analysisResultId: result.id,
          sections: normalizeLocalOnlyV2Sections(
            sections,
            (key) => editable.find((current) => current.key === key)?.content,
            isPrototypeRequested(request.instruction),
          ),
          requirements: [],
          evidence: sections.flatMap((section) =>
            section.sourceIds.map((sourceId) => ({
              sourceId,
              sectionKey: section.key,
              note: "Evidencia del punto LOCAL_ONLY_V2; requiere revisión humana.",
            })),
          ),
        },
        accessToken,
        correlationId,
      );
    } else {
      const draft = parseAiAnalysisDraft(persisted);
      const availableSectionKeys = new Set(
        document.currentVersionDetail.sections.map((section) => section.key),
      );
      const structuredStories =
        draft.schemaVersion === "1.0.0"
          ? []
          : draft.schemaVersion === "4.1.0"
            ? draft.structuredAnalysis.functionalUserStories
            : draft.structuredAnalysis.userStories;
      const storyCodes = new Set(
        structuredStories.map((story) => story.code.toUpperCase()),
      );
      const generatedRequirements = [
        ...structuredStories.map((story) => ({
          clientId: `HU:${story.code}`,
          sectionKey: "milestones" as const,
          code: story.code,
          title: story.title,
          description: [
            `COMO ${story.role}`,
            `QUIERO ${story.want}`,
            `PARA ${story.benefit}`,
            `Contexto: ${story.context}`,
            ...(story.premises.length
              ? [`Premisas: ${story.premises.join("; ")}`]
              : []),
          ].join("\n"),
          requirementType: "USER_STORY",
          sourceIds: [
            ...new Set([
              ...story.sourceIds,
              ...story.fields.flatMap((field) => field.sourceIds),
              ...story.acceptanceCriteria.flatMap(
                (criterion) => criterion.sourceIds,
              ),
            ]),
          ],
          acceptanceCriteria: story.acceptanceCriteria.map(
            (criterion) =>
              `DADO ${criterion.given}, CUANDO ${criterion.when}, ENTONCES ${criterion.then}`,
          ),
        })),
        ...draft.requirements
          .filter(
            (requirement) => !storyCodes.has(requirement.code.toUpperCase()),
          )
          .map((requirement) => ({
            ...requirement,
            sectionKey: resolveAppliedRequirementSectionKey(
              requirement.sectionKey,
              availableSectionKeys,
            ),
          })),
      ];
      const evidenceByKey = new Map<
        string,
        {
          sourceId: string;
          sectionKey: DocumentSectionKey;
          requirementClientId?: string;
          note: string;
        }
      >();
      for (const requirement of generatedRequirements) {
        for (const sourceId of requirement.sourceIds) {
          const key = `${sourceId}|${requirement.clientId}`;
          evidenceByKey.set(key, {
            sourceId,
            sectionKey: requirement.sectionKey,
            requirementClientId: requirement.clientId,
            note: "Trazabilidad propuesta por IA; requiere revisión humana.",
          });
        }
      }
      if (draft.schemaVersion !== "1.0.0") {
        const processFlowSourceIds =
          draft.schemaVersion === "2.0.0"
            ? draft.structuredAnalysis.processFlow.sourceIds
            : [
                ...draft.structuredAnalysis.processFlows.asIs.sourceIds,
                ...draft.structuredAnalysis.processFlows.toBe.sourceIds,
                ...draft.structuredAnalysis.entityRelationship.sourceIds,
              ];
        const sectionEvidence: readonly [
          DocumentSectionKey,
          readonly string[],
        ][] = [
          ["processFlow", processFlowSourceIds],
          [
            "tests",
            draft.structuredAnalysis.tests.flatMap((item) => item.sourceIds),
          ],
          ["scrumPlan", draft.structuredAnalysis.scrumPlan?.sourceIds ?? []],
        ];
        for (const [sectionKey, sourceIds] of sectionEvidence) {
          for (const sourceId of sourceIds) {
            evidenceByKey.set(`${sourceId}|${sectionKey}`, {
              sourceId,
              sectionKey,
              note: "Evidencia estructurada propuesta por IA; requiere revisión humana.",
            });
          }
        }
      }

      await this.documentsAccess.applyAiDraft(
        request.documentId,
        request.generatedVersionNumber,
        {
          expectedRevision: document.currentVersionDetail.revision,
          analysisRequestId: request.id,
          analysisResultId: result.id,
          sections: document.currentVersionDetail.sections
            .filter((section) => !section.templateControlled)
            .sort((left, right) => left.order - right.order)
            .map((currentSection) => {
              const generatedSection = draft.sections.find(
                (section) => section.key === currentSection.key,
              );
              const fallback =
                generatedSection?.content ?? currentSection.content;
              return {
                key: currentSection.key,
                content: generatedSectionContent(
                  draft,
                  currentSection.key,
                  fallback,
                  isPrototypeRequested(request.instruction),
                ),
              };
            }),
          requirements: generatedRequirements.map((requirement, index) => ({
            clientId: requirement.clientId,
            sectionKey: requirement.sectionKey,
            code: requirement.code,
            title: requirement.title,
            description: requirement.description,
            requirementType: requirement.requirementType,
            status: "PROPOSED",
            order: index + 1,
            acceptanceCriteria: requirement.acceptanceCriteria.map(
              (criterion, criterionIndex) => ({
                description: criterion,
                order: criterionIndex + 1,
              }),
            ),
          })),
          evidence: [...evidenceByKey.values()],
        },
        accessToken,
        correlationId,
      );
    }

    const now = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AnalysisResultEntity, result.id, {
        status: "ACCEPTED",
        reviewedByUserId: request.requestedByUserId,
        reviewedAt: now,
        reviewComment:
          "Aplicado automáticamente al borrador; requiere revisión humana.",
        updatedAt: now,
      });
      await manager.update(AnalysisRequestEntity, request.id, {
        status: "COMPLETED",
        errorCode: null,
        errorMessage: null,
        updatedAt: now,
      });
    });
  }
}
