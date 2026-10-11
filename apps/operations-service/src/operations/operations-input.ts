import { BadRequestException } from "@nestjs/common";

import {
  AUDIT_RESULTS,
  EXECUTION_TASK_SOURCES,
  EXECUTION_TASK_STATES,
  EXPORT_FORMATS,
  type AuditResult,
  type CreateExportRequest,
  type ExecutionTaskSource,
  type ExecutionTaskState,
  type ExportFormat,
} from "@levantamiento-rq/shared-contracts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: string, name: string): string {
  if (!UUID_PATTERN.test(value.trim())) {
    throw new BadRequestException(`${name} debe ser un UUID válido.`);
  }
  return value.trim().toLowerCase();
}

export const parseProjectId = (value: string) => uuid(value, "projectId");
export const parseDocumentId = (value: string) => uuid(value, "documentId");
export const parseExportRequestId = (value: string) =>
  uuid(value, "exportRequestId");
export const parseNotificationId = (value: string) =>
  uuid(value, "notificationId");

export interface NotificationListQuery {
  page: number;
  pageSize: number;
  state: "ALL" | "UNREAD" | "READ";
}

export interface AuditEventListQuery {
  page: number;
  pageSize: number;
  action: string | null;
  resourceType: string | null;
  result: AuditResult | null;
  correlationId: string | null;
  from: Date | null;
  to: Date | null;
}

function optionalText(
  value: unknown,
  name: string,
  maximum: number,
): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maximum) {
    throw new BadRequestException(`${name} no es válido.`);
  }
  return value.trim();
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(`${name} no es válido.`);
  }
  return parsed;
}

function optionalDate(value: unknown, name: string): Date | null {
  const text = optionalText(value, name, 40);
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.valueOf())) {
    throw new BadRequestException(`${name} debe ser una fecha ISO válida.`);
  }
  return parsed;
}

export function parseNotificationListQuery(
  value: Readonly<Record<string, unknown>>,
): NotificationListQuery {
  const state = optionalText(value.state, "state", 20)?.toUpperCase() ?? "ALL";
  if (state !== "ALL" && state !== "UNREAD" && state !== "READ") {
    throw new BadRequestException("state debe ser ALL, UNREAD o READ.");
  }
  return {
    page: integer(value.page, 1, 1, 1_000_000, "page"),
    pageSize: integer(value.pageSize, 20, 1, 100, "pageSize"),
    state,
  };
}

export function parseAuditEventListQuery(
  value: Readonly<Record<string, unknown>>,
): AuditEventListQuery {
  const result =
    optionalText(value.result, "result", 20)?.toUpperCase() ?? null;
  if (result && !AUDIT_RESULTS.includes(result as AuditResult)) {
    throw new BadRequestException("result no es válido.");
  }
  const correlationId = optionalText(value.correlationId, "correlationId", 64);
  if (correlationId && !UUID_PATTERN.test(correlationId)) {
    throw new BadRequestException("correlationId debe ser un UUID válido.");
  }
  const from = optionalDate(value.from, "from");
  const to = optionalDate(value.to, "to");
  if (from && to && from > to) {
    throw new BadRequestException("from no puede ser posterior a to.");
  }
  return {
    page: integer(value.page, 1, 1, 1_000_000, "page"),
    pageSize: integer(value.pageSize, 50, 1, 100, "pageSize"),
    action: optionalText(value.action, "action", 120)?.toUpperCase() ?? null,
    resourceType: optionalText(value.resourceType, "resourceType", 80),
    result: result as AuditResult | null,
    correlationId: correlationId?.toLowerCase() ?? null,
    from,
    to,
  };
}

export function parseVersionNumber(value: string): number {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > 1_000_000) {
    throw new BadRequestException("versionNumber no es válido.");
  }
  return result;
}

export function parseCreateExport(value: unknown): CreateExportRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }
  const format = (value as Readonly<Record<string, unknown>>).format;
  if (
    typeof format !== "string" ||
    !EXPORT_FORMATS.includes(format as ExportFormat)
  ) {
    throw new BadRequestException("format debe ser PDF, DOCX o MARKDOWN.");
  }
  return { format: format as ExportFormat };
}

export interface ParsedExecutionTaskUpdate {
  taskCode: string;
  state: ExecutionTaskState;
  source: ExecutionTaskSource;
  note: string | null;
  completedAt: Date | null;
}

const MAX_EXECUTION_TASK_UPDATES = 500;

/** Normaliza el código de una tarea para comparar sin importar mayúsculas ni espacios. */
export function normalizeExecutionTaskCode(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toUpperCase();
}

export function parseExecutionTaskUpdates(
  body: unknown,
): ParsedExecutionTaskUpdate[] {
  const items =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as { items?: unknown }).items
      : undefined;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > MAX_EXECUTION_TASK_UPDATES
  ) {
    throw new BadRequestException(
      `items debe contener entre 1 y ${MAX_EXECUTION_TASK_UPDATES} tareas.`,
    );
  }
  const seen = new Set<string>();
  return items.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new BadRequestException(`items[${index}] no es válido.`);
    }
    const item = raw as Readonly<Record<string, unknown>>;
    const code =
      typeof item.taskCode === "string"
        ? normalizeExecutionTaskCode(item.taskCode)
        : "";
    if (!code || code.length > 120) {
      throw new BadRequestException(`items[${index}].taskCode no es válido.`);
    }
    if (seen.has(code)) {
      throw new BadRequestException(`La tarea ${code} está repetida.`);
    }
    seen.add(code);
    if (!EXECUTION_TASK_STATES.includes(item.state as ExecutionTaskState)) {
      throw new BadRequestException(`items[${index}].state no es válido.`);
    }
    const state = item.state as ExecutionTaskState;
    const source =
      item.source === undefined || item.source === null
        ? "MANUAL"
        : (item.source as ExecutionTaskSource);
    if (!EXECUTION_TASK_SOURCES.includes(source)) {
      throw new BadRequestException(`items[${index}].source no es válido.`);
    }
    const note = optionalText(item.note, `items[${index}].note`, 1000);
    const reported = optionalDate(item.completedAt, `items[${index}].completedAt`);
    return {
      taskCode: code,
      state,
      source,
      note,
      completedAt: state === "DONE" ? (reported ?? new Date()) : null,
    };
  });
}
