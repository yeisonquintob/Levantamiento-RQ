import { BadRequestException } from "@nestjs/common";

import {
  PROJECT_PARTICIPANT_ROLES,
  PROJECT_STATUSES,
  type AddProjectParticipantRequest,
  type CreateProjectRequest,
  type ProjectParticipantRole,
  type ProjectStatus,
  type UpdateProjectRequest,
} from "@levantamiento-rq/shared-contracts";

export interface ProjectListQuery {
  search: string;
  status: ProjectStatus | null;
  page: number;
  pageSize: number;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function requiredText(
  record: Readonly<Record<string, unknown>>,
  field: string,
  minimum: number,
  maximum: number,
): string {
  const value = record[field];

  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.trim().length > maximum
  ) {
    throw new BadRequestException(
      `${field} debe tener entre ${minimum} y ${maximum} caracteres.`,
    );
  }

  return value.trim();
}

function optionalText(
  record: Readonly<Record<string, unknown>>,
  field: string,
  maximum: number,
): string | null | undefined {
  const value = record[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new BadRequestException(
      `${field} debe tener máximo ${maximum} caracteres.`,
    );
  }

  return value.trim() || null;
}

function optionalProjectStatus(value: unknown): ProjectStatus | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== "string" ||
    !PROJECT_STATUSES.includes(value as ProjectStatus)
  ) {
    throw new BadRequestException("El estado del proyecto no es válido.");
  }

  return value as ProjectStatus;
}

function requiredUuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new BadRequestException(`${field} debe ser un UUID válido.`);
  }

  return value.toLowerCase();
}

function readInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const resolved = Number(value);

  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new BadRequestException(
      `${field} debe estar entre ${minimum} y ${maximum}.`,
    );
  }

  return resolved;
}

export function parseCreateProject(value: unknown): CreateProjectRequest {
  const record = asRecord(value);

  return {
    title: requiredText(record, "title", 3, 200),
    requestingArea: requiredText(record, "requestingArea", 2, 160),
    description: optionalText(record, "description", 2000),
  };
}

export function parseUpdateProject(value: unknown): UpdateProjectRequest {
  const record = asRecord(value);
  const result: UpdateProjectRequest = {};

  if (record.title !== undefined) {
    result.title = requiredText(record, "title", 3, 200);
  }

  if (record.requestingArea !== undefined) {
    result.requestingArea = requiredText(record, "requestingArea", 2, 160);
  }

  if (record.description !== undefined) {
    result.description = optionalText(record, "description", 2000);
  }

  if (record.status !== undefined) {
    result.status = optionalProjectStatus(record.status);
  }

  if (Object.keys(result).length === 0) {
    throw new BadRequestException(
      "Debes enviar al menos un campo para actualizar.",
    );
  }

  return result;
}

export function parseProjectListQuery(value: unknown): ProjectListQuery {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};

  const rawSearch = record.search;
  const search =
    typeof rawSearch === "string" ? rawSearch.trim().slice(0, 200) : "";

  const rawStatus = record.status;
  let status: ProjectStatus | null = null;

  if (rawStatus !== undefined && rawStatus !== "") {
    status = optionalProjectStatus(rawStatus) ?? null;
  }

  return {
    search,
    status,
    page: readInteger(record.page, 1, 1, 100000, "page"),
    pageSize: readInteger(record.pageSize, 20, 1, 50, "pageSize"),
  };
}

export function parseAddParticipant(
  value: unknown,
): AddProjectParticipantRequest {
  const record = asRecord(value);
  const role = record.role;

  if (
    typeof role !== "string" ||
    !PROJECT_PARTICIPANT_ROLES.includes(role as ProjectParticipantRole) ||
    role === "OWNER"
  ) {
    throw new BadRequestException("role debe ser EDITOR, REVIEWER o VIEWER.");
  }

  return {
    userId: requiredUuid(record.userId, "userId"),
    role: role as AddProjectParticipantRequest["role"],
  };
}

export function parseProjectId(value: string): string {
  return requiredUuid(value, "projectId");
}

export function parseParticipantUserId(value: string): string {
  return requiredUuid(value, "userId");
}
