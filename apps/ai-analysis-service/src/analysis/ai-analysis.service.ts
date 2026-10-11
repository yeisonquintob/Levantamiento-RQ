import { createHash, randomUUID } from "node:crypto";
import {
  readProviderSnapshots,
  resolveSelectedProvider,
  type SelectedProviderSnapshots,
} from "../providers/provider-selection";

import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  ServiceUnavailableException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";

import type {
  AiAnalysisExecutionDetail,
  AiAnalysisPromptDetail,
  AiAnalysisProcessingDetail,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiAnalysisTokenEstimateRequest,
  AiAnalysisTokenEstimateResponse,
  ProjectDomainPurgeResult,
  AiAnalysisRequestSourceDetail,
  AiAnalysisRequestSummary,
  AiAnalysisResultDetail,
  CreateAiAnalysisRequest,
  RequirementDocumentDetail,
  ReviewAiAnalysisResult,
  SourceDetail,
} from "@levantamiento-rq/shared-contracts";

import { AnalysisExecutionEntity } from "./analysis-execution.entity";
import { AnalysisRequestSourceEntity } from "./analysis-request-source.entity";
import { AnalysisRequestEntity } from "./analysis-request.entity";
import { isSourcesGenerationRequest } from "./analysis-request-origin";
import { AnalysisResultEntity } from "./analysis-result.entity";
import {
  requireExplicitAiEngines,
  type AiAnalysisRequestListQuery,
} from "./ai-analysis-input";
import type { AiAnalysisRequest } from "./ai-analysis-request";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";
import { AiAnalysisDocumentsAccessClient } from "./documents-access.client";
import { AiAnalysisProjectsAccessClient } from "./projects-access.client";
import { AiAnalysisSourcesAccessClient } from "./sources-access.client";
import { parseAiAnalysisDraft } from "../execution/ai-analysis-draft";
import {
  isLocalOnlyV2DocumentResult,
  parseLocalOnlyV2PersistedDocumentResult,
} from "../execution/local-only-v2-document-result";
import { normalizeLocalOnlyV2Sections } from "../execution/local-only-v2-backlog-alignment";
import { isPrototypeRequested } from "../execution/prototype-request-brief";
import { AiAnalysisQueue } from "../execution/ai-analysis.queue";
import {
  AiAnalysisExecutionService,
  resolveAppliedRequirementSectionKey,
} from "../execution/ai-analysis-execution.service";
import {
  cloudGenerationProgress,
  localDraftGenerationProgress,
  localSourceAnalysisProgress,
} from "./ai-analysis-real-progress";
import {
  buildAiAnalysisPrompt,
  estimateAiPromptTokens,
} from "../execution/ai-prompt-builder";
import { AiProviderConfigurationEntity } from "../providers/ai-provider-configuration.entity";
import {
  LOCAL_AI_CONFIG,
  loadLocalAiConfig,
  type LocalAiConfig,
} from "../local-ai/ollama.config";
import { SourceLocalAnalysisEntity } from "../local-ai/source-local-analysis.entity";
import { Inject } from "@nestjs/common";
import { LocalSourceAnalysisQueue } from "../local-ai/local-source-analysis.queue";
import { ProjectKnowledgeSnapshotEntity } from "../local-ai/project-knowledge-snapshot.entity";
import {
  LOCAL_AI_PROMPT_VERSION,
  type ProjectKnowledgeSnapshot,
} from "../local-ai/local-ai-output";
import {
  buildAiAnalysisPromptFromKnowledgeSnapshot,
  buildHybridCloudPromptFromKnowledgeSnapshot,
  resolveLocalPromptVersion,
} from "../local-ai/local-ai-pipeline.service";
import { LocalAiSettingsService } from "../local-ai/local-ai-settings.service";
import { AiUsageGuardService } from "../security/ai-usage-guard.service";
import { AiSecurityAuditEntity } from "../security/ai-security-audit.entity";

export interface AiAnalysisActorContext {
  actor: NonNullable<AiAnalysisRequest["authPrincipal"]>;
  accessToken: string;
  correlationId: string;
}

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function externalDate(value: string, field: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.valueOf())) {
    throw new BadGatewayException(
      `${field} recibido desde otro servicio no es válido.`,
    );
  }

  return date;
}

function isExplicitLocalOnly(engines: readonly string[] | undefined): boolean {
  return engines?.length === 1 && engines[0] === "LOCAL";
}

function requireLocalOnlyConversationSources(
  sources: readonly SourceDetail[],
): void {
  const invalid = sources.find(
    (source) =>
      source.sourceType !== "CONVERSATION" ||
      !(source.extractedText ?? source.content ?? "").trim(),
  );

  if (invalid) {
    throw new ConflictException(
      `LOCAL_ONLY_V2 solo admite fuentes textuales de tipo conversación. La fuente "${invalid.title}" no es compatible.`,
    );
  }
}

@Injectable()
export class AiAnalysisService implements OnModuleInit {
  constructor(
    @InjectRepository(AnalysisRequestEntity)
    private readonly requests: Repository<AnalysisRequestEntity>,
    @InjectRepository(AnalysisRequestSourceEntity)
    private readonly requestSources: Repository<AnalysisRequestSourceEntity>,
    @InjectRepository(AnalysisExecutionEntity)
    private readonly executions: Repository<AnalysisExecutionEntity>,
    @InjectRepository(AnalysisResultEntity)
    private readonly results: Repository<AnalysisResultEntity>,
    private readonly dataSource: DataSource,
    private readonly projectsAccess: AiAnalysisProjectsAccessClient,
    private readonly documentsAccess: AiAnalysisDocumentsAccessClient,
    private readonly sourcesAccess: AiAnalysisSourcesAccessClient,
    private readonly queue: AiAnalysisQueue,
    private readonly events: IntegrationEventsPublisher,
    @Optional()
    @Inject(LOCAL_AI_CONFIG)
    private readonly localAiConfig: LocalAiConfig = loadLocalAiConfig(),
    @Optional()
    private readonly localSourceQueue: LocalSourceAnalysisQueue | null = null,
    @Optional()
    @Inject(LocalAiSettingsService)
    private readonly localAiSettings: LocalAiSettingsService | null = null,
    @Optional() private readonly usageGuard: AiUsageGuardService | null = null,
    @Optional()
    @InjectRepository(AiSecurityAuditEntity)
    private readonly securityAudits: Repository<AiSecurityAuditEntity> | null = null,
    // El tipo `X | null` se compila como `Object`: sin @Inject explícito Nest no
    // resuelve el servicio y lo entrega como null, y el avance por puntos de la
    // IA local nunca se leía (la pantalla se quedaba en 5 %).
    @Optional()
    @Inject(AiAnalysisExecutionService)
    private readonly executionService: AiAnalysisExecutionService | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverOrphanedRequests();
  }

  private async recoverOrphanedRequests(): Promise<void> {
    const candidates = await this.requests.find({
      where: { status: In(["PENDING", "PROCESSING"]) },
      order: { createdAt: "ASC" },
    });

    for (const request of candidates) {
      try {
        if (await this.queue.hasRunnableJob(request.id)) continue;

        const recoveryDiscriminator =
          `recovery-${request.status.toLowerCase()}-` +
          request.updatedAt.valueOf();

        if (request.status === "PROCESSING") {
          const [latestExecution] = await this.executions.find({
            where: { analysisRequestId: request.id },
            order: { attempt: "DESC" },
            take: 1,
          });
          const now = new Date();
          await this.dataSource.transaction(async (manager) => {
            if (
              latestExecution?.status === "PROCESSING" &&
              latestExecution.startedAt
            ) {
              await manager.update(
                AnalysisExecutionEntity,
                latestExecution.id,
                {
                  status: "FAILED",
                  finishedAt: now,
                  durationMs: String(
                    now.valueOf() - latestExecution.startedAt.valueOf(),
                  ),
                  errorCode: "AI_EXECUTION_INTERRUPTED",
                  errorMessage:
                    "La ejecución perdió su trabajo BullMQ y fue recuperada de forma segura.",
                },
              );
            }
            await manager.update(AnalysisRequestEntity, request.id, {
              status: "PENDING",
              errorCode: null,
              errorMessage: null,
              updatedAt: now,
            });
          });
        }

        await this.queue.enqueue(request.id, request.id, recoveryDiscriminator);
      } catch {
        await this.requests.update(request.id, {
          status: "FAILED",
          errorCode: "AI_QUEUE_UNAVAILABLE",
          errorMessage:
            "La solicitud quedó sin trabajo activo en la cola y no pudo recuperarse.",
          updatedAt: new Date(),
        });
      }
    }
  }

  async create(
    context: AiAnalysisActorContext,
    projectId: string,
    input: CreateAiAnalysisRequest,
  ): Promise<AiAnalysisRequestDetail> {
    // Sin motores explícitos no se decide nada: nunca se asume nube ni local.
    const engines = requireExplicitAiEngines(input.engines);
    const requestedIdempotencyKey = input.idempotencyKey?.trim();
    if (requestedIdempotencyKey) {
      const existing = await this.requests.findOneBy({
        projectId,
        idempotencyKey: requestedIdempotencyKey,
      });
      if (existing) return this.loadDetail(projectId, existing.id);
    }

    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const document = await this.documentsAccess.requireCurrentVersion(
      projectId,
      input.documentId,
      input.documentVersionId,
      context.accessToken,
      context.correlationId,
    );
    const localOnly = isExplicitLocalOnly(engines);
    const sources = await this.sourcesAccess.requireReadySources(
      projectId,
      input.sourceIds,
      context.accessToken,
      context.correlationId,
      !localOnly,
    );
    if (localOnly) requireLocalOnlyConversationSources(sources);

    const now = new Date();
    const analysisRequestId = randomUUID();
    const idempotencyKey = requestedIdempotencyKey ?? analysisRequestId;
    const useLocalAi = engines.includes("LOCAL");
    const useCloudAi = engines.includes("CLOUD");
    const providerSnapshots: SelectedProviderSnapshots = {};
    for (const engine of ["LOCAL", "CLOUD"] as const) {
      const selectedId = input.providerSelections?.[engine];
      if (!selectedId || !(engine === "LOCAL" ? useLocalAi : useCloudAi))
        continue;
      const provider = await resolveSelectedProvider(
        this.dataSource.getRepository(AiProviderConfigurationEntity),
        engine,
        selectedId,
      );
      providerSnapshots[engine] = {
        id: provider.id,
        model: provider.model,
        baseUrl: provider.baseUrl,
      };
    }
    const estimatedTokens =
      sources.reduce(
        (total, source) =>
          total +
          Math.ceil((source.extractedText ?? source.content ?? "").length / 4),
        0,
      ) + 12_000;
    try {
      await this.usageGuard?.reserve({
        requestId: analysisRequestId,
        userId: context.actor.id,
        projectId,
        estimatedTokens,
        estimatedCostUsd: useCloudAi
          ? Math.max(0.25, (estimatedTokens * 15) / 1_000_000)
          : 0,
      });
    } catch (error) {
      const response =
        error instanceof HttpException ? error.getResponse() : null;
      const code =
        response && typeof response === "object" && "code" in response
          ? String(response.code).slice(0, 80)
          : "AI_USAGE_REJECTED";
      await this.securityAudits?.save(
        this.securityAudits.create({
          eventType: "AI_USAGE_BLOCKED",
          actorUserId: context.actor.id,
          projectId,
          executionId: null,
          code,
          detailJson: JSON.stringify({ estimatedTokens }),
          createdAt: new Date(),
        }),
      );
      throw error;
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.save(
          manager.create(AnalysisRequestEntity, {
            id: analysisRequestId,
            projectId,
            documentId: input.documentId,
            documentVersionId: input.documentVersionId,
            analysisType: input.analysisType ?? "REQUIREMENT_DOCUMENT",
            purpose: input.purpose ?? "INITIAL_DRAFT",
            instruction: input.instruction ?? null,
            useLocalAi,
            useCloudAi,
            providerSelectionsJson: JSON.stringify(providerSnapshots),
            idempotencyKey,
            generatedVersionNumber: document.currentVersionDetail.versionNumber,
            generatedVersion: document.currentVersionDetail.version,
            status: "PENDING",
            requestedByUserId: context.actor.id,
            documentSnapshotJson: JSON.stringify(document),
            errorCode: null,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
            cancelledAt: null,
          }),
        );

        await manager.save(
          AnalysisRequestSourceEntity,
          sources.map((source, index) => ({
            id: randomUUID(),
            analysisRequestId,
            sourceId: source.id,
            sourceUpdatedAt: externalDate(
              source.updatedAt,
              `updatedAt de la fuente ${source.id}`,
            ),
            sourceSha256: source.sha256,
            sourceTitle: source.title,
            sourceClassification: source.classification,
            sourceMediaType: source.mediaType,
            sourceFileExtension: source.fileExtension,
            snapshotText: source.extractedText ?? source.content ?? "",
            position: index + 1,
            createdAt: now,
          })),
        );
      });
    } catch (error) {
      const existing = await this.requests.findOneBy({
        projectId,
        idempotencyKey,
      });
      await this.usageGuard?.release({
        requestId: analysisRequestId,
        userId: context.actor.id,
        projectId,
      });
      if (existing) return this.loadDetail(projectId, existing.id);
      throw error;
    }

    try {
      await this.queue.enqueue(analysisRequestId, context.correlationId);
    } catch {
      await this.usageGuard?.release({
        requestId: analysisRequestId,
        userId: context.actor.id,
        projectId,
      });
      await this.requests.update(analysisRequestId, {
        status: "FAILED",
        errorCode: "AI_QUEUE_UNAVAILABLE",
        errorMessage:
          "La cola de análisis no está disponible. Puedes reintentarlo.",
        updatedAt: new Date(),
      });
      throw new ServiceUnavailableException(
        "La solicitud fue registrada, pero la cola de análisis no está disponible. Puedes reintentarlo.",
      );
    }

    await this.events.publish({
      eventName: "analysis.requested",
      correlationId: context.correlationId,
      data: {
        projectId,
        analysisRequestId,
        documentId: input.documentId,
        documentVersionId: input.documentVersionId,
        requestedByUserId: context.actor.id,
      },
    });

    return this.loadDetail(projectId, analysisRequestId);
  }

  async estimateTokens(
    context: AiAnalysisActorContext,
    projectId: string,
    input: AiAnalysisTokenEstimateRequest,
  ): Promise<AiAnalysisTokenEstimateResponse> {
    const requestedEngines = requireExplicitAiEngines(input.engines);
    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    const localOnly = isExplicitLocalOnly(requestedEngines);
    const estimateEngine = requestedEngines.includes("CLOUD")
      ? "CLOUD"
      : "LOCAL";
    const selectedEstimateProviderId =
      input.providerSelections?.[estimateEngine];
    const [document, sources, provider] = await Promise.all([
      this.documentsAccess.requireCurrentDocumentForEstimate(
        projectId,
        input.documentId,
        context.accessToken,
        context.correlationId,
      ),
      this.sourcesAccess.requireReadySources(
        projectId,
        input.sourceIds,
        context.accessToken,
        context.correlationId,
        !localOnly,
      ),
      selectedEstimateProviderId
        ? resolveSelectedProvider(
            this.dataSource.getRepository(AiProviderConfigurationEntity),
            estimateEngine,
            selectedEstimateProviderId,
          )
        : this.dataSource
            .getRepository(AiProviderConfigurationEntity)
            .findOneBy({
              providerType: requestedEngines.includes("CLOUD")
                ? "OPENAI"
                : "OLLAMA",
              isEnabled: true,
              isDefault: true,
            }),
    ]);

    if (localOnly) requireLocalOnlyConversationSources(sources);

    if (!provider) {
      throw new ConflictException(
        "No hay un proveedor de IA habilitado y predeterminado para calcular el límite de entrada.",
      );
    }

    const snapshotSources = sources.map((source, index) =>
      this.requestSources.create({
        sourceId: source.id,
        sourceTitle: source.title,
        sourceClassification: source.classification,
        sourceMediaType: source.mediaType,
        sourceFileExtension: source.fileExtension,
        sourceSha256: source.sha256,
        snapshotText: source.extractedText ?? source.content ?? "",
        position: index + 1,
      }),
    );
    const prompt = buildAiAnalysisPrompt(
      document,
      snapshotSources,
      null,
      input.purpose ?? "AI_VERSION",
    );
    const estimatedInputTokens = estimateAiPromptTokens(prompt);
    const originalTokens = snapshotSources.reduce(
      (total, source) =>
        total + estimateAiPromptTokens(source.snapshotText ?? ""),
      0,
    );
    const effectiveLocalConfig = requestedEngines.includes("LOCAL")
      ? this.localAiSettings
        ? await this.localAiSettings.resolve(input.providerSelections?.LOCAL)
        : this.localAiConfig
      : { ...this.localAiConfig, enabled: false };
    // AI_ANALYSIS_ESTIMATE_CACHE_IDENTITY_V1
    // La ejecución real (local-ai-pipeline.service.ts) solo reutiliza un
    // análisis o snapshot cuando coinciden sourceSha256 y promptVersion,
    // además de sourceId/model. El estimado debe validar la misma identidad
    // de caché; de lo contrario una fuente editada que conserva su ID puede
    // mostrar una cifra basada en contenido obsoleto.
    const promptVersion = resolveLocalPromptVersion(
      prompt,
      // Misma identidad de caché que la ejecución: LOCAL_ONLY y LOCAL_CLOUD
      // usan el perfil compacto (AI_ANALYSIS_HYBRID_COMPACT_PREANALYSIS_V1).
      requestedEngines.includes("LOCAL") ? "LOCAL_EXTRACT" : "DEFAULT",
    );
    const localAnalyses = this.dataSource.getRepository(
      SourceLocalAnalysisEntity,
    );
    const cachedLocal = effectiveLocalConfig.enabled
      ? (
          await Promise.all(
            snapshotSources.map((source) =>
              localAnalyses.findOneBy({
                sourceId: source.sourceId,
                sourceSha256:
                  source.sourceSha256 ??
                  createHash("sha256")
                    .update(source.snapshotText ?? "")
                    .digest("hex"),
                model: effectiveLocalConfig.model,
                promptVersion,
                status: "COMPLETED",
              }),
            ),
          )
        ).filter((entity): entity is SourceLocalAnalysisEntity => Boolean(entity))
      : [];
    const localAnalysisTokens =
      cachedLocal.length === snapshotSources.length
        ? cachedLocal.reduce(
            (sum, item) => sum + Number(item.estimatedAnalysisTokens ?? 0),
            0,
          )
        : null;
    const requestedSourceIds = [
      ...snapshotSources.map((source) => source.sourceId),
    ].sort();
    const snapshotEntities = effectiveLocalConfig.enabled
      ? await this.dataSource
          .getRepository(ProjectKnowledgeSnapshotEntity)
          .find({
            where: {
              projectId,
              model: effectiveLocalConfig.model,
              promptVersion,
            },
            order: { createdAt: "DESC" },
            take: 20,
          })
      : [];
    const knowledgeSnapshot =
      snapshotEntities
        .map(
          (entity) =>
            JSON.parse(entity.snapshotJson) as ProjectKnowledgeSnapshot,
        )
        .find(
          (candidate) =>
            [...candidate.sourceIds].sort().join("|") ===
            requestedSourceIds.join("|"),
        ) ?? null;
    const openAiPrompt = knowledgeSnapshot
      ? requestedEngines.includes("LOCAL") && requestedEngines.includes("CLOUD")
        ? buildHybridCloudPromptFromKnowledgeSnapshot(prompt, knowledgeSnapshot)
        : buildAiAnalysisPromptFromKnowledgeSnapshot(prompt, knowledgeSnapshot)
      : prompt;
    const openAiInputTokens = estimateAiPromptTokens(openAiPrompt);
    const effectiveInputTokens = knowledgeSnapshot
      ? openAiInputTokens
      : estimatedInputTokens;
    const maxInputTokens = provider.maxInputTokens;
    const usagePercentage =
      Math.round((effectiveInputTokens / maxInputTokens) * 10_000) / 100;

    return {
      sourceCount: snapshotSources.length,
      promptCharacters: openAiPrompt.length,
      estimatedInputTokens: effectiveInputTokens,
      maxInputTokens,
      remainingTokens: Math.max(0, maxInputTokens - effectiveInputTokens),
      usagePercentage,
      canProcess: effectiveInputTokens <= maxInputTokens,
      model: provider.model,
      estimateMethod: "CHARACTERS_DIVIDED_BY_4",
      originalTokens,
      localAnalysisTokens,
      consolidatedTokens: knowledgeSnapshot?.estimatedSnapshotTokens ?? null,
      reductionPercentage:
        !knowledgeSnapshot || originalTokens === 0
          ? null
          : knowledgeSnapshot.reductionPercentage,
      openAiInputTokens,
      openAiOutputTokens: null,
    };
  }

  async retry(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const entity = await this.requireRequest(projectId, analysisRequestId);
    if (entity.status !== "FAILED") {
      throw new ConflictException(
        "Solo una solicitud FAILED puede reintentarse.",
      );
    }
    const existingResult = await this.results.findOneBy({ analysisRequestId });
    if (existingResult?.status === "ACCEPTED") {
      return this.loadDetail(projectId, analysisRequestId);
    }
    if (existingResult?.status === "REJECTED") {
      throw new ConflictException(
        "Un resultado rechazado no puede aplicarse nuevamente.",
      );
    }
    if (!existingResult) {
      const retrySources = await this.requestSources.find({
        where: { analysisRequestId },
      });
      const retryEstimatedTokens = retrySources.reduce(
        (total, source) =>
          total + Math.ceil((source.snapshotText ?? "").length / 4),
        12_000,
      );
      await this.usageGuard?.reserve({
        requestId: analysisRequestId,
        userId: entity.requestedByUserId,
        projectId,
        estimatedTokens: retryEstimatedTokens,
        estimatedCostUsd: entity.useCloudAi
          ? Math.max(0.25, (retryEstimatedTokens * 15) / 1_000_000)
          : 0,
      });
    }
    entity.status = "PENDING";
    entity.errorCode = null;
    entity.errorMessage = null;
    entity.updatedAt = new Date();
    await this.requests.save(entity);
    try {
      await this.queue.enqueue(
        analysisRequestId,
        context.correlationId,
        `retry-${Date.now()}`,
      );
    } catch {
      await this.usageGuard?.release({
        requestId: analysisRequestId,
        userId: entity.requestedByUserId,
        projectId,
      });
      entity.status = "FAILED";
      entity.errorCode = "AI_QUEUE_UNAVAILABLE";
      entity.errorMessage = "La cola de análisis no está disponible.";
      entity.updatedAt = new Date();
      await this.requests.save(entity);
      throw new ServiceUnavailableException(
        "La cola de análisis no está disponible.",
      );
    }
    return this.loadDetail(projectId, analysisRequestId);
  }

  async purgeProject(
    context: AiAnalysisActorContext,
    projectId: string,
  ): Promise<ProjectDomainPurgeResult> {
    const access = await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    if (access.role !== "ADMIN" && access.role !== "OWNER") {
      throw new ForbiddenException(
        "Solo ADMIN o el propietario pueden eliminar todos los análisis.",
      );
    }
    const count = await this.requests.countBy({ projectId });
    if (count > 0) await this.requests.delete({ projectId });
    return { deleted: true, count };
  }

  async acceptResult(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
    input: ReviewAiAnalysisResult,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const request = await this.requireRequest(projectId, analysisRequestId);
    const result = await this.results.findOneBy({ analysisRequestId });
    if (!result)
      throw new ConflictException(
        "La solicitud no tiene un resultado para revisar.",
      );
    if (result.status === "ACCEPTED")
      return this.loadDetail(projectId, analysisRequestId);
    if (result.status !== "GENERATED") {
      throw new ConflictException(
        "Solo un resultado GENERATED puede aceptarse.",
      );
    }
    if (!input.expectedDocumentRevision) {
      throw new ConflictException(
        "expectedDocumentRevision es obligatorio para aceptar.",
      );
    }

    const document = await this.documentsAccess.requireCurrentVersion(
      projectId,
      request.documentId,
      request.documentVersionId,
      context.accessToken,
      context.correlationId,
    );
    const persisted: unknown = JSON.parse(result.contentJson);
    if (isLocalOnlyV2DocumentResult(persisted)) {
      const sources = await this.requestSources.find({ where: { analysisRequestId } });
      const snapshotDraft = this.parseDynamicResult(
        persisted,
        request,
        sources,
      );
      const draft = parseLocalOnlyV2PersistedDocumentResult(
        snapshotDraft,
        document,
      );
      const editable = [...document.currentVersionDetail.sections].sort(
        (left, right) => left.order - right.order,
      );
      const editableKeys = new Set<string>(
        editable.map((section) => section.key),
      );
      const sections = draft.sections.filter((section) =>
        editableKeys.has(section.key),
      );
      if (
        sections.length !== editable.length ||
        sections.some((section, index) => section.key !== editable[index]?.key)
      ) {
        throw new ConflictException(
          "LOCAL_ONLY_V2 no coincide con las secciones del documento.",
        );
      }
      await this.documentsAccess.applyAiDraft(
        request.documentId,
        document.currentVersionNumber,
        {
          expectedRevision: input.expectedDocumentRevision,
          analysisRequestId,
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
              note: "Evidencia del punto LOCAL_ONLY_V2 aceptada por un usuario; requiere revisión humana.",
            })),
          ),
        },
        context.accessToken,
        context.correlationId,
      );
    } else {
      const draft = parseAiAnalysisDraft(persisted);
      const availableSectionKeys = new Set(
        document.currentVersionDetail.sections.map((section) => section.key),
      );
      const requirements = draft.requirements.map((requirement) => ({
        ...requirement,
        sectionKey: resolveAppliedRequirementSectionKey(
          requirement.sectionKey,
          availableSectionKeys,
        ),
      }));
      await this.documentsAccess.applyAiDraft(
        request.documentId,
        document.currentVersionNumber,
        {
          expectedRevision: input.expectedDocumentRevision,
          analysisRequestId,
          analysisResultId: result.id,
          sections: draft.sections
            .filter(
              (section) =>
                ![
                  "writingRules",
                  "visualFormat",
                  "automationInstruction",
                ].includes(section.key),
            )
            .map((section) => ({
              key: section.key,
              content: section.content,
            })),
          requirements: requirements.map((requirement, index) => ({
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
          evidence: requirements.flatMap((requirement) =>
            requirement.sourceIds.map((sourceId) => ({
              sourceId,
              sectionKey: requirement.sectionKey,
              requirementClientId: requirement.clientId,
              note: "Trazabilidad propuesta por el análisis de IA y aceptada por un usuario.",
            })),
          ),
        },
        context.accessToken,
        context.correlationId,
      );
    }

    result.status = "ACCEPTED";
    result.reviewedByUserId = context.actor.id;
    result.reviewedAt = new Date();
    result.reviewComment = input.comment ?? null;
    result.updatedAt = result.reviewedAt;
    await this.results.save(result);
    return this.loadDetail(projectId, analysisRequestId);
  }

  async rejectResult(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
    input: ReviewAiAnalysisResult,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const result = await this.results.findOneBy({ analysisRequestId });
    if (!result)
      throw new ConflictException(
        "La solicitud no tiene un resultado para revisar.",
      );
    if (result.status === "REJECTED")
      return this.loadDetail(projectId, analysisRequestId);
    if (result.status !== "GENERATED") {
      throw new ConflictException(
        "Solo un resultado GENERATED puede rechazarse.",
      );
    }
    if (!input.comment) {
      throw new ConflictException(
        "El comentario es obligatorio para rechazar.",
      );
    }
    result.status = "REJECTED";
    result.reviewedByUserId = context.actor.id;
    result.reviewedAt = new Date();
    result.reviewComment = input.comment;
    result.updatedAt = result.reviewedAt;
    await this.results.save(result);
    return this.loadDetail(projectId, analysisRequestId);
  }

  async list(
    context: AiAnalysisActorContext,
    projectId: string,
    query: AiAnalysisRequestListQuery,
  ): Promise<AiAnalysisRequestListResponse> {
    await this.projectsAccess.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    const builder = this.requests
      .createQueryBuilder("analysisRequest")
      .where("analysisRequest.ProjectId = :projectId", { projectId });

    if (query.status) {
      builder.andWhere("analysisRequest.Status = :status", {
        status: query.status,
      });
    }

    const totalItems = await builder.getCount();
    const rows = await builder
      .clone()
      .orderBy("analysisRequest.CreatedAt", "DESC")
      .addOrderBy("analysisRequest.Id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getMany();

    const items = await Promise.all(
      rows.map(async (row) => {
        const [sourceCount, executions] = await Promise.all([
          this.requestSources.countBy({ analysisRequestId: row.id }),
          this.executions.find({
            where: { analysisRequestId: row.id },
            order: { attempt: "DESC" },
          }),
        ]);
        return this.toSummary(
          row,
          sourceCount,
          executions.length,
          executions[0] ?? null,
        );
      }),
    );

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    };
  }

  async getById(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    return this.loadDetail(projectId, analysisRequestId);
  }

  async getPrompt(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisPromptDetail> {
    await this.projectsAccess.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    const request = await this.requireRequest(projectId, analysisRequestId);

    if (!isSourcesGenerationRequest(request)) {
      throw new NotFoundException(
        "El prompt solo está disponible para solicitudes iniciadas desde Fuentes.",
      );
    }

    if (
      (request.status !== "COMPLETED" && request.status !== "FAILED") ||
      !request.documentSnapshotJson
    ) {
      throw new NotFoundException(
        "El prompt todavía no está disponible para esta solicitud.",
      );
    }

    const sources = await this.requestSources.find({
      where: { analysisRequestId },
      order: { position: "ASC" },
    });
    const document = JSON.parse(
      request.documentSnapshotJson,
    ) as RequirementDocumentDetail;
    const promptText = buildAiAnalysisPrompt(
      document,
      sources,
      request.instruction,
      request.purpose,
    );
    const [latestExecution] = await this.executions.find({
      where: { analysisRequestId },
      order: { attempt: "DESC" },
      take: 1,
    });

    const failureStage =
      request.errorCode === "AI_CONFIGURATION_REQUIRED"
        ? "Preparación y configuración de la ejecución"
        : request.errorCode?.startsWith("AI_AUTO_APPLY_") ||
            latestExecution?.status === "COMPLETED"
          ? "Aplicación del resultado al documento"
          : "Ejecución y validación de la respuesta de IA";

    return {
      analysisRequestId: request.id,
      purpose: request.purpose,
      generatedVersion: request.generatedVersion,
      status: request.status,
      estimatedInputTokens: Math.ceil(promptText.length / 4),
      failure:
        request.status === "FAILED" && request.errorCode && request.errorMessage
          ? {
              code: request.errorCode,
              message: request.errorMessage,
              stage: failureStage,
              attempt: latestExecution?.attempt ?? null,
              provider: latestExecution?.provider ?? null,
              model: latestExecution?.model ?? null,
              startedAt: latestExecution
                ? optionalIso(latestExecution.startedAt)
                : null,
              finishedAt: latestExecution
                ? optionalIso(latestExecution.finishedAt)
                : null,
              durationMs: latestExecution?.durationMs ?? null,
              inputTokens: latestExecution?.inputTokens ?? null,
              outputTokens: latestExecution?.outputTokens ?? null,
              providerRequestId: latestExecution?.providerRequestId ?? null,
            }
          : null,
      prompt: promptText,
      createdAt: iso(request.createdAt),
    };
  }

  async cancel(
    context: AiAnalysisActorContext,
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireCancel(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    const entity = await this.requireRequest(projectId, analysisRequestId);

    const alreadyCancelled = entity.status === "CANCELLED";
    if (
      !alreadyCancelled &&
      entity.status !== "PENDING" &&
      entity.status !== "PROCESSING"
    ) {
      throw new ConflictException(
        "Solo una solicitud pendiente o en procesamiento puede cancelarse.",
      );
    }

    if (!alreadyCancelled) {
      const now = new Date();
      const result = await this.requests
        .createQueryBuilder()
        .update(AnalysisRequestEntity)
        .set({
          status: "CANCELLED",
          cancelledAt: now,
          updatedAt: now,
        })
        .where("Id = :analysisRequestId", { analysisRequestId })
        .andWhere("ProjectId = :projectId", { projectId })
        .andWhere("Status IN (:...statuses)", {
          statuses: ["PENDING", "PROCESSING"],
        })
        .execute();

      if (result.affected !== 1) {
        throw new ConflictException(
          "La solicitud cambió de estado antes de ser cancelada.",
        );
      }
    }

    const cancellation = await this.queue.cancel(analysisRequestId);
    if (!cancellation.active) {
      await this.usageGuard?.release({
        requestId: analysisRequestId,
        userId: entity.requestedByUserId,
        projectId,
      });
    }

    if (this.localSourceQueue) {
      const sources = await this.requestSources.find({
        where: { analysisRequestId },
      });
      await Promise.all(
        sources.map((source) => this.localSourceQueue?.cancel(source.id)),
      );
    }

    return this.loadDetail(projectId, analysisRequestId);
  }

  private async loadDetail(
    projectId: string,
    analysisRequestId: string,
  ): Promise<AiAnalysisRequestDetail> {
    const request = await this.requireRequest(projectId, analysisRequestId);
    const [sources, executions, result] = await Promise.all([
      this.requestSources.find({
        where: { analysisRequestId },
        order: { position: "ASC" },
      }),
      this.executions.find({
        where: { analysisRequestId },
        order: { attempt: "ASC" },
      }),
      this.results.findOneBy({ analysisRequestId }),
    ]);
    /*
     * PASO_3_API_PROGRESO_BLOQUES_V1
     *
     * Los checkpoints persistentes son la fuente real de avance de LOCAL_ONLY.
     * El orden/número/título vienen del mapeo dinámico de la plantilla.
     */
    const localDraftBlocks =
      request.useLocalAi && this.executionService
        ? await this.executionService.getLocalDraftBlockProgress(
            analysisRequestId,
          )
        : [];

    const processing = await this.resolveProcessingDetail(
      request,
      sources,
      executions,
      result,
      localDraftBlocks,
    );
    const currentLocalDraftBlock =
      localDraftBlocks.find((block) => block.status === "PROCESSING") ??
      localDraftBlocks.find(
        (block) => block.status === "FAILED" || block.status === "CANCELLED",
      ) ??
      null;

    return {
      ...this.toSummary(
        request,
        sources.length,
        executions.length,
        executions.at(-1) ?? null,
      ),
      sources: sources.map((source) => this.toSource(source)),
      executions: executions.map((execution) => this.toExecution(execution)),
      result: result ? this.toResult(result, request, sources) : null,
      processing: {
        ...processing,
        localDraftBlocks,
        currentLocalDraftBlock,
      },
    };
  }

  private async resolveProcessingDetail(
    request: AnalysisRequestEntity,
    sources: readonly AnalysisRequestSourceEntity[],
    executions: readonly AnalysisExecutionEntity[],
    result: AnalysisResultEntity | null,
    localDraftBlocks: Awaited<
      ReturnType<AiAnalysisExecutionService["getLocalDraftBlockProgress"]>
    >,
  ): Promise<AiAnalysisProcessingDetail> {
    const selectedLocal = readProviderSnapshots(
      request.providerSelectionsJson,
    ).LOCAL;
    const provider = await this.dataSource
      .getRepository(AiProviderConfigurationEntity)
      .findOne({
        where: {
          providerType: In(["OLLAMA", "OPENAI_COMPATIBLE"]),
          isEnabled: true,
          ...(selectedLocal ? { id: selectedLocal.id } : { isDefault: true }),
        },
      });
    const snapshot = await this.dataSource
      .getRepository(ProjectKnowledgeSnapshotEntity)
      .findOneBy({ analysisRequestId: request.id });
    // La disponibilidad global de Ollama no significa que esta solicitud lo
    // haya seleccionado. Una ejecución exclusiva de nube no debe consultar ni
    // mostrar avance, caché o etapas de IA local.
    const localTotalSources =
      request.useLocalAi && provider ? sources.length : 0;
    const candidates =
      request.useLocalAi && provider && sources.length > 0
        ? await this.dataSource.getRepository(SourceLocalAnalysisEntity).find({
            where: {
              sourceId: In(sources.map((source) => source.sourceId)),
              model: provider.model,
            },
          })
        : [];
    const expectedHashes = new Map(
      sources.map((source) => [
        source.sourceId.toLowerCase(),
        source.sourceSha256 ??
          createHash("sha256")
            .update(source.snapshotText ?? "")
            .digest("hex"),
      ]),
    );

    /*
     * LOCAL_AI_PROGRESS_REAL_V4_5
     *
     * El avance visible solo usa análisis compatibles con el SHA actual y
     * con la versión local vigente. Cuando la solicitud ya produjo actividad,
     * se fija además el promptVersion exacto de esa ejecución.
     */
    const compatibleByBaseVersion = candidates.filter(
      (analysis) =>
        analysis.promptVersion.startsWith(LOCAL_AI_PROMPT_VERSION) &&
        expectedHashes.get(analysis.sourceId.toLowerCase()) ===
          analysis.sourceSha256,
    );
    const currentRunAnalyses = compatibleByBaseVersion
      .filter((analysis) => analysis.updatedAt >= request.createdAt)
      .sort(
        (left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf(),
      );
    const currentPromptVersion =
      currentRunAnalyses.at(0)?.promptVersion ??
      [...compatibleByBaseVersion]
        .sort(
          (left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf(),
        )
        .at(0)?.promptVersion ??
      null;
    const compatible = currentPromptVersion
      ? compatibleByBaseVersion.filter(
          (analysis) => analysis.promptVersion === currentPromptVersion,
        )
      : compatibleByBaseVersion;
    const completed = compatible.filter(
      (analysis) => analysis.status === "COMPLETED",
    );
    const processing = compatible
      .filter(
        (analysis) =>
          analysis.status === "PROCESSING" &&
          analysis.updatedAt >= request.createdAt,
      )
      .sort(
        (left, right) => right.updatedAt.valueOf() - left.updatedAt.valueOf(),
      );
    const localCompletedSourceIds = [
      ...new Set(completed.map((analysis) => analysis.sourceId.toLowerCase())),
    ];
    const localProcessingSourceIds = [
      ...new Set(processing.map((analysis) => analysis.sourceId.toLowerCase())),
    ];
    const localCompletedSources = localCompletedSourceIds.length;
    const localCacheAvailable = new Set(
      completed
        .filter((analysis) => analysis.createdAt < request.createdAt)
        .map((analysis) => analysis.sourceId.toLowerCase()),
    ).size;
    const currentLocalAnalysis = processing.at(0) ?? null;
    const currentLocalSource = currentLocalAnalysis
      ? (sources.find(
          (source) =>
            source.sourceId.toLowerCase() ===
            currentLocalAnalysis.sourceId.toLowerCase(),
        ) ?? null)
      : null;
    const nextLocalSource =
      currentLocalSource ??
      sources.find(
        (source) =>
          !localCompletedSourceIds.includes(source.sourceId.toLowerCase()),
      ) ??
      null;
    const currentLocalProgress =
      currentLocalSource && currentLocalAnalysis && this.localSourceQueue && provider
        ? await this.localSourceQueue.getProgress(
            currentLocalSource,
            provider.model,
            currentLocalAnalysis.sourceSha256,
            currentLocalAnalysis.promptVersion,
          )
        : null;
    const base = {
      engines: [
        ...(request.useLocalAi ? (["LOCAL"] as const) : []),
        ...(request.useCloudAi ? (["CLOUD"] as const) : []),
      ],
      localCompletedSources,
      localTotalSources,
      localCacheAvailable,
      localSnapshotReady: Boolean(snapshot),
      localCompletedSourceIds,
      localProcessingSourceIds,
      currentLocalSourceId: nextLocalSource?.sourceId ?? null,
      currentLocalSourceTitle: nextLocalSource?.sourceTitle ?? null,
      currentLocalSourceStartedAt:
        currentLocalAnalysis?.updatedAt.toISOString() ?? null,
      localCompletedSegments: currentLocalProgress?.completedSegments ?? null,
      currentLocalSegment: currentLocalProgress?.currentSegment ?? null,
      localTotalSegments: currentLocalProgress?.totalSegments ?? null,
    };

    if (request.status === "PENDING") {
      return {
        ...base,
        stage: "QUEUED",
        label:
          localTotalSources > 0
            ? request.useCloudAi
              ? "En cola: preparando análisis local y generación en nube…"
              : "En cola: preparando análisis y generación local…"
            : "En cola: preparando generación directa con IA en nube…",
        progress: 5,
      };
    }
    if (request.status === "COMPLETED") {
      return {
        ...base,
        stage: "COMPLETED",
        label: "Borrador generado y aplicado.",
        progress: 100,
      };
    }
    if (request.status === "CANCELLED") {
      return {
        ...base,
        stage: "CANCELLED",
        label: "Generación cancelada.",
        progress: snapshot ? 92 : 5,
      };
    }
    if (request.status === "FAILED") {
      const localProgress =
        localTotalSources > 0
          ? localSourceAnalysisProgress(
              localCompletedSources,
              localTotalSources,
              base.localCompletedSegments,
              base.localTotalSegments,
            )
          : 5;
      return {
        ...base,
        stage: "FAILED",
        label: request.errorMessage ?? "La generación terminó con error.",
        progress: snapshot ? 92 : Math.min(45, localProgress),
      };
    }
    if (localDraftBlocks.length === 0 && localTotalSources > 0 && localCompletedSources < localTotalSources) {
      return {
        ...base,
        stage: "LOCAL_AI_ANALYSIS",
        label: `IA local: analizando ${localCompletedSources}/${localTotalSources} fuentes…`,
        progress: localSourceAnalysisProgress(
          localCompletedSources,
          localTotalSources,
          base.localCompletedSegments,
          base.localTotalSegments,
        ),
      };
    }
    if (localDraftBlocks.length === 0 && localTotalSources > 0 && !snapshot) {
      return {
        ...base,
        stage: "LOCAL_AI_CONSOLIDATION",
        label: `IA local: ${localCompletedSources}/${localTotalSources} fuentes analizadas; consolidando el conocimiento…`,
        progress: 40,
      };
    }
    if (result) {
      return {
        ...base,
        stage: "OUTPUT_VALIDATION",
        label: "Validando y aplicando la respuesta de IA…",
        progress: 95,
      };
    }
    // PASO_3_PROGRESO_REAL_POR_ESTADO_V1
    //
    // No se incrementa el porcentaje por tiempo. Solo se informa avance que el
    // backend puede demostrar mediante estados/checkpoints reales.
    if (!request.useCloudAi) {
      const completedBlocks = localDraftBlocks.filter(
        (block) => block.status === "COMPLETED",
      ).length;
      const currentBlock =
        localDraftBlocks.find((block) => block.status === "PROCESSING") ?? null;
      const totalBlocks =
        currentBlock?.blockTotal ??
        localDraftBlocks.find((block) => block.blockTotal > 0)?.blockTotal ??
        localDraftBlocks.length;

      return {
        ...base,
        stage: "LOCAL_AI_GENERATION",
        label: currentBlock
          ? `IA local: procesando punto ${currentBlock.blockNumber}/${currentBlock.blockTotal} · ${currentBlock.blockLabel}`
          : totalBlocks > 0
            ? `IA local: ${completedBlocks}/${totalBlocks} puntos completados; preparando el siguiente punto…`
            : "IA local: preparando el primer punto de la plantilla…",
        progress: localDraftGenerationProgress(localDraftBlocks),
      };
    }

    const usesLocalKnowledge = localTotalSources > 0 && Boolean(snapshot);
    return {
      ...base,
      stage: "CLOUD_AI_GENERATION",
      label: usesLocalKnowledge
        ? "IA en nube: generando el documento desde el conocimiento consolidado local…"
        : "IA en nube: analizando las fuentes y generando el documento…",
      progress: cloudGenerationProgress(usesLocalKnowledge),
    };
  }

  private async requireRequest(
    projectId: string,
    analysisRequestId: string,
  ): Promise<AnalysisRequestEntity> {
    const entity = await this.requests.findOneBy({
      id: analysisRequestId,
      projectId,
    });

    if (!entity) {
      throw new NotFoundException(
        "La solicitud de análisis no existe en este proyecto.",
      );
    }

    return entity;
  }

  private toSummary(
    entity: AnalysisRequestEntity,
    sourceCount: number,
    executionCount: number,
    latestExecution: AnalysisExecutionEntity | null = null,
  ): AiAnalysisRequestSummary {
    return {
      providerSelections: Object.fromEntries(
        Object.entries(
          readProviderSnapshots(entity.providerSelectionsJson),
        ).map(([engine, provider]) => [engine, provider.id]),
      ),
      engines: [
        ...(entity.useLocalAi ? (["LOCAL"] as const) : []),
        ...(entity.useCloudAi ? (["CLOUD"] as const) : []),
      ],
      models: Object.fromEntries(
        Object.entries(
          readProviderSnapshots(entity.providerSelectionsJson),
        ).map(([engine, provider]) => [engine, provider.model]),
      ),
      provider: latestExecution?.provider ?? null,
      model: latestExecution?.model ?? null,
      id: entity.id,
      projectId: entity.projectId,
      documentId: entity.documentId,
      documentVersionId: entity.documentVersionId,
      analysisType: entity.analysisType,
      purpose: entity.purpose,
      status: entity.status,
      requestedByUserId: entity.requestedByUserId,
      generatedVersionNumber: entity.generatedVersionNumber,
      generatedVersion: entity.generatedVersion,
      sourceCount,
      executionCount,
      errorCode: entity.errorCode,
      errorMessage: entity.errorMessage,
      createdAt: iso(entity.createdAt),
      updatedAt: iso(entity.updatedAt),
      cancelledAt: optionalIso(entity.cancelledAt),
    };
  }

  private toSource(
    entity: AnalysisRequestSourceEntity,
  ): AiAnalysisRequestSourceDetail {
    return {
      id: entity.id,
      analysisRequestId: entity.analysisRequestId,
      sourceId: entity.sourceId,
      sourceUpdatedAt: iso(entity.sourceUpdatedAt),
      sourceSha256: entity.sourceSha256,
      sourceTitle: entity.sourceTitle,
      sourceClassification: entity.sourceClassification,
      position: entity.position,
      createdAt: iso(entity.createdAt),
    };
  }

  private toExecution(
    entity: AnalysisExecutionEntity,
  ): AiAnalysisExecutionDetail {
    return {
      id: entity.id,
      analysisRequestId: entity.analysisRequestId,
      attempt: entity.attempt,
      status: entity.status,
      provider: entity.provider,
      model: entity.model,
      startedAt: optionalIso(entity.startedAt),
      finishedAt: optionalIso(entity.finishedAt),
      durationMs: entity.durationMs,
      inputTokens: entity.inputTokens,
      outputTokens: entity.outputTokens,
      estimatedCost: entity.estimatedCost,
      providerRequestId: entity.providerRequestId,
      errorCode: entity.errorCode,
      errorMessage: entity.errorMessage,
      createdAt: iso(entity.createdAt),
    };
  }

  private parseDynamicResult(
    value: unknown,
    request: AnalysisRequestEntity,
    sources: readonly AnalysisRequestSourceEntity[],
  ) {
    if (
      request.useLocalAi === false ||
      request.useCloudAi !== false ||
      !request.documentSnapshotJson
    ) {
      throw new ConflictException(
        "LOCAL_ONLY_V2 requiere una solicitud LOCAL_ONLY con instantánea documental.",
      );
    }
    const document = JSON.parse(
      request.documentSnapshotJson,
    ) as RequirementDocumentDetail;
    if (
      document.projectId !== request.projectId ||
      document.id !== request.documentId ||
      document.currentVersionDetail.id !== request.documentVersionId
    ) {
      throw new ConflictException(
        "La instantánea LOCAL_ONLY_V2 no pertenece a la solicitud.",
      );
    }
    const draft = parseLocalOnlyV2PersistedDocumentResult(value, document);
    const sourceIds = new Set(sources.map((source) => source.sourceId));
    if (
      draft.sections.some((section) =>
        section.sourceIds.some((id) => !sourceIds.has(id)),
      )
    ) {
      throw new ConflictException(
        "LOCAL_ONLY_V2 referencia evidencia ajena a la solicitud.",
      );
    }
    return draft;
  }

  private toResult(
    entity: AnalysisResultEntity,
    request: AnalysisRequestEntity,
    sources: readonly AnalysisRequestSourceEntity[],
  ): AiAnalysisResultDetail {
    const persisted: unknown = JSON.parse(entity.contentJson);
    const draft = isLocalOnlyV2DocumentResult(persisted)
      ? this.parseDynamicResult(persisted, request, sources)
      : parseAiAnalysisDraft(persisted);
    return {
      id: entity.id,
      analysisRequestId: entity.analysisRequestId,
      analysisExecutionId: entity.analysisExecutionId,
      status: entity.status,
      schemaVersion: entity.schemaVersion,
      draft,
      reviewedByUserId: entity.reviewedByUserId,
      reviewedAt: optionalIso(entity.reviewedAt),
      reviewComment: entity.reviewComment,
      createdAt: iso(entity.createdAt),
      updatedAt: iso(entity.updatedAt),
    };
  }
}
