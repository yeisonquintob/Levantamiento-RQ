import { BadRequestException } from "@nestjs/common";

import {
  AI_DRAFT_GENERATION_PURPOSES,
  AI_ANALYSIS_STATUSES,
  AI_ANALYSIS_TYPES,
  type AiAnalysisStatus,
  type CreateAiAnalysisRequest,
  type ReviewAiAnalysisResult,
} from "@levantamiento-rq/shared-contracts";

export interface AiAnalysisRequestListQuery {
  status: AiAnalysisStatus | null;
  page: number;
  pageSize: number;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(`${name} debe ser un UUID válido.`);
  }

  return value.trim().toLowerCase();
}

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function integer(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const raw = first(value);

  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(
      `${name} debe estar entre ${minimum} y ${maximum}.`,
    );
  }

  return parsed;
}

export function parseProjectId(value: string): string {
  return uuid(value, "projectId");
}

export function parseAnalysisRequestId(value: string): string {
  return uuid(value, "analysisRequestId");
}

export function parseCreateAiAnalysisRequest(
  value: unknown,
): CreateAiAnalysisRequest {
  const record = asRecord(value);
  const analysisType = record.analysisType ?? "REQUIREMENT_DOCUMENT";

  if (
    typeof analysisType !== "string" ||
    !AI_ANALYSIS_TYPES.includes(
      analysisType as (typeof AI_ANALYSIS_TYPES)[number],
    )
  ) {
    throw new BadRequestException(
      "analysisType debe ser REQUIREMENT_DOCUMENT.",
    );
  }

  if (
    !Array.isArray(record.sourceIds) ||
    record.sourceIds.length < 1 ||
    record.sourceIds.length > 100
  ) {
    throw new BadRequestException(
      "sourceIds debe contener entre 1 y 100 fuentes.",
    );
  }

  const sourceIds = record.sourceIds.map((item, index) =>
    uuid(item, `sourceIds[${index}]`),
  );

  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new BadRequestException("sourceIds no puede contener duplicados.");
  }

  const purpose = record.purpose ?? "INITIAL_DRAFT";
  if (
    typeof purpose !== "string" ||
    !AI_DRAFT_GENERATION_PURPOSES.includes(
      purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
    )
  ) {
    throw new BadRequestException(
      "purpose debe ser INITIAL_DRAFT o AI_VERSION.",
    );
  }

  let instruction: string | null = null;
  if (
    record.instruction !== undefined &&
    record.instruction !== null &&
    record.instruction !== ""
  ) {
    if (
      typeof record.instruction !== "string" ||
      record.instruction.trim().length > 2000
    ) {
      throw new BadRequestException(
        "instruction no puede superar 2000 caracteres.",
      );
    }
    instruction = record.instruction.trim();
  }

  let idempotencyKey: string | undefined;
  if (record.idempotencyKey !== undefined) {
    if (
      typeof record.idempotencyKey !== "string" ||
      !/^[A-Za-z0-9._:-]{8,120}$/.test(record.idempotencyKey.trim())
    ) {
      throw new BadRequestException(
        "idempotencyKey debe tener entre 8 y 120 caracteres seguros.",
      );
    }
    idempotencyKey = record.idempotencyKey.trim();
  }

  return {
    analysisType: "REQUIREMENT_DOCUMENT",
    documentId: uuid(record.documentId, "documentId"),
    documentVersionId: uuid(record.documentVersionId, "documentVersionId"),
    sourceIds,
    purpose: purpose as (typeof AI_DRAFT_GENERATION_PURPOSES)[number],
    instruction,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

export function parseAiAnalysisRequestListQuery(
  value: unknown,
): AiAnalysisRequestListQuery {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Readonly<Record<string, unknown>>)
      : {};
  const rawStatus = first(record.status);
  let status: AiAnalysisStatus | null = null;

  if (rawStatus !== undefined && rawStatus !== null && rawStatus !== "") {
    if (
      typeof rawStatus !== "string" ||
      !AI_ANALYSIS_STATUSES.includes(
        rawStatus as (typeof AI_ANALYSIS_STATUSES)[number],
      )
    ) {
      throw new BadRequestException("status no es válido.");
    }

    status = rawStatus as AiAnalysisStatus;
  }

  return {
    status,
    page: integer(record.page, 1, 1, 100000, "page"),
    pageSize: integer(record.pageSize, 25, 1, 100, "pageSize"),
  };
}

export function parseReviewAiAnalysisResult(
  value: unknown,
): ReviewAiAnalysisResult {
  const record = asRecord(value);
  let expectedDocumentRevision: number | undefined;
  if (record.expectedDocumentRevision !== undefined) {
    expectedDocumentRevision = integer(
      record.expectedDocumentRevision,
      1,
      1,
      1_000_000,
      "expectedDocumentRevision",
    );
  }
  let comment: string | null = null;
  if (
    record.comment !== undefined &&
    record.comment !== null &&
    record.comment !== ""
  ) {
    if (
      typeof record.comment !== "string" ||
      record.comment.trim().length > 2000
    ) {
      throw new BadRequestException(
        "comment no puede superar 2000 caracteres.",
      );
    }
    comment = record.comment.trim();
  }
  return { expectedDocumentRevision, comment };
}
