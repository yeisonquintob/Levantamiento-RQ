import { ProjectAuditEntity } from "./project-audit.entity";
import {
  readAuditHistory,
  requireAuditAdministrator,
} from "@levantamiento-rq/shared-persistence";
import {
  PROJECT_AUDIT_FIELDS,
  auditFieldChanges,
  auditMetadata,
  auditMetadataChanges,
  type AuditHistoryResponse,
  type AuditFieldChange,
} from "@levantamiento-rq/shared-contracts";
import { randomUUID } from "node:crypto";

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, SelectQueryBuilder } from "typeorm";

import type {
  AddProjectParticipantRequest,
  AuthenticatedUser,
  CreateProjectRequest,
  ProjectDetail,
  ProjectDomainPurgeResult,
  ProjectListResponse,
  ProjectMetrics,
  ProjectParticipant,
  ProjectSummary,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";
import { advanceProjectLifecycleStatus } from "@levantamiento-rq/shared-contracts";

import { DocumentTemplatesAccessClient } from "./document-templates-access.client";
import { ProjectParticipantEntity } from "./project-participant.entity";
import { ProjectEntity } from "./project.entity";
import type { ProjectListQuery } from "./projects-input";

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

function canReadAllProjects(actor: AuthenticatedUser): boolean {
  return (
    isAdministrator(actor) || actor.permissions.includes("projects.read.all")
  );
}

function normalizeUuid(value: string): string {
  return value.toLowerCase();
}

function sameUuid(left: string, right: string): boolean {
  return normalizeUuid(left) === normalizeUuid(right);
}

function toIso(value: Date | string): string {
  const resolved = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(resolved.getTime())) {
    throw new Error("El proyecto contiene una fecha inválida.");
  }

  return resolved.toISOString();
}

function projectCreationError(error: unknown): string {
  if (error instanceof Error) {
    const candidate = error as Error & {
      code?: unknown;
      number?: unknown;
      driverError?: Readonly<{
        code?: unknown;
        number?: unknown;
        message?: unknown;
      }>;
    };
    const details = [
      candidate.stack ?? candidate.message,
      candidate.code === undefined ? null : `code=${String(candidate.code)}`,
      candidate.number === undefined
        ? null
        : `number=${String(candidate.number)}`,
      candidate.driverError?.code === undefined
        ? null
        : `driverCode=${String(candidate.driverError.code)}`,
      candidate.driverError?.number === undefined
        ? null
        : `driverNumber=${String(candidate.driverError.number)}`,
      typeof candidate.driverError?.message === "string"
        ? `driverMessage=${candidate.driverError.message}`
        : null,
    ].filter((value): value is string => Boolean(value));

    return details.join(" | ");
  }

  return String(error);
}

function projectAuditSnapshot(project: ProjectEntity) {
  return {
    title: project.title,
    requestingArea: project.requestingArea,
    description: project.description,
    status: project.status,
    activityState: project.activityState,
    template: project.templateName
      ? `${project.templateName} · ${project.templateVersion}`
      : null,
  };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectParticipantEntity)
    private readonly participants: Repository<ProjectParticipantEntity>,
    private readonly templates: DocumentTemplatesAccessClient,
  ) {}

  async auditHistory(
    actor: AuthenticatedUser,
    query: Readonly<Record<string, unknown>>,
  ): Promise<AuditHistoryResponse> {
    requireAuditAdministrator(actor);
    const page = await readAuditHistory(
      this.dataSource
        .getRepository(ProjectAuditEntity)
        .createQueryBuilder("audit"),
      query,
      {
        date: "audit.occurredAt",
        id: "audit.id",
        projectId: "audit.projectId",
        search: [
          "audit.action",
          "audit.actorName",
          "audit.projectLabel",
          "audit.metadataJson",
        ],
      },
    );
    return {
      ...page,
      items: page.items.map((row) => {
        const metadata = auditMetadata(row.metadataJson);
        return {
          id: row.id,
          occurredAt: row.occurredAt.toISOString(),
          action: row.action,
          actorUserId: row.actorUserId,
          actorName: row.actorName,
          resourceId: row.projectId,
          resourceLabel: row.projectLabel,
          projectId: row.projectId,
          result: "SUCCEEDED" as const,
          changes: auditMetadataChanges(metadata, PROJECT_AUDIT_FIELDS),
          details: metadata.historical
            ? "Registro histórico: se conserva el creador y la fecha original; no se registraron los valores iniciales."
            : null,
        };
      }),
    };
  }

  private async recordAudit(
    manager: DataSource["manager"],
    actor: AuthenticatedUser,
    project: ProjectEntity,
    action: string,
    changes: readonly AuditFieldChange[],
  ): Promise<void> {
    await manager.getRepository(ProjectAuditEntity).insert({
      id: randomUUID(),
      projectId: project.id,
      actorUserId: actor.id,
      actorName: actor.displayName,
      projectLabel: `${project.code} · ${project.title}`,
      action,
      metadataJson: JSON.stringify({ changes }),
      occurredAt: new Date(),
    });
  }

  async create(
    actor: AuthenticatedUser,
    accessToken: string,
    request: CreateProjectRequest,
  ): Promise<ProjectDetail> {
    const template = await this.templates.requirePublished(
      request.templateId,
      accessToken,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        const sequenceRows = (await manager.query(
          "SELECT NEXT VALUE FOR dbo.ProjectCodeSequence AS sequenceValue",
        )) as Array<{ sequenceValue: number | string }>;

        const sequenceValue = Number(sequenceRows[0]?.sequenceValue);

        if (!Number.isSafeInteger(sequenceValue) || sequenceValue < 1) {
          throw new Error("No fue posible generar el código del proyecto.");
        }

        const now = new Date();
        const projectId = randomUUID();
        const participantId = randomUUID();
        const code = `RQ-${now.getUTCFullYear()}-${String(
          sequenceValue,
        ).padStart(6, "0")}`;

        await manager.query(
          `
            INSERT INTO dbo.Projects (
              Id,
              Code,
              Title,
              RequestingArea,
              Description,
              Status,
              TemplateId,
              TemplateCode,
              TemplateName,
              TemplateVersion,
              TemplateType,
              OwnerUserId,
              CreatedByUserId,
              UpdatedByUserId,
              CreatedAt,
              UpdatedAt
            )
            VALUES (
              @0, @1, @2, @3, @4, @5, @6, @7,
              @8, @9, @10, @11, @12, @13, @14, @15
            )
          `,
          [
            projectId,
            code,
            request.title,
            request.requestingArea,
            request.description ?? null,
            "DRAFT",
            template.id,
            template.code,
            template.name,
            template.version,
            template.templateType,
            actor.id,
            actor.id,
            actor.id,
            now,
            now,
          ],
        );

        await manager.query(
          `
            INSERT INTO dbo.ProjectParticipants (
              Id,
              ProjectId,
              UserId,
              Role,
              AddedByUserId,
              CreatedAt
            )
            VALUES (@0, @1, @2, @3, @4, @5)
          `,
          [participantId, projectId, actor.id, "OWNER", actor.id, now],
        );

        const owner = Object.assign(new ProjectParticipantEntity(), {
          id: participantId,
          projectId,
          userId: actor.id,
          role: "OWNER" as const,
          addedByUserId: actor.id,
          createdAt: now,
        });
        const project = Object.assign(new ProjectEntity(), {
          id: projectId,
          code,
          title: request.title,
          requestingArea: request.requestingArea,
          description: request.description ?? null,
          status: "DRAFT" as const,
          activityState: "ACTIVE" as const,
          templateId: template.id,
          templateCode: template.code,
          templateName: template.name,
          templateVersion: template.version,
          templateType: template.templateType,
          ownerUserId: actor.id,
          createdByUserId: actor.id,
          updatedByUserId: actor.id,
          createdAt: now,
          updatedAt: now,
          participants: [owner],
        });

        await this.recordAudit(
          manager,
          actor,
          project,
          "PROJECT_CREATED",
          auditFieldChanges({}, projectAuditSnapshot(project)),
        );
        return this.toDetail(project);
      });
    } catch (error) {
      Logger.error(
        `No fue posible crear el proyecto: ${projectCreationError(error)}`,
        "ProjectsService",
      );

      throw new ServiceUnavailableException(
        "No fue posible guardar el proyecto en este momento.",
      );
    }
  }

  async list(
    actor: AuthenticatedUser,
    query: ProjectListQuery,
  ): Promise<ProjectListResponse> {
    const base = this.projects.createQueryBuilder("project");
    this.applyAccess(base, actor);

    if (query.search) {
      base.andWhere(
        `(
          project.code LIKE :search OR
          project.title LIKE :search OR
          project.requestingArea LIKE :search
        )`,
        { search: `%${query.search}%` },
      );
    }

    if (query.area) {
      base.andWhere("project.requestingArea = :area", { area: query.area });
    }

    if (query.status) {
      base.andWhere("project.status = :status", { status: query.status });
    }

    // Por defecto el listado oculta los proyectos eliminados (situación reversible).
    if (query.activityState === null) {
      base.andWhere("project.activityState <> 'DELETED'");
    } else if (query.activityState !== "ALL") {
      base.andWhere("project.activityState = :activityState", {
        activityState: query.activityState,
      });
    }

    const totalItems = await base.getCount();
    const rows = await base
      .clone()
      .orderBy("project.updatedAt", "DESC")
      .addOrderBy("project.code", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize)
      .getMany();

    const counts = await this.loadParticipantCounts(
      rows.map((project) => project.id),
    );

    return {
      items: rows.map((project) =>
        this.toSummary(project, counts.get(project.id) ?? 0),
      ),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize),
    };
  }

  async metrics(actor: AuthenticatedUser): Promise<ProjectMetrics> {
    const query = this.projects
      .createQueryBuilder("project")
      .select(
        "SUM(CASE WHEN project.activityState <> 'DELETED' THEN 1 ELSE 0 END)",
        "total",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status = 'DRAFT' THEN 1 ELSE 0 END)",
        "draft",
      )
      .addSelect(
        `SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status IN (
          'DISCUSSION', 'SOURCES', 'DOCUMENT_GENERATED',
          'VALIDATION', 'APPROVED', 'EXECUTION'
        ) THEN 1 ELSE 0 END)`,
        "inProgress",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status = 'VALIDATION' THEN 1 ELSE 0 END)",
        "validation",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status = 'APPROVED' THEN 1 ELSE 0 END)",
        "approved",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status = 'ARCHIVED' THEN 1 ELSE 0 END)",
        "archived",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' AND project.status = 'COMPLETED' THEN 1 ELSE 0 END)",
        "completed",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState <> 'DELETED' THEN 1 ELSE 0 END)",
        "active",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState = 'PAUSED' THEN 1 ELSE 0 END)",
        "paused",
      )
      .addSelect(
        "SUM(CASE WHEN project.activityState = 'DELETED' THEN 1 ELSE 0 END)",
        "deleted",
      );

    this.applyAccess(query, actor);

    const row = await query.getRawOne<Record<string, number | string | null>>();

    const numberValue = (name: string): number => {
      const value = Number(row?.[name] ?? 0);
      return Number.isFinite(value) ? value : 0;
    };

    return {
      total: numberValue("total"),
      draft: numberValue("draft"),
      inProgress: numberValue("inProgress"),
      validation: numberValue("validation"),
      approved: numberValue("approved"),
      completed: numberValue("completed"),
      archived: numberValue("archived"),
      active: numberValue("active"),
      paused: numberValue("paused"),
      deleted: numberValue("deleted"),
    };
  }

  async getById(
    actor: AuthenticatedUser,
    projectId: string,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    return this.toDetail(project);
  }

  async update(
    actor: AuthenticatedUser,
    projectId: string,
    request: UpdateProjectRequest,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireManageAccess(actor, project);
    const before = projectAuditSnapshot(project);

    if (request.title !== undefined) {
      project.title = request.title;
    }

    if (request.requestingArea !== undefined) {
      project.requestingArea = request.requestingArea;
    }

    if (request.description !== undefined) {
      project.description = request.description;
    }

    if (
      request.activityState !== undefined &&
      request.activityState !== project.activityState
    ) {
      // Eliminar: solo propietario o administrador. Pausar y reactivar: quien puede editar.
      if (request.activityState === "DELETED") {
        this.requireOwnerAccess(actor, project);
      }
      project.activityState = request.activityState;
    }

    if (request.status !== undefined) {
      project.status =
        request.status === "ARCHIVED"
          ? "ARCHIVED"
          : advanceProjectLifecycleStatus(project.status, request.status);
    }

    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProjectEntity).save(project);
      await this.recordAudit(
        manager,
        actor,
        project,
        "PROJECT_UPDATED",
        auditFieldChanges(before, projectAuditSnapshot(project)),
      );
    });

    return this.toDetail(project);
  }

  async documentGenerated(
    actor: AuthenticatedUser,
    projectId: string,
    documentId: string,
    accessToken: string,
  ): Promise<void> {
    const project = await this.requireAccessibleProject(actor, projectId);
    if (!actor.permissions.includes("documents.ai.apply"))
      this.requireManageAccess(actor, project);
    const url =
      process.env.DOCUMENTS_SERVICE_URL?.trim() || "http://127.0.0.1:3004";
    const response = await fetch(
      `${url}/api/v1/documents/${encodeURIComponent(documentId)}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok)
      throw new ServiceUnavailableException(
        "No se pudo verificar la versión generada.",
      );
    const document = (await response.json()) as {
      projectId: string;
      status: string;
    };
    if (
      !sameUuid(document.projectId, projectId) ||
      document.status !== "DRAFT"
    ) {
      throw new ConflictException(
        "El documento debe ser un borrador actual del proyecto.",
      );
    }
    if (
      project.status === "ARCHIVED" ||
      project.status === "DOCUMENT_GENERATED"
    )
      return;
    const before = projectAuditSnapshot(project);
    project.status = "DOCUMENT_GENERATED";
    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProjectEntity).save(project);
      await this.recordAudit(
        manager,
        actor,
        project,
        "PROJECT_UPDATED",
        auditFieldChanges(before, projectAuditSnapshot(project)),
      );
    });
  }

  async addParticipant(
    actor: AuthenticatedUser,
    projectId: string,
    request: AddProjectParticipantRequest,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireOwnerAccess(actor, project);

    const existing = project.participants.find((participant) =>
      sameUuid(participant.userId, request.userId),
    );

    if (existing) {
      throw new ConflictException("El usuario ya participa en este proyecto.");
    }

    const participant = this.participants.create({
      id: randomUUID(),
      projectId: project.id,
      userId: request.userId,
      role: request.role,
      addedByUserId: actor.id,
      createdAt: new Date(),
    });

    project.participants.push(participant);
    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProjectParticipantEntity).save(participant);
      await manager.getRepository(ProjectEntity).save(project);
      await this.recordAudit(
        manager,
        actor,
        project,
        "PROJECT_PARTICIPANT_ADDED",
        auditFieldChanges(
          {},
          { participant: request.userId, role: request.role },
        ),
      );
    });

    return this.toDetail(project);
  }

  async removeParticipant(
    actor: AuthenticatedUser,
    projectId: string,
    userId: string,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireOwnerAccess(actor, project);

    if (sameUuid(project.ownerUserId, userId)) {
      throw new ConflictException(
        "El propietario del proyecto no puede ser retirado.",
      );
    }

    const participant = project.participants.find((item) =>
      sameUuid(item.userId, userId),
    );

    if (!participant) {
      throw new NotFoundException("El participante no existe.");
    }

    project.participants = project.participants.filter(
      (item) => item.id !== participant.id,
    );
    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProjectParticipantEntity).remove(participant);
      await manager.getRepository(ProjectEntity).save(project);
      await this.recordAudit(
        manager,
        actor,
        project,
        "PROJECT_PARTICIPANT_REMOVED",
        auditFieldChanges({ participant: userId, role: participant.role }, {}),
      );
    });

    return this.toDetail(project);
  }

  async deleteProject(
    actor: AuthenticatedUser,
    projectId: string,
  ): Promise<ProjectDomainPurgeResult & { projectId: string; code: string }> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireOwnerAccess(actor, project);
    const code = project.code;
    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(ProjectEntity).remove(project);
      await this.recordAudit(
        manager,
        actor,
        { ...project, id: projectId },
        "PROJECT_DELETED",
        auditFieldChanges(projectAuditSnapshot(project), {}),
      );
    });
    return {
      deleted: true,
      count: 1,
      projectId: normalizeUuid(projectId),
      code,
    };
  }

  private applyAccess(
    query: SelectQueryBuilder<ProjectEntity>,
    actor: AuthenticatedUser,
  ): void {
    if (canReadAllProjects(actor)) {
      return;
    }

    query.innerJoin(
      ProjectParticipantEntity,
      "accessParticipant",
      "accessParticipant.projectId = project.id AND accessParticipant.userId = :actorId",
      { actorId: actor.id },
    );
  }

  private async requireAccessibleProject(
    actor: AuthenticatedUser,
    projectId: string,
  ): Promise<ProjectEntity> {
    const project = await this.projects.findOne({
      where: { id: projectId },
      relations: { participants: true },
    });

    if (!project) {
      throw new NotFoundException("El proyecto no existe.");
    }

    if (
      !canReadAllProjects(actor) &&
      !project.participants.some((participant) =>
        sameUuid(participant.userId, actor.id),
      )
    ) {
      throw new ForbiddenException("No tienes acceso a este proyecto.");
    }

    return project;
  }

  private requireManageAccess(
    actor: AuthenticatedUser,
    project: ProjectEntity,
  ): void {
    if (isAdministrator(actor)) {
      return;
    }

    const role = project.participants.find((participant) =>
      sameUuid(participant.userId, actor.id),
    )?.role;

    if (role !== "OWNER" && role !== "EDITOR") {
      throw new ForbiddenException(
        "No tienes autorización para modificar este proyecto.",
      );
    }
  }

  private requireOwnerAccess(
    actor: AuthenticatedUser,
    project: ProjectEntity,
  ): void {
    if (isAdministrator(actor)) {
      return;
    }

    const role = project.participants.find((participant) =>
      sameUuid(participant.userId, actor.id),
    )?.role;

    if (role !== "OWNER") {
      throw new ForbiddenException(
        "Solo el propietario puede administrar participantes o eliminar el proyecto.",
      );
    }
  }

  private async loadParticipantCounts(
    projectIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const rows = await this.participants
      .createQueryBuilder("participant")
      .select("participant.projectId", "projectId")
      .addSelect("COUNT(1)", "participantCount")
      .where("participant.projectId IN (:...projectIds)", { projectIds })
      .groupBy("participant.projectId")
      .getRawMany<{ projectId: string; participantCount: number | string }>();

    return new Map(
      rows.map((row) => [row.projectId, Number(row.participantCount)]),
    );
  }

  private toSummary(
    project: ProjectEntity,
    participantCount: number,
  ): ProjectSummary {
    return {
      id: normalizeUuid(project.id),
      code: project.code,
      title: project.title,
      requestingArea: project.requestingArea,
      description: project.description,
      status: project.status,
      activityState: project.activityState ?? "ACTIVE",
      template:
        project.templateId &&
        project.templateCode &&
        project.templateName &&
        project.templateVersion &&
        project.templateType
          ? {
              id: normalizeUuid(project.templateId),
              code: project.templateCode,
              name: project.templateName,
              version: project.templateVersion,
              templateType: project.templateType,
            }
          : null,
      ownerUserId: normalizeUuid(project.ownerUserId),
      participantCount,
      createdAt: toIso(project.createdAt),
      updatedAt: toIso(project.updatedAt),
    };
  }

  private toParticipant(
    participant: ProjectParticipantEntity,
  ): ProjectParticipant {
    return {
      id: normalizeUuid(participant.id),
      userId: normalizeUuid(participant.userId),
      role: participant.role,
      createdAt: toIso(participant.createdAt),
    };
  }

  private toDetail(project: ProjectEntity): ProjectDetail {
    const participants = [...(project.participants ?? [])].sort((left, right) =>
      left.role.localeCompare(right.role),
    );

    return {
      ...this.toSummary(project, participants.length),
      participants: participants.map((participant) =>
        this.toParticipant(participant),
      ),
    };
  }
}
