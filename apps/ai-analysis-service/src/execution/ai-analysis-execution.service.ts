import { randomUUID } from "node:crypto";

import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type { RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";
import { getRuntimeMetrics } from "@levantamiento-rq/shared-observability";

import { AnalysisExecutionEntity } from "../analysis/analysis-execution.entity";
import { AnalysisPromptVersionEntity } from "../analysis/analysis-prompt-version.entity";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";
import { AnalysisResultEntity } from "../analysis/analysis-result.entity";
import { AiAnalysisDocumentsAccessClient } from "../analysis/documents-access.client";
import { AiAnalysisServiceToken } from "../analysis/ai-analysis-service-token.service";
import {
  AI_PROVIDER_RUNTIME_CONFIG,
  type AiProviderRuntimeConfig,
} from "../providers/ai-provider.config";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import { AI_ANALYSIS_OUTPUT_SCHEMA } from "./ai-analysis-draft";
import { parseAiAnalysisDraft } from "./ai-analysis-draft";
import { buildAiAnalysisPrompt } from "./ai-prompt-builder";
import { AiProviderError } from "./ai-text-provider";
import { FakeAiProvider } from "./fake-ai.provider";
import { OpenAiResponsesProvider } from "./openai-responses.provider";

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
  if (error instanceof ConflictException) {
    return {
      code: "AI_CONFIGURATION_REQUIRED",
      message: error.message.slice(0, 2000),
      retryable: false,
    };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      code:
        status >= 500 ? "AI_AUTO_APPLY_UNAVAILABLE" : "AI_AUTO_APPLY_CONFLICT",
      message: error.message.slice(0, 2000),
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

@Injectable()
export class AiAnalysisExecutionService {
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
  ) {}

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
    const attempt = (previous[0]?.attempt ?? 0) + 1;
    const startedAt = new Date();
    const runtimeMetrics = getRuntimeMetrics("ai-analysis-service");
    const execution = this.executions.create({
      id: randomUUID(),
      analysisRequestId,
      attempt,
      status: "PROCESSING",
      provider: this.runtime.executionMode === "FAKE" ? "FAKE" : "OPENAI",
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
      const userPrompt = buildAiAnalysisPrompt(
        document,
        snapshotSources,
        request.instruction,
        request.purpose,
      );
      execution.promptVersionId = prompt.id;

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
        const resolved = await this.providerConfigurations.resolveDefault();
        if (resolved.configuration.lastConnectionTestStatus !== "SUCCEEDED") {
          throw new ConflictException(
            "El proveedor predeterminado debe superar una prueba de conexión antes de ejecutar análisis.",
          );
        }
        if (
          Math.ceil(userPrompt.length / 4) >
          resolved.configuration.maxInputTokens
        ) {
          throw new ConflictException(
            "Las fuentes exceden el límite de entrada configurado.",
          );
        }
        execution.providerConfigurationId = resolved.configuration.id;
        execution.model = resolved.configuration.model;
        provider = new OpenAiResponsesProvider(resolved);
      }

      await this.executions.update(execution.id, {
        promptVersionId: execution.promptVersionId,
        providerConfigurationId: execution.providerConfigurationId,
        model: execution.model,
      });
      const generated = await provider.generate({
        systemInstruction: prompt.systemInstruction,
        userPrompt,
        schema: AI_ANALYSIS_OUTPUT_SCHEMA,
      });
      const allowedSourceIds = new Set(
        snapshotSources.map((source) => source.sourceId.toLowerCase()),
      );
      if (
        generated.draft.requirements.some((requirement) =>
          requirement.sourceIds.some(
            (sourceId) => !allowedSourceIds.has(sourceId.toLowerCase()),
          ),
        )
      ) {
        throw new AiProviderError(
          "AI_UNKNOWN_SOURCE_REFERENCE",
          "La salida de IA referencia una fuente que no pertenece a la solicitud.",
          false,
        );
      }
      const finishedAt = new Date();

      const resultId = randomUUID();
      await this.dataSource.transaction(async (manager) => {
        await manager.save(
          manager.create(AnalysisResultEntity, {
            id: resultId,
            analysisRequestId,
            analysisExecutionId: execution.id,
            status: "GENERATED",
            schemaVersion: generated.draft.schemaVersion,
            contentJson: JSON.stringify(generated.draft),
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
          providerRequestId: generated.providerRequestId,
        });
        await manager.update(AnalysisRequestEntity, analysisRequestId, {
          status: "PROCESSING",
          errorCode: null,
          errorMessage: null,
          updatedAt: finishedAt,
        });
      });
      providerCompleted = true;
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
        await manager.update(AnalysisRequestEntity, analysisRequestId, {
          status: failure.retryable && !finalAttempt ? "PENDING" : "FAILED",
          errorCode: failure.code,
          errorMessage: failure.message,
          updatedAt: finishedAt,
        });
      });

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
    const draft = parseAiAnalysisDraft(JSON.parse(result.contentJson));

    await this.documentsAccess.applyAiDraft(
      request.documentId,
      request.generatedVersionNumber,
      {
        expectedRevision: document.currentVersionDetail.revision,
        analysisRequestId: request.id,
        analysisResultId: result.id,
        sections: draft.sections.slice(0, 10).map((section) => ({
          key: section.key,
          content: section.content,
        })),
        requirements: draft.requirements.map((requirement, index) => ({
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
        evidence: draft.requirements.flatMap((requirement) =>
          requirement.sourceIds.map((sourceId) => ({
            sourceId,
            sectionKey: requirement.sectionKey,
            requirementClientId: requirement.clientId,
            note: "Trazabilidad propuesta por IA; requiere revisión humana.",
          })),
        ),
      },
      accessToken,
      correlationId,
    );

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
