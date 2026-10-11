import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, Repository } from "typeorm";

import {
  PROJECT_AREA_COLORS,
  PROJECT_AREA_ICONS,
  type AuthenticatedUser,
  type ProjectAreaColor,
  type ProjectAreaIcon,
  type ProjectAreaListResponse,
  type ProjectAreaSummary,
} from "@levantamiento-rq/shared-contracts";

import { ProjectAreaEntity } from "./project-area.entity";
import { ProjectEntity } from "./project.entity";

function isAdministrator(actor: AuthenticatedUser): boolean {
  return (
    actor.roles.some((role) => role.toUpperCase() === "ADMIN") ||
    actor.permissions.includes("system.admin")
  );
}

export interface ParsedAreaInput {
  name?: string;
  icon?: ProjectAreaIcon | null;
  color?: ProjectAreaColor | null;
}

/** `requireName`: al crear el nombre es obligatorio; al editar basta con enviar nombre o icono. */
export function parseAreaInput(
  value: unknown,
  requireName: boolean,
): ParsedAreaInput {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result: ParsedAreaInput = {};
  if (record.name !== undefined || requireName) {
    const name = record.name;
    if (
      typeof name !== "string" ||
      name.trim().length < 2 ||
      name.trim().length > 160
    ) {
      throw new BadRequestException(
        "name debe tener entre 2 y 160 caracteres.",
      );
    }
    result.name = name.trim().replace(/\s+/gu, " ");
  }
  if (record.icon !== undefined) {
    if (
      record.icon !== null &&
      !PROJECT_AREA_ICONS.includes(record.icon as ProjectAreaIcon)
    ) {
      throw new BadRequestException("El icono del área no es válido.");
    }
    result.icon = record.icon as ProjectAreaIcon | null;
  }
  if (record.color !== undefined) {
    if (
      record.color !== null &&
      !PROJECT_AREA_COLORS.includes(record.color as ProjectAreaColor)
    ) {
      throw new BadRequestException("El color del área no es válido.");
    }
    result.color = record.color as ProjectAreaColor | null;
  }
  if (
    result.name === undefined &&
    result.icon === undefined &&
    result.color === undefined
  ) {
    throw new BadRequestException(
      "Envía el nombre, el icono o el color del área.",
    );
  }
  return result;
}

function asColor(value: string | null): ProjectAreaColor | null {
  return value && PROJECT_AREA_COLORS.includes(value as ProjectAreaColor)
    ? (value as ProjectAreaColor)
    : null;
}

function asIcon(value: string | null): ProjectAreaIcon | null {
  return value && PROJECT_AREA_ICONS.includes(value as ProjectAreaIcon)
    ? (value as ProjectAreaIcon)
    : null;
}

@Injectable()
export class ProjectAreasService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ProjectAreaEntity)
    private readonly areas: Repository<ProjectAreaEntity>,
  ) {}

  private requireAdministrator(actor: AuthenticatedUser): void {
    if (!isAdministrator(actor)) {
      throw new ForbiddenException(
        "Solo un administrador puede modificar el catálogo de áreas.",
      );
    }
  }

  async list(): Promise<ProjectAreaListResponse> {
    const rows = await this.areas.find({ order: { name: "ASC" } });
    const counts = await this.dataSource
      .getRepository(ProjectEntity)
      .createQueryBuilder("project")
      .select("project.requestingArea", "area")
      .addSelect("COUNT(1)", "total")
      .where("project.activityState <> 'DELETED'")
      .groupBy("project.requestingArea")
      .getRawMany<{ area: string; total: number | string }>();
    const byName = new Map(
      counts.map((row) => [row.area.toLowerCase(), Number(row.total)]),
    );
    return {
      items: rows.map((row): ProjectAreaSummary => ({
        id: row.id.toLowerCase(),
        name: row.name,
        icon: asIcon(row.icon),
        color: asColor(row.color),
        projectCount: byName.get(row.name.toLowerCase()) ?? 0,
      })),
    };
  }

  async create(
    actor: AuthenticatedUser,
    input: ParsedAreaInput,
  ): Promise<ProjectAreaSummary> {
    this.requireAdministrator(actor);
    const name = input.name ?? "";
    await this.requireUniqueName(name);
    const saved = await this.areas.save(
      this.areas.create({
        name,
        icon: input.icon ?? null,
        color: input.color ?? null,
        createdByUserId: actor.id,
      }),
    );
    return {
      id: saved.id.toLowerCase(),
      name: saved.name,
      icon: asIcon(saved.icon),
      color: asColor(saved.color),
      projectCount: 0,
    };
  }

  /** Cambiar el nombre también actualiza el área escrita en los proyectos que la usan. */
  async update(
    actor: AuthenticatedUser,
    id: string,
    input: ParsedAreaInput,
  ): Promise<ProjectAreaSummary> {
    this.requireAdministrator(actor);
    const area = await this.requireArea(id);
    const previous = area.name;
    if (
      input.name !== undefined &&
      input.name.toLowerCase() !== previous.toLowerCase()
    ) {
      await this.requireUniqueName(input.name);
    }
    await this.dataSource.transaction(async (manager) => {
      if (input.name !== undefined) area.name = input.name;
      if (input.icon !== undefined) area.icon = input.icon;
      if (input.color !== undefined) area.color = input.color;
      await manager.getRepository(ProjectAreaEntity).save(area);
      if (input.name !== undefined && input.name !== previous) {
        await manager
          .getRepository(ProjectEntity)
          .update({ requestingArea: previous }, { requestingArea: input.name });
      }
    });
    const summary = (await this.list()).items.find(
      (item) => item.id === area.id.toLowerCase(),
    );
    return (
      summary ?? {
        id: area.id.toLowerCase(),
        name: area.name,
        icon: asIcon(area.icon),
        color: asColor(area.color),
        projectCount: 0,
      }
    );
  }

  /** Quitar un área del catálogo no cambia el área escrita en los proyectos existentes. */
  async remove(actor: AuthenticatedUser, id: string): Promise<{ id: string }> {
    this.requireAdministrator(actor);
    const area = await this.requireArea(id);
    await this.areas.remove(area);
    return { id: id.toLowerCase() };
  }

  private async requireArea(id: string): Promise<ProjectAreaEntity> {
    const area = await this.areas.findOneBy({ id });
    if (!area) throw new NotFoundException("El área no existe.");
    return area;
  }

  private async requireUniqueName(name: string): Promise<void> {
    const existing = await this.areas
      .createQueryBuilder("area")
      .where("LOWER(area.name) = :name", { name: name.toLowerCase() })
      .getCount();
    if (existing > 0) {
      throw new ConflictException("Ya existe un área con ese nombre.");
    }
  }
}
