import { randomUUID } from "node:crypto";

import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type { RequirementDocumentDetail } from "@levantamiento-rq/shared-contracts";

import { AnalysisExecutionEntity } from "../analysis/analysis-execution.entity";
import { AnalysisPromptVersionEntity } from "../analysis/analysis-prompt-version.entity";
import { AnalysisRequestSourceEntity } from "../analysis/analysis-request-source.entity";
import { AnalysisRequestEntity } from "../analysis/analysis-request.entity";
import { AnalysisResultEntity } from "../analysis/analysis-result.entity";
import {
  AI_PROVIDER_RUNTIME_CONFIG,
  type AiProviderRuntimeConfig,
} from "../providers/ai-provider.config";
import { AiProviderConfigurationsService } from "../providers/ai-provider-configurations.service";
import { AI_ANALYSIS_OUTPUT_SCHEMA } from "./ai-analysis-draft";
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
    @Inject(AI_PROVIDER_RUNTIME_CONFIG)
    private readonly runtime: AiProviderRuntimeConfig,
  ) {}

  async process(
    analysisRequestId: string,
    finalAttempt: boolean,
  ): Promise<void> {
    const existingResult = await this.results.findOneBy({ analysisRequestId });
    if (existingResult) return;

    const request = await this.requests.findOneBy({ id: analysisRequestId });
    if (
      !request ||
      request.status === "CANCELLED" ||
      request.status === "COMPLETED"
    )
      return;

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
      const userPrompt = buildAiAnalysisPrompt(document, snapshotSources);
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

      await this.dataSource.transaction(async (manager) => {
        await manager.save(
          manager.create(AnalysisResultEntity, {
            id: randomUUID(),
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
          status: "COMPLETED",
          updatedAt: finishedAt,
        });
      });
    } catch (error) {
      const failure = errorDetails(error);
      const finishedAt = new Date();
      await this.dataSource.transaction(async (manager) => {
        await manager.update(AnalysisExecutionEntity, execution.id, {
          status: "FAILED",
          finishedAt,
          durationMs: String(finishedAt.valueOf() - startedAt.valueOf()),
          errorCode: failure.code,
          errorMessage: failure.message,
        });
        await manager.update(AnalysisRequestEntity, analysisRequestId, {
          status: failure.retryable && !finalAttempt ? "PENDING" : "FAILED",
          updatedAt: finishedAt,
        });
      });

      if (failure.retryable && !finalAttempt) {
        throw new AiProviderError(failure.code, failure.message, true);
      }
    }
  }
}
