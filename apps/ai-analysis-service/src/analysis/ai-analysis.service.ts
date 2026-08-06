import { randomUUID } from "node:crypto";

import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type {
  AiAnalysisExecutionDetail,
  AiAnalysisRequestDetail,
  AiAnalysisRequestListResponse,
  AiAnalysisRequestSourceDetail,
  AiAnalysisRequestSummary,
  CreateAiAnalysisRequest,
} from "@levantamiento-rq/shared-contracts";

import { AnalysisExecutionEntity } from "./analysis-execution.entity";
import { AnalysisRequestSourceEntity } from "./analysis-request-source.entity";
import { AnalysisRequestEntity } from "./analysis-request.entity";
import type { AiAnalysisRequestListQuery } from "./ai-analysis-input";
import type { AiAnalysisRequest } from "./ai-analysis-request";
import { AiAnalysisDocumentsAccessClient } from "./documents-access.client";
import { AiAnalysisProjectsAccessClient } from "./projects-access.client";
import { AiAnalysisSourcesAccessClient } from "./sources-access.client";

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
    private readonly dataSource: DataSource,
    private readonly projectsAccess: AiAnalysisProjectsAccessClient,
    private readonly documentsAccess: AiAnalysisDocumentsAccessClient,
    private readonly sourcesAccess: AiAnalysisSourcesAccessClient,
  ) {}

  async create(
    context: AiAnalysisActorContext,
    projectId: string,
    input: CreateAiAnalysisRequest,
  ): Promise<AiAnalysisRequestDetail> {
    await this.projectsAccess.requireCreate(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    await this.documentsAccess.requireCurrentVersion(
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

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(AnalysisRequestEntity, {
          id: analysisRequestId,
          projectId,
          documentId: input.documentId,
          documentVersionId: input.documentVersionId,
          analysisType: input.analysisType ?? "REQUIREMENT_DOCUMENT",
          status: "PENDING",
          requestedByUserId: context.actor.id,
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
          position: index + 1,
          createdAt: now,
        })),
      );
    });

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
      totalPages:
        totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
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
    const request = await this.requireRequest(
      projectId,
      analysisRequestId,
    );
    const [sources, executions] = await Promise.all([
      this.requestSources.find({
        where: { analysisRequestId },
        order: { position: "ASC" },
      }),
      this.executions.find({
        where: { analysisRequestId },
        order: { attempt: "ASC" },
      }),
    ]);

    return {
      ...this.toSummary(request, sources.length, executions.length),
      sources: sources.map((source) => this.toSource(source)),
      executions: executions.map((execution) =>
        this.toExecution(execution),
      ),
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
      status: entity.status,
      requestedByUserId: entity.requestedByUserId,
      sourceCount,
      executionCount,
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
}
