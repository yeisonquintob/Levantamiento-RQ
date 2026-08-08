import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import type {
  AddWorkflowCommentRequest,
  AuthenticatedUser,
  CreateWorkflowReviewRequest,
  DecideWorkflowReviewRequest,
  WorkflowActivityType,
  WorkflowReviewActivity,
  WorkflowReviewAssignment,
  WorkflowReviewDetail,
  WorkflowReviewListResponse,
  WorkflowReviewStatus,
  WorkflowReviewSummary,
} from "@levantamiento-rq/shared-contracts";

import { WorkflowDocumentsAccessClient } from "./documents-access.client";
import {
  type WorkflowProjectAccess,
  WorkflowProjectsAccessClient,
} from "./projects-access.client";
import {
  WorkflowReviewActivityEntity,
  WorkflowReviewAssignmentEntity,
  WorkflowReviewRequestEntity,
} from "./workflow-review.entities";

export interface WorkflowActorContext {
  actor: AuthenticatedUser;
  accessToken: string;
  correlationId: string;
  idempotencyKey: string | null;
}

function iso(value: Date): string {
  return value.toISOString();
}

function optionalIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

@Injectable()
export class WorkflowReviewsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkflowReviewRequestEntity)
    private readonly reviews: Repository<WorkflowReviewRequestEntity>,
    @InjectRepository(WorkflowReviewAssignmentEntity)
    private readonly assignments: Repository<WorkflowReviewAssignmentEntity>,
    @InjectRepository(WorkflowReviewActivityEntity)
    private readonly activities: Repository<WorkflowReviewActivityEntity>,
    private readonly projects: WorkflowProjectsAccessClient,
    private readonly documents: WorkflowDocumentsAccessClient,
  ) {}

  async create(
    context: WorkflowActorContext,
    projectId: string,
    documentId: string,
    versionNumber: number,
    request: CreateWorkflowReviewRequest,
  ): Promise<WorkflowReviewDetail> {
    const access = await this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );

    if (!access.canCreateReview) {
      throw new ForbiddenException(
        "Solo ADMIN, OWNER o EDITOR pueden solicitar una revisión.",
      );
    }

    const existing = await this.reviews.findOneBy({
      documentId,
      versionNumber,
    });

    if (existing) {
      if (!sameUuid(existing.projectId, projectId)) {
        throw new ConflictException(
          "La versión ya está asociada a una revisión de otro proyecto.",
        );
      }

      return this.loadDetail(projectId, existing.id);
    }

    const document = await this.documents.requireDraftVersion(
      projectId,
      documentId,
      versionNumber,
      request.expectedDocumentRevision,
      context.accessToken,
      context.correlationId,
    );
    const now = new Date();
    const reviewId = randomUUID();
    const reviewerIds = access.project.participants
      .filter((participant) => participant.role === "REVIEWER")
      .map((participant) => participant.userId);

    if (reviewerIds.length === 0) reviewerIds.push(access.project.ownerUserId);

    await this.documents.transition(
      documentId,
      versionNumber,
      "submit-review",
      request.expectedDocumentRevision,
      request.comment,
      context.accessToken,
      context.correlationId,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(WorkflowReviewRequestEntity, {
          id: reviewId,
          projectId,
          documentId,
          documentVersionId: document.currentVersionDetail.id,
          versionNumber,
          status: "IN_REVIEW",
          revision: 1,
          requestedByUserId: context.actor.id,
          requestedAt: now,
          completedByUserId: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      await manager.save(WorkflowReviewAssignmentEntity, [
        ...reviewerIds.map((userId) => ({
          id: randomUUID(),
          reviewRequestId: reviewId,
          userId,
          role: "REVIEWER" as const,
          status: "PENDING" as const,
          assignedAt: now,
          completedAt: null,
        })),
        {
          id: randomUUID(),
          reviewRequestId: reviewId,
          userId: access.project.ownerUserId,
          role: "APPROVER" as const,
          status: "PENDING" as const,
          assignedAt: now,
          completedAt: null,
        },
      ]);
      await manager.save(
        manager.create(WorkflowReviewActivityEntity, {
          id: randomUUID(),
          reviewRequestId: reviewId,
          type: "REVIEW_REQUESTED",
          actorUserId: context.actor.id,
          comment: request.comment ?? null,
          correlationId: context.correlationId,
          idempotencyKey: context.idempotencyKey,
          createdAt: now,
        }),
      );
    });

    return this.loadDetail(projectId, reviewId);
  }

  async list(
    context: WorkflowActorContext,
    projectId: string,
  ): Promise<WorkflowReviewListResponse> {
    await this.requireProjectAccess(context, projectId);
    const reviews = await this.reviews.find({
      where: { projectId },
      order: { updatedAt: "DESC" },
    });

    return {
      items: reviews.map((review) => this.toSummary(review)),
      totalItems: reviews.length,
    };
  }

  async getById(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
  ): Promise<WorkflowReviewDetail> {
    await this.requireProjectAccess(context, projectId);
    return this.loadDetail(projectId, reviewId);
  }

  async addComment(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
    request: AddWorkflowCommentRequest,
  ): Promise<WorkflowReviewDetail> {
    const access = await this.requireProjectAccess(context, projectId);

    if (!access.canReview) {
      throw new ForbiddenException(
        "Solo revisores y aprobadores pueden comentar la revisión.",
      );
    }

    const duplicate = await this.findIdempotentActivity(
      reviewId,
      context.idempotencyKey,
    );

    if (duplicate) return this.loadDetail(projectId, reviewId);

    const review = await this.requireActiveReview(projectId, reviewId);

    if (review.revision !== request.expectedReviewRevision) this.stale();

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(WorkflowReviewRequestEntity)
        .set({ revision: () => "Revision + 1", updatedAt: now })
        .where("Id = :reviewId", { reviewId })
        .andWhere("ProjectId = :projectId", { projectId })
        .andWhere("Revision = :revision", {
          revision: request.expectedReviewRevision,
        })
        .andWhere("Status = :status", { status: "IN_REVIEW" })
        .execute();

      if (result.affected !== 1) this.stale();

      await manager.save(
        manager.create(WorkflowReviewActivityEntity, {
          id: randomUUID(),
          reviewRequestId: reviewId,
          type: "COMMENTED",
          actorUserId: context.actor.id,
          comment: request.comment,
          correlationId: context.correlationId,
          idempotencyKey: context.idempotencyKey,
          createdAt: now,
        }),
      );
    });

    return this.loadDetail(projectId, reviewId);
  }

  requestChanges(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
    request: DecideWorkflowReviewRequest,
  ): Promise<WorkflowReviewDetail> {
    return this.decide(
      context,
      projectId,
      reviewId,
      request,
      "CHANGES_REQUESTED",
      "CHANGES_REQUESTED",
      "reject",
      "REVIEWER",
    );
  }

  approve(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
    request: DecideWorkflowReviewRequest,
  ): Promise<WorkflowReviewDetail> {
    return this.decide(
      context,
      projectId,
      reviewId,
      request,
      "APPROVED",
      "APPROVED",
      "approve",
      "APPROVER",
    );
  }

  reject(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
    request: DecideWorkflowReviewRequest,
  ): Promise<WorkflowReviewDetail> {
    return this.decide(
      context,
      projectId,
      reviewId,
      request,
      "REJECTED",
      "REJECTED",
      "reject",
      "APPROVER",
    );
  }

  private async decide(
    context: WorkflowActorContext,
    projectId: string,
    reviewId: string,
    request: DecideWorkflowReviewRequest,
    status: Exclude<WorkflowReviewStatus, "IN_REVIEW" | "CANCELLED">,
    activityType: Exclude<
      WorkflowActivityType,
      "REVIEW_REQUESTED" | "COMMENTED"
    >,
    documentAction: "approve" | "reject",
    requiredAssignment: "REVIEWER" | "APPROVER",
  ): Promise<WorkflowReviewDetail> {
    const access = await this.requireProjectAccess(context, projectId);

    if (requiredAssignment === "APPROVER" && !access.canApprove) {
      throw new ForbiddenException(
        "Solo ADMIN u OWNER pueden aprobar o rechazar definitivamente.",
      );
    }
    if (requiredAssignment === "REVIEWER" && !access.canReview) {
      throw new ForbiddenException(
        "Solo un revisor asignado puede solicitar correcciones.",
      );
    }

    const duplicate = await this.findIdempotentActivity(
      reviewId,
      context.idempotencyKey,
    );

    if (duplicate) return this.loadDetail(projectId, reviewId);

    const review = await this.requireActiveReview(projectId, reviewId);

    if (review.revision !== request.expectedReviewRevision) this.stale();

    await this.requireAssignment(
      reviewId,
      context.actor,
      access,
      requiredAssignment,
    );

    const document = await this.documents.getDocument(
      review.documentId,
      context.accessToken,
      context.correlationId,
    );
    const version = document.currentVersionDetail;

    if (
      !sameUuid(document.projectId, projectId) ||
      !sameUuid(version.id, review.documentVersionId) ||
      version.versionNumber !== review.versionNumber ||
      version.status !== "IN_REVIEW"
    ) {
      throw new ConflictException(
        "El documento ya no coincide con la revisión activa.",
      );
    }
    if (version.revision !== request.expectedDocumentRevision) {
      throw new ConflictException(
        "La revisión documental está desactualizada. Recarga el documento.",
      );
    }

    await this.documents.transition(
      review.documentId,
      review.versionNumber,
      documentAction,
      request.expectedDocumentRevision,
      request.comment,
      context.accessToken,
      context.correlationId,
    );

    const now = new Date();

    await this.dataSource.transaction(async (manager) => {
      const result = await manager
        .createQueryBuilder()
        .update(WorkflowReviewRequestEntity)
        .set({
          status,
          revision: () => "Revision + 1",
          completedByUserId: context.actor.id,
          completedAt: now,
          updatedAt: now,
        })
        .where("Id = :reviewId", { reviewId })
        .andWhere("ProjectId = :projectId", { projectId })
        .andWhere("Status = :activeStatus", { activeStatus: "IN_REVIEW" })
        .execute();

      if (result.affected !== 1) {
        throw new ConflictException(
          "La decisión documental fue aplicada, pero la revisión local ya había cambiado.",
        );
      }

      await manager.update(
        WorkflowReviewAssignmentEntity,
        { reviewRequestId: reviewId, status: "PENDING" },
        { status: "COMPLETED", completedAt: now },
      );
      await manager.save(
        manager.create(WorkflowReviewActivityEntity, {
          id: randomUUID(),
          reviewRequestId: reviewId,
          type: activityType,
          actorUserId: context.actor.id,
          comment: request.comment ?? null,
          correlationId: context.correlationId,
          idempotencyKey: context.idempotencyKey,
          createdAt: now,
        }),
      );
    });

    return this.loadDetail(projectId, reviewId);
  }

  private async requireProjectAccess(
    context: WorkflowActorContext,
    projectId: string,
  ): Promise<WorkflowProjectAccess> {
    return this.projects.requireRead(
      projectId,
      context.accessToken,
      context.actor,
      context.correlationId,
    );
  }

  private async requireAssignment(
    reviewId: string,
    actor: AuthenticatedUser,
    access: WorkflowProjectAccess,
    role: "REVIEWER" | "APPROVER",
  ): Promise<void> {
    if (isAdministrator(actor)) return;

    const assignment = await this.assignments.findOneBy({
      reviewRequestId: reviewId,
      userId: actor.id,
      role,
      status: "PENDING",
    });

    if (!assignment && !(role === "REVIEWER" && access.role === "OWNER")) {
      throw new ForbiddenException(
        `No tienes una asignación ${role} pendiente en esta revisión.`,
      );
    }
  }

  private async findIdempotentActivity(
    reviewId: string,
    idempotencyKey: string | null,
  ): Promise<WorkflowReviewActivityEntity | null> {
    if (!idempotencyKey) return null;

    return this.activities.findOneBy({
      reviewRequestId: reviewId,
      idempotencyKey,
    });
  }

  private async requireActiveReview(
    projectId: string,
    reviewId: string,
  ): Promise<WorkflowReviewRequestEntity> {
    const review = await this.requireReview(projectId, reviewId);

    if (review.status !== "IN_REVIEW") {
      throw new ConflictException("La revisión ya no está activa.");
    }

    return review;
  }

  private async requireReview(
    projectId: string,
    reviewId: string,
  ): Promise<WorkflowReviewRequestEntity> {
    const review = await this.reviews.findOneBy({ id: reviewId, projectId });

    if (!review) {
      throw new NotFoundException("La revisión no existe en este proyecto.");
    }

    return review;
  }

  private stale(): never {
    throw new ConflictException(
      "La revisión enviada está desactualizada. Recarga antes de continuar.",
    );
  }

  private async loadDetail(
    projectId: string,
    reviewId: string,
  ): Promise<WorkflowReviewDetail> {
    const review = await this.requireReview(projectId, reviewId);
    const [assignments, activities] = await Promise.all([
      this.assignments.find({
        where: { reviewRequestId: reviewId },
        order: { assignedAt: "ASC", id: "ASC" },
      }),
      this.activities.find({
        where: { reviewRequestId: reviewId },
        order: { createdAt: "ASC", id: "ASC" },
      }),
    ]);

    return {
      ...this.toSummary(review),
      assignments: assignments.map((assignment) =>
        this.toAssignment(assignment),
      ),
      activities: activities.map((activity) => this.toActivity(activity)),
    };
  }

  private toSummary(
    review: WorkflowReviewRequestEntity,
  ): WorkflowReviewSummary {
    return {
      id: review.id,
      projectId: review.projectId,
      documentId: review.documentId,
      documentVersionId: review.documentVersionId,
      versionNumber: review.versionNumber,
      status: review.status,
      revision: review.revision,
      requestedByUserId: review.requestedByUserId,
      requestedAt: iso(review.requestedAt),
      completedByUserId: review.completedByUserId,
      completedAt: optionalIso(review.completedAt),
      createdAt: iso(review.createdAt),
      updatedAt: iso(review.updatedAt),
    };
  }

  private toAssignment(
    assignment: WorkflowReviewAssignmentEntity,
  ): WorkflowReviewAssignment {
    return {
      id: assignment.id,
      userId: assignment.userId,
      role: assignment.role,
      status: assignment.status,
      assignedAt: iso(assignment.assignedAt),
      completedAt: optionalIso(assignment.completedAt),
    };
  }

  private toActivity(
    activity: WorkflowReviewActivityEntity,
  ): WorkflowReviewActivity {
    return {
      id: activity.id,
      type: activity.type,
      actorUserId: activity.actorUserId,
      comment: activity.comment,
      correlationId: activity.correlationId,
      createdAt: iso(activity.createdAt),
    };
  }
}
