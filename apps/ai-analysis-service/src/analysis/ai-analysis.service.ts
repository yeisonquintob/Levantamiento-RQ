import { randomUUID } from "node:crypto";

import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type {
  AiAnalysisExecutionDetail,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiAnalysisRequestSourceDetail,
  AiAnalysisRequestSummary,
  AiAnalysisResultDetail,
  CreateAiAnalysisRequest,
  ReviewAiAnalysisResult,
} from "@levantamiento-rq/shared-contracts";

import { AnalysisExecutionEntity } from "./analysis-execution.entity";
import { AnalysisRequestSourceEntity } from "./analysis-request-source.entity";
import { AnalysisRequestEntity } from "./analysis-request.entity";
import { AnalysisResultEntity } from "./analysis-result.entity";
import type { AiAnalysisRequestListQuery } from "./ai-analysis-input";
import type { AiAnalysisRequest } from "./ai-analysis-request";
import { IntegrationEventsPublisher } from "@levantamiento-rq/shared-messaging";
import { AiAnalysisDocumentsAccessClient } from "./documents-access.client";
import { AiAnalysisProjectsAccessClient } from "./projects-access.client";
import { AiAnalysisSourcesAccessClient } from "./sources-access.client";
import { parseAiAnalysisDraft } from "../execution/ai-analysis-draft";
import { AiAnalysisQueue } from "../execution/ai-analysis.queue";

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

@Injectable()
export class AiAnalysisService {
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
  ) {}

  async create(
    context: AiAnalysisActorContext,
    projectId: string,
    input: CreateAiAnalysisRequest,
  ): Promise<AiAnalysisRequestDetail> {
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
    const sources = await this.sourcesAccess.requireReadySources(
      projectId,
      input.sourceIds,
      context.accessToken,
      context.correlationId,
    );

    const now = new Date();
    const analysisRequestId = randomUUID();
    const idempotencyKey = requestedIdempotencyKey ?? analysisRequestId;

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
      if (existing) return this.loadDetail(projectId, existing.id);
      throw error;
    }

    try {
      await this.queue.enqueue(analysisRequestId, context.correlationId);
    } catch {
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
    const draft = parseAiAnalysisDraft(JSON.parse(result.contentJson));
    await this.documentsAccess.applyAiDraft(
      request.documentId,
      document.currentVersionNumber,
      {
        expectedRevision: input.expectedDocumentRevision,
        analysisRequestId,
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
            note: "Trazabilidad propuesta por el análisis de IA y aceptada por un usuario.",
          })),
        ),
      },
      context.accessToken,
      context.correlationId,
    );

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
      rows.map(async (row) =>
        this.toSummary(
          row,
          await this.requestSources.countBy({
            analysisRequestId: row.id,
          }),
          await this.executions.countBy({
            analysisRequestId: row.id,
          }),
        ),
      ),
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

    if (entity.status === "CANCELLED") {
      return this.loadDetail(projectId, analysisRequestId);
    }

    if (entity.status !== "PENDING") {
      throw new ConflictException(
        "Solo una solicitud PENDING puede cancelarse en esta etapa.",
      );
    }

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
      .andWhere("Status = :status", { status: "PENDING" })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException(
        "La solicitud cambió de estado antes de ser cancelada.",
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

    return {
      ...this.toSummary(request, sources.length, executions.length),
      sources: sources.map((source) => this.toSource(source)),
      executions: executions.map((execution) => this.toExecution(execution)),
      result: result ? this.toResult(result) : null,
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
  ): AiAnalysisRequestSummary {
    return {
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

  private toResult(entity: AnalysisResultEntity): AiAnalysisResultDetail {
    return {
      id: entity.id,
      analysisRequestId: entity.analysisRequestId,
      analysisExecutionId: entity.analysisExecutionId,
      status: entity.status,
      schemaVersion: entity.schemaVersion,
      draft: parseAiAnalysisDraft(JSON.parse(entity.contentJson)),
      reviewedByUserId: entity.reviewedByUserId,
      reviewedAt: optionalIso(entity.reviewedAt),
      reviewComment: entity.reviewComment,
      createdAt: iso(entity.createdAt),
      updatedAt: iso(entity.updatedAt),
    };
  }
}
