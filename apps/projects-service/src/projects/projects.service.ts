import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository, SelectQueryBuilder } from "typeorm";

import type {
  AddProjectParticipantRequest,
  AuthenticatedUser,
  CreateProjectRequest,
  ProjectDetail,
  ProjectListResponse,
  ProjectMetrics,
  ProjectParticipant,
  ProjectSummary,
  UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";

import { ProjectParticipantEntity } from "./project-participant.entity";
import { ProjectEntity } from "./project.entity";
import type { ProjectListQuery } from "./projects-input";

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

function toIso(value: Date): string {
  return value.toISOString();
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ProjectParticipantEntity)
    private readonly participants: Repository<ProjectParticipantEntity>,
  ) {}

  async create(
    actor: AuthenticatedUser,
    request: CreateProjectRequest,
  ): Promise<ProjectDetail> {
    return this.dataSource.transaction(async (manager) => {
      const sequenceRows = (await manager.query(
        "SELECT NEXT VALUE FOR dbo.ProjectCodeSequence AS sequenceValue",
      )) as Array<{ sequenceValue: number | string }>;

      const sequenceValue = Number(sequenceRows[0]?.sequenceValue);

      if (!Number.isSafeInteger(sequenceValue) || sequenceValue < 1) {
        throw new Error("No fue posible generar el código del proyecto.");
      }

      const now = new Date();
      const code = `RQ-${now.getUTCFullYear()}-${String(sequenceValue).padStart(
        6,
        "0",
      )}`;

      const projectRepository = manager.getRepository(ProjectEntity);
      const participantRepository = manager.getRepository(
        ProjectParticipantEntity,
      );

      const project = projectRepository.create({
        code,
        title: request.title,
        requestingArea: request.requestingArea,
        description: request.description ?? null,
        status: "DRAFT",
        ownerUserId: actor.id,
        createdByUserId: actor.id,
        updatedByUserId: actor.id,
        createdAt: now,
        updatedAt: now,
      });

      const savedProject = await projectRepository.save(project);

      const owner = participantRepository.create({
        projectId: savedProject.id,
        userId: actor.id,
        role: "OWNER",
        addedByUserId: actor.id,
        createdAt: now,
      });

      await participantRepository.save(owner);

      savedProject.participants = [owner];

      return this.toDetail(savedProject);
    });
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

    if (query.status) {
      base.andWhere("project.status = :status", { status: query.status });
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
      .select("COUNT(1)", "total")
      .addSelect(
        "SUM(CASE WHEN project.status = 'DRAFT' THEN 1 ELSE 0 END)",
        "draft",
      )
      .addSelect(
        "SUM(CASE WHEN project.status = 'IN_PROGRESS' THEN 1 ELSE 0 END)",
        "inProgress",
      )
      .addSelect(
        "SUM(CASE WHEN project.status = 'VALIDATION' THEN 1 ELSE 0 END)",
        "validation",
      )
      .addSelect(
        "SUM(CASE WHEN project.status = 'APPROVED' THEN 1 ELSE 0 END)",
        "approved",
      )
      .addSelect(
        "SUM(CASE WHEN project.status = 'ARCHIVED' THEN 1 ELSE 0 END)",
        "archived",
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
      archived: numberValue("archived"),
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

    if (request.title !== undefined) {
      project.title = request.title;
    }

    if (request.requestingArea !== undefined) {
      project.requestingArea = request.requestingArea;
    }

    if (request.description !== undefined) {
      project.description = request.description;
    }

    if (request.status !== undefined) {
      project.status = request.status;
    }

    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();

    await this.projects.save(project);

    return this.toDetail(project);
  }

  async addParticipant(
    actor: AuthenticatedUser,
    projectId: string,
    request: AddProjectParticipantRequest,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireOwnerAccess(actor, project);

    const existing = project.participants.find(
      (participant) => participant.userId === request.userId,
    );

    if (existing) {
      throw new ConflictException("El usuario ya participa en este proyecto.");
    }

    const participant = this.participants.create({
      projectId: project.id,
      userId: request.userId,
      role: request.role,
      addedByUserId: actor.id,
      createdAt: new Date(),
    });

    await this.participants.save(participant);
    project.participants.push(participant);
    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();
    await this.projects.save(project);

    return this.toDetail(project);
  }

  async removeParticipant(
    actor: AuthenticatedUser,
    projectId: string,
    userId: string,
  ): Promise<ProjectDetail> {
    const project = await this.requireAccessibleProject(actor, projectId);
    this.requireOwnerAccess(actor, project);

    if (project.ownerUserId === userId) {
      throw new ConflictException(
        "El propietario del proyecto no puede ser retirado.",
      );
    }

    const participant = project.participants.find(
      (item) => item.userId === userId,
    );

    if (!participant) {
      throw new NotFoundException("El participante no existe.");
    }

    await this.participants.remove(participant);
    project.participants = project.participants.filter(
      (item) => item.id !== participant.id,
    );
    project.updatedByUserId = actor.id;
    project.updatedAt = new Date();
    await this.projects.save(project);

    return this.toDetail(project);
  }

  private applyAccess(
    query: SelectQueryBuilder<ProjectEntity>,
    actor: AuthenticatedUser,
  ): void {
    if (isAdministrator(actor)) {
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
      !isAdministrator(actor) &&
      !project.participants.some(
        (participant) => participant.userId === actor.id,
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

    const role = project.participants.find(
      (participant) => participant.userId === actor.id,
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

    const role = project.participants.find(
      (participant) => participant.userId === actor.id,
    )?.role;

    if (role !== "OWNER") {
      throw new ForbiddenException(
        "Solo el propietario puede administrar participantes.",
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
      id: project.id,
      code: project.code,
      title: project.title,
      requestingArea: project.requestingArea,
      description: project.description,
      status: project.status,
      ownerUserId: project.ownerUserId,
      participantCount,
      createdAt: toIso(project.createdAt),
      updatedAt: toIso(project.updatedAt),
    };
  }

  private toParticipant(
    participant: ProjectParticipantEntity,
  ): ProjectParticipant {
    return {
      id: participant.id,
      userId: participant.userId,
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
