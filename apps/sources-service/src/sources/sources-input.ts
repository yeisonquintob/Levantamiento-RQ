import { BadRequestException } from "@nestjs/common";

import {
  SOURCE_CLASSIFICATIONS,
  SOURCE_PROCESSING_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  TEXT_SOURCE_TYPES,
  type CreateTextSourceRequest,
  type SourceClassification,
  type SourceProcessingStatus,
  type SourceStatus,
  type SourceUploadFileMetadata,
  type SourceType,
  type TextSourceType,
  type UpdateSourceRequest,
} from "@levantamiento-rq/shared-contracts";

export interface SourceListQuery {
  search: string;
  sourceType: SourceType | null;
  processingStatus: SourceProcessingStatus | null;
  status: SourceStatus | null;
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

function requiredClassification(
  value: unknown,
  field = "classification",
): SourceClassification {
  if (
    typeof value !== "string" ||
    !SOURCE_CLASSIFICATIONS.includes(value as SourceClassification)
  ) {
    throw new BadRequestException(
      `${field} debe contener una clasificación válida.`,
    );
  }

  return value as SourceClassification;
}

function optionalSourceType(value: unknown): SourceType | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !SOURCE_TYPES.includes(value as SourceType)
  ) {
    throw new BadRequestException("El tipo de fuente no es válido.");
  }

  return value as SourceType;
}

function optionalProcessingStatus(
  value: unknown,
): SourceProcessingStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !SOURCE_PROCESSING_STATUSES.includes(
      value as SourceProcessingStatus,
    )
  ) {
    throw new BadRequestException(
      "El estado de procesamiento no es válido.",
    );
  }

  return value as SourceProcessingStatus;
}

function optionalStatus(value: unknown): SourceStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (
    typeof value !== "string" ||
    !SOURCE_STATUSES.includes(value as SourceStatus)
  ) {
    throw new BadRequestException("El estado de la fuente no es válido.");
  }

  return value as SourceStatus;
}

export function parseProjectId(value: string): string {
  return requiredUuid(value, "projectId");
}

export function parseSourceId(value: string): string {
  return requiredUuid(value, "sourceId");
}

export function parseCreateTextSource(
  value: unknown,
): CreateTextSourceRequest {
  const record = asRecord(value);
  const sourceType = record.sourceType;

  if (
    typeof sourceType !== "string" ||
    !TEXT_SOURCE_TYPES.includes(sourceType as TextSourceType)
  ) {
    throw new BadRequestException(
      "sourceType debe ser NOTE, CONVERSATION o TRANSCRIPT.",
    );
  }

  return {
    sourceType: sourceType as TextSourceType,
    title: requiredText(record, "title", 3, 240),
    content: requiredText(record, "content", 1, 200000),
  };
}

export function parseUpdateSource(value: unknown): UpdateSourceRequest {
  const record = asRecord(value);
  const result: UpdateSourceRequest = {};

  if (record.title !== undefined) {
    result.title = requiredText(record, "title", 3, 240);
  }

  if (record.content !== undefined) {
    result.content = requiredText(record, "content", 1, 200000);
  }

  if (record.description !== undefined) {
    result.description = optionalText(record, "description", 2000);
  }

  if (record.classification !== undefined) {
    result.classification = requiredClassification(record.classification);
  }

  if (Object.keys(result).length === 0) {
    throw new BadRequestException(
      "Debes enviar al menos un campo para actualizar.",
    );
  }

  return result;
}

export function parseUploadMetadata(
  value: unknown,
): readonly SourceUploadFileMetadata[] {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(
      "Debes clasificar y describir los archivos antes de cargarlos.",
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new BadRequestException(
      "La configuración de los archivos no contiene JSON válido.",
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 20) {
    throw new BadRequestException(
      "La configuración debe contener entre 1 y 20 archivos.",
    );
  }

  return parsed.map((item, index) => {
    const record = asRecord(item);

    return {
      fileName: requiredText(record, "fileName", 1, 260),
      classification: requiredClassification(
        record.classification,
        `metadata[${index}].classification`,
      ),
      description: optionalText(record, "description", 2000) ?? null,
    };
  });
}

export function parseSourceListQuery(value: unknown): SourceListQuery {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};

  const rawSearch = record.search;
  const search =
    typeof rawSearch === "string" ? rawSearch.trim().slice(0, 240) : "";

  return {
    search,
    sourceType: optionalSourceType(record.sourceType),
    processingStatus: optionalProcessingStatus(record.processingStatus),
    status: optionalStatus(record.status),
    page: readInteger(record.page, 1, 1, 100000, "page"),
    pageSize: readInteger(record.pageSize, 20, 1, 50, "pageSize"),
  };
}
