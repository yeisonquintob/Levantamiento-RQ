import { randomUUID } from "node:crypto";

import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import type {
  AuditEventDetail,
  AuditEventListResponse,
  AuditResult,
  AuthenticatedUser,
  NotificationDetail,
  NotificationListResponse,
  NotificationStatus,
  NotificationType,
} from "@levantamiento-rq/shared-contracts";

import {
  type AuditEventListQuery,
  type NotificationListQuery,
} from "./operations-input";
import {
  AuditEventEntity,
  NotificationRequestEntity,
} from "./operation.entities";
import { OperationsProjectsAccessClient } from "./projects-access.client";

export interface NotificationAuditContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class NotificationsAuditService {
  constructor(
    @InjectRepository(NotificationRequestEntity)
    private readonly notifications: Repository<NotificationRequestEntity>,
    @InjectRepository(AuditEventEntity)
    private readonly audits: Repository<AuditEventEntity>,
    private readonly projects: OperationsProjectsAccessClient,
  ) {}

  async listNotifications(
    context: NotificationAuditContext,
    query: NotificationListQuery,
  ): Promise<NotificationListResponse> {
    const builder = this.notifications
      .createQueryBuilder("notification")
      .where("notification.RecipientUserId = :recipientUserId", {
        recipientUserId: context.actor.id,
      });
    if (query.state === "READ") {
      builder.andWhere("notification.Status = :read", { read: "READ" });
    } else if (query.state === "UNREAD") {
      builder.andWhere("notification.Status <> :read", { read: "READ" });
    }
    builder
      .orderBy("notification.CreatedAt", "DESC")
      .addOrderBy("notification.Id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    const [[items, totalItems], unreadItems] = await Promise.all([
      builder.getManyAndCount(),
      this.notifications
        .createQueryBuilder("notification")
        .where("notification.RecipientUserId = :recipientUserId", {
          recipientUserId: context.actor.id,
        })
        .andWhere("notification.Status <> :read", { read: "READ" })
        .getCount(),
    ]);
    return {
      items: items.map((item) => this.notification(item)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
      unreadItems,
    };
  }

  async markRead(
    context: NotificationAuditContext,
    notificationId: string,
  ): Promise<NotificationDetail> {
    const notification = await this.notifications.findOneBy({
      id: notificationId,
      recipientUserId: context.actor.id,
    });
    if (!notification) {
      throw new NotFoundException("La notificación no existe.");
    }
    if (notification.status !== "READ") {
      const now = new Date();
      notification.status = "READ";
      notification.updatedAt = now;
      await this.notifications.save(notification);
      await this.audits.save({
        id: randomUUID(),
        actorUserId: context.actor.id,
        projectId: notification.projectId,
        action: "NOTIFICATION_READ",
        resourceType: "Notification",
        resourceId: notification.id,
        result: "SUCCEEDED",
        correlationId: context.correlationId,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        metadataJson: "{}",
        occurredAt: now,
      });
    }
    return this.notification(notification);
  }

  async listAudit(
    context: NotificationAuditContext,
    projectId: string,
    query: AuditEventListQuery,
  ): Promise<AuditEventListResponse> {
    await this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const builder = this.audits
      .createQueryBuilder("audit")
      .where("audit.ProjectId = :projectId", { projectId });
    if (query.action) {
      builder.andWhere("audit.Action = :action", { action: query.action });
    }
    if (query.resourceType) {
      builder.andWhere("audit.ResourceType = :resourceType", {
        resourceType: query.resourceType,
      });
    }
    if (query.result) {
      builder.andWhere("audit.Result = :result", { result: query.result });
    }
    if (query.correlationId) {
      builder.andWhere("audit.CorrelationId = :correlationId", {
        correlationId: query.correlationId,
      });
    }
    if (query.from) {
      builder.andWhere("audit.OccurredAt >= :from", { from: query.from });
    }
    if (query.to) {
      builder.andWhere("audit.OccurredAt <= :to", { to: query.to });
    }
    builder
      .orderBy("audit.OccurredAt", "DESC")
      .addOrderBy("audit.Id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    const [items, totalItems] = await builder.getManyAndCount();
    return {
      items: items.map((item) => this.audit(item)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    };
  }

  private notification(row: NotificationRequestEntity): NotificationDetail {
    return {
      id: row.id.toLowerCase(),
      recipientUserId: row.recipientUserId.toLowerCase(),
      projectId: row.projectId?.toLowerCase() ?? null,
      notificationType: row.notificationType as NotificationType,
      channel: row.channel as "IN_APP" | "EMAIL",
      status: row.status as NotificationStatus,
      subject: row.subject,
      body: row.body,
      resourceType: row.resourceType,
      resourceId: row.resourceId?.toLowerCase() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private audit(row: AuditEventEntity): AuditEventDetail {
    let metadata: Readonly<Record<string, unknown>> = {};
    try {
      const parsed = JSON.parse(row.metadataJson) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        metadata = parsed as Readonly<Record<string, unknown>>;
      }
    } catch {
      metadata = {};
    }
    return {
      id: row.id.toLowerCase(),
      actorUserId: row.actorUserId?.toLowerCase() ?? null,
      projectId: row.projectId?.toLowerCase() ?? null,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId?.toLowerCase() ?? null,
      result: row.result as AuditResult,
      correlationId: row.correlationId,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      metadata,
      occurredAt: row.occurredAt.toISOString(),
    };
  }
}
