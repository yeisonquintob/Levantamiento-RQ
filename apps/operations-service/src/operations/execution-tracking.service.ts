import { randomUUID } from "node:crypto";

import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";

import type {
  ExecutionTaskSource,
  ExecutionTaskState,
  ExecutionTaskStatusDetail,
  ExecutionTaskStatusListResponse,
} from "@levantamiento-rq/shared-contracts";

import {
  AuditEventEntity,
  ExecutionTaskStatusEntity,
} from "./operation.entities";
import type { NotificationAuditContext } from "./notifications-audit.service";
import type { ParsedExecutionTaskUpdate } from "./operations-input";
import { OperationsProjectsAccessClient } from "./projects-access.client";

const EXECUTION_STATUSES: ReadonlySet<string> = new Set([
  "APPROVED",
  "EXECUTION",
  "COMPLETED",
]);

/**
 * Estado de ejecución de cada tarea del plan de trabajo. Es la única fuente de verdad de los
 * indicadores de ejecución (avance, objetivos y entregables): la pestaña de seguimiento, la
 * importación de Azure DevOps y las pantallas que muestran los KPI leen y escriben aquí.
 */
@Injectable()
export class ExecutionTrackingService {
  constructor(
    @InjectRepository(ExecutionTaskStatusEntity)
    private readonly statuses: Repository<ExecutionTaskStatusEntity>,
    @InjectRepository(AuditEventEntity)
    private readonly audits: Repository<AuditEventEntity>,
    private readonly projects: OperationsProjectsAccessClient,
  ) {}

  async list(
    context: NotificationAuditContext,
    projectId: string,
  ): Promise<ExecutionTaskStatusListResponse> {
    await this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    const rows = await this.statuses.find({
      where: { projectId },
      order: { taskCode: "ASC" },
    });
    return { items: rows.map((row) => this.detail(row)) };
  }

  async update(
    context: NotificationAuditContext,
    projectId: string,
    updates: readonly ParsedExecutionTaskUpdate[],
  ): Promise<ExecutionTaskStatusListResponse> {
    const project = await this.projects.requireEditor(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
    // La ejecución solo se actualiza con el proyecto aprobado (o ya en ejecución o completado).
    if (!EXECUTION_STATUSES.has(project.status)) {
      throw new ForbiddenException(
        "El proyecto no ha sido aprobado. Valida su aprobación antes de empezar su ejecución.",
      );
    }
    const now = new Date();
    const saved = await this.statuses.manager.transaction(async (manager) => {
      const repository = manager.getRepository(ExecutionTaskStatusEntity);
      const existing = await repository.find({
        where: {
          projectId,
          taskCode: In(updates.map((update) => update.taskCode)),
        },
      });
      const byCode = new Map(existing.map((row) => [row.taskCode, row]));
      const rows = updates.map((update) => {
        const row =
          byCode.get(update.taskCode) ??
          Object.assign(new ExecutionTaskStatusEntity(), {
            id: randomUUID(),
            projectId,
            taskCode: update.taskCode,
            createdAt: now,
          });
        row.state = update.state;
        row.source = update.source;
        row.note = update.note;
        row.completedAt = update.completedAt;
        row.updatedByUserId = context.actor.id;
        row.updatedAt = now;
        return row;
      });
      return repository.save(rows);
    });
    await this.audits.save({
      id: randomUUID(),
      actorUserId: context.actor.id,
      projectId,
      action: "EXECUTION_TASKS_UPDATED",
      resourceType: "ExecutionTracking",
      resourceId: projectId,
      result: "SUCCEEDED",
      correlationId: context.correlationId,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      metadataJson: JSON.stringify({
        count: updates.length,
        done: updates.filter((update) => update.state === "DONE").length,
        sources: [...new Set(updates.map((update) => update.source))],
      }),
      occurredAt: now,
    });
    return { items: saved.map((row) => this.detail(row)) };
  }

  private detail(row: ExecutionTaskStatusEntity): ExecutionTaskStatusDetail {
    return {
      taskCode: row.taskCode,
      state: row.state as ExecutionTaskState,
      source: row.source as ExecutionTaskSource,
      note: row.note,
      completedAt: row.completedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
      updatedByUserId: row.updatedByUserId.toLowerCase(),
    };
  }
}
