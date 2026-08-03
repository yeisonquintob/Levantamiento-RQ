import { createHash } from "node:crypto";

import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import type {
  AuthenticatedUser,
  CreateTextSourceRequest,
  SourceDetail,
  SourceListResponse,
  SourceMetrics,
  SourceSummary,
  UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

import { ProjectsAccessClient } from "./projects-access.client";
import { SourceEntity } from "./source.entity";
import type { SourceListQuery } from "./sources-input";

function toIso(value: Date): string {
  return value.toISOString();
}

function textSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function contentPreview(content: string | null): string | null {
  if (!content) {
    return null;
  }

  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized.length > 180
    ? `${normalized.slice(0, 177)}...`
    : normalized;
}

@Injectable()
export class SourcesService {
  constructor(
    @InjectRepository(SourceEntity)
    private readonly sources: Repository<SourceEntity>,
    private readonly projectAccess: ProjectsAccessClient,
  ) {}

  async createText(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    request: CreateTextSourceRequest,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);

    const now = new Date();
    const source = this.sources.create({
      projectId,
      sourceType: request.sourceType,
      title: request.title,
      content: request.content,
      extractedText: request.content,
      processingStatus: "READY",
      status: "ACTIVE",
      originalFileName: null,
      mediaType: "text/plain; charset=utf-8",
      fileSizeBytes: String(Buffer.byteLength(request.content, "utf8")),
      sha256: textSha256(request.content),
      storageContainer: null,
      storagePath: null,
      createdByUserId: actor.id,
      updatedByUserId: actor.id,
      createdAt: now,
      updatedAt: now,
    });

    return this.toDetail(await this.sources.save(source));
  }

  async list(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    query: SourceListQuery,
  ): Promise<SourceListResponse> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);

    const builder = this.sources
      .createQueryBuilder("source")
      .where("source.projectId = :projectId", { projectId });

    if (query.search) {
      builder.andWhere(
        `(source.title LIKE :search OR source.content LIKE :search)`,
        { search: `%${query.search}%` },
      );
    }

    if (query.sourceType) {
      builder.andWhere("source.sourceType = :sourceType", {
        sourceType: query.sourceType,
      });
    }

    if (query.status) {
      builder.andWhere("source.status = :status", { status: query.status });
    }

    const totalItems = await builder.getCount();
    const rows = await builder
      .clone()
      .orderBy("source.updatedAt", "DESC")
      .addOrderBy("source.title", "ASC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getMany();

    return {
      items: rows.map((source) => this.toSummary(source)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    };
  }

  async metrics(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
  ): Promise<SourceMetrics> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);

    const row = await this.sources
      .createQueryBuilder("source")
      .select("COUNT(1)", "total")
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'FILE' THEN 1 ELSE 0 END)",
        "files",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'NOTE' THEN 1 ELSE 0 END)",
        "notes",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'CONVERSATION' THEN 1 ELSE 0 END)",
        "conversations",
      )
      .addSelect(
        "SUM(CASE WHEN source.sourceType = 'TRANSCRIPT' THEN 1 ELSE 0 END)",
        "transcripts",
      )
      .addSelect(
        "SUM(CASE WHEN source.processingStatus = 'READY' THEN 1 ELSE 0 END)",
        "ready",
      )
      .addSelect(
        "SUM(CASE WHEN source.processingStatus = 'PENDING' THEN 1 ELSE 0 END)",
        "pending",
      )
      .addSelect(
        "SUM(CASE WHEN source.processingStatus = 'FAILED' THEN 1 ELSE 0 END)",
        "failed",
      )
      .addSelect(
        "SUM(CASE WHEN source.status = 'ARCHIVED' THEN 1 ELSE 0 END)",
        "archived",
      )
      .where("source.projectId = :projectId", { projectId })
      .getRawOne<Record<string, number | string | null>>();

    const numberValue = (name: string): number => {
      const value = Number(row?.[name] ?? 0);
      return Number.isFinite(value) ? value : 0;
    };

    return {
      total: numberValue("total"),
      files: numberValue("files"),
      notes: numberValue("notes"),
      conversations: numberValue("conversations"),
      transcripts: numberValue("transcripts"),
      ready: numberValue("ready"),
      pending: numberValue("pending"),
      failed: numberValue("failed"),
      archived: numberValue("archived"),
    };
  }

  async getById(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireRead(projectId, accessToken, actor);
    return this.toDetail(await this.requireSource(projectId, sourceId));
  }

  async update(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
    request: UpdateSourceRequest,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);
    const source = await this.requireSource(projectId, sourceId);

    if (request.title !== undefined) {
      source.title = request.title;
    }

    if (request.content !== undefined) {
      source.content = request.content;
      source.extractedText = request.content;
      source.processingStatus = "READY";
      source.mediaType = "text/plain; charset=utf-8";
      source.fileSizeBytes = String(Buffer.byteLength(request.content, "utf8"));
      source.sha256 = textSha256(request.content);
    }

    source.updatedByUserId = actor.id;
    source.updatedAt = new Date();

    return this.toDetail(await this.sources.save(source));
  }

  async archive(
    actor: AuthenticatedUser,
    accessToken: string,
    projectId: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    await this.projectAccess.requireManage(projectId, accessToken, actor);
    const source = await this.requireSource(projectId, sourceId);

    source.status = "ARCHIVED";
    source.updatedByUserId = actor.id;
    source.updatedAt = new Date();

    return this.toDetail(await this.sources.save(source));
  }

  private async requireSource(
    projectId: string,
    sourceId: string,
  ): Promise<SourceEntity> {
    const source = await this.sources.findOne({
      where: {
        id: sourceId,
        projectId,
      },
    });

    if (!source) {
      throw new NotFoundException("La fuente no existe en este proyecto.");
    }

    return source;
  }

  private toSummary(source: SourceEntity): SourceSummary {
    return {
      id: source.id,
      projectId: source.projectId,
      sourceType: source.sourceType,
      title: source.title,
      contentPreview: contentPreview(source.extractedText ?? source.content),
      processingStatus: source.processingStatus,
      status: source.status,
      originalFileName: source.originalFileName,
      mediaType: source.mediaType,
      fileSizeBytes: source.fileSizeBytes,
      sha256: source.sha256,
      createdByUserId: source.createdByUserId,
      updatedByUserId: source.updatedByUserId,
      createdAt: toIso(source.createdAt),
      updatedAt: toIso(source.updatedAt),
    };
  }

  private toDetail(source: SourceEntity): SourceDetail {
    return {
      ...this.toSummary(source),
      content: source.content,
      extractedText: source.extractedText,
      storageContainer: source.storageContainer,
      storagePath: source.storagePath,
    };
  }
}
