import { BadRequestException } from "@nestjs/common";

import {
  EXPORT_FORMATS,
  type CreateExportRequest,
  type ExportFormat,
} from "@levantamiento-rq/shared-contracts";

function uuid(value: string, name: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(`${name} debe ser un UUID válido.`);
  }
  return value.trim().toLowerCase();
}

export const parseProjectId = (value: string) => uuid(value, "projectId");
export const parseDocumentId = (value: string) => uuid(value, "documentId");
export const parseExportRequestId = (value: string) =>
  uuid(value, "exportRequestId");

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
    throw new BadRequestException("format debe ser PDF o DOCX.");
  }
  return { format: format as ExportFormat };
}
