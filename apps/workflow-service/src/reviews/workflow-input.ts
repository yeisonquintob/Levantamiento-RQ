import { BadRequestException } from "@nestjs/common";

import type {
  AddWorkflowCommentRequest,
  CreateWorkflowReviewRequest,
  DecideWorkflowReviewRequest,
} from "@levantamiento-rq/shared-contracts";

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("El cuerpo de la solicitud no es válido.");
  }

  return value as Readonly<Record<string, unknown>>;
}

function uuid(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(`${field} debe ser un UUID válido.`);
  }

  return value.trim().toLowerCase();
}

function integer(value: unknown, field: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
    throw new BadRequestException(`${field} debe ser un entero positivo.`);
  }

  return parsed;
}

function optionalComment(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 4000) {
    throw new BadRequestException("comment no puede superar 4000 caracteres.");
  }

  return value.trim();
}

function requiredComment(value: unknown): string {
  const resolved = optionalComment(value);

  if (!resolved) {
    throw new BadRequestException("comment es obligatorio.");
  }

  return resolved;
}

export function parseProjectId(value: string): string {
  return uuid(value, "projectId");
}

export function parseDocumentId(value: string): string {
  return uuid(value, "documentId");
}

export function parseReviewId(value: string): string {
  return uuid(value, "reviewId");
}

export function parseVersionNumber(value: string): number {
  return integer(value, "versionNumber");
}

export function parseCreateReview(value: unknown): CreateWorkflowReviewRequest {
  const record = asRecord(value);

  return {
    expectedDocumentRevision: integer(
      record.expectedDocumentRevision,
      "expectedDocumentRevision",
    ),
    comment: optionalComment(record.comment),
  };
}

export function parseAddComment(value: unknown): AddWorkflowCommentRequest {
  const record = asRecord(value);

  return {
    expectedReviewRevision: integer(
      record.expectedReviewRevision,
      "expectedReviewRevision",
    ),
    comment: requiredComment(record.comment),
  };
}

export function parseDecision(value: unknown): DecideWorkflowReviewRequest {
  const record = asRecord(value);

  return {
    expectedReviewRevision: integer(
      record.expectedReviewRevision,
      "expectedReviewRevision",
    ),
    expectedDocumentRevision: integer(
      record.expectedDocumentRevision,
      "expectedDocumentRevision",
    ),
    comment: optionalComment(record.comment),
  };
}
